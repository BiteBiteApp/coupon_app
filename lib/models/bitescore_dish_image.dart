import 'package:cloud_firestore/cloud_firestore.dart';

class BiteScoreDishImage {
  static const String collectionName = 'bitescore_dish_images';

  final String id;
  final String dishId;
  final String restaurantId;
  final String? reviewId;
  final String uploadedByUserId;
  final String imageUrl;
  final String storagePath;
  final int sortOrder;
  final int helpfulCount;
  final int notHelpfulCount;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const BiteScoreDishImage({
    required this.id,
    required this.dishId,
    required this.restaurantId,
    this.reviewId,
    required this.uploadedByUserId,
    required this.imageUrl,
    required this.storagePath,
    this.sortOrder = 0,
    this.helpfulCount = 0,
    this.notHelpfulCount = 0,
    this.createdAt,
    this.updatedAt,
  });

  BiteScoreDishImage copyWith({int? helpfulCount, int? notHelpfulCount}) {
    return BiteScoreDishImage(
      id: id,
      dishId: dishId,
      restaurantId: restaurantId,
      reviewId: reviewId,
      uploadedByUserId: uploadedByUserId,
      imageUrl: imageUrl,
      storagePath: storagePath,
      sortOrder: sortOrder,
      helpfulCount: helpfulCount ?? this.helpfulCount,
      notHelpfulCount: notHelpfulCount ?? this.notHelpfulCount,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'dishId': dishId.trim(),
      'restaurantId': restaurantId.trim(),
      'reviewId': reviewId?.trim(),
      'uploadedByUserId': uploadedByUserId.trim(),
      'imageUrl': imageUrl.trim(),
      'storagePath': storagePath.trim(),
      'sortOrder': sortOrder,
      'helpfulCount': helpfulCount,
      'notHelpfulCount': notHelpfulCount,
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static BiteScoreDishImage? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final dishId = _readString(data['dishId']);
    final restaurantId = _readString(data['restaurantId']);
    final uploadedByUserId = _readString(data['uploadedByUserId']);
    final imageUrl = _readString(data['imageUrl']);
    final storagePath = _readString(data['storagePath']);

    if (dishId == null ||
        restaurantId == null ||
        uploadedByUserId == null ||
        imageUrl == null ||
        storagePath == null) {
      return null;
    }

    return BiteScoreDishImage(
      id: _readString(data['id']) ?? fallbackId,
      dishId: dishId,
      restaurantId: restaurantId,
      reviewId: _readString(data['reviewId']),
      uploadedByUserId: uploadedByUserId,
      imageUrl: imageUrl,
      storagePath: storagePath,
      sortOrder: _readInt(data['sortOrder']) ?? 0,
      helpfulCount: _readInt(data['helpfulCount']) ?? 0,
      notHelpfulCount: _readInt(data['notHelpfulCount']) ?? 0,
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
