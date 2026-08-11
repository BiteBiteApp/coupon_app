import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'admin_restaurant_link_record.dart';
import 'bitescore_dish.dart';
import 'bitescore_restaurant.dart';
import 'dish_report.dart';
import 'dish_review.dart';
import 'duplicate_restaurant_report.dart';
import 'restaurant_claim_request.dart';
import 'restaurant_report.dart';
import 'review_report.dart';

enum RatingAdminRestaurantSearchMode {
  nearbyRadius('nearbyRadius', 'Nearby Radius'),
  exactZip('exactZip', 'Exact ZIP'),
  exactCity('exactCity', 'Exact City');

  const RatingAdminRestaurantSearchMode(this.wireName, this.label);

  final String wireName;
  final String label;
}

enum RatingAdminQueueKind {
  reportedReviews('reportedReviews'),
  restaurantReports('restaurantReports'),
  dishReports('dishReports'),
  duplicateRestaurantReports('duplicateRestaurantReports'),
  claims('claims');

  const RatingAdminQueueKind(this.wireName);
  final String wireName;
}

enum RatingAdminDirectoryKind {
  dishesByRestaurant('dishesByRestaurant'),
  reviews('reviews'),
  claimedRestaurants('claimedRestaurants');

  const RatingAdminDirectoryKind(this.wireName);
  final String wireName;
}

Map<String, Object?> _map(Object? value) {
  if (value is! Map) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const FormatException('Invalid Rating Admin page item.');
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _keys(
  Map<String, Object?> value,
  Set<String> required, [
  Set<String> optional = const <String>{},
]) {
  if (!value.keys.toSet().containsAll(required) ||
      value.keys.any(
        (key) => !required.contains(key) && !optional.contains(key),
      )) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
}

String _string(Object? value, {bool allowEmpty = true}) {
  if (value is! String || (!allowEmpty && value.isEmpty)) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  return value;
}

String? _nullableString(Object? value) {
  return value == null ? null : _string(value);
}

bool _bool(Object? value) {
  if (value is! bool) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  return value;
}

int? _nullableInt(Object? value) {
  if (value == null) return null;
  if (value is! int || value < 0) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  return value;
}

int _safeNonnegativeInt(Object? value) {
  if (value is! int ||
      value < 0 ||
      value > BitescoreRestaurant.maxRestaurantWriteRevision) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  return value;
}

double? _nullableDouble(Object? value) {
  if (value == null) return null;
  if (value is! num || !value.isFinite) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  return value.toDouble();
}

double _double(Object? value) {
  final parsed = _nullableDouble(value);
  if (parsed == null) {
    throw const FormatException('Invalid Rating Admin page item.');
  }
  return parsed;
}

DateTime? _date(Object? value) {
  final millis = _nullableInt(value);
  return millis == null ? null : DateTime.fromMillisecondsSinceEpoch(millis);
}

Map<String, dynamic> _timestampFields(
  Map<String, Object?> data, {
  String created = 'createdAtMillis',
  String updated = 'updatedAtMillis',
}) {
  return <String, dynamic>{
    'createdAt': data[created] == null
        ? null
        : Timestamp.fromMillisecondsSinceEpoch(_nullableInt(data[created])!),
    'updatedAt': data[updated] == null
        ? null
        : Timestamp.fromMillisecondsSinceEpoch(_nullableInt(data[updated])!),
  };
}

@immutable
class RatingAdminRestaurantRecord {
  const RatingAdminRestaurantRecord({
    required this.documentId,
    required this.restaurantName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.phone,
    required this.website,
    required this.latitude,
    required this.longitude,
    required this.distanceMiles,
    required this.isActive,
    required this.isClaimed,
    required this.ownerUserId,
    required this.linkedBiteSaverUid,
    required this.restaurantWriteRevision,
  });

  factory RatingAdminRestaurantRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'source',
      'documentId',
      'actionId',
      'restaurantName',
      'streetAddress',
      'city',
      'state',
      'zipCode',
      'phone',
      'website',
      'latitude',
      'longitude',
      'distanceMiles',
      'isActive',
      'isClaimed',
      'ownerUserId',
      'linkedBiteSaverUid',
      'restaurantWriteRevision',
    });
    if (data['source'] != 'biteScore' ||
        data['actionId'] != data['documentId']) {
      throw const FormatException('Invalid Rating Admin restaurant.');
    }
    return RatingAdminRestaurantRecord(
      documentId: _string(data['documentId'], allowEmpty: false),
      restaurantName: _string(data['restaurantName'], allowEmpty: false),
      streetAddress: _string(data['streetAddress']),
      city: _string(data['city']),
      state: _string(data['state']),
      zipCode: _string(data['zipCode']),
      phone: _string(data['phone']),
      website: _string(data['website']),
      latitude: _nullableDouble(data['latitude']),
      longitude: _nullableDouble(data['longitude']),
      distanceMiles: _nullableDouble(data['distanceMiles']),
      isActive: _bool(data['isActive']),
      isClaimed: _bool(data['isClaimed']),
      ownerUserId: _nullableString(data['ownerUserId']),
      linkedBiteSaverUid: _nullableString(data['linkedBiteSaverUid']),
      restaurantWriteRevision: _safeNonnegativeInt(
        data['restaurantWriteRevision'],
      ),
    );
  }

  final String documentId;
  final String restaurantName;
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;
  final String phone;
  final String website;
  final double? latitude;
  final double? longitude;
  final double? distanceMiles;
  final bool isActive;
  final bool isClaimed;
  final String? ownerUserId;
  final String? linkedBiteSaverUid;
  final int restaurantWriteRevision;

  String get recordKey => 'biteScore:$documentId';

  AdminRestaurantLinkRecord toAdminLinkRecord() => AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteScore,
    documentId: documentId,
    actionId: documentId,
    restaurantName: restaurantName,
    streetAddress: streetAddress,
    city: city,
    state: state,
    zipCode: zipCode,
    phone: phone,
    website: website,
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    distanceMiles: distanceMiles ?? 0,
    isActive: isActive,
    isClaimed: isClaimed,
    ownerUserId: ownerUserId,
    linkedBiteSaverUid: linkedBiteSaverUid,
  );
}

