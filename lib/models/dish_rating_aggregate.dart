import 'package:cloud_firestore/cloud_firestore.dart';

class DishRatingAggregate {
  static const String collectionName = 'dish_rating_aggregates';

  final String dishId;
  final String restaurantId;
  final double overallBiteScore;
  final int ratingCount;
  final double? overallImpressionAverage;
  final double? tastinessScoreAverage;
  final double? qualityScoreAverage;
  final double? valueScoreAverage;
  final DateTime? updatedAt;

  const DishRatingAggregate({
    required this.dishId,
    required this.restaurantId,
    this.overallBiteScore = 0,
    this.ratingCount = 0,
    this.overallImpressionAverage,
    this.tastinessScoreAverage,
    this.qualityScoreAverage,
    this.valueScoreAverage,
    this.updatedAt,
  });

  Map<String, dynamic> toFirestoreMap() {
    return {
      'dishId': dishId.trim(),
      'restaurantId': restaurantId.trim(),
      'overallBiteScore': overallBiteScore,
      'ratingCount': ratingCount,
      'overallImpressionAverage': overallImpressionAverage,
      'tastinessScoreAverage': tastinessScoreAverage,
      'qualityScoreAverage': qualityScoreAverage,
      'valueScoreAverage': valueScoreAverage,
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static DishRatingAggregate? tryFromFirestore(Map<String, dynamic>? data) {
    if (data == null) {
      return null;
    }

    final dishId = _readString(data['dishId']);
    final restaurantId = _readString(data['restaurantId']);

    if (dishId == null || restaurantId == null) {
      return null;
    }

    return DishRatingAggregate(
      dishId: dishId,
      restaurantId: restaurantId,
      overallBiteScore: _readDouble(data['overallBiteScore']) ?? 0,
      ratingCount: _readInt(data['ratingCount']) ?? 0,
      overallImpressionAverage:
          _readDouble(data['overallImpressionAverage']) ??
          _readDouble(data['qualityScore']),
      tastinessScoreAverage:
          _readDouble(data['tastinessScoreAverage']) ??
          _readDouble(data['tasteScore']),
      qualityScoreAverage:
          _readDouble(data['qualityScoreAverage']) ??
          _readDouble(data['qualityScore']),
      valueScoreAverage:
          _readDouble(data['valueScoreAverage']) ??
          _readDouble(data['valueScore']),
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

  static int? _readInt(dynamic value) {
    if (value is num) {
      return value.toInt();
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
