import 'customer_bitesaver_favorite.dart';
import 'customer_bitesaver_search.dart';

enum CustomerBiteSaverSavedSection { restaurants, coupons }

enum CustomerBiteSaverSavedAvailability { available, unavailable }

Map<String, Object?> _savedRecord(Object? value) {
  if (value is! Map) {
    throw const CustomerBiteSaverProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const CustomerBiteSaverProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _savedExactKeys(Map<String, Object?> value, Set<String> expected) {
  if (value.length != expected.length ||
      value.keys.any((key) => !expected.contains(key))) {
    throw const CustomerBiteSaverProtocolException();
  }
}

String _savedString(
  Object? value, {
  required int maximumLength,
  bool allowEmpty = false,
}) {
  if (value is! String ||
      value.length > maximumLength ||
      (!allowEmpty && value.isEmpty)) {
    throw const CustomerBiteSaverProtocolException();
  }
  return value;
}

String? _savedCursor(Object? value) {
  if (value == null) return null;
  return _savedString(value, maximumLength: 32768);
}

final class CustomerBiteSaverSavedPageRequest {
  const CustomerBiteSaverSavedPageRequest({
    required this.clientRequestId,
    required this.section,
    required this.cursor,
  });

  final String clientRequestId;
  final CustomerBiteSaverSavedSection section;
  final String? cursor;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'clientRequestId': clientRequestId,
    'section': section.name,
    'cursor': cursor,
  };
}

final class CustomerBiteSaverSavedEntry {
  const CustomerBiteSaverSavedEntry._({
    required this.favoriteKind,
    required this.restaurantId,
    required this.offerId,
    required this.availability,
    required this.restaurant,
    required this.offer,
    required this.accessToken,
  });

  factory CustomerBiteSaverSavedEntry.fromJson(Object? value) {
    final data = _savedRecord(value);
    _savedExactKeys(data, const <String>{
      'favoriteKind',
      'restaurantId',
      'offerId',
      'availability',
      'restaurant',
      'offer',
      'accessToken',
    });
    final favoriteKind = _savedString(data['favoriteKind'], maximumLength: 32);
    if (favoriteKind != CustomerBiteSaverFavoriteContract.restaurantKind &&
        favoriteKind != CustomerBiteSaverFavoriteContract.couponKind) {
      throw const CustomerBiteSaverProtocolException();
    }
    final restaurantId = data['restaurantId'] == null
        ? null
        : CustomerBiteSaverRestaurantId(
            _savedString(data['restaurantId'], maximumLength: 47),
          );
    final offerId = data['offerId'] == null
        ? null
        : CustomerBiteSaverOfferId(
            _savedString(data['offerId'], maximumLength: 47),
          );
    final availability = switch (data['availability']) {
      'available' => CustomerBiteSaverSavedAvailability.available,
      'unavailable' => CustomerBiteSaverSavedAvailability.unavailable,
      _ => throw const CustomerBiteSaverProtocolException(),
    };
    final restaurant = data['restaurant'] == null
        ? null
        : CustomerBiteSaverRestaurant.fromJson(data['restaurant']);
    final offer = data['offer'] == null
        ? null
        : CustomerBiteSaverOffer.fromJson(data['offer']);
    final accessToken = data['accessToken'] == null
        ? null
        : _savedString(data['accessToken'], maximumLength: 32768);
    final isRestaurant =
        favoriteKind == CustomerBiteSaverFavoriteContract.restaurantKind;
    if ((isRestaurant && (restaurantId == null || offerId != null)) ||
        (!isRestaurant && offerId == null) ||
        (availability == CustomerBiteSaverSavedAvailability.available &&
            (restaurant == null ||
                accessToken == null ||
                restaurantId == null ||
                restaurant.restaurantId != restaurantId ||
                (!isRestaurant &&
                    (offer == null || offer.offerId != offerId)))) ||
        (availability == CustomerBiteSaverSavedAvailability.unavailable &&
            (restaurant != null || offer != null || accessToken != null)) ||
        (isRestaurant && offer != null)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverSavedEntry._(
      favoriteKind: favoriteKind,
      restaurantId: restaurantId,
      offerId: offerId,
      availability: availability,
      restaurant: restaurant,
      offer: offer,
      accessToken: accessToken,
    );
  }

  final String favoriteKind;
  final CustomerBiteSaverRestaurantId? restaurantId;
  final CustomerBiteSaverOfferId? offerId;
  final CustomerBiteSaverSavedAvailability availability;
  final CustomerBiteSaverRestaurant? restaurant;
  final CustomerBiteSaverOffer? offer;
  final String? accessToken;

  bool get isAvailable =>
      availability == CustomerBiteSaverSavedAvailability.available;

  String get favoriteId => switch (favoriteKind) {
    CustomerBiteSaverFavoriteContract.restaurantKind => restaurantId!.value,
    CustomerBiteSaverFavoriteContract.couponKind => offerId!.value,
    _ => throw const CustomerBiteSaverProtocolException(),
  };
}

final class CustomerBiteSaverSavedPageResult {
  const CustomerBiteSaverSavedPageResult._({
    required this.section,
    required this.entries,
    required this.nextCursor,
    required this.hasMore,
    required this.partial,
  });

  factory CustomerBiteSaverSavedPageResult.fromJson(Object? value) {
    final data = _savedRecord(value);
    _savedExactKeys(data, const <String>{
      'schemaVersion',
      'section',
      'entries',
      'nextCursor',
      'hasMore',
      'partial',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final section = switch (data['section']) {
      'restaurants' => CustomerBiteSaverSavedSection.restaurants,
      'coupons' => CustomerBiteSaverSavedSection.coupons,
      _ => throw const CustomerBiteSaverProtocolException(),
    };
    final rawEntries = data['entries'];
    if (rawEntries is! List || rawEntries.length > 25) {
      throw const CustomerBiteSaverProtocolException();
    }
    final entries = rawEntries
        .map(CustomerBiteSaverSavedEntry.fromJson)
        .toList(growable: false);
    if (entries.map((entry) => entry.favoriteId).toSet().length !=
        entries.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    final nextCursor = _savedCursor(data['nextCursor']);
    final hasMore = data['hasMore'];
    final partial = data['partial'];
    if (hasMore is! bool ||
        partial is! bool ||
        hasMore != (nextCursor != null) ||
        (partial && !hasMore)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverSavedPageResult._(
      section: section,
      entries: List<CustomerBiteSaverSavedEntry>.unmodifiable(entries),
      nextCursor: nextCursor,
      hasMore: hasMore,
      partial: partial,
    );
  }

  final CustomerBiteSaverSavedSection section;
  final List<CustomerBiteSaverSavedEntry> entries;
  final String? nextCursor;
  final bool hasMore;
  final bool partial;
}

final class CustomerBiteSaverSavedMenuPageRequest {
  const CustomerBiteSaverSavedMenuPageRequest({
    required this.clientRequestId,
    required this.accessToken,
    required this.cursor,
  });

  final String clientRequestId;
  final String accessToken;
  final String? cursor;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'clientRequestId': clientRequestId,
    'accessToken': accessToken,
    'cursor': cursor,
  };
}
