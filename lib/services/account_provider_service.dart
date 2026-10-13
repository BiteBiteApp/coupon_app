import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'app_error_text.dart';
import 'existing_google_password_link.dart';
import 'registration_diagnostics.dart';

typedef ConfirmAccountPassword = Future<String?> Function(String email);
// Returns a freshly confirmed Google ID token, or null when cancelled.
typedef ConfirmGoogleAccount = Future<String?> Function(String email);

/// The two existing Google entry points share one foreground association flow.
/// Credentials live only on its stack; no email/provider discovery or data move.
class AccountProviderService {
  AccountProviderService({
    required FirebaseAuth auth,
    bool? isWeb,
    Future<AuthCredential> Function()? googleCredential,
    ExistingGooglePasswordLink? passwordLink,
  }) : _auth = auth,
       _isWeb = isWeb ?? kIsWeb,
       _googleCredential = googleCredential ?? _nativeGoogleCredential,
       _passwordLink = passwordLink;

  static AccountProviderService? _shared;
  static AccountProviderService get instance =>
      _shared ??= AccountProviderService(auth: FirebaseAuth.instance);
  static void cancelCurrentOperation() => _shared?.cancelPending();
  static final _activity = ValueNotifier<bool>(false);
  static ValueListenable<bool> get activity => _activity;
  static bool _lastOperationSucceeded = false;
  static bool get lastOperationSucceeded => _lastOperationSucceeded;
  static void requireNoPendingOperation() {
    if (_activity.value) throw FirebaseAuthException(code: 'flow-in-progress');
  }

  static const webServerClientId =
      '253983587346-bqkv4qsf93390ctdjctpq9nuup2r9lhe.apps.googleusercontent.com';

  final FirebaseAuth _auth;
  final bool _isWeb;
  final Future<AuthCredential> Function() _googleCredential;
  final ExistingGooglePasswordLink? _passwordLink;
  _ProviderOperation? _active;
  bool _passwordResetPending = false;

