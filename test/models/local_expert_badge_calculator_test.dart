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

    test(
      'five distinct restaurants overall earns Level 1 without coordinates',
      () {
        final result = _calculate(
          _reviews(5),
        ).resultFor(LocalExperts.burger.id)!;

        expect(result.earnedLevel, LocalExpertBadgeLevel.level1);
        expect(result.bestLocalClusterRestaurantCount, 0);
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
  String body = 'This review has enough useful written detail to qualify today',
  DateTime? createdAt,
  double? latitude,
  double? longitude,
  bool isPublic = true,
}) {
  return LocalExpertReviewCandidate(
    reviewId: reviewId,
    userId: userId,
    restaurantId: restaurantId,
    dishName: dishName,
    categoryName: categoryName,
    subcategory: subcategory,
    headline: 'Solid pick',
    body: body,
    createdAt: createdAt ?? DateTime(2026, 1, 1),
    restaurantLatitude: latitude ?? (longitude == null ? null : 28.0),
    restaurantLongitude: longitude,
    isPublic: isPublic,
  );
}