@immutable
class RatingAdminDishRecord {
  const RatingAdminDishRecord(this.dish);

  factory RatingAdminDishRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'id',
      'restaurantId',
      'restaurantName',
      'name',
      'normalizedName',
      'category',
      'subcategory',
      'categoryManualKeywords',
      'categoryTags',
      'priceLabel',
      'primaryImageUrl',
      'primaryImageId',
      'imageCount',
      'isActive',
      'mergedIntoDishId',
      'createdAtMillis',
      'updatedAtMillis',
    });
    final tags = data['categoryTags'];
    if (tags is! List || tags.any((tag) => tag is! String)) {
      throw const FormatException('Invalid Rating Admin dish.');
    }
    final map = <String, dynamic>{
      ...data,
      'categoryTags': List<String>.from(tags),
      ..._timestampFields(data),
    };
    final dish = BitescoreDish.tryFromFirestore(
      map,
      fallbackId: _string(data['id'], allowEmpty: false),
    );
    if (dish == null || dish.id != data['id']) {
      throw const FormatException('Invalid Rating Admin dish.');
    }
    return RatingAdminDishRecord(dish);
  }

  final BitescoreDish dish;
}

DishReview _reviewFrom(Map<String, Object?> data) {
  final review = DishReview.tryFromFirestore(<String, dynamic>{
    ...data,
    ..._timestampFields(data),
  }, fallbackId: _string(data['id'], allowEmpty: false));
  if (review == null || review.id != data['id']) {
    throw const FormatException('Invalid Rating Admin review.');
  }
  return review;
}

@immutable
class RatingAdminReviewRecord {
  const RatingAdminReviewRecord({
    required this.review,
    required this.dishName,
    required this.restaurantName,
    required this.reviewerDisplayName,
  });

  factory RatingAdminReviewRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'kind',
      'id',
      'dishId',
      'restaurantId',
      'userId',
      'headline',
      'notes',
      'overallImpression',
      'tastinessScore',
      'qualityScore',
      'valueScore',
      'overallBiteScore',
      'createdAtMillis',
      'updatedAtMillis',
      'dishName',
      'restaurantName',
      'reviewerDisplayName',
    });
    if (data['kind'] != 'reviews') {
      throw const FormatException('Invalid Rating Admin review kind.');
    }
    return RatingAdminReviewRecord(
      review: _reviewFrom(data),
      dishName: _string(data['dishName']),
      restaurantName: _string(data['restaurantName']),
      reviewerDisplayName: _string(data['reviewerDisplayName']),
    );
  }

  final DishReview review;
  final String dishName;
  final String restaurantName;
  final String reviewerDisplayName;
}

BitescoreRestaurant? _restaurantFrom(Object? value) {
  if (value == null) return null;
  final data = _map(value);
  _keys(data, <String>{
    'id',
    'name',
    'normalizedName',
    'address',
    'city',
    'state',
    'zipCode',
    'latitude',
    'longitude',
    'phone',
    'website',
    'ownerUserId',
    'isClaimed',
    'isActive',
    'createdAtMillis',
    'updatedAtMillis',
    'restaurantWriteRevision',
  });
  final id = _string(data['id'], allowEmpty: false);
  final restaurant = BitescoreRestaurant.tryFromFirestore(<String, dynamic>{
    ...data,
    BitescoreRestaurant.restaurantWriteRevisionField: _safeNonnegativeInt(
      data['restaurantWriteRevision'],
    ),
    'location': GeoPoint(_double(data['latitude']), _double(data['longitude'])),
    ..._timestampFields(data),
  }, fallbackId: id);
  if (restaurant == null || restaurant.id != id) {
    throw const FormatException('Invalid Rating Admin restaurant target.');
  }
  return restaurant;
}

