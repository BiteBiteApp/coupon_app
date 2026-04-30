import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class BiteSaverReportService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  static Future<void> submitReport({
    required String reportType,
    String? restaurantId,
    String? couponId,
    required String reason,
    String? note,
  }) async {
    final trimmedReportType = reportType.trim();
    if (trimmedReportType.isEmpty) {
      throw ArgumentError('Report type is required.');
    }

    final trimmedReason = reason.trim();
    if (trimmedReason.isEmpty) {
      throw ArgumentError('Choose a reason before submitting.');
    }

    final trimmedRestaurantId = restaurantId?.trim();
    final trimmedCouponId = couponId?.trim();
    final trimmedNote = note?.trim();
    final user = _auth.currentUser;

    await _firestore.collection('bitesaver_reports').add({
      'reportType': trimmedReportType,
      if (trimmedRestaurantId != null && trimmedRestaurantId.isNotEmpty)
        'restaurantId': trimmedRestaurantId,
      if (trimmedCouponId != null && trimmedCouponId.isNotEmpty)
        'couponId': trimmedCouponId,
      'reason': trimmedReason,
      if (trimmedNote != null && trimmedNote.isNotEmpty) 'note': trimmedNote,
      if (user != null) 'reporterUid': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'status': 'open',
    });
  }
}
