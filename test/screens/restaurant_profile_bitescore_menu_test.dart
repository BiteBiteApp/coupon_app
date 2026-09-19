import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_menu_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    CustomerBiteScoreRuntime.testEnabled = true;
  });
  tearDown(() => CustomerBiteScoreRuntime.testEnabled = null);

  testWidgets(
    'legacy BiteSaver profile opens linked BiteScore menu with bounded reads',
    (tester) async {
      final projections = <String>[];
      final menuReads = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantProfileScreen(
            restaurant: _restaurant(),
            loadFavorite: (_) async => false,
            refreshRestaurant: (_) async => null,
            loadProjectionData: (id) async {
              projections.add(id);
              return _projection(linkedId: 'linked-score');
            },
            resolvePublicMenu: (_) async =>
                throw StateError('raw menu resolver used'),
            testBiteScoreReads: CustomerBiteScoreReads(
              actorKey: () => 'guest',
              boundary: (name, request) async {
                expect(name, 'pageCustomerBiteScoreMenu');
                expect(request['restaurantId'], 'linked-score');
                menuReads.add(request['restaurantId'] as String);
                return {
                  'schemaVersion': 1,
                  'restaurantId': 'linked-score',
                  'state': 'available',
                  'menuStyle': 'biteScore',
                  'entries': [
                    {
                      'kind': 'item',
                      'key': 'bscm_${'a' * 64}',
                      'sortOrder': 0,
                      'name': 'Linked Dish',
                      'description': '',
                      'price': r'$9',
                      'category': 'Dinner',
                    },
                  ],
                  'nextCursor': null,
                };
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // The independent BiteSaver bounded composition is absent.
      expect(
        tester
            .widget<RestaurantProfileScreen>(
              find.byType(RestaurantProfileScreen),
            )
            .boundedRestaurant,
        isNull,
      );
      await _openMenu(tester);
      expect(projections, ['account']);
      expect(menuReads, ['linked-score']);
      expect(find.text('Linked Dish'), findsOneWidget);
      final menu = tester.widget<RestaurantMenuScreen>(
        find.byType(RestaurantMenuScreen),
      );
      expect(menu.biteScorePageLoader, isNotNull);
      expect(menu.boundedPageLoader, isNull);
      expect(menu.source, isNull);
      expect(menu.mode, AppMode.biteSaver);
      expect(tester.takeException(), isNull);
    },
  );

  test('own BiteSaver menu retains its existing account source', () async {
    final route = await RestaurantMenuService.resolveBiteSaverPublicMenuRoute(
      uid: 'account',
      projectionLoader: (_) async => _projection(),
    );
    expect(route!.biteScoreRestaurantId, isNull);
    expect(route.source!.isLegacyBiteSaver, isTrue);
    expect(route.source!.id, 'account');
  });

  testWidgets('default-off keeps the existing BiteSaver menu resolver', (
    tester,
  ) async {
    CustomerBiteScoreRuntime.testEnabled = false;
    final requested = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantProfileScreen(
          restaurant: _restaurant(),
          loadFavorite: (_) async => false,
          refreshRestaurant: (_) async => null,
          loadProjectionData: (_) async =>
              throw StateError('bounded menu routing used'),
          resolvePublicMenu: (id) async {
            requested.add(id);
            return RestaurantMenuSource.legacyBiteSaver('');
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _openMenu(tester);
    expect(requested, ['account']);
    final menu = tester.widget<RestaurantMenuScreen>(
      find.byType(RestaurantMenuScreen),
    );
    expect(menu.biteScorePageLoader, isNull);
    expect(menu.source!.isLegacyBiteSaver, isTrue);
    expect(tester.takeException(), isNull);
  });

  for (final changes in <Map<String, dynamic>>[
    {'publicVisible': false},
    {'sourceDocumentId': 'different-account'},
    {'linkedBiteScoreRestaurantId': ' linked-score'},
    {'linkedBiteScoreRestaurantId': 'invalid/path'},
    {'linkedBiteScoreRestaurantId': null},
  ]) {
    test('invalid public menu route is unavailable: $changes', () async {
      expect(
        await RestaurantMenuService.resolveBiteSaverPublicMenuRoute(
          uid: 'account',
          projectionLoader: (_) async => {
            ..._projection(linkedId: 'linked-score'),
            ...changes,
          },
        ),
        isNull,
      );
    });
  }
}

Future<void> _openMenu(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Restaurant Information'));
  await tester.tap(find.text('Restaurant Information'));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Menu'));
  await tester.tap(find.text('Menu'));
  await tester.pumpAndSettle();
}

Restaurant _restaurant() => Restaurant(
  documentId: 'account',
  uid: 'stored-owner',
  name: 'Cafe',
  distance: '1 mile',
  city: 'Crystal River',
  state: 'FL',
  zipCode: '34428',
  streetAddress: '1 Main St',
  coupons: const [],
  dailySpecials: const [],
);

Map<String, dynamic> _projection({String? linkedId}) => {
  RestaurantAccountService.publicProjectionVersionField:
      RestaurantAccountService.customerPublicProjectionVersion,
  RestaurantAccountService.projectionEntityTypeField: 'restaurant',
  RestaurantAccountService.projectionSourceField: 'biteSaver',
  RestaurantAccountService.projectionSourceDocumentIdField: 'account',
  RestaurantAccountService.projectionIndexDocumentIdField: 'index-account',
  RestaurantAccountService.projectionDisplayNameField: 'Cafe',
  RestaurantAccountService.publicVisibleField: true,
  Restaurant.fieldStreetAddress: '1 Main St',
  Restaurant.fieldCity: 'Crystal River',
  Restaurant.fieldState: 'FL',
  Restaurant.fieldZipCode: '34428',
  'menuSourceSide': linkedId == null ? 'biteSaver' : 'biteScore',
  'linkedBiteScoreRestaurantId': ?linkedId,
};
