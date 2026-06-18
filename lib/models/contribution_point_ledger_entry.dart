import 'package:cloud_firestore/cloud_firestore.dart';

class ContributionPointLedgerEntry {
  static const String collectionName = 'bitescore_contribution_point_ledger';

  static const String statusActive = 'active';
  static const String statusReversed = 'reversed';
  static const String statusReversal = 'reversal';
  static const String celebrationStatusPending = 'pending';
  static const String celebrationStatusCelebrated = 'celebrated';

  final String id;
  final String userId;
  final int pointsDelta;
  final String actionType;
  final String sourceKey;
  final String description;
  final String status;
  final String? originalLedgerEntryId;
  final String? reversalLedgerEntryId;
  final String? dishId;
  final String? dishName;
  final String? restaurantId;
  final String? restaurantName;
  final String? restaurantCity;
  final String? restaurantState;
  final String? restaurantAddress;
  final String? restaurantPhone;
  final String? reviewId;
  final String? requestId;
  final String? imageId;
  final String? oldValue;
  final String? newValue;
  final String? mergeSourceDishId;
  final String? mergeSourceDishName;
  final String? mergeTargetDishId;
  final String? mergeTargetDishName;
  final String? reason;
  final String? celebrationStatus;
  final DateTime? celebratedAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const ContributionPointLedgerEntry({
    required this.id,
    required this.userId,
    required this.pointsDelta,
    required this.actionType,
    required this.sourceKey,
    required this.description,
    this.status = statusActive,
    this.originalLedgerEntryId,
    this.reversalLedgerEntryId,
    this.dishId,
    this.dishName,
    this.restaurantId,
    this.restaurantName,
    this.restaurantCity,
    this.restaurantState,
    this.restaurantAddress,
    this.restaurantPhone,
    this.reviewId,
    this.requestId,
    this.imageId,
    this.oldValue,
    this.newValue,
    this.mergeSourceDishId,
    this.mergeSourceDishName,
    this.mergeTargetDishId,
    this.mergeTargetDishName,
    this.reason,
    this.celebrationStatus,
    this.celebratedAt,
    this.createdAt,
    this.updatedAt,
  });

  bool get isReversal => pointsDelta < 0 || status == statusReversal;

  Map<String, dynamic> toFirestoreMap() {
    return {
      'id': id.trim(),
      'userId': userId.trim(),
      'pointsDelta': pointsDelta,
      'actionType': actionType.trim(),
      'sourceKey': sourceKey.trim(),
      'description': description.trim(),
      'status': status.trim(),
      'originalLedgerEntryId': originalLedgerEntryId?.trim(),
      'reversalLedgerEntryId': reversalLedgerEntryId?.trim(),
      'dishId': dishId?.trim(),
      'dishName': dishName?.trim(),
      'restaurantId': restaurantId?.trim(),
      'restaurantName': restaurantName?.trim(),
      'restaurantCity': restaurantCity?.trim(),
      'restaurantState': restaurantState?.trim(),
      'restaurantAddress': restaurantAddress?.trim(),
      'restaurantPhone': restaurantPhone?.trim(),
      'reviewId': reviewId?.trim(),
      'requestId': requestId?.trim(),
      'imageId': imageId?.trim(),
      'oldValue': oldValue?.trim(),
      'newValue': newValue?.trim(),
      'mergeSourceDishId': mergeSourceDishId?.trim(),
      'mergeSourceDishName': mergeSourceDishName?.trim(),
      'mergeTargetDishId': mergeTargetDishId?.trim(),
      'mergeTargetDishName': mergeTargetDishName?.trim(),
      'reason': reason?.trim(),
      'celebrationStatus': celebrationStatus?.trim(),
      'celebratedAt': celebratedAt == null
          ? null
          : Timestamp.fromDate(celebratedAt!),
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  static ContributionPointLedgerEntry? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final userId = _readString(data['userId']);
    final actionType = _readString(data['actionType']);
    final sourceKey = _readString(data['sourceKey']);
    final description = _readString(data['description']);
    final pointsDelta = _readInt(data['pointsDelta']);
    if (userId == null ||
        actionType == null ||
        sourceKey == null ||
        description == null ||
        pointsDelta == null) {
      return null;
    }

    return ContributionPointLedgerEntry(
      id: _readString(data['id']) ?? fallbackId,
      userId: userId,
      pointsDelta: pointsDelta,
      actionType: actionType,
      sourceKey: sourceKey,
      description: description,
      status: _readString(data['status']) ?? statusActive,
      originalLedgerEntryId: _readString(data['originalLedgerEntryId']),
      reversalLedgerEntryId: _readString(data['reversalLedgerEntryId']),
      dishId: _readString(data['dishId']),
      dishName: _readString(data['dishName']),
      restaurantId: _readString(data['restaurantId']),
      restaurantName: _readString(data['restaurantName']),
      restaurantCity: _readString(data['restaurantCity']),
      restaurantState: _readString(data['restaurantState']),
      restaurantAddress: _readString(data['restaurantAddress']),
      restaurantPhone: _readString(data['restaurantPhone']),
      reviewId: _readString(data['reviewId']),
      requestId: _readString(data['requestId']),
      imageId: _readString(data['imageId']),
      oldValue: _readString(data['oldValue']),
      newValue: _readString(data['newValue']),
      mergeSourceDishId: _readString(data['mergeSourceDishId']),
      mergeSourceDishName: _readString(data['mergeSourceDishName']),
      mergeTargetDishId: _readString(data['mergeTargetDishId']),
      mergeTargetDishName: _readString(data['mergeTargetDishName']),
      reason: _readString(data['reason']),
      celebrationStatus: _readString(data['celebrationStatus']),
      celebratedAt: _readDateTime(data['celebratedAt']),
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