  static bool isPasswordResetEmailValid(String email) =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email.trim());

  /// Uses Firebase's configured email action handler without changing the
  /// current session, providers or account data. A request is not delivery proof.
  Future<void> sendPasswordResetEmail(String email) async {
    if (!isPasswordResetEmailValid(email)) {
      throw FirebaseAuthException(code: 'invalid-email');
    }
    if (_passwordResetPending) {
      throw FirebaseAuthException(code: 'too-many-requests');
    }
    _passwordResetPending = true;
    try {
      await _auth.sendPasswordResetEmail(email: email.trim());
    } on FirebaseAuthException catch (error) {
      // Match the generic accepted response even when enumeration protection
      // is unavailable. Never disclose whether an address/account can reset.
      if (error.code != 'user-not-found' && error.code != 'user-disabled') {
        rethrow;
      }
    } finally {
      _passwordResetPending = false;
    }
  }

  static Future<void>? _googleInitialization;
  static Future<void> initializeGoogle() =>
      _googleInitialization ??= GoogleSignIn.instance.initialize(
        clientId: kIsWeb ? webServerClientId : null,
        serverClientId: kIsWeb ? null : webServerClientId,
      );

  static bool hasProvider(User user, String provider) =>
      user.providerData.any((value) => value.providerId == provider);

  static bool wasCancelled(Object error) =>
      error is FirebaseAuthException &&
          const {
            'flow-cancelled',
            'popup-closed-by-user',
            'cancelled-popup-request',
            'web-context-cancelled',
          }.contains(error.code) ||
      error is GoogleSignInException &&
          error.code == GoogleSignInExceptionCode.canceled;

  static String errorText(Object error, {required String fallback}) {
    if (error is FirebaseAuthException) {
      switch (error.code) {
        case 'invalid-credential':
        case 'invalid-login-credentials':
        case 'wrong-password':
        case 'user-not-found':
          return 'Could not confirm those credentials. Please check your email '
              'and password, or use your original sign-in method.';
        case 'email-already-in-use':
        case 'credential-already-in-use':
          return 'This sign-in method belongs to an existing account. Sign in '
              'using its original method. No accounts have been combined.';
        case 'provider-already-linked':
          return 'This account already has a password. Use its existing password '
              'or your usual password recovery option. It has not been replaced.';
        case 'requires-recent-login':
        case 'user-token-expired':
        case 'invalid-user-token':
        case 'session-expired':
          return 'Your confirmation expired. Please sign in again and retry.';
        case 'user-mismatch':
        case 'email-mismatch':
          return 'Choose the Google account for this BiteStar account.';
        case 'unverified-account':
          return 'Verify the email on your existing account before adding a '
              'sign-in method. Then sign in again.';
        case 'account-exists-with-different-credential':
          return 'Sign in using your existing method to confirm this account, '
              'then retry Google sign-in.';
        case 'flow-in-progress':
          return 'Finish the current sign-in confirmation first.';
      }
    }
    return AppErrorText.friendly(error, fallback: fallback);
  }

  void cancelPending() => _active?.cancel();

  _ProviderOperation _begin(bool Function()? isActive) {
    if (_active != null) {
      throw FirebaseAuthException(code: 'flow-in-progress');
    }
    final operation = _active = _ProviderOperation(
      _auth,
      isActive ?? () => true,
    );
    _lastOperationSucceeded = false;
    _activity.value = true;
    return operation;
  }

  Future<void> _finish(_ProviderOperation operation, bool succeeded) async {
    try {
      await operation.dispose();
    } finally {
      if (identical(_active, operation)) _active = null;
      _lastOperationSucceeded = succeeded && operation.isCurrent();
      _activity.value = false;
    }
  }

  static GoogleAuthProvider _googleProvider() =>
      GoogleAuthProvider()..setCustomParameters({'prompt': 'select_account'});

  static Future<AuthCredential> _nativeGoogleCredential() async {
    final google = GoogleSignIn.instance;
    await initializeGoogle();
    final account = await google.authenticate();
    final token = account.authentication.idToken;
    if (token == null) throw FirebaseAuthException(code: 'invalid-credential');
    return GoogleAuthProvider.credential(idToken: token);
  }

  Future<User> signInWithGoogle({
    required bool linkGuest,
    ConfirmAccountPassword? confirmPassword,
    bool Function()? isActive,
    Future<void> Function(User user, bool Function() isCurrent)?
    onAuthenticated,
  }) async {
    final operation = _begin(isActive);
    var succeeded = false;
    try {
      operation.check();
      final initialUser = _auth.currentUser;
      if (initialUser != null && !initialUser.isAnonymous) {
        throw FirebaseAuthException(
          code: 'already-signed-in',
          message: 'Sign out before selecting another Google account.',
        );
      }
      AuthCredential? googleCredential;
      if (!_isWeb) {
        googleCredential = await _googleCredential();
        operation.check();
      }
      Future<UserCredential> authenticate() => operation.signIn(
        () => _isWeb
            ? _auth.signInWithPopup(_googleProvider())
            : _auth.signInWithCredential(googleCredential!),
      );

      UserCredential result;
      try {
        if (linkGuest && initialUser != null && initialUser.isAnonymous) {
          try {
            operation.check();
            result = await operation.boundResult(
              () => _isWeb
                  ? initialUser.linkWithPopup(_googleProvider())
                  : initialUser.linkWithCredential(googleCredential!),
              signingIn: true,
            );
            operation.check();
          } on FirebaseAuthException catch (error) {
            operation.check();
            if (error.code != 'credential-already-in-use' &&
                error.code != 'email-already-in-use' &&
                error.code != 'provider-already-linked') {
              rethrow;
            }
            result = await authenticate();
          }
        } else {
          result = await authenticate();
        }
      } on FirebaseAuthException catch (error) {
        operation.check();
        if (error.code != 'account-exists-with-different-credential') rethrow;
        final email = error.email;
        final pending = error.credential ?? googleCredential;
        if (email == null ||
            pending?.providerId != 'google.com' ||
            confirmPassword == null) {
          rethrow;
        }
        final password = await confirmPassword(email);
        operation.check();
        if (password == null) {
          throw FirebaseAuthException(code: 'flow-cancelled');
        }
        result = await operation.signIn(
          () => _auth.signInWithEmailAndPassword(
            email: email,
            password: password,
          ),
        );
        final existing = result.user;
        if (existing == null) {
          throw FirebaseAuthException(code: 'invalid-credential');
        }
        await existing.reload();
        operation.check();
        final refreshed = _auth.currentUser!;
        if (!_sameEmail(refreshed.email, email)) {
          throw FirebaseAuthException(code: 'email-mismatch');
        }
        if (!refreshed.emailVerified) {
          throw FirebaseAuthException(code: 'unverified-account');
        }
        // Firebase verifies the pending Google credential. Never recover an
        // unverified password that trusted-provider sign-in has superseded.
        operation.check();
        result = await operation.boundResult(
          () => refreshed.linkWithCredential(pending!),
        );
        operation.check();
        if (result.user?.uid != refreshed.uid) {
          throw FirebaseAuthException(code: 'user-mismatch');
        }
      }
      operation.check();
      final user = result.user;
      if (user == null ||
          user.isAnonymous ||
          user.uid != _auth.currentUser?.uid) {
        throw FirebaseAuthException(code: 'flow-cancelled');
      }
      await user.reload();
      operation.check();
      final current = _auth.currentUser!;
      if (!hasProvider(current, 'google.com')) {
        throw FirebaseAuthException(code: 'invalid-credential');
      }
      await onAuthenticated?.call(current, operation.isCurrent);
      operation.check();
      succeeded = true;
      return current;
    } finally {
      await _finish(operation, succeeded);
    }
  }

  Future<User> authenticateWithEmail({
    required String email,
    required String password,
    required bool register,
    required bool linkGuest,
    ConfirmGoogleAccount? confirmGoogle,
    bool Function()? isActive,
    Future<void> Function(User user, bool Function() isCurrent)?
    onAuthenticated,
  }) async {
    final operation = _begin(isActive);
    var succeeded = false;
    final address = email.trim();
    try {
      operation.check();
      final initial = _auth.currentUser;
      if (initial != null && !initial.isAnonymous) {
        throw FirebaseAuthException(code: 'already-signed-in');
      }
      Future<UserCredential> signIn() => operation.signIn(
        () => _auth.signInWithEmailAndPassword(
          email: address,
          password: password,
        ),
      );
      UserCredential result;
      String? confirmedUid;
      try {
        if (!register) {
          result = await signIn();
        } else {
          try {
            result = linkGuest && initial != null && initial.isAnonymous
                ? await operation.boundResult(
                    () => initial.linkWithCredential(
                      EmailAuthProvider.credential(
                        email: address,
                        password: password,
                      ),
                    ),
                    signingIn: true,
                  )
                : await operation.signIn(
                    () => _auth.createUserWithEmailAndPassword(
                      email: address,
                      password: password,
                    ),
                  );
          } on FirebaseAuthException catch (error) {
            operation.check();
            if (!const {
              'email-already-in-use',
              'credential-already-in-use',
            }.contains(error.code)) {
              rethrow;
            }
            // An existing password is authenticated, never replaced by signup.
            result = await signIn();
          }
        }
      } on FirebaseAuthException catch (error) {
        operation.check();
        // Enumeration protection intentionally makes these failures ambiguous.
        // Confirmation is optional and generic; never discover providers by email.
        if (!const {
              'invalid-credential',
              'invalid-login-credentials',
              'wrong-password',
              'user-not-found',
            }.contains(error.code) ||
            confirmGoogle == null) {
          rethrow;
        }
        final token = await confirmGoogle(address);
        operation.check();
        if (token == null) throw FirebaseAuthException(code: 'flow-cancelled');
        confirmedUid =
            await (_passwordLink ??
                    ExistingGooglePasswordLink(
                      apiKey: _auth.app.options.apiKey,
                      tenantId: _auth.tenantId,
                    ))
                .link(
                  googleIdToken: token,
                  email: address,
                  password: password,
                  isCurrent: operation.isCurrent,
                );
        operation.check();
        // Establish the normal SDK session through existing-only password login.
        // Never call signup-capable Google sign-in after the confirmation.
        registrationDiagnostic(
          RegistrationStage.emailContinuation,
          RegistrationCheck.started,
        );
        result = await signIn();
      }
      operation.check();
      final user = result.user;
      if (user == null || user.isAnonymous) {
        throw FirebaseAuthException(code: 'invalid-credential');
      }
      if (confirmedUid != null && user.uid != confirmedUid) {
        await _auth.signOut();
        throw FirebaseAuthException(code: 'user-mismatch');
      }
      await user.reload();
      operation.check();
      final current = _auth.currentUser!;
      // The linker verified Google ownership before adding password. Firebase
      // may now require email verification; keep that status and let the normal
      // verification flow handle it after establishing this same-UID session.
      if (!_sameEmail(current.email, address) ||
          !hasProvider(current, 'password') ||
          (confirmedUid != null && !hasProvider(current, 'google.com'))) {
        throw FirebaseAuthException(code: 'association-not-confirmed');
      }
      await onAuthenticated?.call(current, operation.isCurrent);
      operation.check();
      succeeded = true;
      registrationDiagnostic(
        RegistrationStage.emailContinuation,
        RegistrationCheck.accepted,
      );
      return current;
    } catch (error) {
      registrationDiagnostic(
        RegistrationStage.emailContinuation,
        wasCancelled(error)
            ? RegistrationCheck.cancelled
            : RegistrationCheck.failed,
      );
      rethrow;
    } finally {
      await _finish(operation, succeeded);
    }
  }

  static bool _sameEmail(String? left, String? right) =>
      left != null &&
      right != null &&
      left.toLowerCase() == right.toLowerCase();
}

