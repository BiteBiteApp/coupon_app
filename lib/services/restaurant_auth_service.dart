import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'account_provider_service.dart';
import 'restaurant_account_service.dart';
import 'user_profile_service.dart';

typedef RestaurantAuthenticatedUserAction = Future<void> Function(User user);
typedef RestaurantUserAuthenticator = Future<User?> Function();
typedef RestaurantAuthenticatedUserRefresher = Future<User> Function(User user);

class RestaurantAuthService {
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  static const String webServerClientId =
      '253983587346-bqkv4qsf93390ctdjctpq9nuup2r9lhe.apps.googleusercontent.com';

  static bool requiresEmailVerification(User user) {
    final isPasswordUser = user.providerData.any(
      (provider) => provider.providerId == 'password',
    );
    return isPasswordUser && !user.emailVerified;
  }

  static Future<User?> signInWithGoogle({
    ConfirmAccountPassword? confirmPassword,
    bool Function()? isActive,
  }) async {
    return AccountProviderService.instance.signInWithGoogle(
      linkGuest: false,
      confirmPassword: confirmPassword,
      isActive: isActive,
      onAuthenticated: (user, isCurrent) =>
          completeAuthenticatedUser(user, isCurrent: isCurrent),
    );
  }

  static Future<User?> signInWithPhoneCredential(
    PhoneAuthCredential credential,
  ) {
    AccountProviderService.requireNoPendingOperation();
    return signInWithPhoneUsing(
      authenticate: () async {
        final signedInCredential = await _auth.signInWithCredential(credential);
        return signedInCredential.user;
      },
    );
  }

  @visibleForTesting
  static Future<User?> signInWithGoogleUsing({
    required RestaurantUserAuthenticator authenticate,
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
  }) async {
    final user = await authenticate();
    if (user != null) {
      await completeAuthenticatedUser(
        user,
        syncExistingRestaurantAccount: syncExistingRestaurantAccount,
        upsertUserProfile: upsertUserProfile,
      );
    }
    return user;
  }

  @visibleForTesting
  static Future<User?> signInWithPhoneUsing({
    required RestaurantUserAuthenticator authenticate,
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
  }) async {
    final user = await authenticate();
    if (user != null) {
      await completeAuthenticatedUser(
        user,
        syncExistingRestaurantAccount: syncExistingRestaurantAccount,
        upsertUserProfile: upsertUserProfile,
      );
    }
    return user;
  }

  static Future<User?> signInOrCreateWithEmail({
    required String email,
    required String password,
    required bool isLoginMode,
    ConfirmGoogleAccount? confirmGoogle,
    bool Function()? isActive,
  }) => AccountProviderService.instance.authenticateWithEmail(
    email: email,
    password: password,
    register: !isLoginMode,
    linkGuest: false,
    confirmGoogle: confirmGoogle,
    isActive: isActive,
    onAuthenticated: (user, isCurrent) async {
      await _completeEmailAuthentication(
        user: user,
        isLoginMode: isLoginMode,
        isCurrent: (_) => isCurrent(),
      );
    },
  );

  static Future<User?> authenticateWithEmail({
    required bool isLoginMode,
    required RestaurantUserAuthenticator signIn,
    required RestaurantUserAuthenticator register,
    RestaurantAuthenticatedUserAction? sendVerificationEmail,
    RestaurantAuthenticatedUserRefresher? refreshUser,
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
    bool Function(User user)? isCurrent,
  }) async {
    AccountProviderService.requireNoPendingOperation();
    final user = await (isLoginMode ? signIn() : register());
    return _completeEmailAuthentication(
      user: user,
      isLoginMode: isLoginMode,
      isCurrent: isCurrent,
      sendVerificationEmail: sendVerificationEmail,
      refreshUser: refreshUser,
      syncExistingRestaurantAccount: syncExistingRestaurantAccount,
      upsertUserProfile: upsertUserProfile,
    );
  }

  static Future<User?> _completeEmailAuthentication({
    required User? user,
    required bool isLoginMode,
    RestaurantAuthenticatedUserAction? sendVerificationEmail,
    RestaurantAuthenticatedUserRefresher? refreshUser,
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
    bool Function(User user)? isCurrent,
  }) async {
    if (user == null) {
      return null;
    }

    if (isCurrent?.call(user) == false) {
      throw FirebaseAuthException(code: 'flow-cancelled');
    }
    if (!isLoginMode && !user.emailVerified) {
      await (sendVerificationEmail ?? (user) => user.sendEmailVerification())(
        user,
      );
    }

    final refreshedUser = await (refreshUser ?? _refreshAuthenticatedUser)(
      user,
    );
    if (refreshedUser.uid != user.uid || isCurrent?.call(user) == false) {
      throw FirebaseAuthException(code: 'flow-cancelled');
    }
    await completeAuthenticatedUser(
      refreshedUser,
      isCurrent: isCurrent == null ? null : () => isCurrent(user),
      syncExistingRestaurantAccount: syncExistingRestaurantAccount,
      upsertUserProfile: upsertUserProfile,
    );
    if (isCurrent?.call(user) == false) {
      throw FirebaseAuthException(code: 'flow-cancelled');
    }
    return refreshedUser;
  }

  static Future<User> _refreshAuthenticatedUser(User user) async {
    void check() {
      if (_auth.currentUser?.uid != user.uid) {
        throw FirebaseAuthException(code: 'flow-cancelled');
      }
    }

    check();
    await user.reload();
    check();
    await user.getIdToken(true);
    check();
    return _auth.currentUser!;
  }

  static Future<void> completeAuthenticatedUser(
    User user, {
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
    bool Function()? isCurrent,
  }) async {
    if (isCurrent?.call() == false) return;
    try {
      await (syncExistingRestaurantAccount ??
          RestaurantAccountService.syncEmailVerified)(user);
    } catch (_) {
      // Authentication has already succeeded. Account metadata synchronization
      // is best-effort and must not block the authenticated user flow.
    }
    if (isCurrent?.call() == false) return;
    await (upsertUserProfile ?? UserProfileService.upsertSignedInUserProfile)(
      user,
    );
  }
}
