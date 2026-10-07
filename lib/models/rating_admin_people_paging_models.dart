import 'package:flutter/foundation.dart';

enum RatingAdminUserSearchMode {
  viewAll('viewAll', 'View All'),
  displayName('displayName', 'Display Name'),
  uid('uid', 'UID'),
  email('email', 'Email'),
  phone('phone', 'Phone'),
  claimedRestaurant('claimedRestaurant', 'Claimed Restaurant');

  const RatingAdminUserSearchMode(this.wireName, this.label);

  final String wireName;
  final String label;
}

enum RatingAdminUserPointsSort {
  mostPoints('mostPoints', 'Most points'),
  fewestPoints('fewestPoints', 'Fewest points'),
  displayNameAz('displayNameAz', 'Display name A-Z'),
  mostRecentActivity('mostRecentActivity', 'Most recent point activity');

  const RatingAdminUserPointsSort(this.wireName, this.label);

  final String wireName;
  final String label;
}

Map<String, Object?> _map(Object? value) {
  if (value is! Map) {
    throw const FormatException('Invalid Rating Admin people page item.');
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const FormatException('Invalid Rating Admin people page item.');
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
    throw const FormatException('Invalid Rating Admin people page item.');
  }
}

String _exactUid(Object? value) {
  if (value is! String || value.isEmpty || value.length > 128 ||
      value == '.' || value == '..' || RegExp(r'[/\x00-\x1f\x7f]').hasMatch(value)) {
    throw const FormatException('Invalid user identity.');
  }
  return value;
}

String _string(Object? value, {bool allowEmpty = false}) {
  if (value is! String || (!allowEmpty && value.trim().isEmpty)) {
    throw const FormatException('Invalid Rating Admin people page item.');
  }
  return value;
}

String? _nullableString(Object? value) {
  return value == null ? null : _string(value);
}

bool _bool(Object? value) {
  if (value is! bool) {
    throw const FormatException('Invalid Rating Admin people page item.');
  }
  return value;
}

int _integer(Object? value) {
  if (value is! int) {
    throw const FormatException('Invalid Rating Admin people page item.');
  }
  return value;
}

int? _nullableInteger(Object? value) {
  return value == null ? null : _integer(value);
}

List<String> _strings(Object? value, {required int maximumLength}) {
  if (value is! List ||
      value.length > maximumLength ||
      value.any((entry) => entry is! String || entry.trim().isEmpty)) {
    throw const FormatException('Invalid Rating Admin people page item.');
  }
  return List<String>.unmodifiable(value.cast<String>());
}

@immutable
class RatingAdminUserRecord {
  const RatingAdminUserRecord({
    required this.uid,
    required this.displayName,
    required this.email,
    required this.phoneNumber,
    required this.claimedRestaurantNames,
    required this.hasMoreClaimedRestaurants,
    required this.hasRestaurantAccount,
    required this.hasBiteScoreOwnership,
    required this.isAdmin,
    required this.isEmailVerified,
    required this.restaurantAccountStatus,
    required this.activityTags,
  });

  factory RatingAdminUserRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'uid',
      'displayName',
      'email',
      'phoneNumber',
      'claimedRestaurantNames',
      'hasMoreClaimedRestaurants',
      'hasRestaurantAccount',
      'hasBiteScoreOwnership',
      'isAdmin',
      'isEmailVerified',
      'restaurantAccountStatus',
      'activityTags',
    });
    return RatingAdminUserRecord(
      uid: _exactUid(data['uid']),
      displayName: _string(data['displayName']),
      email: _nullableString(data['email']),
      phoneNumber: _nullableString(data['phoneNumber']),
      claimedRestaurantNames: _strings(
        data['claimedRestaurantNames'],
        maximumLength: 5,
      ),
      hasMoreClaimedRestaurants: _bool(data['hasMoreClaimedRestaurants']),
      hasRestaurantAccount: _bool(data['hasRestaurantAccount']),
      hasBiteScoreOwnership: _bool(data['hasBiteScoreOwnership']),
      isAdmin: _bool(data['isAdmin']),
      isEmailVerified: _bool(data['isEmailVerified']),
      restaurantAccountStatus: _string(data['restaurantAccountStatus']),
      activityTags: _strings(data['activityTags'], maximumLength: 8).toSet(),
    );
  }

  final String uid;
  final String displayName;
  final String? email;
  final String? phoneNumber;
  final List<String> claimedRestaurantNames;
  final bool hasMoreClaimedRestaurants;
  final bool hasRestaurantAccount;
  final bool hasBiteScoreOwnership;
  final bool isAdmin;
  final bool isEmailVerified;
  final String restaurantAccountStatus;
  final Set<String> activityTags;

  String get roleLabel {
    final roles = <String>[];
    if (isAdmin) roles.add('Admin');
    if (hasRestaurantAccount) roles.add('Coupon Owner');
    if (hasBiteScoreOwnership) roles.add('BiteScore Owner');
    if (activityTags.contains('Claims')) roles.add('Claimant');
    if (activityTags.contains('Reviews') || activityTags.contains('Reports')) {
      roles.add('Customer');
    }
    return roles.isEmpty ? 'App User' : roles.toSet().join(', ');
  }
}

