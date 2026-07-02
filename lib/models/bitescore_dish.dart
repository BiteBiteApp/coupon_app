import 'package:cloud_firestore/cloud_firestore.dart';

class BitescoreDish {
  static const String collectionName = 'bitescore_dishes';

  final String id;
  final String restaurantId;
  final String restaurantName;
  final String name;
  final String normalizedName;
  final String? category;
  final String? subcategory;
  final String? categoryManualKeywords;
  final List<String> categoryTags;
  final String? priceLabel;
  final String? primaryImageUrl;
  final String? primaryImageId;
  final int imageCount;
  final bool isActive;
  final String? mergedIntoDishId;
  final String? createdByUserId;
  final String? createdFromReviewId;
  final String? createdWithRestaurantId;
  final bool createdFromCreateFlow;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const BitescoreDish({
    required this.id,
    required this.restaurantId,
    required this.restaurantName,
    required this.name,
    required this.normalizedName,
    this.category,
    this.subcategory,
    this.categoryManualKeywords,
    this.categoryTags = const [],
    this.priceLabel,
    this.primaryImageUrl,
    this.primaryImageId,
    this.imageCount = 0,
    this.isActive = true,
    this.mergedIntoDishId,
    this.createdByUserId,
    this.createdFromReviewId,
    this.createdWithRestaurantId,
    this.createdFromCreateFlow = false,
    this.createdAt,
    this.updatedAt,
  });

  bool get isMerged =>
      mergedIntoDishId != null && mergedIntoDishId!.trim().isNotEmpty;

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'restaurantId': restaurantId.trim(),
      'restaurantName': restaurantName.trim(),
      'name': name.trim(),
      'normalizedName': normalizedName.trim(),
      'category': category?.trim(),
      'subcategory': subcategory?.trim(),
      'categoryManualKeywords': categoryManualKeywords?.trim(),
      'categoryTags': categoryTags,
      'priceLabel': priceLabel?.trim(),
      'primaryImageUrl': primaryImageUrl?.trim(),
      'primaryImageId': primaryImageId?.trim(),
      'imageCount': imageCount,
      'isActive': isActive,
      'mergedIntoDishId': mergedIntoDishId?.trim(),
      if (createdByUserId?.trim().isNotEmpty == true)
        'createdByUserId': createdByUserId!.trim(),
      if (createdFromReviewId?.trim().isNotEmpty == true)
        'createdFromReviewId': createdFromReviewId!.trim(),
      if (createdWithRestaurantId?.trim().isNotEmpty == true)
        'createdWithRestaurantId': createdWithRestaurantId!.trim(),
      if (createdFromCreateFlow) 'createdFromCreateFlow': true,
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static BitescoreDish? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final restaurantId = _readString(data['restaurantId']);
    final restaurantName = _readString(data['restaurantName']);
    final name = _readString(data['name']);
    final normalizedName =
        _readString(data['normalizedName']) ?? name?.toLowerCase();

    if (restaurantId == null ||
        restaurantName == null ||
        name == null ||
        normalizedName == null) {
      return null;
    }

    return BitescoreDish(
      id: _readString(data['id']) ?? fallbackId,
      restaurantId: restaurantId,
      restaurantName: restaurantName,
      name: name,
      normalizedName: normalizedName,
      category: _readString(data['category']),
      subcategory: _readString(data['subcategory']),
      categoryManualKeywords: _readString(data['categoryManualKeywords']),
      categoryTags: _readStringList(data['categoryTags']),
      priceLabel: _readString(data['priceLabel']),
      primaryImageUrl: _readString(data['primaryImageUrl']),
      primaryImageId: _readString(data['primaryImageId']),
      imageCount: _readInt(data['imageCount']) ?? 0,
      isActive: _readBool(data['isActive']) ?? true,
      mergedIntoDishId: _readString(data['mergedIntoDishId']),
      createdByUserId: _readString(data['createdByUserId']),
      createdFromReviewId: _readString(data['createdFromReviewId']),
      createdWithRestaurantId: _readString(data['createdWithRestaurantId']),
      createdFromCreateFlow: _readBool(data['createdFromCreateFlow']) ?? false,
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

  static bool? _readBool(dynamic value) {
    if (value is bool) {
      return value;
    }

    return null;
  }

  static int? _readInt(dynamic value) {
    if (value is num) {
      return value.toInt();
    }

    return null;
  }

  static List<String> _readStringList(dynamic value) {
    if (value is Iterable) {
      return value
          .whereType<String>()
          .map((tag) => tag.trim())
          .where((tag) => tag.isNotEmpty)
          .toList(growable: false);
    }

    return const [];
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
