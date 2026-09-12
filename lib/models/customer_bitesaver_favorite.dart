typedef CustomerBiteSaverFavoriteTimestampDecoder =
    DateTime? Function(Object? value);

final class CustomerBiteSaverRestaurantId {
  static final RegExp _pattern = RegExp(r'^bsr_[A-Za-z0-9_-]{43}$');

  final String value;

  CustomerBiteSaverRestaurantId(String value) : value = _requireValue(value);

  static String _requireValue(String value) {
    final match = _pattern.matchAsPrefix(value);
    if (value.length != 47 || match == null || match.end != value.length) {
      throw FormatException('Invalid BiteSaver restaurant ID.', value);
    }
    return value;
  }

  @override
  bool operator ==(Object other) =>
      other is CustomerBiteSaverRestaurantId && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => value;
}

final class CustomerBiteSaverOfferId {
  static final RegExp _pattern = RegExp(r'^bso_[A-Za-z0-9_-]{43}$');

  final String value;

  CustomerBiteSaverOfferId(String value) : value = _requireValue(value);

  static String _requireValue(String value) {
    final match = _pattern.matchAsPrefix(value);
    if (value.length != 47 || match == null || match.end != value.length) {
      throw FormatException('Invalid BiteSaver offer ID.', value);
    }
    return value;
  }

  @override
  bool operator ==(Object other) =>
      other is CustomerBiteSaverOfferId && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => value;
}

final class CustomerBiteSaverRestaurantFavoriteIdentity {
  final CustomerBiteSaverRestaurantId restaurantId;

  const CustomerBiteSaverRestaurantFavoriteIdentity({
    required this.restaurantId,
  });
}

final class CustomerBiteSaverCouponFavoriteIdentity {
  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;

  const CustomerBiteSaverCouponFavoriteIdentity({
    required this.restaurantId,
    required this.offerId,
  });
}

abstract final class CustomerBiteSaverFavoriteContract {
  static const String contractVersion =
      'bitestar.customer-bitesaver-favorite.v1';
  static const int schemaVersion = 1;
  static const String restaurantKind = 'bitesaverRestaurant';
  static const String couponKind = 'bitesaverCoupon';
  static const String couponOfferType = 'coupon';

  static const Set<String> restaurantFields = <String>{
    'schemaVersion',
    'favoriteKind',
    'userId',
    'restaurantId',
    'createdAt',
    'updatedAt',
  };

  static const Set<String> couponFields = <String>{
    'schemaVersion',
    'favoriteKind',
    'userId',
    'restaurantId',
    'offerId',
    'offerType',
    'createdAt',
    'updatedAt',
  };

  static Map<String, dynamic> restaurantDocument({
    required String userId,
    required CustomerBiteSaverRestaurantFavoriteIdentity identity,
    required Object createdAt,
    required Object updatedAt,
  }) {
    return <String, dynamic>{
      'schemaVersion': schemaVersion,
      'favoriteKind': restaurantKind,
      'userId': userId,
      'restaurantId': identity.restaurantId.value,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  static Map<String, dynamic> couponDocument({
    required String userId,
    required CustomerBiteSaverCouponFavoriteIdentity identity,
    required Object createdAt,
    required Object updatedAt,
  }) {
    return <String, dynamic>{
      'schemaVersion': schemaVersion,
      'favoriteKind': couponKind,
      'userId': userId,
      'restaurantId': identity.restaurantId.value,
      'offerId': identity.offerId.value,
      'offerType': couponOfferType,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }

  static bool isValidRestaurantDocument({
    required Map<String, dynamic> data,
    required String userId,
    required CustomerBiteSaverRestaurantFavoriteIdentity identity,
    required CustomerBiteSaverFavoriteTimestampDecoder decodeTimestamp,
  }) {
    if (!_hasExactFields(data, restaurantFields) ||
        data['schemaVersion'] is! int ||
        data['schemaVersion'] != schemaVersion ||
        data['favoriteKind'] != restaurantKind ||
        data['userId'] != userId ||
        data['restaurantId'] != identity.restaurantId.value) {
      return false;
    }
    return _hasCoherentTimestamps(data, decodeTimestamp);
  }

  static bool isValidCouponDocument({
    required Map<String, dynamic> data,
    required String userId,
    required CustomerBiteSaverCouponFavoriteIdentity identity,
    required CustomerBiteSaverFavoriteTimestampDecoder decodeTimestamp,
  }) {
    if (!_hasExactFields(data, couponFields) ||
        data['schemaVersion'] is! int ||
        data['schemaVersion'] != schemaVersion ||
        data['favoriteKind'] != couponKind ||
        data['userId'] != userId ||
        data['restaurantId'] != identity.restaurantId.value ||
        data['offerId'] != identity.offerId.value ||
        data['offerType'] != couponOfferType) {
      return false;
    }
    return _hasCoherentTimestamps(data, decodeTimestamp);
  }

  static bool _hasExactFields(
    Map<String, dynamic> data,
    Set<String> expectedFields,
  ) {
    return data.length == expectedFields.length &&
        data.keys.every(expectedFields.contains);
  }

  static bool _hasCoherentTimestamps(
    Map<String, dynamic> data,
    CustomerBiteSaverFavoriteTimestampDecoder decodeTimestamp,
  ) {
    final createdAt = decodeTimestamp(data['createdAt']);
    final updatedAt = decodeTimestamp(data['updatedAt']);
    return createdAt != null &&
        updatedAt != null &&
        createdAt.millisecondsSinceEpoch >= 0 &&
        !updatedAt.isBefore(createdAt);
  }
}
