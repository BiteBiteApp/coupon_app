import 'dart:convert';
import 'dart:io';
import 'package:coupon_app/models/daily_special.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/restaurant_specials_screen.dart';
import 'package:coupon_app/screens/bitesaver_photo_viewer.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fixture =
      jsonDecode(
            File(
              'test/fixtures/web_release_specials_media.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  const special = DailySpecial(
    id: 'manual-special',
    restaurantId: 'release-owner',
    ownerUid: 'release-owner',
    title: 'Lunch Special',
    isActive: true,
    availabilityMode: DailySpecialAvailabilityMode.specificDays,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    allDay: true,
  );
  final projection = <String, dynamic>{
    RestaurantAccountService.publicProjectionVersionField:
        RestaurantAccountService.customerPublicProjectionVersion,
    RestaurantAccountService.projectionEntityTypeField: 'restaurant',
    RestaurantAccountService.projectionSourceField: 'biteSaver',
    RestaurantAccountService.projectionSourceDocumentIdField: 'release-owner',
    RestaurantAccountService.projectionIndexDocumentIdField:
        'index-release-owner',
    RestaurantAccountService.projectionDisplayNameField: 'Release Cafe',
    Restaurant.fieldStreetAddress: '1 Main St',
    Restaurant.fieldCity: 'Hartford',
    Restaurant.fieldState: 'CT',
    Restaurant.fieldZipCode: '06103',
    RestaurantAccountService.publicVisibleField: true,
    'publicRestaurantId': fixture['request']['restaurantId'],
  };
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final mode in ['manual', 'photo']) {
    testWidgets(
      'default Home media contract selects $mode Specials and opens the actual Specials view',
      (tester) async {
        final calls = <Map<String, Object?>>[];
        final service = CustomerBiteSaverService(
          transport: (name, request) async {
            expect(name, 'getCustomerBiteSaverSearchPage');
            expect(request, fixture['request']);
            calls.add(request);
            return fixture[mode];
          },
        );
        var manualLoads = 0;
        final restaurants =
            await RestaurantAccountService.loadApprovedRestaurantsWithCoupons(
              projectionLoader: () async => [
                CustomerRestaurantProjectionDocument(
                  documentId: 'index-release-owner',
                  data: projection,
                ),
              ],
              couponLoader: (id) async {
                expect(id, 'release-owner');
                return [];
              },
              mediaLoader: service.getRestaurantMedia,
              specialsLoader: (id) async {
                expect(id, 'release-owner');
                manualLoads++;
                return [special];
              },
            );
        expect(restaurants, hasLength(1));
        expect(calls, hasLength(1));
        expect(restaurants.single.accountDocumentId, 'release-owner');
        expect(
          restaurants.single.dailySpecials.single.title,
          mode == 'manual' ? 'Lunch Special' : 'Daily Specials board',
        );
        expect(manualLoads, mode == 'manual' ? 1 : 0);
        final media = await service.getRestaurantMedia(
          fixture['request']['restaurantId'] as String,
        );
        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantSpecialsScreen(
              restaurant: restaurants.single,
              media: media,
              loadSpecials: (id) async {
                expect(id, 'release-owner');
                return [special];
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.descendant(
            of: find.byType(AppBar),
            matching: find.text("Today's Specials"),
          ),
          findsOneWidget,
        );
        if (mode == 'manual') {
          expect(find.text('Lunch Special'), findsOneWidget);
          expect(
            find.byKey(const ValueKey('daily-specials-board-photo')),
            findsNothing,
          );
        } else {
          expect(find.text('Lunch Special'), findsNothing);
          await tester.tap(
            find.byKey(const ValueKey('daily-specials-board-photo')),
          );
          await tester.pumpAndSettle();
          expect(find.byType(BiteSaverPhotoViewer), findsOneWidget);
          expect(find.text('Release Cafe Daily Specials'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
  test(
    'failed media lookup preserves the restaurant and suppresses stale Specials',
    () async {
      var manualLoads = 0;
      final restaurants =
          await RestaurantAccountService.loadApprovedRestaurantsWithCoupons(
            projectionLoader: () async => [
              CustomerRestaurantProjectionDocument(
                documentId: 'index-release-owner',
                data: projection,
              ),
            ],
            couponLoader: (_) async => [],
            mediaLoader: (_) async => throw StateError('media unavailable'),
            specialsLoader: (_) async {
              manualLoads++;
              return [special];
            },
          );
      expect(restaurants, hasLength(1));
      expect(restaurants.single.dailySpecials, isEmpty);
      expect(manualLoads, 0);
    },
  );
}
