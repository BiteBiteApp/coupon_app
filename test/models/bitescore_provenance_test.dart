import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/contribution_points_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BiteScore creation provenance', () {
    test('newly created dish serializes creator provenance', () {
      final dish = BitescoreDish(
        id: 'dish-1',
        restaurantId: 'restaurant-1',
        restaurantName: 'Pizza Place',
        name: 'Pizza Slice',
        normalizedName: 'pizza slice',
        createdByUserId: ' user-1 ',
        createdFromReviewId: ' review-1 ',
        createdWithRestaurantId: ' restaurant-1 ',
        createdFromCreateFlow: true,
      );

      final map = dish.toFirestoreMap();

      expect(map['createdByUserId'], 'user-1');
      expect(map['createdFromReviewId'], 'review-1');
      expect(map['createdWithRestaurantId'], 'restaurant-1');
      expect(map['createdFromCreateFlow'], isTrue);
    });

    test('newly created restaurant serializes creator provenance', () {
      final restaurant = BitescoreRestaurant(
        id: 'restaurant-1',
        name: 'Pizza Place',
        normalizedName: 'pizza place',
        address: '1 Main St',
        city: 'Lecanto',
        state: 'FL',
        zipCode: '34461',
        location: const GeoPoint(28.8, -82.5),
        createdByUserId: ' user-1 ',
        createdFromDishId: ' dish-1 ',
        createdFromReviewId: ' review-1 ',
        createdFromCreateFlow: true,
      );

      final map = restaurant.toFirestoreMap();

      expect(map['createdByUserId'], 'user-1');
      expect(map['createdFromDishId'], 'dish-1');
      expect(map['createdFromReviewId'], 'review-1');
      expect(map['createdFromCreateFlow'], isTrue);
    });

    test('old dish docs without provenance still parse', () {
      final dish = BitescoreDish.tryFromFirestore({
        'restaurantId': 'restaurant-1',
        'restaurantName': 'Pizza Place',
        'name': 'Pizza Slice',
        'normalizedName': 'pizza slice',
      }, fallbackId: 'dish-1');

      expect(dish, isNotNull);
      expect(dish!.createdByUserId, isNull);
      expect(dish.createdFromReviewId, isNull);
      expect(dish.createdWithRestaurantId, isNull);
      expect(dish.createdFromCreateFlow, isFalse);
      expect(dish.toFirestoreMap().containsKey('createdByUserId'), isFalse);
      expect(
        dish.toFirestoreMap().containsKey('createdFromCreateFlow'),
        isFalse,
      );
    });

    test('old restaurant docs without provenance still parse', () {
      final restaurant = BitescoreRestaurant.tryFromFirestore({
        'name': 'Pizza Place',
        'normalizedName': 'pizza place',
        'address': '1 Main St',
        'city': 'Lecanto',
        'state': 'FL',
        'zipCode': '34461',
        'location': const GeoPoint(28.8, -82.5),
      }, fallbackId: 'restaurant-1');

      expect(restaurant, isNotNull);
      expect(restaurant!.createdByUserId, isNull);
      expect(restaurant.createdFromDishId, isNull);
      expect(restaurant.createdFromReviewId, isNull);
      expect(restaurant.createdFromCreateFlow, isFalse);
      expect(
        restaurant.toFirestoreMap().containsKey('createdByUserId'),
        isFalse,
      );
      expect(
        restaurant.toFirestoreMap().containsKey('createdFromCreateFlow'),
        isFalse,
      );
    });

    test(
      'create-and-rate provenance helpers use creator uid and review id',
      () {
        final dishProvenance =
            BiteScoreService.dishCreationProvenanceFieldsForTesting(
              createdByUserId: ' user-1 ',
              dishId: 'dish-1',
              restaurantId: ' restaurant-1 ',
            );
        final restaurantProvenance =
            BiteScoreService.restaurantCreationProvenanceFieldsForTesting(
              createdByUserId: ' user-1 ',
              createdFromDishId: ' dish-1 ',
              createdFromReviewId: 'dish-1_user-1',
            );

        expect(dishProvenance, {
          'createdByUserId': 'user-1',
          'createdFromReviewId': 'dish-1_user-1',
          'createdWithRestaurantId': 'restaurant-1',
          'createdFromCreateFlow': true,
        });
        expect(restaurantProvenance, {
          'createdByUserId': 'user-1',
          'createdFromDishId': 'dish-1',
          'createdFromReviewId': 'dish-1_user-1',
          'createdFromCreateFlow': true,
        });
      },
    );

    test('contribution point award values and source keys are unchanged', () {
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: false,
          createdNewDish: true,
          restaurantHadNoDishesBefore: false,
        ),
        1,
      );
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: true,
          createdNewDish: true,
          restaurantHadNoDishesBefore: true,
        ),
        3,
      );
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: false,
          createdNewDish: true,
          restaurantHadNoDishesBefore: true,
        ),
        3,
      );
      expect(
        ContributionPointsService.dishCreatedSourceKey('dish-1'),
        'dish_created:dish-1',
      );
      expect(
        ContributionPointsService.restaurantFirstDishSourceKey(
          restaurantId: 'restaurant-1',
          dishId: 'dish-1',
        ),
        'restaurant_first_dish:restaurant-1:dish-1',
      );
      expect(
        ContributionPointsService.newRestaurantFirstDishSourceKey(
          restaurantId: 'restaurant-1',
          dishId: 'dish-1',
        ),
        'new_restaurant_first_dish:restaurant-1:dish-1',
      );
    });
  });
}
