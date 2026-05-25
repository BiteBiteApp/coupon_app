import 'package:cloud_firestore/cloud_firestore.dart';

class BiteScoreDishImageVote {
  static const String collectionName = 'bitescore_dish_image_votes';
  static const String voteHelpful = 'helpful';
  static const String voteNotHelpful = 'notHelpful';

  final String id;
  final String imageId;
  final String dishId;
  final String restaurantId;
  final String userId;
  final String voteType;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const BiteScoreDishImageVote({
    required this.id,
    required this.imageId,
    required this.dishId,
    required this.restaurantId,
    required this.userId,
    required this.voteType,
    this.createdAt,
    this.updatedAt,
  });

  bool get isHelpful => voteType == voteHelpful;
  bool get isNotHelpful => voteType == voteNotHelpful;

  static BiteScoreDishImageVote? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final imageId = _readString(data['imageId']);
    final dishId = _readString(data['dishId']);
    final restaurantId = _readString(data['restaurantId']);
    final userId = _readString(data['userId']);
    final voteType = _readString(data['voteType']);

    if (imageId == null ||
        dishId == null ||
        restaurantId == null ||
        userId == null ||
        voteType == null ||
        (voteType != voteHelpful && voteType != voteNotHelpful)) {
      return null;
    }

    return BiteScoreDishImageVote(
      id: _readString(data['id']) ?? fallbackId,
      imageId: imageId,
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