RestaurantClaimRequest _claimFrom(Map<String, Object?> data) {
  final claim = RestaurantClaimRequest.tryFromFirestore(<String, dynamic>{
    ...data,
    ..._timestampFields(data),
  }, fallbackId: _string(data['id'], allowEmpty: false));
  if (claim == null || claim.id != data['id']) {
    throw const FormatException('Invalid Rating Admin claim.');
  }
  return claim;
}

@immutable
class RatingAdminClaimedRestaurantRecord {
  const RatingAdminClaimedRestaurantRecord({
    required this.restaurant,
    required this.approvedClaim,
  });

  factory RatingAdminClaimedRestaurantRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{'kind', 'id', 'restaurant', 'approvedClaim'});
    if (data['kind'] != 'claimedRestaurants') {
      throw const FormatException('Invalid claimed restaurant kind.');
    }
    final restaurant = _restaurantFrom(data['restaurant']);
    if (restaurant == null || restaurant.id != data['id']) {
      throw const FormatException('Invalid claimed restaurant.');
    }
    final claimData = data['approvedClaim'] == null
        ? null
        : _map(data['approvedClaim']);
    return RatingAdminClaimedRestaurantRecord(
      restaurant: restaurant,
      approvedClaim: claimData == null ? null : _claimFrom(claimData),
    );
  }

  final BitescoreRestaurant restaurant;
  final RestaurantClaimRequest? approvedClaim;
}

@immutable
class RatingAdminQueueRecord {
  const RatingAdminQueueRecord({
    required this.kind,
    required this.id,
    required this.fields,
  });

  factory RatingAdminQueueRecord.fromJson(Object? value) {
    final data = _map(value);
    final kindValue = _string(data['kind'], allowEmpty: false);
    final kind = RatingAdminQueueKind.values
        .where((candidate) => candidate.wireName == kindValue)
        .firstOrNull;
    if (kind == null) {
      throw const FormatException('Invalid Rating Admin queue kind.');
    }
    final required = switch (kind) {
      RatingAdminQueueKind.reportedReviews => <String>{
        'kind',
        'id',
        'reportId',
        'reviewId',
        'reportDishId',
        'reportRestaurantId',
        'reportingUserId',
        'reason',
        'status',
        'reportCreatedAtMillis',
        'reportUpdatedAtMillis',
        'review',
        'dishName',
        'restaurantName',
        'reviewerDisplayName',
      },
      RatingAdminQueueKind.restaurantReports ||
      RatingAdminQueueKind.duplicateRestaurantReports => <String>{
        'kind',
        'id',
        'reportId',
        'restaurantId',
        'restaurantName',
        'reportingUserId',
        'reason',
        'status',
        'createdAtMillis',
        'updatedAtMillis',
        'restaurant',
      },
      RatingAdminQueueKind.dishReports => <String>{
        'kind',
        'id',
        'reportId',
        'dishId',
        'dishName',
        'restaurantId',
        'reportingUserId',
        'reason',
        'status',
        'createdAtMillis',
        'updatedAtMillis',
        'dish',
        'restaurant',
      },
      RatingAdminQueueKind.claims => <String>{
        'kind',
        'id',
        'claimId',
        'restaurantId',
        'restaurantName',
        'requesterUserId',
        'claimantName',
        'email',
        'phone',
        'message',
        'status',
        'createdAtMillis',
        'updatedAtMillis',
        'restaurant',
      },
    };
    _keys(data, required);
    if (kind == RatingAdminQueueKind.restaurantReports ||
        kind == RatingAdminQueueKind.duplicateRestaurantReports) {
      if (_restaurantFrom(data['restaurant']) == null) {
        throw const FormatException('Invalid Rating Admin restaurant target.');
      }
    } else if (data['restaurant'] != null) {
      _restaurantFrom(data['restaurant']);
    }
    final id = _string(data['id'], allowEmpty: false);
    final identityField = kind == RatingAdminQueueKind.claims
        ? data['claimId']
        : data['reportId'];
    if (identityField != id) {
      throw const FormatException('Invalid Rating Admin queue identity.');
    }
    return RatingAdminQueueRecord(
      kind: kind,
      id: id,
      fields: Map<String, Object?>.unmodifiable(data),
    );
  }

  final RatingAdminQueueKind kind;
  final String id;
  final Map<String, Object?> fields;

