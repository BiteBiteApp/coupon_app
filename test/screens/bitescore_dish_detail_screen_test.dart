import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('multi-word title does not shrink when individual words fit', () {
    final size = BiteScoreResponsiveDishTitle.fittedFontSizeFor(
      text: 'Double Cheeseburger',
      availableWidth: 360,
    );

    expect(size, BiteScoreResponsiveDishTitle.normalFontSize);
  });

  test('normal length title keeps normal font size when practical', () {
    final size = BiteScoreResponsiveDishTitle.fittedFontSizeFor(
      text: 'Burger',
      availableWidth: 220,
    );

    expect(size, BiteScoreResponsiveDishTitle.normalFontSize);
  });

  testWidgets('dish title wraps naturally instead of forcing one line', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 360,
            child: BiteScoreResponsiveDishTitle(title: 'Double Cheeseburger'),
          ),
        ),
      ),
    );

    final title = tester.widget<Text>(find.text('Double Cheeseburger'));
    expect(title.maxLines, isNull);
    expect(title.softWrap, true);
    expect(title.style?.fontSize, BiteScoreResponsiveDishTitle.normalFontSize);
  });

  test('single overlong word shrinks only to readable minimum', () {
    final size = BiteScoreResponsiveDishTitle.fittedFontSizeFor(
      text: 'Supercalifragilisticexpialidocious',
      availableWidth: 90,
    );

    expect(size, BiteScoreResponsiveDishTitle.minFontSize);
  });

  test('overlong single-word fallback uses visible hyphen', () {
    final display = BiteScoreResponsiveDishTitle.hyphenatedTitleFor(
      text: 'Supercalifragilisticexpialidocious',
      availableWidth: 90,
      fontSize: BiteScoreResponsiveDishTitle.minFontSize,
    );

    expect(display, contains('-\n'));
  });

  test(
    'double cheeseburger does not create a lone trailing letter fallback',
    () {
      final display = BiteScoreResponsiveDishTitle.hyphenatedTitleFor(
        text: 'Double Cheeseburger',
        availableWidth: 360,
        fontSize: BiteScoreResponsiveDishTitle.normalFontSize,
      );

      expect(display, 'Double Cheeseburger');
      expect(display.endsWith('\nr'), isFalse);
    },
  );

  test(
    'dish detail accepts exact target review id without affecting normal navigation',
    () {
      final normal = BiteScoreDishDetailScreen(entry: _entry());
      final targeted = BiteScoreDishDetailScreen(
        entry: _entry(),
        targetReviewId: 'review-1',
      );

      expect(normal.targetReviewId, isNull);
      expect(targeted.targetReviewId, 'review-1');
    },
  );
}

BiteScoreHomeEntry _entry() {
  return BiteScoreHomeEntry(
    dish: BitescoreDish(
      id: 'dish-1',
      restaurantId: 'restaurant-1',
      restaurantName: 'Restaurant',
      name: 'Double Cheeseburger',
      normalizedName: 'double cheeseburger',
      category: 'Burgers',
      categoryTags: const ['burger', 'burgers', 'american'],
    ),
    restaurant: const BitescoreRestaurant(
      id: 'restaurant-1',
      name: 'Restaurant',
      normalizedName: 'restaurant',
      address: '1 Main St',
      city: 'Ocala',
      state: 'FL',
      zipCode: '34470',
      location: GeoPoint(0, 0),
    ),
    aggregate: const DishRatingAggregate(
      dishId: 'dish-1',
      restaurantId: 'restaurant-1',
    ),
  );
}
