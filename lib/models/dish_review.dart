import 'package:cloud_firestore/cloud_firestore.dart';

class DishReview {
  static const String collectionName = 'dish_reviews';

  final String id;
  final String dishId;
  final String restaurantId;
  final String userId;
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