@immutable
class RatingAdminUserPointsRecord {
  const RatingAdminUserPointsRecord({
    required this.userId,
    required this.displayName,
    required this.totalPoints,
    required this.lastActivityAt,
  });

  factory RatingAdminUserPointsRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'userId',
      'displayName',
      'totalPoints',
      'lastActivityAtMillis',
    });
    final millis = _nullableInteger(data['lastActivityAtMillis']);
    return RatingAdminUserPointsRecord(
      userId: _string(data['userId']),
      displayName: _string(data['displayName']),
      totalPoints: _integer(data['totalPoints']),
      lastActivityAt: millis == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(millis),
    );
  }

  final String userId;
  final String displayName;
  final int totalPoints;
  final DateTime? lastActivityAt;
}

@immutable
class RatingAdminContributionLedgerRecord {
  const RatingAdminContributionLedgerRecord({
    required this.id,
    required this.userId,
    required this.pointsDelta,
    required this.description,
    required this.dishId,
    required this.dishName,
    required this.restaurantId,
    required this.restaurantName,
    required this.restaurantCity,
    required this.restaurantState,
    required this.restaurantAddress,
    required this.restaurantPhone,
    required this.requestId,
    required this.reason,
    required this.createdAt,
  });

  factory RatingAdminContributionLedgerRecord.fromJson(Object? value) {
    final data = _map(value);
    _keys(data, <String>{
      'id',
      'userId',
      'pointsDelta',
      'description',
      'dishId',
      'dishName',
      'restaurantId',
      'restaurantName',
      'restaurantCity',
      'restaurantState',
      'restaurantAddress',
      'restaurantPhone',
      'requestId',
      'reason',
      'createdAtMillis',
    });
    return RatingAdminContributionLedgerRecord(
      id: _string(data['id']),
      userId: _string(data['userId']),
      pointsDelta: _integer(data['pointsDelta']),
      description: _string(data['description']),
      dishId: _nullableString(data['dishId']),
      dishName: _nullableString(data['dishName']),
      restaurantId: _nullableString(data['restaurantId']),
      restaurantName: _nullableString(data['restaurantName']),
      restaurantCity: _nullableString(data['restaurantCity']),
      restaurantState: _nullableString(data['restaurantState']),
      restaurantAddress: _nullableString(data['restaurantAddress']),
      restaurantPhone: _nullableString(data['restaurantPhone']),
      requestId: _nullableString(data['requestId']),
      reason: _nullableString(data['reason']),
      createdAt: DateTime.fromMillisecondsSinceEpoch(
        _integer(data['createdAtMillis']),
      ),
    );
  }

  final String id;
  final String userId;
  final int pointsDelta;
  final String description;
  final String? dishId;
  final String? dishName;
  final String? restaurantId;
  final String? restaurantName;
  final String? restaurantCity;
  final String? restaurantState;
  final String? restaurantAddress;
  final String? restaurantPhone;
  final String? requestId;
  final String? reason;
  final DateTime createdAt;
}
class AdminUserVerificationStatus {
  const AdminUserVerificationStatus({
    required this.status, required this.passId, required this.revision,
    required this.phase, required this.examined, required this.steps,
    required this.lastCompletedAt,
  });
  final String status;
  final String? passId;
  final String? revision;
  final String phase;
  final int examined;
  final int steps;
  final DateTime? lastCompletedAt;

  factory AdminUserVerificationStatus.fromJson(Object? raw) {
    if (raw is! Map || raw['schemaVersion'] != 1 ||
        !const ['notStarted', 'pending', 'paused', 'failed', 'complete'].contains(raw['status']) ||
        !const ['discovering', 'reconciling'].contains(raw['phase']) ||
        raw['examined'] is! int || raw['steps'] is! int ||
        (raw['passId'] != null && raw['passId'] is! String) ||
        (raw['revision'] != null && raw['revision'] is! String) ||
        (raw['lastCompletedAtMillis'] != null && raw['lastCompletedAtMillis'] is! int)) {
      throw const FormatException('Invalid directory verification status.');
    }
    return AdminUserVerificationStatus(
      status: raw['status'] as String, passId: raw['passId'] as String?,
      revision: raw['revision'] as String?, phase: raw['phase'] as String,
      examined: raw['examined'] as int, steps: raw['steps'] as int,
      lastCompletedAt: raw['lastCompletedAtMillis'] == null ? null :
          DateTime.fromMillisecondsSinceEpoch(raw['lastCompletedAtMillis'] as int),
    );
  }

  String get summary => switch (status) {
    'complete' => 'Recovery pass completed at ${lastCompletedAt?.toLocal()}.',
    'failed' => 'Verification failed. Saved progress can be resumed.',
    'pending' || 'paused' => 'Verification incomplete. Resume to continue.',
    _ => 'No completed recovery pass.',
  };
}