class _ProviderOperation {
  _ProviderOperation(this.auth, this.isActive) : uid = auth.currentUser?.uid {
    subscription = auth.authStateChanges().listen((user) {
      final next = user?.uid;
      if (next == uid) return;
      if (signingIn && next != null && transitionUid == null) {
        transitionUid = next;
      } else if (next != transitionUid || next == null) {
        cancel();
      }
    });
  }

  final FirebaseAuth auth;
  final bool Function() isActive;
  late final StreamSubscription<User?> subscription;
  String? uid;
  String? transitionUid;
  bool signingIn = false;
  bool cancelled = false;
  bool didAuthenticate = false;

  void cancel() => cancelled = true;

  bool isCurrent() => !cancelled && isActive() && auth.currentUser?.uid == uid;

  void check() {
    if (!isCurrent()) {
      throw FirebaseAuthException(code: 'flow-cancelled');
    }
  }

  // Native SDK completions can restore their user after sign-out. Discard only
  // that stale result, never a different currently selected account. Closing a
  // setup dialog alone does not sign out an existing registered user.
  Future<void> _discardCancelledResult(
    UserCredential result, {
    bool signingIn = false,
  }) async {
    if ((cancelled || (signingIn && !isActive())) &&
        result.user != null &&
        auth.currentUser?.uid == result.user!.uid) {
      await auth.signOut();
    }
  }

