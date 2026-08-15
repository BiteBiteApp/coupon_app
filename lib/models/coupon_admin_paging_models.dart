import 'package:flutter/foundation.dart';

import 'coupon.dart';

enum CouponAdminRestaurantSearchMode {
  nearbyRadius('nearbyRadius', 'Nearby Radius'),
  exactZip('exactZip', 'Exact ZIP'),
  exactCity('exactCity', 'Exact City');

  const CouponAdminRestaurantSearchMode(this.wireName, this.label);

  final String wireName;
  final String label;
}

enum CouponAdminQueueKind {
  pendingApplications('pendingApplications'),
  nameChanges('nameChanges'),
  openReports('openReports');

  const CouponAdminQueueKind(this.wireName);

  final String wireName;
}

Map<String, Object?> _map(Object? value) {
  if (value is! Map) {
    throw const FormatException('Invalid Coupon Admin page item.');
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const FormatException('Invalid Coupon Admin page item.');
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
    throw const FormatException('Invalid Coupon Admin page item.');
  }
}

String _string(Object? value, {bool empty = true}) {
  if (value is! String || (!empty && value.isEmpty)) {
    throw const FormatException('Invalid Coupon Admin page item.');
  }
  return value;
}

String? _nullableString(Object? value) {
  if (value == null) return null;
  return _string(value);
}

int? _nullableInteger(Object? value) {
  if (value == null) return null;
  if (value is! int || value < 0) {
    throw const FormatException('Invalid Coupon Admin page item.');
  }
  return value;
}

double? _nullableDouble(Object? value) {
  if (value == null) return null;
  if (value is! num || !value.isFinite) {
    throw const FormatException('Invalid Coupon Admin page item.');
  }
  return value.toDouble();
}

bool _bool(Object? value) {
  if (value is! bool) {
    throw const FormatException('Invalid Coupon Admin page item.');
  }
  return value;
}

DateTime? _dateFromMillis(Object? value) {
  final millis = _nullableInteger(value);
  return millis == null ? null : DateTime.fromMillisecondsSinceEpoch(millis);
}

@immutable
class CouponAdminRestaurantRecord {
  const CouponAdminRestaurantRecord({
    required this.documentId,
    required this.actionId,
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
    required this.approvalStatus,
    required this.couponApplicationSubmitted,
    required this.adminHidden,
    required this.uid,
    required this.linkedBiteScoreRestaurantId,
  });

  factory CouponAdminRestaurantRecord.fromJson(Object? value) {
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
      'approvalStatus',
      'couponApplicationSubmitted',
      'adminHidden',
      'uid',
      'linkedBiteScoreRestaurantId',
    });
    if (data['source'] != 'biteSaver') {
      throw const FormatException('Invalid Coupon Admin restaurant source.');
    }
    return CouponAdminRestaurantRecord(
      documentId: _string(data['documentId'], empty: false),
      actionId: _string(data['actionId'], empty: false),
      restaurantName: _string(data['restaurantName'], empty: false),
      streetAddress: _string(data['streetAddress']),
      city: _string(data['city']),
      state: _string(data['state']),
      zipCode: _string(data['zipCode']),
      phone: _string(data['phone']),
      website: _string(data['website']),
      latitude: _nullableDouble(data['latitude']),
      longitude: _nullableDouble(data['longitude']),
      distanceMiles: _nullableDouble(data['distanceMiles']),
      approvalStatus: _string(data['approvalStatus']),
      couponApplicationSubmitted: _bool(data['couponApplicationSubmitted']),
      adminHidden: _bool(data['adminHidden']),
      uid: _nullableString(data['uid']),
      linkedBiteScoreRestaurantId: _nullableString(
        data['linkedBiteScoreRestaurantId'],
      ),
    );
  }

  final String documentId;
  final String actionId;
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
  final String approvalStatus;
  final bool couponApplicationSubmitted;
  final bool adminHidden;
  final String? uid;
  final String? linkedBiteScoreRestaurantId;

  String get recordKey => 'biteSaver:$documentId';

  Map<String, dynamic> toRestaurantData() => <String, dynamic>{
    'uid': uid ?? actionId,
    'restaurantName': restaurantName,
    'streetAddress': streetAddress,
    'city': city,
    'state': state,
    'zipCode': zipCode,
    'phone': phone,
    'website': website,
    'latitude': latitude,
    'longitude': longitude,
    'approvalStatus': approvalStatus,
    'couponApplicationSubmitted': couponApplicationSubmitted,
    'adminHidden': adminHidden,
  };
}

@immutable
class CouponAdminQueueRecord {
  const CouponAdminQueueRecord({
    required this.id,
    required this.kind,
    required this.fields,
  });

