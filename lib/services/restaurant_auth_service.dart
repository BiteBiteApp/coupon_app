import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

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

  static Future<User?> signInWithGoogle() async {
    return signInWithGoogleUsing(
      authenticate: kIsWeb
          ? _authenticateWithGoogleWeb
          : _authenticateWithGoogleNative,
    );
  }

  static Future<User?> _authenticateWithGoogleWeb() async {
    final provider = GoogleAuthProvider();

    final credential = await _auth.signInWithPopup(provider);
    return credential.user;
  }

  static Future<User?> _authenticateWithGoogleNative() async {
    final GoogleSignIn googleSignIn = GoogleSignIn.instance;

    await googleSignIn.initialize(serverClientId: webServerClientId);

    final GoogleSignInAccount googleUser = await googleSignIn.authenticate();
    final googleAuth = googleUser.authentication;

    if (googleAuth.idToken == null) {
      throw Exception('Google sign-in did not return an ID token.');
    }

    final credential = GoogleAuthProvider.credential(
      idToken: googleAuth.idToken,
    );

    final signedInCredential = await _auth.signInWithCredential(credential);
    return signedInCredential.user;
  }

  static Future<User?> signInWithPhoneCredential(
    PhoneAuthCredential credential,
  ) {
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

  static Future<User?> authenticateWithEmail({
    required bool isLoginMode,
    required RestaurantUserAuthenticator signIn,
    required RestaurantUserAuthenticator register,
    RestaurantAuthenticatedUserAction? sendVerificationEmail,
    RestaurantAuthenticatedUserRefresher? refreshUser,
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
  }) async {
    final user = await (isLoginMode ? signIn() : register());
    if (user == null) {
      return null;
    }

    if (!isLoginMode && !user.emailVerified) {
      await (sendVerificationEmail ?? (user) => user.sendEmailVerification())(
        user,
      );
    }

    final refreshedUser = await (refreshUser ?? _refreshAuthenticatedUser)(
      user,
    );
    await completeAuthenticatedUser(
      refreshedUser,
      syncExistingRestaurantAccount: syncExistingRestaurantAccount,
      upsertUserProfile: upsertUserProfile,
    );
    return refreshedUser;
  }

  static Future<User> _refreshAuthenticatedUser(User user) async {
    await user.reload();
    await _auth.currentUser?.getIdToken(true);
    return _auth.currentUser ?? user;
  }

  static Future<void> completeAuthenticatedUser(
    User user, {
    RestaurantAuthenticatedUserAction? syncExistingRestaurantAccount,
    RestaurantAuthenticatedUserAction? upsertUserProfile,
  }) async {
    try {
      await (syncExistingRestaurantAccount ??
          RestaurantAccountService.syncEmailVerified)(user);
    } catch (_) {
      // Authentication has already succeeded. Account metadata synchronization
      // is best-effort and must not block the authenticated user flow.
    }
    await (upsertUserProfile ?? UserProfileService.upsertSignedInUserProfile)(
      user,
    );
  }
}
