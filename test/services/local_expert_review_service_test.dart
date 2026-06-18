import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/services/local_expert_review_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertReviewQualification', () {
    test(
      'only selected reviewer and expert type are returned by helper filter',
      () {
        final entries = _filterEntries(
          [
            _fixture('target-burger', userId: 'target', dishName: 'Burger'),
            _fixture(
              'target-pizza',
              userId: 'target',
              dishName: 'Pizza',
              category: 'Pizza',
            ),
            _fixture('other-burger', userId: 'other', dishName: 'Burger'),
          ],
          reviewerUserId: 'target',
          expertTypeId: 'burger',
        );

        expect(entries.map((entry) => entry.review.id), ['target-burger']);
      },
    );

    test('badge earning still uses 10 combined words', () {
      expect(
        LocalExperts.hasMinimumWrittenReview(
          headline: 'Great crispy burger',
          body: 'juicy patty sauce toasted bun excellent value',
        ),
        isTrue,
      );
      expect(
        LocalExperts.hasMinimumWrittenReview(
          headline: 'Great crispy burger',
          body: 'juicy patty sauce toasted bun excellent',
        ),
        isFalse,
      );
    });

    test('public expert reviews do not require 10 written words', () {
      final tenWords = _fixture(
        'ten',
        headline: 'Great crispy burger',
        notes: 'juicy patty sauce toasted bun excellent value',
      );
      final nineWords = _fixture(
        'nine',
        headline: 'Great crispy burger',
        notes: 'juicy patty sauce toasted bun excellent',
      );
      final zeroWords = _fixture('zero', headline: '', notes: '');

      expect(_qualifies(tenWords, 'burger'), isTrue);
      expect(_qualifies(nineWords, 'burger'), isTrue);
      expect(_qualifies(zeroWords, 'burger'), isTrue);
    });

    test('short Burger reviews appear on Burger expert page', () {
      final entries = _filterEntries(
        [
          _fixture('zero', headline: '', notes: ''),
          _fixture('short', headline: 'Good burger', notes: ''),
        ],
        reviewerUserId: 'target',
        expertTypeId: 'burger',
      );

      expect(entries.map((entry) => entry.review.id), ['zero', 'short']);
    });

    test('Burger aliases map correctly', () {
      for (final dishName in [
        'Classic hamburger',
        'Double cheeseburger',
        'Bacon burger',
      ]) {
        expect(
          _qualifies(_fixture(dishName, dishName: dishName), 'burger'),
          isTrue,
        );
      }
    });

    test('grouped Steak dishes appear under Steak', () {
      for (final dishName in ['Ribeye', 'Filet mignon', 'Porterhouse']) {
        expect(
          _qualifies(
            _fixture(dishName, dishName: dishName, category: 'Steakhouse'),
            'steak',
          ),
          isTrue,
        );
      }
    });

    test('Chinese top-level mappings work', () {
      expect(
        _qualifies(
          _fixture('chinese', dishName: 'House special', category: 'Chinese'),
          'chinese',
        ),
        isTrue,
      );
    });

    test('Japanese/Sushi mappings work', () {
      expect(
        _qualifies(
          _fixture(
            'sushi',
            dishName: 'Salmon sashimi',
            category: 'Japanese / Sushi',
          ),
          'japanese_sushi',
        ),
        isTrue,
      );
    });

    test('Mexican replaces Taco and Burrito review matching', () {
      expect(
        _qualifies(
          _fixture('taco', dishName: 'Street tacos', category: 'Tacos'),
          'mexican',
        ),
        isTrue,
      );
      expect(
        _qualifies(
          _fixture(
            'burrito',
            dishName: 'Smothered burrito',
            category: 'Mexican',
            subcategory: 'Burrito',
          ),
          'mexican',
        ),
        isTrue,
      );
      expect(
        _qualifies(_fixture('taco', dishName: 'Street tacos'), 'tacos'),
        isFalse,
      );
    });

    test('Cuban sandwich beneath Deli appears for Cuban and Subs', () {
      final fixture = _fixture(
        'cuban',
        dishName: 'Cuban sandwich',
        category: 'Deli / Sandwiches',
        subcategory: 'Cuban sandwich',
        categoryTags: const ['cuban_sandwich', 'cuban', 'deli', 'sandwich'],
      );

      expect(_qualifies(fixture, 'cuban'), isTrue);
      expect(_qualifies(fixture, 'subs_sandwiches'), isTrue);
      expect(_qualifies(fixture, 'chicken_sandwich'), isFalse);
    });

    test('Cuban sandwich beneath Cuban appears for Cuban and Subs', () {
      final fixture = _fixture(
        'cuban',
        dishName: 'Cuban sandwich',
        category: 'Cuban',
        subcategory: 'Cuban sandwich',
        categoryTags: const ['cuban_sandwich', 'cuban', 'deli', 'sandwich'],
      );

      expect(_qualifies(fixture, 'cuban'), isTrue);
      expect(_qualifies(fixture, 'subs_sandwiches'), isTrue);
    });

    test('Subs appear for structured Deli sandwiches', () {
      final fixture = _fixture(
        'hoagie',
        dishName: 'Turkey hoagie',
        category: 'Deli / Sandwiches',
        subcategory: 'Subs',
      );

      expect(_qualifies(fixture, 'subs_sandwiches'), isTrue);
    });

    test('Chili appears for structured and clear chili dishes', () {
      final structured = _fixture(
        'chili',
        dishName: 'Chili',
        category: 'American',
        subcategory: 'Chili',
      );
      final whiteChicken = _fixture(
        'white-chicken-chili',
        dishName: 'White chicken chili',
        category: null,
      );

      expect(_qualifies(structured, 'chili'), isTrue);
      expect(_qualifies(whiteChicken, 'chili'), isTrue);
    });

    test('Chili dog appears for Chili and Hot Dogs', () {
      final fixture = _fixture(
        'chili-dog',
        dishName: 'Chili dog',
        category: null,
      );

      expect(_qualifies(fixture, 'chili'), isTrue);
      expect(_qualifies(fixture, 'hot_dogs_corn_dogs'), isTrue);
    });

    test('Chili sauce oil and unrelated chicken do not appear for Chili', () {
      expect(
        _qualifies(
          _fixture('chili-sauce', dishName: 'Chili sauce', category: null),
          'chili',
        ),
        isFalse,
      );
      expect(
        _qualifies(
          _fixture('chili-oil', dishName: 'Chili oil', category: null),
          'chili',
        ),
        isFalse,
      );
      expect(
        _qualifies(
          _fixture('chili-chicken', dishName: 'Chili chicken', category: null),
          'chili',
        ),
        isFalse,
      );
    });

    test('Fried chicken sandwich appears for both applicable badges', () {
      final fixture = _fixture(
        'fried-chicken-sandwich',
        dishName: 'Fried chicken sandwich',
        category: 'Chicken',
        subcategory: 'Chicken sandwich',
      );

      expect(_qualifies(fixture, 'fried_chicken'), isTrue);
      expect(_qualifies(fixture, 'chicken_sandwich'), isTrue);
      expect(_qualifies(fixture, 'subs_sandwiches'), isFalse);
    });

    test('BBQ and chicken sandwiches do not appear for Subs', () {
      final bbq = _fixture(
        'bbq-sandwich',
        dishName: 'BBQ pulled pork sandwich',
        category: 'BBQ',
        subcategory: 'BBQ sandwich',
      );
      final chicken = _fixture(
        'chicken-sandwich',
        dishName: 'Grilled chicken sandwich',
        category: 'Chicken',
        subcategory: 'Chicken sandwich',
      );

      expect(_qualifies(bbq, 'bbq'), isTrue);
      expect(_qualifies(bbq, 'subs_sandwiches'), isFalse);
      expect(_qualifies(chicken, 'chicken_sandwich'), isTrue);
      expect(_qualifies(chicken, 'subs_sandwiches'), isFalse);
    });

    test('hidden deleted and rejected reviews are excluded', () {
      expect(
        _qualifies(
          _fixture('hidden', rawReviewData: {'hidden': true}),
          'burger',
        ),
        isFalse,
      );
      expect(
        _qualifies(
          _fixture('deleted', rawReviewData: {'isDeleted': true}),
          'burger',
        ),
        isFalse,
      );
      expect(
        _qualifies(
          _fixture('rejected', rawReviewData: {'status': 'rejected'}),
          'burger',
        ),
        isFalse,
      );
    });

    test(
      'multiple qualifying reviews from the same restaurant may all display',
      () {
        final entries = _filterEntries(
          [
            _fixture('first', restaurantId: 'same-place'),
            _fixture('second', restaurantId: 'same-place'),
          ],
          reviewerUserId: 'target',
          expertTypeId: 'burger',
        );

        expect(entries.map((entry) => entry.review.id), ['first', 'second']);
      },
    );

    test('matching review outside a badge local cluster may display', () {
      final entry = _fixture(
        'far',
        restaurant: _restaurant(
          id: 'far-place',
          location: const GeoPoint(40, -120),
        ),
      );

      expect(_qualifies(entry, 'burger'), isTrue);
    });

    test('malformed records are skipped safely', () {
      expect(
        LocalExpertReviewQualification.qualifies(
          review: _review('missing-dish'),
          dish: null,
          restaurant: _restaurant(),
          expertTypeId: 'burger',
        ),
        isFalse,
      );
      expect(
        LocalExpertReviewQualification.qualifies(
          review: _review('missing-restaurant'),
          dish: _dish(),
          restaurant: null,
          expertTypeId: 'burger',
        ),
        isFalse,
      );
    });
  });
}

