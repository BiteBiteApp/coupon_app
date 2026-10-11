import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:coupon_app/services/customer_session_service.dart';
import 'package:coupon_app/services/user_profile_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'account_provider_service.dart';

class CustomerAuthService {
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  static const String webServerClientId =
      '253983587346-bqkv4qsf93390ctdjctpq9nuup2r9lhe.apps.googleusercontent.com';

  static bool requiresEmailVerification(User user) {
    final hasPasswordProvider = user.providerData.any(
      (provider) => provider.providerId == 'password',
    );
    return hasPasswordProvider && !user.emailVerified;
  }

  static Future<User?> signInOrLinkWithGoogle({
    ConfirmAccountPassword? confirmPassword,
    bool Function()? isActive,
  }) async {
    return AccountProviderService.instance.signInWithGoogle(
      linkGuest: true,
      confirmPassword: confirmPassword,
      isActive: isActive,
      onAuthenticated: (user, isCurrent) => _finalizeSignedInCustomerSession(
        signedInUser: user,
        isOperationCurrent: isCurrent,
      ),
    );
  }

  static Future<User?> createAccountWithEmailPassword({
    required String email,
    required String password,
    ConfirmGoogleAccount? confirmGoogle,
    bool Function()? isActive,
  }) => _authenticateWithEmail(
    email: email,
    password: password,
    register: true,
    confirmGoogle: confirmGoogle,
    isActive: isActive,
  );

  static Future<User?> signInWithEmailPassword({
    required String email,
    required String password,
    ConfirmGoogleAccount? confirmGoogle,
    bool Function()? isActive,
  }) => _authenticateWithEmail(
    email: email,
    password: password,
    register: false,
    confirmGoogle: confirmGoogle,
    isActive: isActive,
  );

  static Future<User?> _authenticateWithEmail({
    required String email,
    required String password,
    required bool register,
    ConfirmGoogleAccount? confirmGoogle,
    bool Function()? isActive,
  }) => AccountProviderService.instance.authenticateWithEmail(
    email: email,
    password: password,
    register: register,
    linkGuest: true,
    confirmGoogle: confirmGoogle,
    isActive: isActive,
    onAuthenticated: (user, isCurrent) async {
      if (register && isCurrent()) await _sendEmailVerificationIfNeeded(user);
      if (!isCurrent()) return;
      await _finalizeSignedInCustomerSession(
        signedInUser: user,
        isOperationCurrent: isCurrent,
      );
    },
  );

  static Future<User?> signInOrLinkWithPhoneCredential(
    PhoneAuthCredential credential,
  ) async {
    AccountProviderService.requireNoPendingOperation();
    final currentUser = _auth.currentUser;

    if (currentUser != null && currentUser.isAnonymous) {
      try {
        final linkedCredential = await currentUser.linkWithCredential(
          credential,
        );
        final linkedUser = linkedCredential.user;

        await _finalizeSignedInCustomerSession(signedInUser: linkedUser);

        return linkedUser;
      } on FirebaseAuthException catch (e) {
        if (e.code == 'credential-already-in-use' ||
            e.code == 'provider-already-linked') {
          final signedInCredential = await _auth.signInWithCredential(
            credential,
          );

          await _finalizeSignedInCustomerSession(
            signedInUser: signedInCredential.user,
          );

          return signedInCredential.user;
        }
        rethrow;
      }
    }

    final signedInCredential = await _auth.signInWithCredential(credential);

    await _finalizeSignedInCustomerSession(
      signedInUser: signedInCredential.user,
    );

    return signedInCredential.user;
  }

  static Future<void> signOutCustomer() async {
    AccountProviderService.cancelCurrentOperation();
    if (!kIsWeb) {
      try {
        await GoogleSignIn.instance.signOut();
      } catch (_) {}
    }

    await CustomerSessionService.signOutToSignedOut();
    if (DemoRedemptionStore.legacyWritesEnabled) {
      await DemoRedemptionStore.refreshFromFirestore();
    }
  }

  static Future<void> _finalizeSignedInCustomerSession({
    required User? signedInUser,
    bool Function()? isOperationCurrent,
    User? Function()? currentUserForTesting,
    Future<void> Function(User)? upsertProfileForTesting,
    Future<void> Function()? refreshRedemptionsForTesting,
  }) async {
    if (signedInUser == null || signedInUser.isAnonymous) {
      return;
    }

    final currentUser = currentUserForTesting ?? () => _auth.currentUser;
    bool isCurrent() {
      final user = currentUser();
      return isOperationCurrent?.call() != false &&
          user != null &&
          !user.isAnonymous &&
          user.uid == signedInUser.uid;
    }

    if (!isCurrent()) return;
    // Guest history stays device-scoped. Account/device allowance is enforced
    // by the trusted per-offer use operation, never imported during sign-in.
    await signedInUser.reload();
    if (!isCurrent()) return;
    await (upsertProfileForTesting ??
        UserProfileService.upsertSignedInUserProfile)(currentUser()!);

    if (isCurrent() && DemoRedemptionStore.legacyWritesEnabled) {
      await (refreshRedemptionsForTesting ??
          DemoRedemptionStore.refreshFromFirestore)();
    }
  }

  @visibleForTesting
  static Future<void> finalizeSignedInSessionForTesting({
    required User signedInUser,
    required User? Function() currentUser,
    required Future<void> Function(User) upsertProfile,
    required Future<void> Function() refreshRedemptions,
  }) => _finalizeSignedInCustomerSession(
    signedInUser: signedInUser,
    currentUserForTesting: currentUser,
    upsertProfileForTesting: upsertProfile,
    refreshRedemptionsForTesting: refreshRedemptions,
  );

  static Future<void> _sendEmailVerificationIfNeeded(User? user) async {
    if (user == null || user.isAnonymous || user.emailVerified) {
      return;
    }

    final hasPasswordProvider = user.providerData.any(
      (provider) => provider.providerId == 'password',
    );
    if (!hasPasswordProvider) {
      return;
    }

    await user.sendEmailVerification();
  }
}
