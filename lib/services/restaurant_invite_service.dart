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

class RestaurantInviteDeepLink {
  final String side;
  final String token;

  const RestaurantInviteDeepLink({required this.side, required this.token});
}

class CouponInvitePrefillPreview {
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;
  final String phone;
  final String website;
  final double? latitude;
  final double? longitude;

  const CouponInvitePrefillPreview({
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.phone,
    required this.website,
    required this.latitude,
    required this.longitude,
  });

  factory CouponInvitePrefillPreview.fromCallableData(
    Map<String, dynamic> data,
  ) {
    return CouponInvitePrefillPreview(
      streetAddress: _readString(data['streetAddress']),
      city: _readString(data['city']),
      state: _readString(data['state']),
      zipCode: _readString(data['zipCode']),
      phone: _readString(data['phone']),
      website: _readString(data['website']),
      latitude: _readDouble(data['latitude']),
      longitude: _readDouble(data['longitude']),
    );
  }
}

class RestaurantInvitePreview {
  final String inviteId;
  final String side;
  final String type;
  final String status;
  final String restaurantName;
  final DateTime? expiresAt;
  final String pendingRestaurantKey;
  final CouponInvitePrefillPreview? couponPrefill;
  final String restaurantId;
  final String restaurantAddressSummary;

  const RestaurantInvitePreview({
    required this.inviteId,
    required this.side,
    required this.type,
    required this.status,
    required this.restaurantName,
    required this.expiresAt,
    required this.pendingRestaurantKey,
    required this.couponPrefill,
    required this.restaurantId,
    required this.restaurantAddressSummary,
  });

  bool get isCoupon => side == 'coupon';
  bool get isBiteScore => side == 'bitescore';

  factory RestaurantInvitePreview.fromCallableData(Map<String, dynamic> data) {
    final rawPrefill = data['couponPrefill'];
    final prefill = rawPrefill is Map
        ? CouponInvitePrefillPreview.fromCallableData(
            Map<String, dynamic>.from(rawPrefill),
          )
        : null;

    return RestaurantInvitePreview(
      inviteId: _readString(data['inviteId']),
      side: _readString(data['side']),
      type: _readString(data['type']),
      status: _readString(data['status']),
      restaurantName: _readString(data['restaurantName']),
      expiresAt: _readDateTimeFromMillis(data['expiresAtMillis']),
      pendingRestaurantKey: _readString(data['pendingRestaurantKey']),
      couponPrefill: prefill,
      restaurantId: _readString(data['restaurantId']),
      restaurantAddressSummary: _readString(data['restaurantAddressSummary']),
    );
  }
}

class RestaurantInviteRedemptionResult {
  final String inviteId;
  final String restaurantId;
  final String restaurantName;

  const RestaurantInviteRedemptionResult({
    required this.inviteId,
    required this.restaurantId,
    required this.restaurantName,
  });

  factory RestaurantInviteRedemptionResult.fromCallableData(
    Map<String, dynamic> data,
  ) {
    return RestaurantInviteRedemptionResult(
      inviteId: _readString(data['inviteId']),
      restaurantId: _readString(data['restaurantId']),
      restaurantName: _readString(data['restaurantName']),
    );
  }
}

class RestaurantInviteService {
  static const Set<String> _trustedHttpsHosts = {
    'go.biteranger.com',
    'app.biteranger.com',
    'go.colesmartllc.com',
    'app.colesmartllc.com',
    'colesmartllc.com',
    'www.colesmartllc.com',
  };

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

  static Future<RestaurantInvitePreview> previewInvite({
    required String token,
    required String side,
  }) async {
    final callable = _functions.httpsCallable('previewRestaurantInvite');
    final response = await callable.call<Map<String, dynamic>>({
      'token': token.trim(),
      'side': side.trim(),
    });
    return RestaurantInvitePreview.fromCallableData(response.data);
  }

  static Future<RestaurantInviteRedemptionResult> redeemCouponInvite({
    required String token,
  }) async {
    final callable = _functions.httpsCallable('redeemCouponRestaurantInvite');
    final response = await callable.call<Map<String, dynamic>>({
      'token': token.trim(),
    });
    return RestaurantInviteRedemptionResult.fromCallableData(response.data);
  }

  static Future<RestaurantInviteRedemptionResult> redeemBiteScoreClaimInvite({
    required String token,
  }) async {
    final callable = _functions.httpsCallable(
      'redeemBiteScoreRestaurantClaimInvite',
    );
    final response = await callable.call<Map<String, dynamic>>({
      'token': token.trim(),
    });
    return RestaurantInviteRedemptionResult.fromCallableData(response.data);
  }

  static RestaurantInviteDeepLink? parseInviteDeepLink(Uri uri) {
    final isCustomScheme = uri.scheme == 'bitesaver';
    final isTrustedHttps =
        uri.scheme == 'https' &&
        _trustedHttpsHosts.contains(uri.host.trim().toLowerCase());
    if (!isCustomScheme && !isTrustedHttps) {
      return null;
    }

    if (isTrustedHttps) {
      return _parseInviteSegments(uri.pathSegments);
    }

    final segments = _normalizedInviteSegments(
      host: uri.host,
      pathSegments: uri.pathSegments,
    );
    return _parseInviteSegments(segments);
  }

  static RestaurantInviteDeepLink? parseInviteRouteName(String? routeName) {
    final uri = Uri.tryParse(routeName ?? '');
    if (uri == null) {
      return null;
    }

    return _parseInviteSegments(uri.pathSegments);
  }

  static List<String> _normalizedInviteSegments({
    required String host,
    required List<String> pathSegments,
  }) {
    final normalizedHost = host.trim().toLowerCase();
    if (normalizedHost == 'invite') {
      return pathSegments;
    }
    if (normalizedHost.isEmpty) {
      return pathSegments;
    }

    return const <String>[];
  }

  static RestaurantInviteDeepLink? _parseInviteSegments(
    List<String> rawSegments,
  ) {
    final segments = rawSegments
        .map((segment) => segment.trim())
        .where((segment) => segment.isNotEmpty)
        .toList(growable: false);

    final inviteOffset = segments.isNotEmpty && segments.first == 'invite'
        ? 1
        : 0;
    if (segments.length < inviteOffset + 2) {
      return null;
    }

    final side = segments[inviteOffset].trim().toLowerCase();
    final token = segments[inviteOffset + 1].trim();
    if ((side != 'coupon' && side != 'bitescore') || token.isEmpty) {
      return null;
    }

    return RestaurantInviteDeepLink(side: side, token: token);
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

double? _readDouble(dynamic value) {
  if (value is num) {
    return value.toDouble();
  }
  if (value is String) {
    return double.tryParse(value.trim());
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
