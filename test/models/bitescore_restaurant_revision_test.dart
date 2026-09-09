import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/bitescore_dish.dart';

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

Map<String, dynamic> dishData({Object? restaurantId = 'restaurant-1'}) =>
    <String, dynamic>{
      'restaurantId': restaurantId,
      'restaurantName': 'Root Kitchen',
      'name': 'House Dish',
      'normalizedName': 'house dish',
    };

void main() {
  test('actual Firestore document IDs override conflicting embedded IDs', () {
    final data = restaurantData()..['id'] = 'embedded-restaurant-id';
    final strict = BitescoreRestaurant.tryFromFirestore(
      data,
      fallbackId: 'actual-restaurant-id',
    );
    final finder = BitescoreRestaurant.tryFromFinderFirestore(
      data,
      fallbackId: 'actual-restaurant-id',
    );
    final dish = BitescoreDish.tryFromFirestore(<String, dynamic>{
      'id': 'embedded-dish-id',
      'restaurantId': 'actual-restaurant-id',
      'restaurantName': 'Root Kitchen',
      'name': 'House Dish',
      'normalizedName': 'house dish',
    }, fallbackId: 'actual-dish-id');

    expect(strict?.id, 'actual-restaurant-id');
    expect(finder?.id, 'actual-restaurant-id');
    expect(dish?.id, 'actual-dish-id');
    expect(dish?.restaurantId, 'actual-restaurant-id');
  });

  test('valid exact restaurant and dish source IDs remain authoritative', () {
    for (final sourceId in <String>[
      'Ab3dEf7GhJ9kLm2NpQrS',
      'ChIJN1t_tDeuEmsRUsoyG83frY4',
      'restaurant-😀-ក',
    ]) {
      final data = restaurantData()..['id'] = 'embedded-id';
      expect(
        BitescoreRestaurant.tryFromFirestore(data, fallbackId: sourceId)?.id,
        sourceId,
      );
      expect(
        BitescoreRestaurant.tryFromFinderFirestore(
          data,
          fallbackId: sourceId,
        )?.id,
        sourceId,
      );
      expect(
        BitescoreDish.tryFromFirestore(
          dishData()..['id'] = 'embedded-id',
          fallbackId: sourceId,
        )?.id,
        sourceId,
      );
    }
  });

  test('invalid actual restaurant and dish source IDs fail closed', () {
    final malformedUnicode = String.fromCharCode(0xd800);
    final invalidSourceIds = <String>[
      '',
      ' restaurant-1',
      'restaurant-1 ',
      'restaurant/1',
      '.',
      '..',
      'restaurant-\u0001',
      'restaurant-\u200b',
      malformedUnicode,
      'x' * 1501,
      'restaurant-\u17b4',
      'restaurant-\u17b5',
    ];

    for (final sourceId in invalidSourceIds) {
      final restaurant = restaurantData()..['id'] = 'embedded-valid-id';
      final dish = dishData()..['id'] = 'embedded-valid-id';
      expect(
        BitescoreRestaurant.tryFromFirestore(restaurant, fallbackId: sourceId),
        isNull,
        reason: 'strict restaurant: $sourceId',
      );
      expect(
        BitescoreRestaurant.tryFromFinderFirestore(
          restaurant,
          fallbackId: sourceId,
        ),
        isNull,
        reason: 'Finder restaurant: $sourceId',
      );
      expect(
        BitescoreDish.tryFromFirestore(dish, fallbackId: sourceId),
        isNull,
        reason: 'dish: $sourceId',
      );
    }
  });

  test('dish parent restaurant IDs must be exact and are never redirected', () {
    final malformedUnicode = String.fromCharCode(0xd800);
    for (final parentId in <String>[
      '',
      ' restaurant-1',
      'restaurant-1 ',
      'restaurant/1',
      '.',
      '..',
      'restaurant-\u0001',
      'restaurant-\u200b',
      malformedUnicode,
      'x' * 1501,
      'restaurant-\u17b4',
      'restaurant-\u17b5',
    ]) {
      expect(
        BitescoreDish.tryFromFirestore(
          dishData(restaurantId: parentId),
          fallbackId: 'dish-1',
        ),
        isNull,
        reason: parentId,
      );
    }

    final exact = BitescoreDish.tryFromFirestore(
      dishData(restaurantId: 'restaurant-1'),
      fallbackId: 'dish-1',
    );
    expect(exact?.restaurantId, 'restaurant-1');
  });

  test('constructors continue to support intentionally unsaved draft IDs', () {
    const dish = BitescoreDish(
      id: '',
      restaurantId: '',
      restaurantName: 'Draft Kitchen',
      name: 'Draft Dish',
      normalizedName: 'draft dish',
    );
    const restaurant = BitescoreRestaurant(
      id: '',
      name: 'Draft Kitchen',
      normalizedName: 'draft kitchen',
      address: '1 Main St',
      city: 'Orlando',
      state: 'FL',
      zipCode: '32801',
      location: GeoPoint(28.5, -81.3),
      restaurantWriteRevision: 0,
    );

    expect(dish.id, isEmpty);
    expect(restaurant.id, isEmpty);
  });

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

  test('strict and finder parsing share fail-closed restaurant activity', () {
    final cases = <String, ({Map<String, dynamic> fields, bool expected})>{
      'both absent': (fields: const <String, dynamic>{}, expected: true),
      'canonical true': (
        fields: const <String, dynamic>{'isActive': true},
        expected: true,
      ),
      'canonical false': (
        fields: const <String, dynamic>{'isActive': false},
        expected: false,
      ),
      'legacy true': (
        fields: const <String, dynamic>{'active': true},
        expected: true,
      ),
      'legacy false': (
        fields: const <String, dynamic>{'active': false},
        expected: false,
      ),
      'both true': (
        fields: const <String, dynamic>{'isActive': true, 'active': true},
        expected: true,
      ),
      'both false': (
        fields: const <String, dynamic>{'isActive': false, 'active': false},
        expected: false,
      ),
      'canonical true conflicts': (
        fields: const <String, dynamic>{'isActive': true, 'active': false},
        expected: false,
      ),
      'legacy true conflicts': (
        fields: const <String, dynamic>{'isActive': false, 'active': true},
        expected: false,
      ),
      'canonical string is malformed': (
        fields: const <String, dynamic>{'isActive': 'true'},
        expected: false,
      ),
      'legacy null is malformed': (
        fields: const <String, dynamic>{'active': null},
        expected: false,
      ),
      'valid canonical plus malformed legacy': (
        fields: const <String, dynamic>{'isActive': true, 'active': 1},
        expected: false,
      ),
      'malformed canonical plus valid legacy': (
        fields: const <String, dynamic>{
          'isActive': <String, Object>{},
          'active': true,
        },
        expected: false,
      ),
    };

    for (final MapEntry(key: label, value: fixture) in cases.entries) {
      final data = restaurantData()..addAll(fixture.fields);
      expect(
        BitescoreRestaurant.readActivity(data),
        fixture.expected,
        reason: label,
      );
      expect(
        BitescoreRestaurant.tryFromFirestore(
          data,
          fallbackId: 'restaurant-1',
        )?.isActive,
        fixture.expected,
        reason: 'strict: $label',
      );
      expect(
        BitescoreRestaurant.tryFromFinderFirestore(
          data,
          fallbackId: 'restaurant-1',
        )?.isActive,
        fixture.expected,
        reason: 'finder: $label',
      );
    }
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
