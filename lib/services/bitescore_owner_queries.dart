import 'package:cloud_firestore/cloud_firestore.dart';

/// Keeps owner reads within the same source scope enforced by Firestore Rules.
abstract final class BiteScoreOwnerQueries {
  static Query<Map<String, dynamic>> restaurants(
    Query<Map<String, dynamic>> query, {
    required String userId,
  }) => query
      .where('ownerUserId', isEqualTo: userId)
      .where('isClaimed', isEqualTo: true);

  static Query<Map<String, dynamic>> aggregates(
    Query<Map<String, dynamic>> query, {
    required String restaurantId,
  }) => query.where('restaurantId', isEqualTo: restaurantId);
}
