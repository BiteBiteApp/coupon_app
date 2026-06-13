import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteScore duplicate dish protection', () {
    test(
      'home entries do not render duplicate cards with the same dish id',
      () {
        final entries = BiteScoreService.deduplicateHomeEntriesForDisplay([
          _entry(dishId: 'dish-1', score: 92),
          _entry(dishId: 'dish-1', score: 92),
        ]);

        expect(entries, hasLength(1));
        expect(entries.single.dish.id, 'dish-1');
      },
    );

    test(
      'home entries do not render duplicate same-restaurant normalized names',
      () {
        final entries = BiteScoreService.deduplicateHomeEntriesForDisplay([
          _entry(dishId: 'dish-1', dishName: 'Supreme Pizza'),
          _entry(
            dishId: 'dish-2',
            dishName: '  SUPREME   PIZZA  ',
            normalizedName: '  supreme   pizza ',
          ),
        ]);

        expect(entries, hasLength(1));
        expect(entries.single.dish.id, 'dish-1');
      },
    );

    test('two restaurants can each show a dish with the same name', () {
      final entries = BiteScoreService.deduplicateHomeEntriesForDisplay([
        _entry(
          dishId: 'dish-1',
          restaurantId: 'restaurant-1',
          dishName: 'Supreme Pizza',
        ),
        _entry(
          dishId: 'dish-2',
          restaurantId: 'restaurant-2',
          dishName: 'Supreme Pizza',
        ),
      ]);

      expect(entries.map((entry) => entry.dish.id), ['dish-1', 'dish-2']);
    });

    test('legitimate different dishes at one restaurant are not merged', () {
      final entries = BiteScoreService.deduplicateHomeEntriesForDisplay([
        _entry(dishId: 'dish-1', dishName: 'Supreme Pizza'),
        _entry(dishId: 'dish-2', dishName: 'Margherita Pizza'),
      ]);

      expect(entries.map((entry) => entry.dish.name), [
        'Supreme Pizza',
        'Margherita Pizza',
      ]);
    });

    test('dish identity key is conservative and restaurant-scoped', () {
      expect(
        BiteScoreService.dishIdentityKey(
          restaurantId: 'restaurant-1',
          dishName: ' Supreme   Pizza ',
        ),
        BiteScoreService.dishIdentityKey(
          restaurantId: 'restaurant-1',
          dishName: 'supreme pizza',
        ),
      );
      expect(
        BiteScoreService.dishIdentityKey(
          restaurantId: 'restaurant-1',
          dishName: 'supreme pizza',
        ),
        isNot(
          BiteScoreService.dishIdentityKey(
            restaurantId: 'restaurant-2',
            dishName: 'supreme pizza',
          ),
        ),
      );
    });

    test(
      'search, category filter, and sort still work after de-duplication',
      () {
        final entries = BiteScoreService.deduplicateHomeEntriesForDisplay([
          _entry(
            dishId: 'dish-1',
            dishName: 'Supreme Pizza',
            categoryTags: const ['pizza', 'italian'],
            score: 88,
          ),
          _entry(
            dishId: 'dish-2',
            dishName: 'supreme pizza',
            normalizedName: 'supreme pizza',
            categoryTags: const ['pizza', 'italian'],
            score: 88,
          ),
          _entry(
            dishId: 'dish-3',
            dishName: 'Birria Taco',
            categoryTags: const ['taco', 'mexican'],
            score: 94,
          ),
        ]);

        final searchResults = entries
            .where((entry) => entry.dish.name.toLowerCase().contains('pizza'))
            .toList();
        final categoryResults = entries
            .where((entry) => entry.dish.categoryTags.contains('pizza'))
            .toList();
        final sorted = List<BiteScoreHomeEntry>.from(entries)
          ..sort(
            (a, b) => b.aggregate.overallBiteScore.compareTo(
              a.aggregate.overallBiteScore,
            ),
          );

        expect(entries.map((entry) => entry.dish.id), ['dish-1', 'dish-3']);
        expect(searchResults.map((entry) => entry.dish.id), ['dish-1']);
        expect(categoryResults.map((entry) => entry.dish.id), ['dish-1']);
        expect(sorted.first.dish.id, 'dish-3');
      },
    );
  });

  group('BiteScore duplicate review protection', () {
    test('same user cannot be counted twice for the same dish', () {
      final reviews = BiteScoreService.deduplicateReviewsForAggregate([
        _review(
          id: 'old-review',
          userId: 'user-1',
          overallBiteScore: 60,
          updatedAt: DateTime(2026, 6, 11),
        ),
        _review(
          id: 'new-review',
          userId: 'user-1',
          overallBiteScore: 90,
          updatedAt: DateTime(2026, 6, 12),
        ),
      ]);

      expect(reviews, hasLength(1));
      expect(reviews.single.id, 'new-review');
      expect(reviews.single.overallBiteScore, 90);
    });

    test('different users reviewing the same dish still count separately', () {
      final reviews = BiteScoreService.deduplicateReviewsForAggregate([
        _review(id: 'review-1', userId: 'user-1'),
        _review(id: 'review-2', userId: 'user-2'),
      ]);

      expect(reviews.map((review) => review.id), ['review-1', 'review-2']);
    });

    test('duplicate review docs do not double-count score or review count', () {
      final reviews = BiteScoreService.deduplicateReviewsForAggregate([
        _review(
          id: 'old-review',
          userId: 'user-1',
          overallBiteScore: 50,
          updatedAt: DateTime(2026, 6, 11),
        ),
        _review(
          id: 'new-review',
          userId: 'user-1',
          overallBiteScore: 90,
          updatedAt: DateTime(2026, 6, 12),
        ),
        _review(
          id: 'other-user-review',
          userId: 'user-2',
          overallBiteScore: 70,
        ),
      ]);

      final average =
          reviews.fold<double>(
            0,
            (total, review) => total + review.overallBiteScore,
          ) /
          reviews.length;

      expect(reviews, hasLength(2));
      expect(average, 80);
    });
  });
}

