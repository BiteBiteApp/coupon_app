import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:coupon_app/services/customer_session_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

class CustomerAuthService {
  static final FirebaseAuth _auth = FirebaseAuth.instance;
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  static const String webServerClientId =
      '253983587346-bqkv4qsf93390ctdjctpq9nuup2r9lhe.apps.googleusercontent.com';

  static bool requiresEmailVerification(User user) {
    final hasPasswordProvider = user.providerData.any(
      (provider) => provider.providerId == 'password',
    );
    return hasPasswordProvider && !user.emailVerified;
  }

  static Future<User?> signInOrLinkWithGoogle() async {
    if (kIsWeb) {
      return _signInOrLinkWithGoogleWeb();
    } else {
      return _signInOrLinkWithGoogleNative();
    }
  }

  static Future<User?> createAccountWithEmailPassword({
    required String email,
    required String password,
  }) async {
    final currentUser = _auth.currentUser;
    final trimmedEmail = email.trim();

    if (currentUser != null && currentUser.isAnonymous) {
      final anonymousUid = currentUser.uid;
      final credential = EmailAuthProvider.credential(
        email: trimmedEmail,
        password: password,
      );

      try {
        final linkedCredential = await currentUser.linkWithCredential(
          credential,
        );
        final linkedUser = linkedCredential.user;

        await _sendEmailVerificationIfNeeded(linkedUser);

        await _finalizeSignedInCustomerSession(
          anonymousUid: anonymousUid,
          signedInUser: linkedUser,
        );

        return linkedUser;
      } on FirebaseAuthException catch (e) {
        if (e.code == 'credential-already-in-use' ||
            e.code == 'email-already-in-use') {
          final signedInCredential = await _auth.signInWithEmailAndPassword(
            email: trimmedEmail,
            password: password,
          );

          await _sendEmailVerificationIfNeeded(signedInCredential.user);

          await _finalizeSignedInCustomerSession(
            anonymousUid: anonymousUid,
            signedInUser: signedInCredential.user,
          );

          return signedInCredential.user;
        }
        rethrow;
      }
    }

    final createdCredential = await _auth.createUserWithEmailAndPassword(
      email: trimmedEmail,
      password: password,
    );

    await _sendEmailVerificationIfNeeded(createdCredential.user);

    await _finalizeSignedInCustomerSession(
      anonymousUid: null,
      signedInUser: createdCredential.user,
    );

    return createdCredential.user;
  }

  static Future<User?> signInWithEmailPassword({
    required String email,
    required String password,
  }) async {
    final currentUser = _auth.currentUser;
    final anonymousUid = currentUser != null && currentUser.isAnonymous
        ? currentUser.uid
        : null;

    final signedInCredential = await _auth.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );

    await _finalizeSignedInCustomerSession(
      anonymousUid: anonymousUid,
      signedInUser: signedInCredential.user,
    );

