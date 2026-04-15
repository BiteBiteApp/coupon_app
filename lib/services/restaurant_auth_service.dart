import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'restaurant_account_service.dart';

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
    if (kIsWeb) {
      return _signInWithGoogleWeb();
    } else {
      return _signInWithGoogleNative();
    }
  }

  static Future<User?> _signInWithGoogleWeb() async {
    final provider = GoogleAuthProvider();

    final credential = await _auth.signInWithPopup(provider);
    final user = credential.user;

    if (user != null) {
      await RestaurantAccountService.createOrUpdateAccountRecord(user);
      await RestaurantAccountService.syncEmailVerified(user);
    }

    return user;
  }

  static Future<User?> _signInWithGoogleNative() async {
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
    final user = signedInCredential.user;

    if (user != null) {
      await RestaurantAccountService.createOrUpdateAccountRecord(user);
      await RestaurantAccountService.syncEmailVerified(user);
    }

    return user;
  }

  static Future<User?> signInWithPhoneCredential(
    PhoneAuthCredential credential,
  ) async {
    final signedInCredential = await _auth.signInWithCredential(credential);
    final user = signedInCredential.user;

    if (user != null) {
      await RestaurantAccountService.createOrUpdateAccountRecord(user);
      await RestaurantAccountService.syncEmailVerified(user);
    }

    return user;
  }
}
