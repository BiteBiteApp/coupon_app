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
        LocalExperts.mexican.id,
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
      expect(LocalExperts.all.map((type) => type.id), [
        'burger',
        'pizza',
        'wings',
        'ramen',
        'donuts',
        'steak',
        'chinese',
        'japanese_sushi',
        'mexican',
        'seafood',
        'italian',
        'bbq',
        'hot_dogs_corn_dogs',
        'chili',
        'mac_and_cheese',
        'meatloaf',
        'chicken_pie',
        'chicken_sandwich',
        'fried_chicken',
        'cuban',
        'subs_sandwiches',
      ]);
      expect(
        LocalExperts.all.map((type) => type.id),
        isNot(containsAll(['burrito', 'tacos', 'lobster', 'pasta'])),
      );
      expect(LocalExperts.byId('Japanese_Sushi')?.id, 'japanese_sushi');
    });

    test('new grouped badge mappings resolve targeted dishes', () {
      expect(
        LocalExperts.matchDish(dishName: 'Birria tacos')?.id,
        LocalExperts.mexican.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Lobster roll')?.id,
        LocalExperts.seafood.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Pulled pork')?.id,
        LocalExperts.bbq.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Corn dog')?.id,
        LocalExperts.hotDogsCornDogs.id,
      );
      expect(
        LocalExperts.matchDish(
          dishName: 'Chili',
          categoryName: 'American',
          subcategory: 'Chili',
        )?.id,
        LocalExperts.chili.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Mac & Cheese')?.id,
        LocalExperts.macAndCheese.id,
      );
      expect(
        LocalExperts.matchDish(dishName: 'Meat loaf')?.id,
        LocalExperts.meatloaf.id,
      );
      expect(
        LocalExperts.matchDish(
          subcategory: 'Chicken Pie / Chicken Pot Pie',
        )?.id,
        LocalExperts.chickenPie.id,
      );
      expect(
        LocalExperts.matchDish(categoryId: 'subs', categoryName: 'Subs')?.id,
        LocalExperts.subsSandwiches.id,
      );
    });

    test('pizza is excluded from Italian but other Italian dishes qualify', () {
      expect(
        LocalExperts.matchDishes(
          dishName: 'Pepperoni pizza',
          categoryName: 'Italian',
          subcategory: 'Pizza',
        ).map((type) => type.id),
        [LocalExperts.pizza.id],
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Spaghetti marinara',
          categoryName: 'Italian',
        ).map((type) => type.id),
        contains(LocalExperts.italian.id),
      );
    });

    test('seafood does not claim sushi without seafood classification', () {
      final matches = LocalExperts.matchDishes(
        dishName: 'Salmon sushi roll',
        categoryName: 'Japanese / Sushi',
        subcategory: 'Sushi roll',
      ).map((type) => type.id);

      expect(matches, contains(LocalExperts.japaneseSushi.id));
      expect(matches, isNot(contains(LocalExperts.seafood.id)));
    });

    test('intentional multi-badge dishes resolve to each applicable badge', () {
      expect(
        LocalExperts.matchDishes(
          dishName: 'Fried chicken sandwich',
          subcategory: 'Chicken sandwich',
        ).map((type) => type.id),
        containsAll([
          LocalExperts.chickenSandwich.id,
          LocalExperts.friedChicken.id,
        ]),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Cuban sandwich',
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Cuban sandwich',
          categoryTags: const ['cuban_sandwich', 'cuban', 'deli'],
        ).map((type) => type.id),
        containsAll([LocalExperts.cuban.id, LocalExperts.subsSandwiches.id]),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Chili cheese dog',
        ).map((type) => type.id),
        containsAll([LocalExperts.chili.id, LocalExperts.hotDogsCornDogs.id]),
      );
    });

    test('Subs / Sandwiches resolves structured deli and sub dishes', () {
      expect(
        LocalExperts.matchDishes(
          dishName: 'Italian sub',
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Italian sub',
        ).map((type) => type.id),
        contains(LocalExperts.subsSandwiches.id),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Turkey hoagie',
        ).map((type) => type.id),
        contains(LocalExperts.subsSandwiches.id),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Meatball grinder',
        ).map((type) => type.id),
        contains(LocalExperts.subsSandwiches.id),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Ham sandwich',
          categoryId: 'deli_sandwiches',
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Ham sandwich',
        ).map((type) => type.id),
        contains(LocalExperts.subsSandwiches.id),
      );
    });

    test('Chili resolves clear chili dishes without broad sauce matches', () {
      expect(
        LocalExperts.matchDishes(
          dishName: 'Chili con carne',
        ).map((type) => type.id),
        contains(LocalExperts.chili.id),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'White chicken chili',
        ).map((type) => type.id),
        contains(LocalExperts.chili.id),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Vegetarian chili',
        ).map((type) => type.id),
        contains(LocalExperts.chili.id),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Chili sauce',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.chili.id)),
      );
      expect(
        LocalExperts.matchDishes(dishName: 'Chili oil').map((type) => type.id),
        isNot(contains(LocalExperts.chili.id)),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Chili chicken',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.chili.id)),
      );
    });

    test('explicit exclusions prevent false multi-badge matches', () {
      expect(
        LocalExperts.matchDishes(
          dishName: 'Cuban sandwich',
          subcategory: 'Cuban sandwich',
          categoryTags: const ['cuban_sandwich', 'cuban', 'sandwich'],
        ).map((type) => type.id),
        isNot(contains(LocalExperts.chickenSandwich.id)),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Buffalo wings',
          subcategory: 'Wings',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.friedChicken.id)),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'BBQ pulled pork sandwich',
          categoryName: 'BBQ',
          subcategory: 'BBQ sandwich',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.subsSandwiches.id)),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Grilled chicken sandwich',
          categoryName: 'Chicken',
          subcategory: 'Chicken sandwich',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.subsSandwiches.id)),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Cheeseburger',
          categoryName: 'Burgers',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.subsSandwiches.id)),
      );
      expect(
        LocalExperts.matchDishes(
          dishName: 'Hot dog',
          subcategory: 'Hot dogs',
        ).map((type) => type.id),
        isNot(contains(LocalExperts.subsSandwiches.id)),
      );
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
