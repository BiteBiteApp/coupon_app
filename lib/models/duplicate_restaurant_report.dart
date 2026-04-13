import 'package:cloud_firestore/cloud_firestore.dart';

class DuplicateRestaurantReport {
  static const String collectionName = 'duplicate_restaurant_reports';
  static const String statusPending = 'pending';
  static const String statusDismissed = 'dismissed';
  static const String statusResolved = 'resolved';

  final String id;
  final String restaurantId;
  final String restaurantName;
  final String reportingUserId;
  final String? reason;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const DuplicateRestaurantReport({
    required this.id,
    required this.restaurantId,
    required this.restaurantName,
    required this.reportingUserId,
    this.reason,
    required this.status,
    this.createdAt,
    this.updatedAt,
  });

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'restaurantId': restaurantId.trim(),
      'restaurantName': restaurantName.trim(),
      'reportingUserId': reportingUserId.trim(),
      'reason': reason?.trim(),
      'status': status.trim(),
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static DuplicateRestaurantReport? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final restaurantId = _readString(data['restaurantId']);
    final restaurantName = _readString(data['restaurantName']);
    final reportingUserId = _readString(data['reportingUserId']);
    final status = _readString(data['status']);

    if (restaurantId == null ||
        restaurantName == null ||
        reportingUserId == null ||
        status == null) {
      return null;
    }

    return DuplicateRestaurantReport(
      id: _readString(data['id']) ?? fallbackId,
      restaurantId: restaurantId,
      restaurantName: restaurantName,
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