  factory CouponAdminQueueRecord.fromJson(Object? value) {
    final data = _map(value);
    final id = _string(data['id'], empty: false);
    final kindValue = _string(data['kind'], empty: false);
    final kind = CouponAdminQueueKind.values
        .where((candidate) => candidate.wireName == kindValue)
        .firstOrNull;
    if (kind == null) {
      throw const FormatException('Invalid Coupon Admin queue kind.');
    }
    final required = switch (kind) {
      CouponAdminQueueKind.pendingApplications => <String>{
        'id',
        'kind',
        'restaurantName',
        'uid',
        'email',
        'phone',
        'applicantPhone',
        'streetAddress',
        'city',
        'state',
        'zipCode',
        'website',
        'latitude',
        'longitude',
        'approvalStatus',
        'couponApplicationSubmitted',
        'profileVersion',
        'createdAtMillis',
        'updatedAtMillis',
      },
      CouponAdminQueueKind.nameChanges => <String>{
        'id',
        'kind',
        'userId',
        'currentRestaurantName',
        'requestedRestaurantName',
        'status',
        'createdAtMillis',
      },
      CouponAdminQueueKind.openReports => <String>{
        'id',
        'kind',
        'reportType',
        'restaurantName',
        'couponTitle',
        'restaurantId',
        'couponId',
        'reason',
        'note',
        'reporterUid',
        'status',
        'createdAtMillis',
      },
    };
    _keys(data, required);
    for (final entry in data.entries) {
      if (entry.key == 'id' || entry.key == 'kind') continue;
      final valid =
          entry.value == null ||
          entry.value is String ||
          entry.value is bool ||
          (entry.value is num && (entry.value! as num).isFinite);
      if (!valid) {
        throw const FormatException('Invalid Coupon Admin queue item.');
      }
    }
    return CouponAdminQueueRecord(
      id: id,
      kind: kind,
      fields: Map<String, Object?>.unmodifiable(data),
    );
  }

  final String id;
  final CouponAdminQueueKind kind;
  final Map<String, Object?> fields;

  String text(String key) =>
      fields[key] is String ? fields[key]! as String : '';
  int? integer(String key) => fields[key] is int ? fields[key]! as int : null;
  bool flag(String key) => fields[key] == true;
  DateTime? date(String key) => _dateFromMillis(fields[key]);

  Map<String, dynamic> toRestaurantData() => <String, dynamic>{
    'uid': text('uid'),
    'restaurantName': text('restaurantName'),
    'email': text('email'),
    'phoneNumber': text('phone'),
    'phone': text('applicantPhone'),
    'streetAddress': text('streetAddress'),
    'city': text('city'),
    'state': text('state'),
    'zipCode': text('zipCode'),
    'website': text('website'),
    'latitude': _nullableDouble(fields['latitude']),
    'longitude': _nullableDouble(fields['longitude']),
    'approvalStatus': text('approvalStatus'),
    'couponApplicationSubmitted': flag('couponApplicationSubmitted'),
    'profileVersion': integer('profileVersion') ?? 0,
  };
}

@immutable
class CouponAdminCouponRecord {
  const CouponAdminCouponRecord({required this.coupon});

  factory CouponAdminCouponRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'id',
      'title',
      'restaurant',
      'expires',
      'startTimeMillis',
      'endTimeMillis',
      'usageRule',
      'couponNumber',
      'isProximityOnly',
      'proximityRadiusMiles',
      'details',
      'imageUrl',
      'createdAtMillis',
      'updatedAtMillis',
    });
    return CouponAdminCouponRecord(
      coupon: Coupon(
        id: _string(data['id'], empty: false),
        title: _string(data['title']),
        restaurant: _string(data['restaurant']),
        distance: '',
        expires: _string(data['expires']),
        startTime: _dateFromMillis(data['startTimeMillis']),
        endTime: _dateFromMillis(data['endTimeMillis']),
        usageRule: _string(data['usageRule']),
        couponNumber: _nullableString(data['couponNumber']),
        isProximityOnly: _bool(data['isProximityOnly']),
        proximityRadiusMiles: _nullableDouble(data['proximityRadiusMiles']),
        details: _nullableString(data['details']),
        imageUrl: _nullableString(data['imageUrl']),
      ),
    );
  }

  final Coupon coupon;
}

@immutable
class CouponAdminInviteRecord {
  const CouponAdminInviteRecord({
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

  factory CouponAdminInviteRecord.fromJson(Object? value) {
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
    if (data['side'] != 'coupon') {
      throw const FormatException('Invalid Coupon Admin invite side.');
    }
    return CouponAdminInviteRecord(
      id: _string(data['id'], empty: false),
      type: _string(data['type']),
      status: _string(data['status']),
      restaurantId: _string(data['restaurantId']),
      pendingRestaurantKey: _string(data['pendingRestaurantKey']),
      restaurantName: _string(data['restaurantName']),
      createdByEmail: _string(data['createdByEmail']),
      createdAt: _dateFromMillis(data['createdAtMillis']),
      expiresAt: _dateFromMillis(data['expiresAtMillis']),
      usedAt: _dateFromMillis(data['usedAtMillis']),
      revokedAt: _dateFromMillis(data['revokedAtMillis']),
      maxUses: _nullableInteger(data['maxUses']) ?? 1,
      useCount: _nullableInteger(data['useCount']) ?? 0,
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
}