List<LocalExpertReviewEntry> _filterEntries(
  List<_ReviewFixture> fixtures, {
  required String reviewerUserId,
  required String expertTypeId,
}) {
  return fixtures
      .where(
        (fixture) =>
            fixture.review.userId == reviewerUserId &&
            LocalExpertReviewQualification.qualifies(
              review: fixture.review,
              dish: fixture.dish,
              restaurant: fixture.restaurant,
              expertTypeId: expertTypeId,
              rawReviewData: fixture.rawReviewData,
            ),
      )
      .map(
        (fixture) => LocalExpertReviewEntry(
          review: fixture.review,
          dish: fixture.dish,
          restaurant: fixture.restaurant,
        ),
      )
      .toList(growable: false);
}

bool _qualifies(_ReviewFixture fixture, String expertTypeId) {
  return LocalExpertReviewQualification.qualifies(
    review: fixture.review,
    dish: fixture.dish,
    restaurant: fixture.restaurant,
    expertTypeId: expertTypeId,
    rawReviewData: fixture.rawReviewData,
  );
}

_ReviewFixture _fixture(
  String id, {
  String userId = 'target',
  String restaurantId = 'restaurant-1',
  String dishName = 'Burger',
  String? category = 'Burgers',
  String? subcategory,
  List<String> categoryTags = const [],
  String headline = 'Great crispy burger',
  String notes = 'juicy patty sauce toasted bun excellent value',
  BitescoreRestaurant? restaurant,
  Map<String, dynamic>? rawReviewData,
}) {
  final resolvedRestaurant = restaurant ?? _restaurant(id: restaurantId);
  return _ReviewFixture(
    review: _review(
      id,
      userId: userId,
      restaurantId: resolvedRestaurant.id,
      headline: headline,
      notes: notes,
    ),
    dish: _dish(
      id: 'dish-$id',
      restaurantId: resolvedRestaurant.id,
      name: dishName,
      category: category,
      subcategory: subcategory,
      categoryTags: categoryTags,
    ),
    restaurant: resolvedRestaurant,
    rawReviewData: rawReviewData,
  );
}

