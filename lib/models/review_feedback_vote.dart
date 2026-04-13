import 'package:cloud_firestore/cloud_firestore.dart';

class ReviewFeedbackVote {
  static const String collectionName = 'review_feedback_votes';
  static const String voteHelpful = 'helpful';
  static const String voteNotHelpful = 'not_helpful';

  final String id;
  final String reviewId;
  final String dishId;
  final String restaurantId;
  final String userId;
  final String voteType;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const ReviewFeedbackVote({
    required this.id,
    required this.reviewId,
    required this.dishId,
    required this.restaurantId,
    required this.userId,
    required this.voteType,
    this.createdAt,
    this.updatedAt,
  });

  bool get isHelpful => voteType == voteHelpful;
  bool get isNotHelpful => voteType == voteNotHelpful;

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'reviewId': reviewId.trim(),
      'dishId': dishId.trim(),
      'restaurantId': restaurantId.trim(),
      'userId': userId.trim(),
      'voteType': voteType.trim(),
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static ReviewFeedbackVote? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final reviewId = _readString(data['reviewId']);
    final dishId = _readString(data['dishId']);
    final restaurantId = _readString(data['restaurantId']);
    final userId = _readString(data['userId']);
    final voteType = _readString(data['voteType']);

    if (reviewId == null ||
        dishId == null ||
        restaurantId == null ||
        userId == null ||
        voteType == null ||
        (voteType != voteHelpful && voteType != voteNotHelpful)) {
      return null;
    }

    return ReviewFeedbackVote(
      id: _readString(data['id']) ?? fallbackId,
      reviewId: reviewId,
      dishId: dishId,
      restaurantId: restaurantId,
      userId: userId,
      voteType: voteType,
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
