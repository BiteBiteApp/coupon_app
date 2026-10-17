import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/widgets/bitescore_category_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _User extends Fake implements User {
  @override
  final String uid;
  _User(this.uid);
  @override
  String? get email => uid == 'admin' ? 'schuyler.cole@gmail.com' : null;
  @override
  bool get isAnonymous => false;
}

void main() {
  for (final restaurantPage in [false, true]) {
    for (final scenario in [
      'customer accepts',
      'customer cancels',
      'owner accepts',
      'owner cancels',
      'admin',
    ]) {
      testWidgets(
        '${restaurantPage ? 'restaurant' : 'dish'} category: $scenario',
        (tester) async {
          tester.view.physicalSize = const Size(900, 1600);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final owner = scenario.startsWith('owner');
          final user = _User(
            scenario == 'admin'
                ? 'admin'
                : owner
                ? 'owner'
                : 'customer',
          );
          final restaurant = BitescoreRestaurant(
            id: 'restaurant',
            name: 'Restaurant',
            normalizedName: 'restaurant',
            address: '1 Main',
            city: 'Test',
            state: 'NY',
            zipCode: '10001',
            location: const GeoPoint(0, 0),
            ownerUserId: 'owner',
            isClaimed: true,
            restaurantWriteRevision: 0,
          );
          final entry = BiteScoreHomeEntry(
            restaurant: restaurant,
            dish: const BitescoreDish(
              id: 'dish',
              restaurantId: 'restaurant',
              restaurantName: 'Restaurant',
              name: 'Dish',
              normalizedName: 'dish',
            ),
            aggregate: const DishRatingAggregate(
              dishId: 'dish',
              restaurantId: 'restaurant',
            ),
          );
          var gates = 0, saves = 0;
          Future<bool> gate(BuildContext _) async {
            gates++;
            return scenario.endsWith('accepts');
          }

          Future<void> save(
            BitescoreDish dish,
            BitescoreCategorySelection selection,
          ) async {
            expect(selection.categoryForSave, 'Test Category');
            saves++;
          }

          await tester.pumpWidget(
            MaterialApp(
              home: restaurantPage
                  ? BiteScoreRestaurantDishesScreen(
                      restaurant: restaurant,
                      entries: [entry],
                      testInitialDataLoader: () async => (
                        restaurant: restaurant,
                        entries: [entry],
                        isFavorite: false,
                      ),
                      testCurrentUserProvider: () => user,
                      testWriteGate: (_) async => true,
                      testTermsGate: gate,
                      testDishCategorySaver: save,
                    )
                  : BiteScoreDishDetailScreen(
                      entry: entry,
                      testInitialLoader: () async {},
                      testCurrentUserProvider: () => user,
                      testWriteGate: (_) async => true,
                      testTermsGate: gate,
                      testDishCategorySaver: save,
                      testSuppressLocalExpertBadgeRecalculation: true,
                    ),
            ),
          );
          await tester.pumpAndSettle();
          final add = find.text('+ Add category').first;
          await tester.ensureVisible(add);
          await tester.tap(add);
          await tester.pumpAndSettle();
          tester
              .widget<BitescoreCategoryPicker>(
                find.byType(BitescoreCategoryPicker),
              )
              .onChanged(
                const BitescoreCategorySelection(
                  legacyCategory: 'Test Category',
                ),
              );
          await tester.pump();
          await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
          await tester.pumpAndSettle();
          expect(gates, scenario == 'admin' ? 0 : 1);
          expect(saves, scenario.endsWith('cancels') ? 0 : 1);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
