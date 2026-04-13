import 'package:cloud_firestore/cloud_firestore.dart';

class BitescoreDish {
  static const String collectionName = 'bitescore_dishes';

  final String id;
  final String restaurantId;
  final String restaurantName;
  final String name;
  final String normalizedName;
  final String? category;
  final String? priceLabel;
  final bool isActive;
  final String? mergedIntoDishId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const BitescoreDish({
    required this.id,
    required this.restaurantId,
    required this.restaurantName,
    required this.name,
    required this.normalizedName,
    this.category,
    this.priceLabel,
    this.isActive = true,
    this.mergedIntoDishId,
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
      'priceLabel': priceLabel?.trim(),
      'isActive': isActive,
      'mergedIntoDishId': mergedIntoDishId?.trim(),
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
      priceLabel: _readString(data['priceLabel']),
      isActive: _readBool(data['isActive']) ?? true,
      mergedIntoDishId: _readString(data['mergedIntoDishId']),
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
