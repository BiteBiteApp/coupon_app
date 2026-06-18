import 'package:cloud_functions/cloud_functions.dart';

class RestaurantInviteCreationResult {
  final String inviteId;
  final String token;
  final String inviteUrl;
  final DateTime? expiresAt;

  const RestaurantInviteCreationResult({
    required this.inviteId,
    required this.token,
    required this.inviteUrl,
    required this.expiresAt,
  });

  factory RestaurantInviteCreationResult.fromCallableData(
    Map<String, dynamic> data,
  ) {
    return RestaurantInviteCreationResult(
      inviteId: _readString(data['inviteId']),
      token: _readString(data['token']),
      inviteUrl: _readString(data['inviteUrl']),
      expiresAt: _readDateTimeFromMillis(data['expiresAtMillis']),
    );
  }
}

class RestaurantInviteAdminEntry {
  final String id;
  final String type;
  final String side;
  final String status;
  final String restaurantId;
  final String pendingRestaurantKey;
  final String restaurantName;
  final String createdByEmail;
  final DateTime? createdAt;
  final DateTime? expiresAt;
  final DateTime? usedAt;
  final String usedByEmail;
  final DateTime? revokedAt;
  final String revokedByUid;
  final int maxUses;
  final int useCount;

  const RestaurantInviteAdminEntry({
    required this.id,
    required this.type,
    required this.side,
    required this.status,
    required this.restaurantId,
    required this.pendingRestaurantKey,
    required this.restaurantName,
    required this.createdByEmail,
    required this.createdAt,
    required this.expiresAt,
    required this.usedAt,
    required this.usedByEmail,
    required this.revokedAt,
    required this.revokedByUid,
    required this.maxUses,
    required this.useCount,
  });

  bool get isActive => status.trim().toLowerCase() == 'active';

  factory RestaurantInviteAdminEntry.fromCallableData(
    Map<String, dynamic> data,
  ) {
    return RestaurantInviteAdminEntry(
      id: _readString(data['id']),
      type: _readString(data['type']),
      side: _readString(data['side']),
      status: _readString(data['status']),
      restaurantId: _readString(data['restaurantId']),
      pendingRestaurantKey: _readString(data['pendingRestaurantKey']),
      restaurantName: _readString(data['restaurantName']),
      createdByEmail: _readString(data['createdByEmail']),
      createdAt: _readDateTimeFromMillis(data['createdAtMillis']),
      expiresAt: _readDateTimeFromMillis(data['expiresAtMillis']),
      usedAt: _readDateTimeFromMillis(data['usedAtMillis']),
      usedByEmail: _readString(data['usedByEmail']),
      revokedAt: _readDateTimeFromMillis(data['revokedAtMillis']),
      revokedByUid: _readString(data['revokedByUid']),
      maxUses: _readInt(data['maxUses']) ?? 1,
      useCount: _readInt(data['useCount']) ?? 0,
    );
  }
}

class RestaurantInviteService {
  static final FirebaseFunctions _functions = FirebaseFunctions.instanceFor(
    region: 'us-central1',
  );

  static Future<RestaurantInviteCreationResult> createCouponInvite({
    required String restaurantName,
    String? restaurantId,
    String? streetAddress,
    String? city,
    String? state,
    String? zipCode,
    String? phone,
    String? website,
    double? latitude,
    double? longitude,
  }) async {
    final callable = _functions.httpsCallable('createCouponRestaurantInvite');
    final payload = <String, dynamic>{
      if (_trimmedOrNull(restaurantId) != null)
        'restaurantId': _trimmedOrNull(restaurantId),
      'restaurantName': restaurantName.trim(),
      if (_trimmedOrNull(streetAddress) != null)
        'streetAddress': _trimmedOrNull(streetAddress),
      if (_trimmedOrNull(city) != null) 'city': _trimmedOrNull(city),
      if (_trimmedOrNull(state) != null) 'state': _trimmedOrNull(state),
      if (_trimmedOrNull(zipCode) != null) 'zipCode': _trimmedOrNull(zipCode),
      if (_trimmedOrNull(phone) != null) 'phone': _trimmedOrNull(phone),
      if (_trimmedOrNull(website) != null) 'website': _trimmedOrNull(website),
    };
    if (latitude != null) {
      payload['latitude'] = latitude;
    }
    if (longitude != null) {
      payload['longitude'] = longitude;
    }
    final response = await callable.call<Map<String, dynamic>>(payload);
    return RestaurantInviteCreationResult.fromCallableData(response.data);
  }

  static Future<RestaurantInviteCreationResult> createBiteScoreClaimInvite({
    required String restaurantId,
  }) async {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty) {
      throw ArgumentError(
        'BiteScore restaurant ID is required to create a claim invite.',
      );
    }

    final callable = _functions.httpsCallable(
      'createBiteScoreRestaurantClaimInvite',
    );
    final response = await callable.call<Map<String, dynamic>>({
      'restaurantId': trimmedRestaurantId,
    });
    return RestaurantInviteCreationResult.fromCallableData(response.data);
  }

  static Future<List<RestaurantInviteAdminEntry>> listInvites({
    String? side,
  }) async {
    final callable = _functions.httpsCallable('listRestaurantInvites');
    final response = await callable.call<Map<String, dynamic>>({
      if (_trimmedOrNull(side) != null) 'side': _trimmedOrNull(side),
      'limit': 50,
    });
    final rawInvites = response.data['invites'];
    if (rawInvites is! List) {
      return const <RestaurantInviteAdminEntry>[];
    }
    return rawInvites
        .whereType<Map>()
        .map(
          (entry) => RestaurantInviteAdminEntry.fromCallableData(
            Map<String, dynamic>.from(entry),
          ),
        )
        .toList(growable: false);
  }

  static Future<void> revokeInvite(String inviteId) async {
    final callable = _functions.httpsCallable('revokeRestaurantInvite');
    await callable.call<Map<String, dynamic>>({'inviteId': inviteId.trim()});
  }
}

String _readString(dynamic value) {
  return value is String ? value.trim() : '';
}

String? _trimmedOrNull(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

int? _readInt(dynamic value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  return null;
}

DateTime? _readDateTimeFromMillis(dynamic value) {
  if (value is int) {
    return DateTime.fromMillisecondsSinceEpoch(value);
  }
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  }
  return null;
}