DishReview _review(
  String id, {
  String userId = 'target',
  String restaurantId = 'restaurant-1',
  String headline = 'Great crispy burger',
  String notes = 'juicy patty sauce toasted bun excellent value',
}) {
  return DishReview(
    id: id,
    dishId: 'dish-$id',
    restaurantId: restaurantId,
    userId: userId,
    headline: headline,
    notes: notes,
    overallImpression: 8,
    overallBiteScore: 84,
    createdAt: DateTime(2026, 1, 1),
  );
}

BitescoreDish _dish({
  String id = 'dish-1',
  String restaurantId = 'restaurant-1',
  String name = 'Burger',
  String? category = 'Burgers',
  String? subcategory,
  List<String> categoryTags = const [],
}) {
  return BitescoreDish(
    id: id,
    restaurantId: restaurantId,
    restaurantName: 'Restaurant',
    name: name,
    normalizedName: name.toLowerCase(),
    category: category,
    subcategory: subcategory,
    categoryTags: categoryTags.isEmpty
        ? [name.toLowerCase(), if (category != null) category.toLowerCase()]
        : categoryTags,
  );
}

BitescoreRestaurant _restaurant({
  String id = 'restaurant-1',
  GeoPoint location = const GeoPoint(0, 0),
}) {
  return BitescoreRestaurant(
    id: id,
    name: 'Restaurant',
    normalizedName: 'restaurant',
    address: '1 Main St',
    city: 'Town',
    state: 'FL',
    zipCode: '12345',
    location: location,
  );
}

class _ReviewFixture {
  final DishReview review;
  final BitescoreDish dish;
  final BitescoreRestaurant restaurant;
  final Map<String, dynamic>? rawReviewData;

  const _ReviewFixture({
    required this.review,
    required this.dish,
    required this.restaurant,
    this.rawReviewData,
  });
}
