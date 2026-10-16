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
    if (data == null ||
        (data['reportScope'] != null && data['reportScope'] != 'review')) {
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

/// A reviewer-behavior report has no synthetic review target. This is an
/// operator read model; only the trusted server creates its evidence.
class ReviewerReport {
  const ReviewerReport({
    required this.id,
    required this.reportedUserId,
    required this.reportingUserId,
    required this.reason,
    required this.status,
    required this.publicDisplayName,
    required this.capturedAt,
    required this.supportingReviewId,
    required this.supportingDishId,
    required this.supportingRestaurantId,
    required this.headline,
    required this.notes,
    required this.textTruncated,
  });

  factory ReviewerReport.fromAdminMap(Map<String, Object?> data) {
    Never invalid() => throw const FormatException('Invalid reviewer report.');
    String text(Object? value, int max) {
      if (value is! String || value.isEmpty || value.length > max) invalid();
      return value;
    }

    String? optionalText(Object? value, int max) =>
        value == null ? null : text(value, max);
    Map<String, Object?> map(Object? value, Set<String> keys) {
      if (value is! Map ||
          value.keys.toSet().difference(keys).isNotEmpty ||
          keys.difference(value.keys.toSet()).isNotEmpty) {
        invalid();
      }
      return Map<String, Object?>.from(value);
    }

    if (data['schemaVersion'] != 1 || data['reportScope'] != 'reviewer') {
      invalid();
    }
    final evidence = map(data['evidence'], {
      'publicDisplayName',
      'capturedAtMillis',
      'supportingReview',
    });
    final source = evidence['supportingReview'] == null
        ? null
        : map(evidence['supportingReview'], {
            'reviewId',
            'dishId',
            'restaurantId',
            'headline',
            'notes',
            'textTruncated',
          });
    final captured = evidence['capturedAtMillis'];
    if (captured is! int ||
        captured < 0 ||
        (source != null && source['textTruncated'] is! bool)) {
      invalid();
    }
    final id = text(data['id'], 1500);
    if (data['reportId'] != id) invalid();
    return ReviewerReport(
      id: id,
      reportedUserId: text(data['reportedUserId'], 128),
      reportingUserId: text(data['reportingUserId'], 128),
      reason: text(data['reason'], 2000),
      status: text(data['status'], 64),
      publicDisplayName: optionalText(evidence['publicDisplayName'], 320),
      capturedAt: DateTime.fromMillisecondsSinceEpoch(captured, isUtc: true),
      supportingReviewId: source == null
          ? null
          : text(source['reviewId'], 1500),
      supportingDishId: source == null ? null : text(source['dishId'], 1500),
      supportingRestaurantId: source == null
          ? null
          : text(source['restaurantId'], 1500),
      headline: optionalText(source?['headline'], 200),
      notes: optionalText(source?['notes'], 2000),
      textTruncated: source?['textTruncated'] == true,
    );
  }

  final String id, reportedUserId, reportingUserId, reason, status;
  final String? publicDisplayName,
      supportingReviewId,
      supportingDishId,
      supportingRestaurantId,
      headline,
      notes;
  final DateTime capturedAt;
  final bool textTruncated;
}

/// Exact photo case; a deleted supporting review does not invalidate the target.
class PhotoReport {
  const PhotoReport({
    required this.id,
    required this.imageId,
    required this.dishId,
    required this.restaurantId,
    required this.reason,
    required this.status,
    required this.imageState,
    required this.dishName,
    required this.restaurantName,
    this.supportingReviewId,
    this.imageUrl,
  });
  final String id,
      imageId,
      dishId,
      restaurantId,
      reason,
      status,
      imageState,
      dishName,
      restaurantName;
  final String? supportingReviewId, imageUrl;
  factory PhotoReport.fromAdminMap(Map<String, Object?> data) {
    Never invalid() => throw const FormatException('Invalid photo report.');
    String text(String key, [int max = 1500]) {
      final value = data[key];
      if (value is! String || value.isEmpty || value.length > max) invalid();
      return value;
    }

    if (data['schemaVersion'] != 1 ||
        data['reportScope'] != 'photo' ||
        data['id'] != data['reportId']) {
      invalid();
    }
    final state = text('imageState', 32);
    if (!{'available', 'removed', 'unavailable', 'changed'}.contains(state)) {
      invalid();
    }
    final status = text('status', 32);
    if (!{'pending', 'dismissed', 'resolved'}.contains(status)) invalid();
    final url = data['imageUrl'] == null ? null : text('imageUrl', 4096);
    if ((state == 'available') != (url != null)) invalid();
    if (url != null && Uri.tryParse(url)?.scheme != 'https') invalid();
    return PhotoReport(
      id: text('id'),
      imageId: text('imageId'),
      dishId: text('dishId'),
      restaurantId: text('restaurantId'),
      reason: text('reason', 2000),
      status: status,
      imageState: state,
      imageUrl: url,
      dishName: text('dishName', 100),
      restaurantName: text('restaurantName', 100),
      supportingReviewId: data['supportingReviewId'] == null
          ? null
          : text('supportingReviewId'),
    );
  }
}
