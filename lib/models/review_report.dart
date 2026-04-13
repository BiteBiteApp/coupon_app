import 'package:cloud_firestore/cloud_firestore.dart';

class ReviewReport {
  static const String collectionName = 'review_reports';
  static const String statusPending = 'pending';
  static const String statusDismissed = 'dismissed';

  final String id;
  final String reviewId;
  final String dishId;
  final String restaurantId;
  final String reportingUserId;
  final String? reason;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const ReviewReport({
    required this.id,
    required this.reviewId,
    required this.dishId,
    required this.restaurantId,
    required this.reportingUserId,
    this.reason,
    required this.status,
    this.createdAt,
    this.updatedAt,
  });

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'reviewId': reviewId.trim(),
      'dishId': dishId.trim(),
      'restaurantId': restaurantId.trim(),
      'reportingUserId': reportingUserId.trim(),
      'reason': reason?.trim(),
      'status': status.trim(),
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static ReviewReport? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final reviewId = _readString(data['reviewId']);
    final dishId = _readString(data['dishId']);
    final restaurantId = _readString(data['restaurantId']);
    final reportingUserId = _readString(data['reportingUserId']);
    final status = _readString(data['status']);

    if (reviewId == null ||
        dishId == null ||
        restaurantId == null ||
        reportingUserId == null ||
        status == null) {
      return null;
    }

    return ReviewReport(
      id: _readString(data['id']) ?? fallbackId,
      reviewId: reviewId,
      dishId: dishId,
      restaurantId: restaurantId,
      reportingUserId: reportingUserId,
      reason: _readString(data['reason']),
      status: status,
      createdAt: _readDateTime(data['createdAt']),
      updatedAt: _readDateTime(data['updatedAt']),
    );
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate().toLocal();
    }

    if (value is DateTime) {
      return value.toLocal();
    }

    return null;
  }
}
