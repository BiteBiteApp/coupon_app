import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/models/local_expert_badge_calculator.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertBadgeCalculator', () {
    test('three restaurants in a valid 30-mile cluster earns Level 1', () {
      final result = _calculate([
        _review('r1', restaurantId: 'a', longitude: 0),
        _review('r2', restaurantId: 'b', longitude: 0.1),
        _review('r3', restaurantId: 'c', longitude: 0.2),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(result.bestLocalClusterRestaurantCount, 3);
      expect(result.bestSameCountyRestaurantCount, 0);
      expect(
        result.qualificationMethod,
        LocalExpertQualificationMethod.localCluster,
      );
    });

    test(
      'three restaurants with one distant pair does not earn local Level 1',
      () {
        final result = _calculate([
          _review('r1', restaurantId: 'a', longitude: 0),
          _review('r2', restaurantId: 'b', longitude: 0.2),
          _review('r3', restaurantId: 'c', longitude: 0.55),
        ]).resultFor(LocalExperts.burger.id)!;

        expect(result.earnedLevel, isNull);
        expect(result.totalDistinctRestaurantCount, 3);
        expect(result.bestLocalClusterRestaurantCount, 2);
      },
    );

    test('same-county qualification works outside the 30-mile cluster', () {
      final result = _calculate([
        _review(
          'r1',
          restaurantId: 'a',
          longitude: 0,
          restaurantCounty: 'Citrus',
          restaurantState: 'FL',
        ),
        _review(
          'r2',
          restaurantId: 'b',
          longitude: 0.7,
          restaurantCounty: 'citrus county',
          restaurantState: 'Florida',
        ),
        _review(
          'r3',
          restaurantId: 'c',
          longitude: 1.4,
          restaurantCounty: 'CITRUS COUNTY',
          restaurantState: 'FL',
        ),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(result.totalDistinctRestaurantCount, 3);
      expect(result.bestLocalClusterRestaurantCount, 1);
      expect(result.bestSameCountyRestaurantCount, 3);
      expect(
        result.qualificationMethod,
        LocalExpertQualificationMethod.localCluster,
      );
    });

    test('same county name in different states does not qualify together', () {
      final result = _calculate([
        _review(
          'fl',
          restaurantId: 'fl',
          longitude: 0,
          restaurantCounty: 'Orange County',
          restaurantState: 'FL',
        ),
        _review(
          'ca',
          restaurantId: 'ca',
          longitude: 0.7,
          restaurantCounty: 'Orange County',
          restaurantState: 'CA',
        ),
        _review(
          'ny',
          restaurantId: 'ny',
          longitude: 1.4,
          restaurantCounty: 'Orange County',
          restaurantState: 'NY',
        ),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, isNull);
      expect(result.totalDistinctRestaurantCount, 3);
      expect(result.bestLocalClusterRestaurantCount, 1);
      expect(result.bestSameCountyRestaurantCount, 1);
    });

    test('missing county data does not break badge calculation', () {
      final result = _calculate([
        _review('r1', restaurantId: 'a', longitude: 0),
        _review('r2', restaurantId: 'b', longitude: 0.7),
        _review('r3', restaurantId: 'c', longitude: 1.4),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, isNull);
      expect(result.totalDistinctRestaurantCount, 3);
      expect(result.bestLocalClusterRestaurantCount, 1);
      expect(result.bestSameCountyRestaurantCount, 0);
    });

    test('same-county grouping uses distinct restaurant count semantics', () {
      final result = _calculate([
        _review(
          'first',
          restaurantId: 'same-place',
          longitude: 0,
          restaurantCounty: 'Citrus County',
          restaurantState: 'FL',
          createdAt: DateTime(2026, 1, 1),
        ),
        _review(
          'second',
          restaurantId: 'same-place',
          longitude: 0.7,
          restaurantCounty: 'Citrus County',
          restaurantState: 'FL',
          createdAt: DateTime(2026, 2, 1),
        ),
        _review(
          'third',
          restaurantId: 'other-place',
          longitude: 1.4,
          restaurantCounty: 'Citrus County',
          restaurantState: 'FL',
        ),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, isNull);
      expect(result.totalDistinctRestaurantCount, 2);
      expect(result.bestSameCountyRestaurantCount, 2);
      expect(result.qualifyingReviewIds, ['second', 'third']);
    });

    test(
      'one review does not double count when cluster and county both qualify',
      () {
        final result = _calculate([
          for (var index = 0; index < 3; index += 1)
            _review(
              'r$index',
              restaurantId: 'restaurant-$index',
              longitude: index * 0.1,
              restaurantCounty: 'Citrus County',
              restaurantState: 'FL',
            ),
        ]).resultFor(LocalExperts.burger.id)!;

        expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
        expect(result.totalDistinctRestaurantCount, 3);
        expect(result.bestLocalClusterRestaurantCount, 3);
        expect(result.bestSameCountyRestaurantCount, 3);
        expect(result.qualifyingReviewIds, hasLength(3));
        expect(result.qualifyingRestaurantIds, hasLength(3));
      },
    );

    test(
      'five distinct restaurants overall earns Level 1 without coordinates',
      () {
        final result = _calculate(
          _reviews(5),
        ).resultFor(LocalExperts.burger.id)!;

        expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
        expect(result.bestLocalClusterRestaurantCount, 0);
        expect(result.bestSameCountyRestaurantCount, 0);
        expect(
          result.qualificationMethod,
          LocalExpertQualificationMethod.overall,
        );
      },
    );

    test('five restaurants in a valid 30-mile cluster earns Level 2', () {
      final result = _calculate([
        for (var index = 0; index < 5; index += 1)
          _review(
            'r$index',
            restaurantId: 'restaurant-$index',
            longitude: index * 0.08,
          ),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level2);
      expect(result.bestLocalClusterRestaurantCount, 5);
      expect(
        result.qualificationMethod,
        LocalExpertQualificationMethod.localCluster,
      );
    });

    test('ten distinct restaurants overall earns Level 2', () {
      final result = _calculate(
        _reviews(10),
      ).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level2);
      expect(result.totalDistinctRestaurantCount, 10);
      expect(
        result.qualificationMethod,
        LocalExpertQualificationMethod.overall,
      );
    });

    test('twenty-five distinct restaurants overall earns Level 3', () {
      final result = _calculate(
        _reviews(25),
      ).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level3);
      expect(result.totalDistinctRestaurantCount, 25);
    });

    test('highest qualified level is returned', () {
      final result = _calculate([
        for (var index = 0; index < 25; index += 1)
          _review(
            'r$index',
            restaurantId: 'restaurant-$index',
            longitude: index < 5 ? index * 0.08 : null,
          ),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level3);
      expect(result.bestLocalClusterRestaurantCount, 5);
    });

    test(
      'multiple reviews for same restaurant and expert type count only once',
      () {
        final result = _calculate([
          _review(
            'older',
            restaurantId: 'same-place',
            createdAt: DateTime(2026, 1, 1),
          ),
          _review(
            'newer',
            restaurantId: 'same-place',
            createdAt: DateTime(2026, 2, 1),
          ),
        ]).resultFor(LocalExperts.burger.id)!;

        expect(result.totalDistinctRestaurantCount, 1);
        expect(result.qualifyingReviewIds, ['newer']);
      },
    );

    test('same restaurant may count once for Burger and once for Pizza', () {
      final calculation = _calculate([
        _review('burger', restaurantId: 'same-place'),
        _review(
          'pizza',
          restaurantId: 'same-place',
          dishName: 'Pepperoni pizza',
          categoryName: 'Pizza',
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.burger.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.pizza.id)!
            .totalDistinctRestaurantCount,
        1,
      );
    });

    test('reviews below 10 combined words do not count', () {
      final result = _calculate([
        _review('short', body: 'too few words here'),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.totalDistinctRestaurantCount, 0);
      expect(result.earnedLevel, isNull);
    });

    test(
      'reviews without coordinates count overall but not toward local clusters',
      () {
        final result = _calculate(
          _reviews(5),
        ).resultFor(LocalExperts.burger.id)!;

        expect(result.totalDistinctRestaurantCount, 5);
        expect(result.bestLocalClusterRestaurantCount, 0);
        expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
      },
    );

    test('invalid or hidden reviews do not count', () {
      final result = _calculate([
        _review('hidden', isPublic: false),
        _review('visible', restaurantId: 'visible-place'),
      ]).resultFor(LocalExperts.burger.id)!;

      expect(result.totalDistinctRestaurantCount, 1);
      expect(result.qualifyingReviewIds, ['visible']);
    });

    test('Steak aliases map into one Steak expert calculation', () {
      final result = _calculate([
        _review('ribeye', restaurantId: 'a', dishName: 'Ribeye'),
        _review('filet', restaurantId: 'b', dishName: 'Filet mignon'),
        _review('porterhouse', restaurantId: 'c', dishName: 'Porterhouse'),
      ]).resultFor(LocalExperts.steak.id)!;

      expect(result.totalDistinctRestaurantCount, 3);
      expect(result.qualifyingRestaurantIds, ['a', 'b', 'c']);
    });

    test('Chinese grouped expertise works', () {
      final result = _calculate([
        for (var index = 0; index < 5; index += 1)
          _review(
            'chinese-$index',
            restaurantId: 'restaurant-$index',
            dishName: 'General Tso’s chicken',
            categoryName: 'Chinese',
          ),
      ]).resultFor(LocalExperts.chinese.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(result.totalDistinctRestaurantCount, 5);
    });

    test('Japanese Sushi grouped expertise works', () {
      final result = _calculate([
        for (var index = 0; index < 5; index += 1)
          _review(
            'sushi-$index',
            restaurantId: 'restaurant-$index',
            dishName: 'Salmon sushi roll',
            categoryName: 'Japanese / Sushi',
          ),
      ]).resultFor(LocalExperts.japaneseSushi.id)!;

      expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(result.totalDistinctRestaurantCount, 5);
    });

    test('Pizza beneath Italian counts toward Pizza but not Italian', () {
      final calculation = _calculate([
        _review(
          'pizza',
          dishName: 'Pepperoni pizza',
          categoryName: 'Italian',
          subcategory: 'Pizza',
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.pizza.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.italian.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('Non-pizza Italian and pasta dishes count toward Italian only', () {
      final calculation = _calculate([
        _review(
          'spaghetti',
          restaurantId: 'a',
          dishName: 'Spaghetti marinara',
          categoryName: 'Italian',
        ),
        _review(
          'ravioli',
          restaurantId: 'b',
          dishName: 'Ravioli',
          categoryName: 'Italian',
        ),
      ]);

      expect(LocalExperts.byId('pasta'), isNull);
      expect(
        calculation
            .resultFor(LocalExperts.italian.id)!
            .totalDistinctRestaurantCount,
        2,
      );
      expect(
        calculation
            .resultFor(LocalExperts.pizza.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('Taco and Burrito reviews recalculate into Mexican', () {
      final result = _calculate([
        _review(
          'taco',
          restaurantId: 'a',
          dishName: 'Street tacos',
          categoryName: 'Tacos',
        ),
        _review(
          'burrito',
          restaurantId: 'b',
          dishName: 'Smothered burrito',
          subcategory: 'Burrito',
        ),
      ]).resultFor(LocalExperts.mexican.id)!;

      expect(result.totalDistinctRestaurantCount, 2);
      expect(LocalExperts.byId('tacos'), isNull);
      expect(LocalExperts.byId('burrito'), isNull);
    });

    test('Lobster reviews recalculate into Seafood', () {
      final result = _calculate([
        _review(
          'lobster',
          restaurantId: 'a',
          dishName: 'Lobster roll',
          categoryName: 'Seafood',
          subcategory: 'Lobster',
        ),
      ]).resultFor(LocalExperts.seafood.id)!;

      expect(result.totalDistinctRestaurantCount, 1);
      expect(LocalExperts.byId('lobster'), isNull);
    });

    test('Sushi counts toward Japanese Sushi and not Seafood by default', () {
      final calculation = _calculate([
        _review(
          'sushi',
          dishName: 'Salmon sushi roll',
          categoryName: 'Japanese / Sushi',
          subcategory: 'Sushi roll',
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.japaneseSushi.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.seafood.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('Cuban Sandwich beneath Deli counts toward Cuban and Subs', () {
      final calculation = _calculate([
        _review(
          'cuban',
          dishName: 'Cuban sandwich',
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Cuban sandwich',
          categoryTags: const ['cuban_sandwich', 'cuban', 'deli', 'sandwich'],
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.cuban.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.subsSandwiches.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.chickenSandwich.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('Cuban Sandwich beneath Cuban counts toward Cuban and Subs', () {
      final calculation = _calculate([
        _review(
          'cuban',
          dishName: 'Cuban sandwich',
          categoryName: 'Cuban',
          subcategory: 'Cuban sandwich',
          categoryTags: const ['cuban_sandwich', 'cuban', 'deli', 'sandwich'],
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.cuban.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.subsSandwiches.id)!
            .totalDistinctRestaurantCount,
        1,
      );
    });

    test('multi-badge dishes still qualify through same-county grouping', () {
      final calculation = _calculate([
        for (var index = 0; index < 3; index += 1)
          _review(
            'cuban-$index',
            restaurantId: 'restaurant-$index',
            dishName: 'Cuban sandwich',
            categoryName: 'Deli / Sandwiches',
            subcategory: 'Cuban sandwich',
            categoryTags: const ['cuban_sandwich', 'cuban', 'deli', 'sandwich'],
            longitude: index * 0.7,
            restaurantCounty: 'Citrus County',
            restaurantState: 'FL',
          ),
      ]);
      final cuban = calculation.resultFor(LocalExperts.cuban.id)!;
      final subs = calculation.resultFor(LocalExperts.subsSandwiches.id)!;

      expect(cuban.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(cuban.bestLocalClusterRestaurantCount, 1);
      expect(cuban.bestSameCountyRestaurantCount, 3);
      expect(subs.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(subs.bestLocalClusterRestaurantCount, 1);
      expect(subs.bestSameCountyRestaurantCount, 3);
    });

    test('Section A and deli sub dishes count toward Subs', () {
      final result = _calculate([
        _review('section-a-sub', dishName: 'Sub', categoryName: 'Subs'),
        _review(
          'deli-sub',
          restaurantId: 'b',
          dishName: 'Italian sub',
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Italian sub',
        ),
        _review(
          'hoagie',
          restaurantId: 'c',
          dishName: 'Turkey hoagie',
          categoryName: null,
        ),
        _review(
          'grinder',
          restaurantId: 'd',
          dishName: 'Meatball grinder',
          categoryName: null,
        ),
      ]).resultFor(LocalExperts.subsSandwiches.id)!;

      expect(result.totalDistinctRestaurantCount, 4);
      expect(result.qualifyingReviewIds, hasLength(4));
      expect(
        result.qualifyingReviewIds,
        containsAll(['section-a-sub', 'deli-sub', 'hoagie', 'grinder']),
      );
    });

    test('Chili dishes count toward Chili', () {
      final result = _calculate([
        _review(
          'chili',
          dishName: 'Chili',
          categoryName: 'American',
          subcategory: 'Chili',
        ),
        _review(
          'con-carne',
          restaurantId: 'b',
          dishName: 'Chili con carne',
          categoryName: null,
        ),
        _review(
          'white-chicken',
          restaurantId: 'c',
          dishName: 'White chicken chili',
          categoryName: null,
        ),
        _review(
          'vegetarian',
          restaurantId: 'd',
          dishName: 'Vegetarian chili',
          categoryName: null,
        ),
      ]).resultFor(LocalExperts.chili.id)!;

      expect(result.totalDistinctRestaurantCount, 4);
      expect(
        result.qualifyingReviewIds,
        containsAll(['chili', 'con-carne', 'white-chicken', 'vegetarian']),
      );
    });

    test('Chili dog can count toward Chili and Hot Dogs', () {
      final calculation = _calculate([
        _review('chili-dog', dishName: 'Chili cheese dog', categoryName: null),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.chili.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.hotDogsCornDogs.id)!
            .totalDistinctRestaurantCount,
        1,
      );
    });

    test('Chili exclusions avoid sauce oil and unrelated dishes', () {
      final calculation = _calculate([
        _review('sauce', dishName: 'Chili sauce', categoryName: null),
        _review(
          'oil',
          restaurantId: 'oil',
          dishName: 'Chili oil',
          categoryName: null,
        ),
        _review(
          'chicken',
          restaurantId: 'chicken',
          dishName: 'Chili chicken',
          categoryName: null,
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.chili.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('Chicken Pie and Chicken Pot Pie share one badge', () {
      final result = _calculate([
        _review(
          'pie',
          restaurantId: 'a',
          dishName: 'Chicken Pie',
          categoryName: 'American',
          subcategory: 'Chicken Pie / Chicken Pot Pie',
        ),
        _review(
          'pot-pie',
          restaurantId: 'b',
          dishName: 'Chicken Pot Pie',
          categoryName: 'American',
          categoryTags: const ['chicken_pie', 'chicken pot pie'],
        ),
      ]).resultFor(LocalExperts.chickenPie.id)!;

      expect(result.totalDistinctRestaurantCount, 2);
    });

    test('Fried chicken sandwich can count toward two badges', () {
      final calculation = _calculate([
        _review(
          'sandwich',
          dishName: 'Fried chicken sandwich',
          subcategory: 'Chicken sandwich',
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.chickenSandwich.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.friedChicken.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.subsSandwiches.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('specific excluded sandwiches do not count toward Subs', () {
      final calculation = _calculate([
        _review(
          'bbq',
          restaurantId: 'bbq',
          dishName: 'BBQ pulled pork sandwich',
          categoryName: 'BBQ',
          subcategory: 'BBQ sandwich',
        ),
        _review(
          'chicken',
          restaurantId: 'chicken',
          dishName: 'Grilled chicken sandwich',
          categoryName: 'Chicken',
          subcategory: 'Chicken sandwich',
        ),
        _review(
          'burger',
          restaurantId: 'burger',
          dishName: 'Cheeseburger',
          categoryName: 'Burgers',
        ),
        _review(
          'hot-dog',
          restaurantId: 'hot-dog',
          dishName: 'Hot dog',
          categoryName: null,
          subcategory: 'Hot dogs',
        ),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.bbq.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.chickenSandwich.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.burger.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.hotDogsCornDogs.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.subsSandwiches.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('Wings do not automatically count toward Fried Chicken', () {
      final calculation = _calculate([
        _review('wings', dishName: 'Buffalo wings', subcategory: 'Wings'),
      ]);

      expect(
        calculation
            .resultFor(LocalExperts.wings.id)!
            .totalDistinctRestaurantCount,
        1,
      );
      expect(
        calculation
            .resultFor(LocalExperts.friedChicken.id)!
            .totalDistinctRestaurantCount,
        0,
      );
    });

    test('one review cannot advance the same badge twice', () {
      final result = _calculate([
        _review(
          'double-mexican',
          dishName: 'Burrito tacos',
          categoryName: 'Mexican',
          subcategory: 'Tacos',
        ),
      ]).resultFor(LocalExperts.mexican.id)!;

      expect(result.totalDistinctRestaurantCount, 1);
      expect(result.qualifyingReviewIds, ['double-mexican']);
    });

    test('one review cannot advance Subs twice', () {
      final result = _calculate([
        _review(
          'double-sub',
          dishName: 'Italian sub',
          categoryName: 'Deli / Sandwiches',
          subcategory: 'Subs',
          categoryTags: const ['subs', 'sub', 'hoagie', 'deli_sandwiches'],
        ),
      ]).resultFor(LocalExperts.subsSandwiches.id)!;

      expect(result.totalDistinctRestaurantCount, 1);
      expect(result.qualifyingReviewIds, ['double-sub']);
    });

    test('one review cannot advance Chili twice', () {
      final result = _calculate([
        _review(
          'double-chili',
          dishName: 'Chili con carne',
          categoryName: 'American',
          subcategory: 'Chili',
          categoryTags: const ['chili', 'chilli', 'bowl of chili'],
        ),
      ]).resultFor(LocalExperts.chili.id)!;

      expect(result.totalDistinctRestaurantCount, 1);
      expect(result.qualifyingReviewIds, ['double-chili']);
    });

    test('calculation is deterministic regardless of input review order', () {
      final reviews = [
        for (var index = 0; index < 5; index += 1)
          _review('review-$index', restaurantId: 'restaurant-$index'),
      ];
      final first = _calculate(reviews).resultFor(LocalExperts.burger.id)!;
      final second = _calculate(
        reviews.reversed,
      ).resultFor(LocalExperts.burger.id)!;

      expect(second.earnedLevel, first.earnedLevel);
      expect(second.qualifyingReviewIds, first.qualifyingReviewIds);
      expect(second.qualifyingRestaurantIds, first.qualifyingRestaurantIds);
    });

    test('recalculation can downgrade or remove a badge', () {
      final level2 = _calculate(
        _reviews(10),
      ).resultFor(LocalExperts.burger.id)!;
      final level1 = _calculate(_reviews(5)).resultFor(LocalExperts.burger.id)!;
      final removedCalculation = _calculate(_reviews(2));
      final removed = removedCalculation.resultFor(LocalExperts.burger.id)!;

      expect(level2.earnedLevel, LocalExpertBadgeLevel.level2);
      expect(level1.earnedLevel, LocalExpertBadgeLevel.level1);
      expect(removed.earnedLevel, isNull);
      expect(
        removedCalculation.badgeTypeIdsToRemove([LocalExperts.burger.id]),
        [LocalExperts.burger.id],
      );
      expect(
        removedCalculation.badgeTypeIdsToRemove([
          LocalExperts.burger.id,
          'burrito',
          'tacos',
          'lobster',
          'pasta',
        ]),
        [LocalExperts.burger.id],
      );
    });

    test('earned badge result has persistence schema fields', () {
      final result = _calculate(_reviews(5)).resultFor(LocalExperts.burger.id)!;
      final data = result.toFirestoreMap(earnedAt: DateTime(2026, 1, 1));

      expect(
        LocalExpertBadgePaths.badgeDocumentPath(
          userId: 'user-1',
          expertTypeId: LocalExperts.burger.id,
        ),
        'user_profiles/user-1/local_expert_badges/burger',
      );
      expect(data['expertTypeId'], LocalExperts.burger.id);
      expect(data['displayName'], 'Burger');
      expect(data['level'], LocalExpertBadgeLevel.level1.name);
      expect(data['totalRestaurantCount'], 5);
      expect(data['qualificationMethod'], 'overall');
    });

    test('badge thresholds are unchanged', () {
      expect(LocalExpertBadgeThresholds.clusterRadiusMiles, 30);
      expect(
        LocalExpertBadgeThresholds.forLevel(
          LocalExpertBadgeLevel.level1,
        ).distinctRestaurantsOverall,
        5,
      );
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
          LocalExpertBadgeLevel.level2,
        ).distinctRestaurantsInCluster,
        5,
      );
      expect(
        LocalExpertBadgeThresholds.forLevel(
          LocalExpertBadgeLevel.level3,
        ).distinctRestaurantsOverall,
        25,
      );
      expect(
        LocalExpertBadgeThresholds.forLevel(
          LocalExpertBadgeLevel.level3,
        ).distinctRestaurantsInCluster,
        isNull,
      );
    });
  });
}

LocalExpertBadgeCalculation _calculate(
  Iterable<LocalExpertReviewCandidate> reviews,
) {
  return LocalExpertBadgeCalculator.calculateForUser(
    userId: 'user-1',
    reviews: reviews,
    calculatedAt: DateTime(2026, 6, 12, 12),
  );
}

List<LocalExpertReviewCandidate> _reviews(int count) {
  return [
    for (var index = 0; index < count; index += 1)
      _review('review-$index', restaurantId: 'restaurant-$index'),
  ];
}

LocalExpertReviewCandidate _review(
  String reviewId, {
  String userId = 'user-1',
  String restaurantId = 'restaurant-1',
  String dishName = 'Cheeseburger',
  String? categoryName = 'Burgers',
  String? subcategory,
  List<String> categoryTags = const [],
  String body = 'This review has enough useful written detail to qualify today',
  DateTime? createdAt,
  double? latitude,
  double? longitude,
  String? restaurantCounty,
  String? restaurantState,
  bool isPublic = true,
}) {
  return LocalExpertReviewCandidate(
    reviewId: reviewId,
    userId: userId,
    restaurantId: restaurantId,
    dishName: dishName,
    categoryName: categoryName,
    subcategory: subcategory,
    categoryTags: categoryTags,
    headline: 'Solid pick',
    body: body,
    createdAt: createdAt ?? DateTime(2026, 1, 1),
    restaurantLatitude: latitude ?? (longitude == null ? null : 28.0),
    restaurantLongitude: longitude,
    restaurantCounty: restaurantCounty,
    restaurantState: restaurantState,
    isPublic: isPublic,
  );
}
