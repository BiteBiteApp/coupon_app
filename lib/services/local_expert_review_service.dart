import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/dish_review.dart';
import '../models/local_expert.dart';
import 'bitescore_service.dart';

class LocalExpertReviewEntry {
  final DishReview review;
  final BitescoreDish dish;
  final BitescoreRestaurant restaurant;

  const LocalExpertReviewEntry({
    required this.review,
    required this.dish,
    required this.restaurant,
  });

  String get dishName => dish.name;
  String get restaurantName => restaurant.name;
}

class LocalExpertReviewQualification {
  static bool isPublicMatchingExpertReview({
    required DishReview review,
    required BitescoreDish? dish,
    required BitescoreRestaurant? restaurant,
    required String expertTypeId,
    Map<String, dynamic>? rawReviewData,
  }) {
    final trimmedExpertTypeId = expertTypeId.trim();
    if (trimmedExpertTypeId.isEmpty || dish == null || restaurant == null) {
      return false;
    }

    if (!_isPublicReview(rawReviewData) || !dish.isActive || dish.isMerged) {
      return false;
    }
    if (!restaurant.isActive) {
      return false;
    }

    final matchedExpertType = LocalExperts.matchDish(
      dishName: dish.name,
      categoryName: dish.category,
      subcategory: dish.subcategory,
      categoryTags: dish.categoryTags,
    );
    return matchedExpertType?.id == trimmedExpertTypeId;
  }

  static bool qualifies({
    required DishReview review,
    required BitescoreDish? dish,
    required BitescoreRestaurant? restaurant,
    required String expertTypeId,
    Map<String, dynamic>? rawReviewData,
  }) {
    return isPublicMatchingExpertReview(
      review: review,
      dish: dish,
      restaurant: restaurant,
      expertTypeId: expertTypeId,
      rawReviewData: rawReviewData,
    );
  }

  static bool _isPublicReview(Map<String, dynamic>? data) {
    if (data == null) {
      return true;
    }

    if (data['isPublic'] == false ||
        data['isDeleted'] == true ||
        data['hidden'] == true ||
        data['isHidden'] == true) {
      return false;
    }

    final status = _readString(data['status'])?.toLowerCase();
    return status != 'deleted' && status != 'hidden' && status != 'rejected';
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }
}

class LocalExpertReviewService {
  static Future<List<LocalExpertReviewEntry>> loadExpertReviews({
    required String reviewerUserId,
    required String expertTypeId,
  }) {
    return _loadReviews(
      reviewerUserId: reviewerUserId,
      expertTypeId: expertTypeId,
    );
  }

  static Future<List<LocalExpertReviewEntry>> loadQualifyingReviews({
    required String reviewerUserId,
    required String expertTypeId,
  }) {
    return _loadReviews(
      reviewerUserId: reviewerUserId,
      expertTypeId: expertTypeId,
    );
  }

  static Future<List<LocalExpertReviewEntry>> _loadReviews({
    required String reviewerUserId,
    required String expertTypeId,
  }) async {
    final trimmedReviewerUserId = reviewerUserId.trim();
    final trimmedExpertTypeId = expertTypeId.trim();
    if (trimmedReviewerUserId.isEmpty || trimmedExpertTypeId.isEmpty) {
      return const <LocalExpertReviewEntry>[];
    }

    final reviewSnapshot = await BiteScoreService.reviewsCollection()
        .where('userId', isEqualTo: trimmedReviewerUserId)
        .get();

    final dishCache = <String, BitescoreDish?>{};
    final restaurantCache = <String, BitescoreRestaurant?>{};
    final entries = <LocalExpertReviewEntry>[];

    for (final doc in reviewSnapshot.docs) {
      final rawData = doc.data();
      final review = DishReview.tryFromFirestore(rawData, fallbackId: doc.id);
      if (review == null) {
        continue;
      }

      final dish = await _cachedDish(dishCache, review.dishId);
      final restaurant = await _cachedRestaurant(
        restaurantCache,
        review.restaurantId,
      );
      if (!LocalExpertReviewQualification.isPublicMatchingExpertReview(
        review: review,
        dish: dish,
        restaurant: restaurant,
        expertTypeId: trimmedExpertTypeId,
        rawReviewData: rawData,
      )) {
        continue;
      }

      entries.add(
        LocalExpertReviewEntry(
          review: review,
          dish: dish!,
          restaurant: restaurant!,
        ),
      );
    }

    entries.sort((a, b) {
      final aDate =
          a.review.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bDate =
          b.review.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final byDate = bDate.compareTo(aDate);
      if (byDate != 0) {
        return byDate;
      }
      return a.review.id.compareTo(b.review.id);
    });
    return entries;
  }

  static Future<BitescoreDish?> _cachedDish(
    Map<String, BitescoreDish?> cache,
    String dishId,
  ) {
    final trimmedDishId = dishId.trim();
    if (trimmedDishId.isEmpty) {
      return Future.value(null);
    }
    final cached = cache[trimmedDishId];
    if (cache.containsKey(trimmedDishId)) {
      return Future.value(cached);
    }
    return BiteScoreService.loadDishById(trimmedDishId).then((dish) {
      cache[trimmedDishId] = dish;
      return dish;
    });
  }

  static Future<BitescoreRestaurant?> _cachedRestaurant(
    Map<String, BitescoreRestaurant?> cache,
    String restaurantId,
  ) {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty) {
      return Future.value(null);
    }
    final cached = cache[trimmedRestaurantId];
    if (cache.containsKey(trimmedRestaurantId)) {
      return Future.value(cached);
    }
    return BiteScoreService.loadRestaurantById(trimmedRestaurantId).then((
      restaurant,
    ) {
      cache[trimmedRestaurantId] = restaurant;
      return restaurant;
    });
  }
}
