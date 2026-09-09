import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/bitesaver_location_search.dart';
import 'package:flutter_test/flutter_test.dart';

Restaurant restaurant({
  String documentId = 'restaurant-1',
  String city = 'Springfield',
  String state = 'MA',
  String zipCode = '01234',
  double? latitude = 1,
  double? longitude = -72,
}) {
  return Restaurant(
    documentId: documentId,
    name: 'Radius Cafe',
    distance: Restaurant.defaultDistanceLabel,
    city: city,
    state: state,
    zipCode: zipCode,
    latitude: latitude,
    longitude: longitude,
    coupons: const [],
  );
}

BiteSaverLocationMatch? match({
  required Restaurant restaurant,
  required double radius,
  required double calculatedDistance,
  String query = 'Springfield, MA',
}) {
  return BiteSaverLocationSearch.eligibleRestaurant(
    restaurant: restaurant,
    centerLatitude: 42,
    centerLongitude: -72,
    radiusMiles: radius,
    typedQuery: query,
    distanceCalculator: (_, _, _, _) => calculatedDistance,
  );
}

void main() {
  test(
    'all supported radii include inside and boundary, then reject outside',
    () {
      for (final radius in <double>[1, 3, 5, 10, 15, 20, 30]) {
        expect(
          match(
            restaurant: restaurant(),
            radius: radius,
            calculatedDistance: radius - 0.001,
          ),
          isNotNull,
          reason: '$radius miles inside',
        );
        expect(
          match(
            restaurant: restaurant(),
            radius: radius,
            calculatedDistance: radius,
          )?.distanceMiles,
          radius,
          reason: '$radius miles on boundary',
        );
        expect(
          match(
            restaurant: restaurant(),
            radius: radius,
            calculatedDistance: radius + 0.001,
          ),
          isNull,
          reason: '$radius miles outside',
        );
      }
    },
  );

  test('missing and invalid coordinates fail closed before distance', () {
    var distanceCalls = 0;
    for (final candidate in <Restaurant>[
      restaurant(latitude: null),
      restaurant(longitude: null),
      restaurant(latitude: double.nan),
      restaurant(longitude: double.infinity),
      restaurant(latitude: 91),
      restaurant(longitude: -181),
      restaurant(latitude: 0, longitude: 0),
    ]) {
      final result = BiteSaverLocationSearch.eligibleRestaurant(
        restaurant: candidate,
        centerLatitude: 42,
        centerLongitude: -72,
        radiusMiles: 30,
        typedQuery: 'Springfield, MA',
        distanceCalculator: (_, _, _, _) {
          distanceCalls += 1;
          return 0;
        },
      );
      expect(result, isNull);
    }
    expect(distanceCalls, 0);
  });

  test('invalid resolved centers fail closed', () {
    for (final center in <(double, double)>[
      (double.nan, -72),
      (42, double.infinity),
      (91, -72),
      (42, -181),
      (0, 0),
    ]) {
      expect(
        BiteSaverLocationSearch.eligibleRestaurant(
          restaurant: restaurant(),
          centerLatitude: center.$1,
          centerLongitude: center.$2,
          radiusMiles: 30,
          typedQuery: 'Springfield, MA',
          distanceCalculator: (_, _, _, _) => 0,
        ),
        isNull,
      );
    }
  });

  test(
    'state-aware city preference never excludes eligible cross-state results',
    () {
      final massachusetts = match(
        restaurant: restaurant(state: 'MA'),
        radius: 30,
        calculatedDistance: 2,
      );
      final illinois = match(
        restaurant: restaurant(state: 'IL'),
        radius: 30,
        calculatedDistance: 2,
      );

      expect(massachusetts?.exactLocationPreference, isTrue);
      expect(illinois, isNotNull);
      expect(illinois?.exactLocationPreference, isFalse);
      expect(
        match(
          restaurant: restaurant(state: 'IL'),
          radius: 3,
          calculatedDistance: 3.001,
        ),
        isNull,
      );
    },
  );

  test(
    'leading-zero ZIP and ZIP+4 remain strings with exact preference only',
    () {
      expect(
        match(
          restaurant: restaurant(zipCode: '01234'),
          radius: 5,
          calculatedDistance: 1,
          query: '01234',
        )?.exactLocationPreference,
        isTrue,
      );
      expect(
        match(
          restaurant: restaurant(zipCode: '01234-5678'),
          radius: 5,
          calculatedDistance: 1,
          query: '01234-5678',
        )?.exactLocationPreference,
        isTrue,
      );
      expect(
        match(
          restaurant: restaurant(zipCode: '01234-5678'),
          radius: 5,
          calculatedDistance: 1,
          query: '01234',
        )?.exactLocationPreference,
        isFalse,
      );
    },
  );

  test('exact city or ZIP never bypasses radius or missing coordinates', () {
    expect(
      match(
        restaurant: restaurant(city: 'Springfield', state: 'MA'),
        radius: 1,
        calculatedDistance: 10,
      ),
      isNull,
    );
    expect(
      match(
        restaurant: restaurant(zipCode: '01234', latitude: null),
        radius: 30,
        calculatedDistance: 0,
        query: '01234',
      ),
      isNull,
    );
  });
}
