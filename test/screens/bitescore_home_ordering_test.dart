import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteScore Home production ordering', () {
    for (final selectedSort in <String>[
      'Highest BiteScore',
      'Closest',
      'Most Reviewed',
      'Best Value',
      'Best Flavor',
      'Highest Quality',
      'Most Enjoyed',
    ]) {
      test('$selectedSort finishes with exact dish ID ascending', () {
        final sorted = BiteScoreHomeOrdering.sortEntries(
          <BiteScoreHomeEntry>[_entry('dish-b'), _entry('dish-a')],
          selectedSort: selectedSort,
          distanceMilesFor: (_) => 3,
        );

        expect(sorted.map((entry) => entry.dish.id), <String>[
          'dish-a',
          'dish-b',
        ]);
      });
    }

    test('dish ID remains after all existing customer-visible fields', () {
      final alphabeticNameWithLaterId = _entry(
        'dish-z',
        dishName: 'Alpha Dish',
      );
      final laterNameWithEarlierId = _entry('dish-a', dishName: 'Zulu Dish');

      final sorted = BiteScoreHomeOrdering.sortEntries(
        <BiteScoreHomeEntry>[laterNameWithEarlierId, alphabeticNameWithLaterId],
        selectedSort: 'Highest BiteScore',
        distanceMilesFor: (_) => null,
      );

      expect(sorted.map((entry) => entry.dish.id), <String>[
        'dish-z',
        'dish-a',
      ]);
    });
  });
}

BiteScoreHomeEntry _entry(String dishId, {String dishName = 'Twin Dish'}) {
  const restaurantId = 'restaurant-1';
  return BiteScoreHomeEntry(
    dish: BitescoreDish(
      id: dishId,
      restaurantId: restaurantId,
      restaurantName: 'Root Kitchen',
      name: dishName,
      normalizedName: dishName.toLowerCase(),
    ),
    restaurant: const BitescoreRestaurant(
      id: restaurantId,
      name: 'Root Kitchen',
      normalizedName: 'root kitchen',
      address: '1 Main St',
      city: 'Orlando',
      state: 'FL',
      zipCode: '32801',
      location: GeoPoint(28.5, -81.3),
      restaurantWriteRevision: 4,
    ),
    aggregate: DishRatingAggregate(
      dishId: dishId,
      restaurantId: restaurantId,
      overallBiteScore: 88,
      ratingCount: 12,
      valueScoreAverage: 8,
      tastinessScoreAverage: 8,
      qualityScoreAverage: 8,
      overallImpressionAverage: 8,
    ),
  );
}