BiteScoreHomeEntry _entry({
  required String dishId,
  String restaurantId = 'restaurant-1',
  String dishName = 'Supreme Pizza',
  String? normalizedName,
  List<String> categoryTags = const ['pizza'],
  double score = 90,
}) {
  final restaurant = BitescoreRestaurant(
    id: restaurantId,
    name: restaurantId == 'restaurant-1'
        ? 'Bills Wild Buffalos'
        : 'Other Restaurant',
    normalizedName: restaurantId == 'restaurant-1'
        ? 'bills wild buffalos'
        : 'other restaurant',
    address: '1 Main St',
    city: 'Lecanto',
    state: 'FL',
    zipCode: '34461',
    location: const GeoPoint(0, 0),
  );
  return BiteScoreHomeEntry(
    dish: BitescoreDish(
      id: dishId,
      restaurantId: restaurantId,
      restaurantName: restaurant.name,
      name: dishName.trim(),
      normalizedName:
          normalizedName ??
          BiteScoreService.normalizedDishIdentityText(dishName),
      category: categoryTags.isEmpty ? null : categoryTags.first,
      categoryTags: categoryTags,
    ),
    restaurant: restaurant,
    aggregate: DishRatingAggregate(
      dishId: dishId,
      restaurantId: restaurantId,
      overallBiteScore: score,
      ratingCount: 1,
    ),
  );
}

DishReview _review({
  required String id,
  String dishId = 'dish-1',
  String restaurantId = 'restaurant-1',
  required String userId,
  double overallBiteScore = 80,
  DateTime? updatedAt,
}) {
  return DishReview(
    id: id,
    dishId: dishId,
    restaurantId: restaurantId,
    userId: userId,
    headline: 'Good',
    notes: 'Worth ordering again.',
    overallImpression: overallBiteScore / 10,
    tastinessScore: overallBiteScore / 10,
    qualityScore: overallBiteScore / 10,
    valueScore: overallBiteScore / 10,
    overallBiteScore: overallBiteScore,
    createdAt: updatedAt,
    updatedAt: updatedAt,
  );
}
