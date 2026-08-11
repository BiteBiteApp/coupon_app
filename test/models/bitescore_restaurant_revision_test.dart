import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/bitescore_restaurant.dart';

Map<String, dynamic> restaurantData({Object? revision = 4}) =>
    <String, dynamic>{
      'name': 'Root Kitchen',
      'normalizedName': 'root kitchen',
      'address': '1 Main St',
      'city': 'Orlando',
      'state': 'FL',
      'zipCode': '32801',
      'location': const GeoPoint(28.5, -81.3),
      'latitude': 28.5,
      'longitude': -81.3,
      'restaurantWriteRevision': revision,
    };

void main() {
  test('strict and finder parsing preserve an exact safe revision', () {
    final strict = BitescoreRestaurant.tryFromFirestore(
      restaurantData(),
      fallbackId: 'restaurant-1',
    );
    final finder = BitescoreRestaurant.tryFromFinderFirestore(
      restaurantData(),
      fallbackId: 'restaurant-1',
    );
    expect(strict?.restaurantWriteRevision, 4);
    expect(finder?.restaurantWriteRevision, 4);
  });

  test('missing and malformed stored revisions fail closed', () {
    final missing = restaurantData()..remove('restaurantWriteRevision');
    expect(
      BitescoreRestaurant.tryFromFirestore(missing, fallbackId: 'restaurant-1'),
      isNull,
    );
    expect(
      BitescoreRestaurant.tryFromFinderFirestore(
        missing,
        fallbackId: 'restaurant-1',
      ),
      isNull,
    );

    for (final revision in <Object?>[
      null,
      '4',
      -1,
      1.5,
      BitescoreRestaurant.maxRestaurantWriteRevision + 1,
    ]) {
      expect(
        BitescoreRestaurant.tryFromFirestore(
          restaurantData(revision: revision),
          fallbackId: 'restaurant-1',
        ),
        isNull,
      );
      expect(
        BitescoreRestaurant.tryFromFinderFirestore(
          restaurantData(revision: revision),
          fallbackId: 'restaurant-1',
        ),
        isNull,
      );
    }
  });

  test('serialization and copyWith preserve and advance revision exactly', () {
    final restaurant = BitescoreRestaurant.tryFromFirestore(
      restaurantData(),
      fallbackId: 'restaurant-1',
    )!;
    expect(restaurant.toFirestoreMap()['restaurantWriteRevision'], 4);
    expect(restaurant.copyWith().restaurantWriteRevision, 4);
    expect(
      restaurant.copyWith(restaurantWriteRevision: 5).restaurantWriteRevision,
      5,
    );
    expect(BitescoreRestaurant.nextRestaurantWriteRevision(4), 5);
  });

  test('invalid and exhausted revision state cannot serialize or advance', () {
    final restaurant = BitescoreRestaurant(
      id: 'restaurant-1',
      name: 'Root Kitchen',
      normalizedName: 'root kitchen',
      address: '1 Main St',
      city: 'Orlando',
      state: 'FL',
      zipCode: '32801',
      location: const GeoPoint(28.5, -81.3),
      restaurantWriteRevision: -1,
    );
    expect(restaurant.toFirestoreMap, throwsStateError);
    expect(
      () => BitescoreRestaurant.nextRestaurantWriteRevision(
        BitescoreRestaurant.maxRestaurantWriteRevision,
      ),
      throwsStateError,
    );
  });

  test('controlled write errors disclose no source identity or revision', () {
    const privateId = 'private-restaurant-id';
    const privateRevision = '12345';
    for (final error in const <Object>[
      BiteScoreRestaurantChangedException(),
      BiteScoreRestaurantWriteStateException(),
    ]) {
      final text = error.toString();
      expect(text, isNot(contains(privateId)));
      expect(text, isNot(contains(privateRevision)));
    }
  });
}