    return signedInCredential.user;
  }

  static Future<User?> signInOrLinkWithPhoneCredential(
    PhoneAuthCredential credential,
  ) async {
    final currentUser = _auth.currentUser;
    final anonymousUid = currentUser != null && currentUser.isAnonymous
        ? currentUser.uid
        : null;

    if (currentUser != null && currentUser.isAnonymous) {
      try {
        final linkedCredential = await currentUser.linkWithCredential(
          credential,
        );
        final linkedUser = linkedCredential.user;

        await _finalizeSignedInCustomerSession(
          anonymousUid: anonymousUid,
          signedInUser: linkedUser,
        );

        return linkedUser;
      } on FirebaseAuthException catch (e) {
        if (e.code == 'credential-already-in-use' ||
            e.code == 'provider-already-linked') {
          final signedInCredential = await _auth.signInWithCredential(
            credential,
          );

          await _finalizeSignedInCustomerSession(
            anonymousUid: anonymousUid,
            signedInUser: signedInCredential.user,
          );

          return signedInCredential.user;
        }
        rethrow;
      }
    }

    final signedInCredential = await _auth.signInWithCredential(credential);

    await _finalizeSignedInCustomerSession(
      anonymousUid: null,
      signedInUser: signedInCredential.user,
    );

    return signedInCredential.user;
  }

  static Future<User?> _signInOrLinkWithGoogleWeb() async {
    final provider = GoogleAuthProvider();
    final currentUser = _auth.currentUser;
    final anonymousUid = currentUser != null && currentUser.isAnonymous
        ? currentUser.uid
        : null;

    if (currentUser != null && currentUser.isAnonymous) {
      try {
        final linkedCredential = await currentUser.linkWithPopup(provider);
        final linkedUser = linkedCredential.user;

        await _finalizeSignedInCustomerSession(
          anonymousUid: anonymousUid,
          signedInUser: linkedUser,
        );

        return linkedUser;
      } on FirebaseAuthException catch (e) {
        if (e.code == 'credential-already-in-use' ||
            e.code == 'provider-already-linked') {
          final signedInCredential = await _auth.signInWithPopup(provider);

          await _finalizeSignedInCustomerSession(
            anonymousUid: anonymousUid,
            signedInUser: signedInCredential.user,
          );

          return signedInCredential.user;
        }
        rethrow;
      }
    }

    final credential = await _auth.signInWithPopup(provider);

    await _finalizeSignedInCustomerSession(
      anonymousUid: null,
      signedInUser: credential.user,
    );

    return credential.user;
  }

  static Future<User?> _signInOrLinkWithGoogleNative() async {
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

    final currentUser = _auth.currentUser;
    final anonymousUid = currentUser != null && currentUser.isAnonymous
        ? currentUser.uid
        : null;

    if (currentUser != null && currentUser.isAnonymous) {
      try {
        final linkedCredential = await currentUser.linkWithCredential(
          credential,
        );
        final linkedUser = linkedCredential.user;

        await _finalizeSignedInCustomerSession(
          anonymousUid: anonymousUid,
          signedInUser: linkedUser,
        );

        return linkedUser;
      } on FirebaseAuthException catch (e) {
        if (e.code == 'credential-already-in-use' ||
            e.code == 'provider-already-linked') {
          final signedInCredential = await _auth.signInWithCredential(
            credential,
          );

          await _finalizeSignedInCustomerSession(
            anonymousUid: anonymousUid,
            signedInUser: signedInCredential.user,
          );

          return signedInCredential.user;
        }
        rethrow;
      }
    }

    final signedInCredential = await _auth.signInWithCredential(credential);

    await _finalizeSignedInCustomerSession(
      anonymousUid: null,
      signedInUser: signedInCredential.user,
    );

    return signedInCredential.user;
  }

  static Future<void> signOutCustomer() async {
    if (!kIsWeb) {
      try {
        await GoogleSignIn.instance.signOut();
      } catch (_) {}
    }

    await CustomerSessionService.signOutToSignedOut();
    await DemoRedemptionStore.refreshFromFirestore();
  }

  static Future<void> _finalizeSignedInCustomerSession({
    required String? anonymousUid,
    required User? signedInUser,
  }) async {
    if (signedInUser == null) {
      return;
    }

    await DemoRedemptionStore.syncGuestDeviceRedemptionsToSignedInUser(
      signedInUser.uid,
    );

    await signedInUser.reload();
    final refreshedUser = _auth.currentUser ?? signedInUser;
    if (!refreshedUser.isAnonymous) {
      final email = refreshedUser.email?.trim();
      final phoneNumber = refreshedUser.phoneNumber?.trim();
      final displayName = refreshedUser.displayName?.trim();
      await _firestore.collection('user_profiles').doc(refreshedUser.uid).set({
        'userId': refreshedUser.uid,
        if (email != null && email.isNotEmpty) 'email': email,
        if (phoneNumber != null && phoneNumber.isNotEmpty)
          'phoneNumber': phoneNumber,
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }

    await DemoRedemptionStore.refreshFromFirestore();
  }

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

  static Future<void> _mergeAnonymousRedemptionsIntoUser({
    required String? anonymousUid,
    required String? targetUid,
  }) async {
    // Legacy helper kept for reference. The active guest redemption flow stores
    // anonymous redemptions locally on device and syncs them after sign-in.
    // Reading the previous anonymous Firestore path after auth has switched to
    // the signed-in user will violate Firestore ownership rules.
    if (anonymousUid == null ||
        targetUid == null ||
        anonymousUid == targetUid) {
      return;
    }

    final sourceCollection = _firestore
        .collection('customer_redemptions')
        .doc(anonymousUid)
        .collection('coupon_redemptions');

    final targetCollection = _firestore
        .collection('customer_redemptions')
        .doc(targetUid)
        .collection('coupon_redemptions');

    final sourceSnapshot = await sourceCollection.get();

    if (sourceSnapshot.docs.isEmpty) {
      return;
    }

    final batch = _firestore.batch();

    for (final doc in sourceSnapshot.docs) {
      batch.set(
        targetCollection.doc(doc.id),
        doc.data(),
        SetOptions(merge: true),
      );
    }

    for (final doc in sourceSnapshot.docs) {
      batch.delete(doc.reference);
    }

    await batch.commit();
  }
}
