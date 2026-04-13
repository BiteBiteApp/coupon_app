import 'package:cloud_firestore/cloud_firestore.dart';

class DishEditProposal {
  static const String collectionName = 'dish_edit_proposals';
  static const String typeRename = 'rename';
  static const String typeMerge = 'merge';

  final String id;
  final String type;
  final String restaurantId;
  final String targetDishId;
  final String? mergeTargetDishId;
  final String? proposedName;
  final String? reason;
  final String userId;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const DishEditProposal({
    required this.id,
    required this.type,
    required this.restaurantId,
    required this.targetDishId,
    this.mergeTargetDishId,
    this.proposedName,
    this.reason,
    required this.userId,
    this.status = 'pending',
    this.createdAt,
    this.updatedAt,
  });

  bool get isRename => type == typeRename;
  bool get isMerge => type == typeMerge;

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'type': type.trim(),
      'restaurantId': restaurantId.trim(),
      'targetDishId': targetDishId.trim(),
      'mergeTargetDishId': mergeTargetDishId?.trim(),
      'proposedName': proposedName?.trim(),
      'reason': reason?.trim(),
      'userId': userId.trim(),
      'status': status.trim(),
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static DishEditProposal? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final type = _readString(data['type']) ?? _readString(data['targetType']);
    final restaurantId = _readString(data['restaurantId']);
    final sourceDishId = _readString(data['sourceDishId']);
    final storedTargetDishId =
        _readString(data['targetDishId']) ?? _readString(data['targetId']);
    final targetDishId = sourceDishId ?? storedTargetDishId;
    final mergeTargetDishId =
        _readString(data['mergeTargetDishId']) ??
        (type == typeMerge && sourceDishId != null ? storedTargetDishId : null);
    final userId = _readString(data['userId']) ??
        _readString(data['createdByUserId']);

    if (type == null ||
        restaurantId == null ||
        targetDishId == null ||
        userId == null) {
      return null;
    }

    return DishEditProposal(
      id: _readString(data['id']) ?? fallbackId,
      type: type,
      restaurantId: restaurantId,
      targetDishId: targetDishId,
      mergeTargetDishId: mergeTargetDishId,
      proposedName: _readString(data['proposedName']),
      reason: _readString(data['reason']),
      userId: userId,
      status: _readString(data['status']) ?? 'pending',
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
