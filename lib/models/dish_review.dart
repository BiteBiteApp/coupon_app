import 'package:cloud_firestore/cloud_firestore.dart';

class DishReview {
  static const String collectionName = 'dish_reviews';

  final String id;
  final String dishId;
  final String restaurantId;
  final String userId;
  // Callable/author-only outcome; excluded from public Firestore writes.
  final String? textStatus;
  bool get hasUnpublishedText =>
      textStatus != null && textStatus != 'legacy' && textStatus != 'published';
  String? get textStatusMessage => switch (textStatus) {
    'published' => 'Rating and review text saved.',
    'pending' => 'Rating saved; your proposed words are awaiting review.',
    'screening' => 'Rating saved; your proposed words are still being checked.',
    'rejected' =>
      'Rating saved; your proposed words were not accepted. Earlier published words are unchanged.',
    'expired' =>
      'Rating saved; the unpublished text has expired. Submit your words again.',
    'screening_failed' =>
      'Rating saved; your proposed words could not be screened and remain unpublished.',
    'superseded' =>
      'Rating saved; a newer edit or withdrawal replaced this text submission.',
    _ => null,
  };
  final String? headline;
  final String? notes;
  final double overallImpression;
  final double? tastinessScore;
  final double? qualityScore;
  final double? valueScore;
  final double overallBiteScore;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const DishReview({
    required this.id,
    required this.dishId,
    required this.restaurantId,
    required this.userId,
    this.headline,
    this.textStatus,
    this.notes,
    required this.overallImpression,
    this.tastinessScore,
    this.qualityScore,
    this.valueScore,
    required this.overallBiteScore,
    this.createdAt,
    this.updatedAt,
  });

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'dishId': dishId.trim(),
      'restaurantId': restaurantId.trim(),
      'userId': userId.trim(),
      'headline': headline?.trim(),
      'notes': notes?.trim(),
      'overallImpression': overallImpression,
      'tastinessScore': tastinessScore,
      'qualityScore': qualityScore,
      'valueScore': valueScore,
      'overallBiteScore': overallBiteScore,
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static DishReview? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final dishId = _readString(data['dishId']);
    final restaurantId = _readString(data['restaurantId']);
    final userId = _readString(data['userId']);

    if (dishId == null || restaurantId == null || userId == null) {
      return null;
    }

    final overallBiteScore = _readDouble(data['overallBiteScore']) ?? 0;
    final tastinessScore =
        _readDouble(data['tastinessScore']) ?? _readDouble(data['tasteScore']);
    final qualityScore = _readDouble(data['qualityScore']);
    final valueScore = _readDouble(data['valueScore']);
    final overallImpression =
        _readDouble(data['overallImpression']) ??
        qualityScore ??
        tastinessScore ??
        (overallBiteScore > 0 ? (overallBiteScore / 10).clamp(1, 10) : null);

    if (overallImpression == null) {
      return null;
    }

    return DishReview(
      id: _readString(data['id']) ?? fallbackId,
      dishId: dishId,
      restaurantId: restaurantId,
      userId: userId,
      headline: _readString(data['headline']),
      textStatus: _readString(data['textStatus']),
      notes: _readString(data['notes']),
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
      overallBiteScore: overallBiteScore,
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

  static double? _readDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
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