  String get status => _string(fields['status']);
  String? get reason => _nullableString(fields['reason']);
  String get restaurantName => _string(fields['restaurantName']);
  String get reportingUserId =>
      _nullableString(fields['reportingUserId']) ?? '';
  BitescoreRestaurant? get restaurant => _restaurantFrom(fields['restaurant']);

  RatingAdminReviewRecord get reportedReview {
    if (kind != RatingAdminQueueKind.reportedReviews) {
      throw StateError('Not a reported review.');
    }
    final reviewData = _map(fields['review']);
    return RatingAdminReviewRecord(
      review: _reviewFrom(reviewData),
      dishName: _string(fields['dishName']),
      restaurantName: _string(fields['restaurantName']),
      reviewerDisplayName: _string(fields['reviewerDisplayName']),
    );
  }

  ReviewReport get reviewReport {
    return ReviewReport(
      id: id,
      reviewId: _string(fields['reviewId'], allowEmpty: false),
      dishId: _string(fields['reportDishId'], allowEmpty: false),
      restaurantId: _string(fields['reportRestaurantId'], allowEmpty: false),
      reportingUserId: _string(fields['reportingUserId']),
      reason: reason,
      status: status,
      createdAt: _date(fields['reportCreatedAtMillis']),
      updatedAt: _date(fields['reportUpdatedAtMillis']),
    );
  }

  RestaurantReport get restaurantReport => RestaurantReport(
    id: id,
    restaurantId: _string(fields['restaurantId'], allowEmpty: false),
    restaurantName: restaurantName,
    reportingUserId: reportingUserId,
    reason: reason,
    status: status,
    createdAt: _date(fields['createdAtMillis']),
    updatedAt: _date(fields['updatedAtMillis']),
  );

  DuplicateRestaurantReport get duplicateRestaurantReport =>
      DuplicateRestaurantReport(
        id: id,
        restaurantId: _string(fields['restaurantId'], allowEmpty: false),
        restaurantName: restaurantName,
        reportingUserId: reportingUserId,
        reason: reason,
        status: status,
        createdAt: _date(fields['createdAtMillis']),
        updatedAt: _date(fields['updatedAtMillis']),
      );

  DishReport get dishReport => DishReport(
    id: id,
    dishId: _string(fields['dishId'], allowEmpty: false),
    dishName: _string(fields['dishName']),
    restaurantId: _string(fields['restaurantId'], allowEmpty: false),
    reportingUserId: reportingUserId,
    reason: reason,
    status: status,
    createdAt: _date(fields['createdAtMillis']),
    updatedAt: _date(fields['updatedAtMillis']),
  );

  BitescoreDish get dish {
    final nested = RatingAdminDishRecord.fromJson(fields['dish']);
    return nested.dish;
  }

  RestaurantClaimRequest get claim => _claimFrom(fields);
}

@immutable
class RatingAdminInviteRecord {
  const RatingAdminInviteRecord({
    required this.id,
    required this.type,
    required this.status,
    required this.restaurantId,
    required this.pendingRestaurantKey,
    required this.restaurantName,
    required this.createdByEmail,
    required this.createdAt,
    required this.expiresAt,
    required this.usedAt,
    required this.revokedAt,
    required this.maxUses,
    required this.useCount,
  });

  factory RatingAdminInviteRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'id',
      'type',
      'side',
      'status',
      'restaurantId',
      'pendingRestaurantKey',
      'restaurantName',
      'createdByEmail',
      'createdAtMillis',
      'expiresAtMillis',
      'usedAtMillis',
      'revokedAtMillis',
      'maxUses',
      'useCount',
    });
    if (data['side'] != 'bitescore') {
      throw const FormatException('Invalid Rating Admin invite side.');
    }
    return RatingAdminInviteRecord(
      id: _string(data['id'], allowEmpty: false),
      type: _string(data['type']),
      status: _string(data['status']),
      restaurantId: _string(data['restaurantId']),
      pendingRestaurantKey: _string(data['pendingRestaurantKey']),
      restaurantName: _string(data['restaurantName']),
      createdByEmail: _string(data['createdByEmail']),
      createdAt: _date(data['createdAtMillis']),
      expiresAt: _date(data['expiresAtMillis']),
      usedAt: _date(data['usedAtMillis']),
      revokedAt: _date(data['revokedAtMillis']),
      maxUses: _nullableInt(data['maxUses']) ?? 1,
      useCount: _nullableInt(data['useCount']) ?? 0,
    );
  }

  final String id;
  final String type;
  final String status;
  final String restaurantId;
  final String pendingRestaurantKey;
  final String restaurantName;
  final String createdByEmail;
  final DateTime? createdAt;
  final DateTime? expiresAt;
  final DateTime? usedAt;
  final DateTime? revokedAt;
  final int maxUses;
  final int useCount;

  bool get isActive => status.trim().toLowerCase() == 'active';
}
