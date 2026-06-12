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
}) {
  return BitescoreDish(
    id: id,
    restaurantId: restaurantId,
    restaurantName: 'Restaurant',
    name: name,
    normalizedName: name.toLowerCase(),
    category: category,
    subcategory: subcategory,
    categoryTags: [
      name.toLowerCase(),
      if (category != null) category.toLowerCase(),
    ],
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
