import 'package:coupon_app/models/local_expert.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExperts', () {
    test('10-word combined headline and body qualifies', () {
      expect(
        LocalExperts.hasMinimumWrittenReview(
          headline: 'Great burger',
          body: 'Juicy patty with crispy edges and excellent sauce',
        ),
        isTrue,
      );
    });

    test('exactly 10 combined headline and body words qualifies', () {
      expect(
        LocalExperts.writtenReviewWordCount(
          headline: 'Great crispy burger',
          body: 'juicy patty sauce toasted bun excellent value',
        ),
        10,
      );
      expect(
        LocalExperts.hasMinimumWrittenReview(
          headline: 'Great crispy burger',
          body: 'juicy patty sauce toasted bun excellent value',
        ),
        isTrue,
      );
    });

    test('nine combined headline and body words fails', () {
      expect(
        LocalExperts.writtenReviewWordCount(
          headline: 'Great crispy burger',
          body: 'juicy patty sauce toasted bun excellent',
        ),
        9,
      );
      expect(
        LocalExperts.hasMinimumWrittenReview(
          headline: 'Great crispy burger',
          body: 'juicy patty sauce toasted bun excellent',
        ),
        isFalse,
      );
    });

    test('fewer than 10 written words does not qualify', () {
      expect(
        LocalExperts.hasMinimumWrittenReview(
          headline: 'Great burger',
          body: 'Juicy patty and sauce',
        ),
        isFalse,
      );
    });

    test('extra spaces and newlines do not inflate word count', () {
      expect(
        LocalExperts.writtenReviewWordCount(
          headline: '  Great    burger  ',
          body: '\n\nJuicy   patty\nwith sauce!!!  ',
        ),
        6,
      );
    });

    test('direct mappings resolve common dish names', () {
      expect(
        LocalExperts.matchDish(dishName: 'Classic hamburger')?.id,
        LocalExperts.burger.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Double cheeseburger')?.id,
        LocalExperts.burger.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Bacon burger')?.id,
        LocalExperts.burger.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Pepperoni pizza')?.id,
        LocalExperts.pizza.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Smothered burrito')?.id,
        LocalExperts.burrito.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Ribeye')?.id,
        LocalExperts.steak.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Filet mignon')?.id,
        LocalExperts.steak.id,
      );
    });

    test('grouped Chinese mappings resolve category and dishes', () {
      expect(
        LocalExperts.matchDish(categoryId: 'chinese')?.id,
        LocalExperts.chinese.id,
      );
      expect(
        LocalExperts.matchDish(subcategory: 'General Tso’s chicken')?.id,
        LocalExperts.chinese.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Kung pao chicken')?.id,
        LocalExperts.chinese.id,
      );
    });

    test('grouped Japanese Sushi mappings resolve category and dishes', () {
      expect(
        LocalExperts.matchDish(categoryName: 'Japanese / Sushi')?.id,
        LocalExperts.japaneseSushi.id,
      );
      expect(
        LocalExperts.matchDish(subcategory: 'Sushi roll')?.id,
        LocalExperts.japaneseSushi.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Salmon sashimi')?.id,
        LocalExperts.japaneseSushi.id,
      );
    });

    test('expert type IDs are stable', () {
      expect(
        LocalExperts.all.map((type) => type.id),
        containsAll([
          'burger',
          'pizza',
          'burrito',
          'tacos',
          'wings',
          'lobster',
          'pasta',
          'ramen',
          'donuts',
          'chinese',
          'japanese_sushi',
          'steak',
        ]),
      );
      expect(LocalExperts.byId('Japanese_Sushi')?.id, 'japanese_sushi');
    });

    test('badge thresholds are shared constants', () {
      expect(LocalExpertBadgeThresholds.clusterRadiusMiles, 30);
      expect(
        LocalExpertBadgeThresholds.forLevel(
          LocalExpertBadgeLevel.level1,
        ).distinctRestaurantsInCluster,
        3,
      );
      expect(
        LocalExpertBadgeThresholds.forLevel(
          LocalExpertBadgeLevel.level2,
        ).distinctRestaurantsOverall,
        10,
      );
      expect(
        LocalExpertBadgeThresholds.forLevel(
          LocalExpertBadgeLevel.level3,
        ).distinctRestaurantsOverall,
        25,
      );
    });

    test('deduplication key is stable for user restaurant and expert type', () {
      final first = LocalExperts.deduplicationKey(
        userId: ' UserA ',
        restaurantId: ' RestaurantA ',
        expertTypeId: ' Burger ',
      );
      final second = LocalExperts.deduplicationKey(
        userId: 'usera',
        restaurantId: 'restauranta',
        expertTypeId: 'burger',
      );

      expect(first, second);
      expect(first, 'usera|restauranta|burger');
    });

    test('same restaurant and expert type produces same deduplication key', () {
      final first = LocalExperts.deduplicationKey(
        userId: 'user-1',
        restaurantId: 'restaurant-1',
        expertTypeId: LocalExperts.burger.id,
      );
      final second = LocalExperts.deduplicationKey(
        userId: 'user-1',
        restaurantId: 'restaurant-1',
        expertTypeId: LocalExperts.burger.id,
      );

      expect(first, second);
    });

    test(
      'same restaurant but different expert types produce different keys',
      () {
        final burgerKey = LocalExperts.deduplicationKey(
          userId: 'user-1',
          restaurantId: 'restaurant-1',
          expertTypeId: LocalExperts.burger.id,
        );
        final pizzaKey = LocalExperts.deduplicationKey(
          userId: 'user-1',
          restaurantId: 'restaurant-1',
          expertTypeId: LocalExperts.pizza.id,
        );

        expect(burgerKey, isNot(pizzaKey));
      },
    );

    test('review reference supports future expert review lists', () {
      const reference = LocalExpertReviewReference(
        userId: 'user-1',
        reviewId: 'review-1',
        restaurantId: 'restaurant-1',
        expertTypeId: 'burger',
      );

      expect(reference.reviewId, 'review-1');
      expect(reference.deduplicationKey, 'user-1|restaurant-1|burger');
    });
  });
}