  Future<UserCredential> boundResult(
    Future<UserCredential> Function() action, {
    bool signingIn = false,
  }) async {
    check();
    final result = await action();
    await _discardCancelledResult(result, signingIn: signingIn);
    check();
    if (signingIn &&
        result.user?.isAnonymous == false &&
        result.user?.uid == uid) {
      didAuthenticate = true;
    }
    return result;
  }

  Future<UserCredential> signIn(
    Future<UserCredential> Function() action,
  ) async {
    check();
    signingIn = true;
    try {
      final result = await action();
      if (transitionUid != null && transitionUid != result.user?.uid) cancel();
      await _discardCancelledResult(result, signingIn: true);
      if (cancelled ||
          !isActive() ||
          result.user == null ||
          auth.currentUser?.uid != result.user!.uid ||
          (transitionUid != null && transitionUid != result.user!.uid)) {
        throw FirebaseAuthException(code: 'flow-cancelled');
      }
      uid = result.user!.uid;
      didAuthenticate = true;
      return result;
    } finally {
      signingIn = false;
      transitionUid = null;
    }
  }

  Future<void> dispose() async {
    try {
      // Native reload (including profile finalization) can also restore the
      // captured user after sign-out. Clear that cancelled session only; a
      // different current account or a dismissed dialog remains untouched.
      if ((cancelled || (didAuthenticate && !isActive())) &&
          uid != null &&
          auth.currentUser?.uid == uid) {
        await auth.signOut();
      }
    } finally {
      await subscription.cancel();
    }
  }
}
