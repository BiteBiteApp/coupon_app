import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class UserProfileService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  static Future<void> upsertSignedInUserProfile(User user) async {
    if (user.isAnonymous) {
      return;
    }

    final email = user.email?.trim();
    final phoneNumber = user.phoneNumber?.trim();
    final displayName = user.displayName?.trim();

    await _firestore.collection('user_profiles').doc(user.uid).set({
      'userId': user.uid,
      if (email != null && email.isNotEmpty) 'email': email,
      if (phoneNumber != null && phoneNumber.isNotEmpty)
        'phoneNumber': phoneNumber,
      if (displayName != null && displayName.isNotEmpty)
        'displayName': displayName,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}
