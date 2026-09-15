import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/customer_bitesaver_browse_destinations.dart';
import 'package:coupon_app/screens/customer_bitesaver_browse_screen.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(const <String, Object>{});
    SharedLocationStateService.resetForTesting();
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  tearDown(() {
    SharedLocationStateService.resetForTesting();
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  test('default navigation entry has no bounded browse activation', () {
    const screen = MainNavigationScreen(initializePlatformServices: false);
    expect(screen.biteSaverBrowseHomeBuilder, isNull);
  });

  testWidgets(
    'production handler opens exact restaurant DTO and Back retains browse',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      const handler = CustomerBiteSaverBrowseDestinationHandler();

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          home: MainNavigationScreen(
            initializePlatformServices: false,
            biteSaverBrowseHomeBuilder:
                (context, navigationRefreshGeneration, authRealm) =>
                    harness.screen(
                      navigationRefreshGeneration: navigationRefreshGeneration,
                      onAction: handler.call,
                    ),
            testPagesBuilder: (mode) => const <Widget>[
              SizedBox.shrink(),
              SizedBox.shrink(),
              SizedBox.shrink(),
            ],
          ),
        ),
      );
      await _pumpBrowseReady(tester, harness.transport);
      final browseState = tester.state(
        find.byType(CustomerBiteSaverBrowseScreen),
      );
      final scroll = tester.widget<CustomScrollView>(
        find.byType(CustomScrollView).last,
      );
      scroll.controller!.jumpTo(80);
      await tester.pump();
      final retainedOffset = scroll.controller!.offset;
      final expected = harness.coordinator.currentAcceptedRestaurantFor(
        _restaurantId(harness.transport),
      );

      await tester.tap(find.text('Fixture Café 😀'));
      await tester.pumpAndSettle();

      final destination = tester.widget<RestaurantProfileScreen>(
        find.byType(RestaurantProfileScreen),
      );
      expect(destination.boundedRestaurant, same(expected));
      expect(destination.boundedSession, same(harness.coordinator));
      expect(destination.boundedAccess, isNotNull);
      expect(
        harness.coordinator.isBrowseAccessCurrent(destination.boundedAccess!),
        isTrue,
      );
      expect(destination.restaurant.accountDocumentId, isNull);
      expect(destination.restaurant.name, 'Fixture Café 😀');
      expect(find.byTooltip('Save restaurant'), findsNothing);
      expect(find.text('Report'), findsNothing);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(
        tester.state(find.byType(CustomerBiteSaverBrowseScreen)),
        same(browseState),
      );
      expect(
        tester
            .widget<CustomScrollView>(find.byType(CustomScrollView).last)
            .controller!
            .offset,
        closeTo(retainedOffset, 0.01),
      );
      expect(harness.transport.startCalls, 1);
      expect(harness.transport.restaurantPageCalls, 1);
      expect(harness.transport.redemptionCalls, 0);

      for (var cycle = 0; cycle < 2; cycle += 1) {
        await tester.tap(find.text('Fixture Café 😀'));
        await tester.pumpAndSettle();
        expect(find.byType(RestaurantProfileScreen), findsOneWidget);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
      }
      expect(
        tester.state(find.byType(CustomerBiteSaverBrowseScreen)),
        same(browseState),
      );
      expect(harness.transport.startCalls, 1);
      expect(harness.transport.restaurantPageCalls, 1);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Fixture Café 😀'));
      await tester.pumpAndSettle();
      final replacedAccess = tester
          .widget<RestaurantProfileScreen>(find.byType(RestaurantProfileScreen))
          .boundedAccess!;
      await harness.coordinator.freshSearch(harness.coordinator.criteria!);
      await _pumpUntil(
        tester,
        () => find.byType(RestaurantProfileScreen).evaluate().isEmpty,
      );
      expect(
        harness.coordinator.isBrowseAccessCurrent(replacedAccess),
        isFalse,
      );
      expect(harness.transport.startCalls, 2);
      expect(harness.transport.restaurantPageCalls, 2);
    },
  );

  testWidgets(
    'production handler opens preview and expanded offers without redemption',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1100);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      const handler = CustomerBiteSaverBrowseDestinationHandler();

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          home: MainNavigationScreen(
            initializePlatformServices: false,
            biteSaverBrowseHomeBuilder:
                (context, navigationRefreshGeneration, authRealm) =>
                    harness.screen(
                      navigationRefreshGeneration: navigationRefreshGeneration,
                      onAction: handler.call,
                    ),
            testPagesBuilder: (mode) => const <Widget>[
              SizedBox.shrink(),
              SizedBox.shrink(),
              SizedBox.shrink(),
            ],
          ),
        ),
      );
      await _pumpBrowseReady(tester, harness.transport);
      final browseState = tester.state(
        find.byType(CustomerBiteSaverBrowseScreen),
      );
      var expected = harness.coordinator.currentAcceptedOfferSelectionFor(
        _restaurantId(harness.transport),
        CustomerBiteSaverOfferId(harness.transport.firstOfferId),
      )!;

      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();

      var detail = tester.widget<CouponDetailScreen>(
        find.byType(CouponDetailScreen),
      );
      expect(detail.boundedRestaurant, same(expected.restaurant));
      expect(detail.boundedOffer, same(expected.offer));
      expect(detail.boundedSession, same(harness.coordinator));
      expect(
        detail.boundedOffer!.offerOccurrence,
        expected.offer.offerOccurrence,
      );
      expect(detail.coupon.id, harness.transport.firstOfferId);
      expect(detail.restaurant!.accountDocumentId, isNull);
      expect(detail.useBoundedCoupon, isNull);
      expect(find.text('Use Coupon Unavailable'), findsOneWidget);
      expect(find.byTooltip('Save coupon'), findsNothing);
      expect(harness.transport.redemptionCalls, 0);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester.state(find.byType(CustomerBiteSaverBrowseScreen)),
        same(browseState),
      );

      await tester.tap(find.text('More deals'));
      await _pumpUntil(tester, () => harness.transport.offerPageCalls == 1);
      expected = harness.coordinator.currentAcceptedOfferSelectionFor(
        _restaurantId(harness.transport),
        CustomerBiteSaverOfferId(harness.transport.thirdOfferId),
      )!;
      await tester.tap(find.text('Additional Deal 3'));
      await tester.pumpAndSettle();

      detail = tester.widget<CouponDetailScreen>(
        find.byType(CouponDetailScreen),
      );
      expect(detail.boundedRestaurant, same(expected.restaurant));
      expect(detail.boundedOffer, same(expected.offer));
      expect(
        detail.boundedOffer!.offerId.value,
        harness.transport.thirdOfferId,
      );
      expect(
        detail.boundedOffer!.offerOccurrence,
        expected.offer.offerOccurrence,
      );
      expect(harness.transport.redemptionCalls, 0);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester.state(find.byType(CustomerBiteSaverBrowseScreen)),
        same(browseState),
      );
      expect(harness.transport.startCalls, 1);
    },
  );

  testWidgets('bounded detail preserves structured offer presentation', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1100);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(
      firstOfferOverrides: const <String, Object?>{
        'usageRule': 'Limit 2 per customer',
        'redemptionPolicyLabel': 'Limit 2 per customer',
        'availabilityMode': 'specificDays',
        'daysOfWeek': <int>[1, 3, 5],
        'allDay': false,
        'startTime': '09:15',
        'endTime': '14:45',
        'expiresText': null,
      },
    );
    final harness = _BrowseHarness(transport: transport);
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();

    expect(
      _richTextAtKey(tester, CouponDetailScreen.boundedOfferTypeKey),
      'Offer type: Coupon',
    );
    expect(
      _richTextAtKey(tester, CouponDetailScreen.boundedScheduleKey),
      'Schedule: Mon, Wed, Fri · 09:15–14:45',
    );
    expect(
      _richTextAtKey(tester, BiteSaverCouponDetailInfoSection.usageKey),
      'Usage: Limit 2 per customer',
    );
    expect(find.textContaining('Limited time'), findsNothing);
    expect(find.textContaining('See offer details'), findsNothing);
  });

  testWidgets('transient inactive and resumed preserves open bounded detail', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, harness.transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();
    final detail = tester.state(find.byType(CouponDetailScreen));

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(find.byType(CouponDetailScreen), findsOneWidget);
    expect(tester.state(find.byType(CouponDetailScreen)), same(detail));
    expect(harness.transport.startCalls, 1);
  });

  testWidgets(
    'bounded profile and detail preserve daily-special presentation',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1100);
      addTearDown(tester.view.reset);
      final transport = _BrowseFixtureTransport(
        firstOfferIsDailySpecial: true,
        firstOfferOverrides: const <String, Object?>{
          'availabilityMode': 'specificDays',
          'daysOfWeek': <int>[2, 4],
          'allDay': false,
          'startTime': '11:00 AM',
          'endTime': '2:00 PM',
        },
      );
      final harness = _BrowseHarness(transport: transport);
      const handler = CustomerBiteSaverBrowseDestinationHandler();

      await tester.pumpWidget(_productionBrowseApp(harness, handler));
      await _pumpBrowseReady(tester, transport);
      await tester.tap(find.text('Fixture Café 😀'));
      await tester.pumpAndSettle();

      expect(find.text('Available Offers'), findsOneWidget);
      expect(find.text('Fixture Daily Special'), findsOneWidget);
      expect(find.text('Daily Special'), findsOneWidget);
      expect(
        find.textContaining('Tue, Thu · 11:00 AM–2:00 PM'),
        findsOneWidget,
      );

      await tester.tap(find.text('Fixture Daily Special'));
      await tester.pumpAndSettle();

      expect(
        _richTextAtKey(tester, CouponDetailScreen.boundedOfferTypeKey),
        'Offer type: Daily special',
      );
      expect(
        _richTextAtKey(tester, CouponDetailScreen.boundedScheduleKey),
        'Schedule: Tue, Thu · 11:00 AM–2:00 PM',
      );
      expect(find.textContaining('Use Coupon'), findsNothing);
      expect(
        find.byKey(BiteSaverCouponDetailInfoSection.usageKey),
        findsNothing,
      );
      expect(transport.redemptionCalls, 0);
    },
  );

  testWidgets('retained profile revalidates offer action after resume', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1100);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, harness.transport);
    await tester.tap(find.text('Fixture Café 😀'));
    await tester.pumpAndSettle();
    final profile = tester.widget<RestaurantProfileScreen>(
      find.byType(RestaurantProfileScreen),
    );

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();

    final detail = tester.widget<CouponDetailScreen>(
      find.byType(CouponDetailScreen),
    );
    expect(detail.boundedAccess, same(profile.boundedAccess));
    expect(detail.boundedRestaurant, same(profile.boundedRestaurant));
    expect(detail.boundedOffer?.title, 'Fixture Coupon 1');
    expect(harness.transport.startCalls, 1);
    expect(harness.transport.redemptionCalls, 0);
  });

  testWidgets('bounded all-day schedule does not invent clock times', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1100);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(
      firstOfferOverrides: const <String, Object?>{
        'availabilityMode': 'specificDays',
        'daysOfWeek': <int>[6, 7],
        'allDay': true,
        'startTime': null,
        'endTime': null,
      },
    );
    final harness = _BrowseHarness(transport: transport);
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();

    expect(
      _richTextAtKey(tester, CouponDetailScreen.boundedScheduleKey),
      'Schedule: Sat, Sun · All day',
    );
    expect(find.byKey(CouponDetailScreen.boundedStartsKey), findsNothing);
    expect(find.byKey(CouponDetailScreen.boundedEndsKey), findsNothing);
  });

  testWidgets('bounded absolute schedule retains source instants', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1100);
    addTearDown(tester.view.reset);
    const startAtMillis = 1789221600000;
    const endAtMillis = 1789228800000;
    final transport = _BrowseFixtureTransport(
      firstOfferOverrides: const <String, Object?>{
        'startAtMillis': startAtMillis,
        'endAtMillis': endAtMillis,
        'expiresAtMillis': endAtMillis,
        'expiresText': null,
      },
    );
    final harness = _BrowseHarness(transport: transport);
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();

    expect(
      _richTextAtKey(tester, CouponDetailScreen.boundedStartsKey),
      'Starts: ${Coupon.formatDateTime(DateTime.fromMillisecondsSinceEpoch(startAtMillis, isUtc: true))}',
    );
    expect(
      _richTextAtKey(tester, CouponDetailScreen.boundedEndsKey),
      'Ends: ${Coupon.formatDateTime(DateTime.fromMillisecondsSinceEpoch(endAtMillis, isUtc: true))}',
    );
    expect(
      _richTextAtKey(tester, BiteSaverCouponDetailInfoSection.expiresKey),
      'Expires: ${Coupon.formatMonthDayTime(DateTime.fromMillisecondsSinceEpoch(endAtMillis, isUtc: true))}',
    );
  });

  testWidgets('bounded missing optional labels stay neutral', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1100);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(
      firstOfferIsDailySpecial: true,
      firstOfferOverrides: const <String, Object?>{
        'availabilityMode': null,
        'daysOfWeek': <int>[],
        'allDay': null,
        'startTime': null,
        'endTime': null,
        'expiresAtMillis': null,
        'expiresText': null,
        'usageRule': null,
        'redemptionPolicyLabel': null,
      },
    );
    final harness = _BrowseHarness(transport: transport);
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, transport);
    await tester.tap(find.text('Fixture Daily Special'));
    await tester.pumpAndSettle();

    expect(
      _richTextAtKey(tester, CouponDetailScreen.boundedOfferTypeKey),
      'Offer type: Daily special',
    );
    expect(find.byKey(BiteSaverCouponDetailInfoSection.usageKey), findsNothing);
    expect(
      find.byKey(BiteSaverCouponDetailInfoSection.expiresKey),
      findsNothing,
    );
    expect(find.byKey(CouponDetailScreen.boundedScheduleKey), findsNothing);
    expect(find.textContaining('Limited time'), findsNothing);
    expect(find.textContaining('See offer details'), findsNothing);
    expect(find.textContaining('Unlimited'), findsNothing);
  });

  testWidgets(
    'paused hidden and repeated external handoffs retain one detail route',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      const handler = CustomerBiteSaverBrowseDestinationHandler();

      await tester.pumpWidget(_productionBrowseApp(harness, handler));
      await _pumpBrowseReady(tester, harness.transport);
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      final detail = tester.state(find.byType(CouponDetailScreen));

      for (var cycle = 0; cycle < 3; cycle += 1) {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pumpAndSettle();

        expect(find.byType(CouponDetailScreen), findsOneWidget);
        expect(tester.state(find.byType(CouponDetailScreen)), same(detail));
        expect(
          find.byType(MainNavigationScreen, skipOffstage: false),
          findsOneWidget,
        );
      }
      expect(harness.transport.startCalls, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('auth invalidation wins during transient lifecycle state', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, harness.transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.byType(CouponDetailScreen), findsOneWidget);

    await harness.coordinator.updateAuth(
      const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
    );
    await _pumpUntil(
      tester,
      () => find.byType(CouponDetailScreen).evaluate().isEmpty,
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 10));

    expect(find.byType(CouponDetailScreen), findsNothing);
    expect(harness.transport.startCalls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('accepted evidence expiry retires retained public detail', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport();
    var nowMillis = transport.evaluationAtMillis;
    final harness = _BrowseHarness(
      transport: transport,
      clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis, isUtc: true),
    );
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();
    expect(find.byType(CouponDetailScreen), findsOneWidget);

    nowMillis = transport.logicalExpiresAtMillis;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await _pumpUntil(
      tester,
      () => find.byType(CouponDetailScreen).evaluate().isEmpty,
    );

    expect(find.byType(CustomerBiteSaverBrowseScreen), findsOneWidget);
    expect(harness.transport.startCalls, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
  });

  testWidgets('root disposal releases retained destination listeners', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(_productionBrowseApp(harness, handler));
    await _pumpBrowseReady(tester, harness.transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    await tester.pumpAndSettle();
    expect(find.byType(CouponDetailScreen), findsOneWidget);

    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    await tester.pumpAndSettle();

    expect(harness.coordinator.isDisposed, isTrue);
    expect(find.byType(CouponDetailScreen), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'menu stays blocked without raw identity and does not open a consumer',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      const handler = CustomerBiteSaverBrowseDestinationHandler();

      await tester.pumpWidget(
        MaterialApp(home: harness.screen(onAction: handler.call)),
      );
      await _pumpBrowseReady(tester, harness.transport);
      expect(
        harness.coordinator
            .currentAcceptedRestaurantFor(_restaurantId(harness.transport))!
            .catalogBindingAvailable,
        isTrue,
      );

      await tester.tap(find.text('View Menu'));
      await tester.pump();

      expect(
        find.text('Menu is not available from this search yet.'),
        findsOneWidget,
      );
      expect(find.byType(RestaurantMenuScreen), findsNothing);
      expect(harness.transport.startCalls, 1);
      expect(harness.transport.redemptionCalls, 0);
    },
  );

  testWidgets('daily-special selections use the bounded offer destination', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(firstOfferIsDailySpecial: true);
    final harness = _BrowseHarness(transport: transport);
    const handler = CustomerBiteSaverBrowseDestinationHandler();

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        home: MainNavigationScreen(
          initializePlatformServices: false,
          biteSaverBrowseHomeBuilder:
              (context, navigationRefreshGeneration, authRealm) =>
                  harness.screen(
                    navigationRefreshGeneration: navigationRefreshGeneration,
                    onAction: handler.call,
                  ),
          testPagesBuilder: (mode) => const <Widget>[
            SizedBox.shrink(),
            SizedBox.shrink(),
            SizedBox.shrink(),
          ],
        ),
      ),
    );
    await _pumpBrowseReady(tester, transport);

    await tester.tap(find.text('Fixture Daily Special'));
    await tester.pumpAndSettle();

    final detail = tester.widget<CouponDetailScreen>(
      find.byType(CouponDetailScreen),
    );
    expect(
      detail.boundedOffer?.offerType,
      CustomerBiteSaverOfferType.dailySpecial,
    );
    expect(find.text('Offer Details'), findsOneWidget);
    expect(find.text('Use Coupon Unavailable'), findsNothing);
    expect(transport.redemptionCalls, 0);
  });

  testWidgets('auth replacement retires bounded destinations and leases', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    const handler = CustomerBiteSaverBrowseDestinationHandler();
    CustomerBiteSaverBrowseSelection? pendingSelection;

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        home: MainNavigationScreen(
          initializePlatformServices: false,
          biteSaverBrowseHomeBuilder:
              (context, navigationRefreshGeneration, authRealm) =>
                  harness.screen(
                    navigationRefreshGeneration: navigationRefreshGeneration,
                    onAction: (context, selection) {
                      pendingSelection = selection;
                      return handler.call(context, selection);
                    },
                  ),
          testPagesBuilder: (mode) => const <Widget>[
            SizedBox.shrink(),
            SizedBox.shrink(),
            SizedBox.shrink(),
          ],
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);
    await tester.tap(find.text('Fixture Coupon 1'));
    final access = pendingSelection!.access;
    expect(harness.coordinator.isBrowseAccessCurrent(access), isTrue);

    await harness.coordinator.updateAuth(
      const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
    );
    await _pumpUntil(
      tester,
      () =>
          find.byType(CouponDetailScreen).evaluate().isEmpty &&
          find.byType(CustomerBiteSaverBrowseScreen).evaluate().isNotEmpty,
    );

    expect(harness.coordinator.isBrowseAccessCurrent(access), isFalse);
    expect(find.byType(CouponDetailScreen), findsNothing);
    expect(find.byType(CustomerBiteSaverBrowseScreen), findsOneWidget);
    expect(harness.transport.startCalls, 1);
    expect(harness.transport.redemptionCalls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'bounded entry starts once, excludes legacy Home, and retains tab state',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      final selections = <CustomerBiteSaverBrowseSelection>[];

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          home: MainNavigationScreen(
            initializePlatformServices: false,
            biteSaverBrowseHomeBuilder:
                (context, navigationRefreshGeneration, authRealm) =>
                    harness.screen(
                      navigationRefreshGeneration: navigationRefreshGeneration,
                      onAction: (context, selection) async {
                        selections.add(selection);
                        await Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (_) => const Scaffold(
                              body: Center(child: Text('Synthetic detail')),
                            ),
                          ),
                        );
                        return const CustomerBiteSaverBrowseActionResult();
                      },
                    ),
            testPagesBuilder: (mode) => const <Widget>[
              SizedBox.shrink(),
              Center(child: Text('Bounded test Hub')),
              Center(child: Text('Bounded test Account')),
            ],
          ),
        ),
      );
      await _pumpBrowseReady(tester, harness.transport);

      expect(find.byType(CustomerBiteSaverBrowseScreen), findsOneWidget);
      expect(find.byType(HomeScreen), findsNothing);
      expect(harness.transport.startCalls, 1);
      expect(harness.transport.restaurantPageCalls, 1);
      expect(find.text('Fixture Café 😀'), findsOneWidget);
      expect(find.text('Fixture Coupon 1'), findsOneWidget);
      expect(find.text('Fixture Coupon 2'), findsOneWidget);

      final scroll = tester.widget<CustomScrollView>(
        find.byType(CustomScrollView).last,
      );
      scroll.controller!.jumpTo(220);
      await tester.pump();
      final retainedOffset = scroll.controller!.offset;

      await tester.tap(find.text('Restaurant\nHub'));
      await tester.pump();
      expect(find.text('Bounded test Hub'), findsOneWidget);
      await tester.tap(find.text('Home'));
      await tester.pump();

      expect(harness.transport.startCalls, 1);
      expect(
        tester
            .widget<CustomScrollView>(find.byType(CustomScrollView).last)
            .controller!
            .offset,
        closeTo(retainedOffset, 0.01),
      );

      await tester.ensureVisible(find.text('Fixture Coupon 1'));
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      expect(find.text('Synthetic detail'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      scroll.controller!.jumpTo(0);
      await tester.pump();
      await tester.ensureVisible(find.text('Fixture Café 😀'));
      await tester.tap(find.text('Fixture Café 😀'));
      await tester.pumpAndSettle();
      expect(find.text('Synthetic detail'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.text('View Menu'));
      await tester.tap(find.text('View Menu'));
      await tester.pumpAndSettle();
      expect(find.text('Synthetic detail'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(harness.transport.startCalls, 1);
      expect(selections, hasLength(3));
      expect(
        selections.map((selection) => selection.action),
        <CustomerBiteSaverBrowseAction>[
          CustomerBiteSaverBrowseAction.offer,
          CustomerBiteSaverBrowseAction.restaurantProfile,
          CustomerBiteSaverBrowseAction.menu,
        ],
      );
      expect(
        selections.map((selection) => selection.restaurant.restaurantId.value),
        everyElement(harness.transport.firstRestaurantId),
      );
      expect(
        selections.first.offer?.offerId.value,
        harness.transport.firstOfferId,
      );
      expect(
        selections.map((selection) => selection.session),
        everyElement(same(harness.coordinator)),
      );
      expect(harness.transport.redemptionCalls, 0);
    },
  );

  testWidgets(
    'two previews expand through independent offer pages and keep newest occurrence',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1100);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness(
        transport: _BrowseFixtureTransport(
          repeatPreviewOnSecondOfferPage: true,
        ),
      );
      final selections = <CustomerBiteSaverBrowseSelection>[];

      await tester.pumpWidget(
        MaterialApp(
          home: harness.screen(
            onAction: (context, selection) async {
              selections.add(selection);
              return const CustomerBiteSaverBrowseActionResult();
            },
          ),
        ),
      );
      await _pumpBrowseReady(tester, harness.transport);

      expect(find.text('Additional Deal 3'), findsNothing);
      await tester.tap(find.text('More deals'));
      await _pumpUntil(tester, () => harness.transport.offerPageCalls == 1);

      expect(find.text('Additional Deal 3'), findsOneWidget);
      expect(harness.transport.offerPageCalls, 1);
      expect(
        harness.coordinator
            .previewOffersFor(
              CustomerBiteSaverRestaurantId(
                harness.transport.firstRestaurantId,
              ),
            )
            .first
            .offerOccurrence,
        harness.transport.currentFirstOfferOccurrence,
      );
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pump();
      expect(
        selections.single.offer?.offerOccurrence,
        harness.transport.currentFirstOfferOccurrence,
      );
      expect(
        selections.single.restaurant.offers
            .singleWhere(
              (offer) => offer.offerId.value == harness.transport.firstOfferId,
            )
            .offerOccurrence,
        harness.transport.currentFirstOfferOccurrence,
      );
      final oldPreviewCallback = tester
          .widget<BiteSaverHomeDealBubble>(
            find.byKey(
              ValueKey<String>(
                'bounded-offer-${harness.transport.firstOfferId}',
              ),
            ),
          )
          .onTap!;

      await tester.tap(find.text('Additional Deal 3'));
      await tester.pump();
      expect(
        selections[1].offer?.offerId.value,
        harness.transport.thirdOfferId,
      );
      expect(selections[1].restaurant.offers, hasLength(2));
      expect(
        selections[1].restaurant.offers.map((offer) => offer.offerId.value),
        isNot(contains(harness.transport.thirdOfferId)),
      );

      await tester.ensureVisible(find.text('Fixture Café 😀'));
      await tester.tap(find.text('Fixture Café 😀'));
      await tester.pump();
      await tester.ensureVisible(find.text('View Menu'));
      await tester.tap(find.text('View Menu'));
      await tester.pump();
      expect(
        selections.skip(2).map((selection) => selection.action),
        <CustomerBiteSaverBrowseAction>[
          CustomerBiteSaverBrowseAction.restaurantProfile,
          CustomerBiteSaverBrowseAction.menu,
        ],
      );
      for (final selection in selections.skip(2)) {
        expect(
          selection.restaurant.offers.first.offerOccurrence,
          harness.transport.currentFirstOfferOccurrence,
        );
      }

      await tester.tap(find.text('Load More Deals'));
      await _pumpUntil(tester, () => harness.transport.offerPageCalls == 2);
      expect(find.text('Additional Deal 4'), findsOneWidget);
      expect(harness.transport.offerCursors, <String?>[
        null,
        'bsc1.offer-next',
      ]);
      expect(harness.coordinator.restaurants, hasLength(25));
      expect(
        harness.coordinator
            .offerPagerFor(
              CustomerBiteSaverRestaurantId(
                harness.transport.firstRestaurantId,
              ),
            )!
            .items
            .map((offer) => offer.title),
        <String>['Additional Deal 3', 'Additional Deal 4'],
      );
      oldPreviewCallback();
      await tester.pump();
      expect(
        selections.last.offer?.offerOccurrence,
        harness.transport.repeatedFirstOfferOccurrence,
      );
      expect(
        selections.last.restaurant.offers.first.offerOccurrence,
        harness.transport.repeatedFirstOfferOccurrence,
      );
      expect(selections.last.restaurant.offers, hasLength(2));
      expect(harness.transport.redemptionCalls, 0);
    },
  );

  testWidgets(
    'non-progress offer page cannot replace accepted selection data',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1100);
      addTearDown(tester.view.reset);
      final transport = _BrowseFixtureTransport(
        repeatPreviewOnSecondOfferPage: true,
        nonProgressSecondOfferPage: true,
      );
      final harness = _BrowseHarness(transport: transport);
      final selections = <CustomerBiteSaverBrowseSelection>[];

      await tester.pumpWidget(
        MaterialApp(
          home: harness.screen(
            onAction: (context, selection) async {
              selections.add(selection);
              return const CustomerBiteSaverBrowseActionResult();
            },
          ),
        ),
      );
      await _pumpBrowseReady(tester, transport);
      await tester.tap(find.text('More deals'));
      await _pumpUntil(tester, () => transport.offerPageCalls == 1);
      final acceptedCallback = tester
          .widget<BiteSaverHomeDealBubble>(
            find.byKey(
              ValueKey<String>('bounded-offer-${transport.firstOfferId}'),
            ),
          )
          .onTap!;

      await tester.tap(find.text('Load More Deals'));
      await _pumpUntil(tester, () => transport.offerPageCalls == 2);
      await tester.pump();
      expect(
        harness.coordinator.offerPagerFor(_restaurantId(transport))!.error,
        isNotNull,
      );
      expect(
        harness.coordinator
            .currentAcceptedRestaurantFor(_restaurantId(transport))!
            .offers
            .first
            .offerOccurrence,
        transport.currentFirstOfferOccurrence,
      );

      acceptedCallback();
      await tester.pump();
      expect(
        selections.single.offer?.offerOccurrence,
        transport.currentFirstOfferOccurrence,
      );
      expect(
        selections.single.restaurant.offers.first.offerOccurrence,
        transport.currentFirstOfferOccurrence,
      );
      expect(
        selections.single.offer?.offerOccurrence,
        isNot(transport.repeatedFirstOfferOccurrence),
      );
    },
  );

  testWidgets('auth replacement fences a previously captured offer callback', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    final selections = <CustomerBiteSaverBrowseSelection>[];

    await tester.pumpWidget(
      MaterialApp(
        home: harness.screen(
          onAction: (context, selection) async {
            selections.add(selection);
            return const CustomerBiteSaverBrowseActionResult();
          },
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);
    final oldCallback = tester
        .widget<BiteSaverHomeDealBubble>(
          find.byKey(
            ValueKey<String>('bounded-offer-${harness.transport.firstOfferId}'),
          ),
        )
        .onTap!;

    await harness.coordinator.updateAuth(
      const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
    );
    oldCallback();
    await tester.pump();

    expect(selections, isEmpty);
    expect(harness.transport.startCalls, 1);
    expect(harness.transport.offerPageCalls, 0);
    expect(harness.transport.redemptionCalls, 0);
  });

  testWidgets('latest submitted search wins while time setup is pending', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    final olderTime = Completer<CustomerBiteSaverTimeContext>();
    final newerTime = Completer<CustomerBiteSaverTimeContext>();
    var providerCalls = 0;
    Future<CustomerBiteSaverTimeContext> timeProvider() {
      providerCalls += 1;
      return switch (providerCalls) {
        1 => Future<CustomerBiteSaverTimeContext>.value(_testTimeContext),
        2 => olderTime.future,
        3 => newerTime.future,
        _ => throw StateError('Unexpected time-context request.'),
      };
    }

    await tester.pumpWidget(
      MaterialApp(
        home: harness.screen(
          onAction: _ignoreAction,
          timeContextProvider: timeProvider,
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);

    final field = find.byKey(const ValueKey<String>('bounded-content-field'));
    await tester.enterText(field, 'older search');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.enterText(field, 'newer search');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(providerCalls, 3);

    newerTime.complete(_testTimeContext);
    await _pumpUntil(tester, () => harness.transport.startCalls == 2);
    olderTime.complete(_testTimeContext);
    await tester.pump(const Duration(milliseconds: 50));

    expect(harness.transport.startCalls, 2);
    expect(harness.transport.startRequests.last['searchText'], 'newer search');
    expect(harness.coordinator.criteria?.searchText, 'newer search');
  });

  testWidgets(
    'stale setup failure and finally cannot replace or clear newer pending setup',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      final olderTime = Completer<CustomerBiteSaverTimeContext>();
      final newerTime = Completer<CustomerBiteSaverTimeContext>();
      var providerCalls = 0;
      Future<CustomerBiteSaverTimeContext> timeProvider() {
        providerCalls += 1;
        return switch (providerCalls) {
          1 => Future<CustomerBiteSaverTimeContext>.value(_testTimeContext),
          2 => olderTime.future,
          3 => newerTime.future,
          _ => throw StateError('Duplicate pending setup was not reused.'),
        };
      }

      await tester.pumpWidget(
        MaterialApp(
          home: harness.screen(
            onAction: _ignoreAction,
            timeContextProvider: timeProvider,
          ),
        ),
      );
      await _pumpBrowseReady(tester, harness.transport);

      final field = find.byKey(const ValueKey<String>('bounded-content-field'));
      await tester.enterText(field, 'older failure');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();
      await tester.enterText(field, 'newer pending');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();

      olderTime.completeError(Exception('stale time failure'));
      await tester.pump();
      expect(find.text('stale time failure'), findsNothing);
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pump();
      expect(providerCalls, 3);

      newerTime.complete(_testTimeContext);
      await _pumpUntil(tester, () => harness.transport.startCalls == 2);
      expect(
        harness.transport.startRequests.last['searchText'],
        'newer pending',
      );
      expect(harness.coordinator.criteria?.searchText, 'newer pending');
      expect(find.text('stale time failure'), findsNothing);
    },
  );

  testWidgets('new invalid submission revokes an older valid pending setup', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    final olderTime = Completer<CustomerBiteSaverTimeContext>();
    var providerCalls = 0;
    Future<CustomerBiteSaverTimeContext> timeProvider() {
      providerCalls += 1;
      return providerCalls == 1
          ? Future<CustomerBiteSaverTimeContext>.value(_testTimeContext)
          : olderTime.future;
    }

    await tester.pumpWidget(
      MaterialApp(
        home: harness.screen(
          onAction: _ignoreAction,
          timeContextProvider: timeProvider,
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);
    final field = find.byKey(const ValueKey<String>('bounded-content-field'));
    await tester.enterText(field, 'older valid search');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();

    final invalid = List<String>.filled(201, '😀').join();
    await tester.enterText(field, invalid);
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(
      find.text('Search must be at most 200 characters and 800 UTF-8 bytes.'),
      findsOneWidget,
    );
    expect(providerCalls, 2);

    olderTime.complete(_testTimeContext);
    await tester.pump(const Duration(milliseconds: 50));
    expect(harness.transport.startCalls, 1);
    expect(
      find.text('Search must be at most 200 characters and 800 UTF-8 bytes.'),
      findsOneWidget,
    );
  });

  testWidgets('content center radius and mode form one submitted snapshot', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues(const <String, Object>{
      'selected_radius': '30 miles',
    });
    final harness = _BrowseHarness();
    final olderTime = Completer<CustomerBiteSaverTimeContext>();
    final newerTime = Completer<CustomerBiteSaverTimeContext>();
    var providerCalls = 0;
    Future<CustomerBiteSaverTimeContext> timeProvider() {
      providerCalls += 1;
      return switch (providerCalls) {
        1 => Future<CustomerBiteSaverTimeContext>.value(_testTimeContext),
        2 => olderTime.future,
        3 => newerTime.future,
        _ => throw StateError('Unexpected time-context request.'),
      };
    }

    await tester.pumpWidget(
      MaterialApp(
        home: harness.screen(
          onAction: _ignoreAction,
          timeContextProvider: timeProvider,
          restoredLocation: const SharedLocationState(
            usingTypedSearchLocation: true,
            typedLatitude: 42.3601,
            typedLongitude: -71.0589,
            typedLabel: 'Boston, MA',
            searchText: 'Boston, MA',
          ),
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);

    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-content-field')),
      'coherent request',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-content-field')),
      'new coherent request',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(providerCalls, 3);

    newerTime.complete(_testTimeContext);
    await _pumpUntil(tester, () => harness.transport.startCalls == 2);
    olderTime.complete(_testTimeContext);
    await tester.pump(const Duration(milliseconds: 50));

    final request = harness.transport.startRequests.last;
    expect(harness.transport.startCalls, 2);
    expect(request['searchText'], 'new coherent request');
    expect(request['radiusMiles'], 30);
    expect(request['locationMode'], 'typed');
    expect(request['latitude'], 42.3601);
    expect(request['longitude'], -71.0589);
    expect(request['typedLocation'], <String, Object?>{
      'kind': 'city',
      'city': 'boston',
      'state': 'MA',
    });
  });

  testWidgets('radius change cannot mix an older submitted snapshot', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    final olderTime = Completer<CustomerBiteSaverTimeContext>();
    final newerTime = Completer<CustomerBiteSaverTimeContext>();
    var providerCalls = 0;
    Future<CustomerBiteSaverTimeContext> timeProvider() {
      providerCalls += 1;
      return switch (providerCalls) {
        1 => Future<CustomerBiteSaverTimeContext>.value(_testTimeContext),
        2 => olderTime.future,
        3 => newerTime.future,
        _ => throw StateError('Radius submission was dispatched twice.'),
      };
    }

    await tester.pumpWidget(
      MaterialApp(
        home: harness.screen(
          onAction: _ignoreAction,
          timeContextProvider: timeProvider,
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);
    final content = find.byKey(const ValueKey<String>('bounded-content-field'));
    await tester.enterText(content, 'older radius');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();

    await tester.enterText(content, 'newer radius');
    await tester.tap(
      find.byKey(const ValueKey<String>('bounded-radius-field')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('30 mi').last);
    await tester.pump();
    await tester.tap(find.byTooltip('Search restaurants or deals'));
    await _pumpUntil(tester, () => providerCalls == 3);
    await tester.pump(const Duration(milliseconds: 50));
    expect(providerCalls, 3);

    newerTime.complete(_testTimeContext);
    await _pumpUntil(tester, () => harness.transport.startCalls == 2);
    olderTime.complete(_testTimeContext);
    await tester.pump(const Duration(milliseconds: 50));

    final request = harness.transport.startRequests.last;
    final position = _position();
    expect(harness.transport.startCalls, 2);
    expect(request['searchText'], 'newer radius');
    expect(request['radiusMiles'], 30);
    expect(request['locationMode'], 'current');
    expect(request['latitude'], position.latitude);
    expect(request['longitude'], position.longitude);
    expect(request['typedLocation'], isNull);
  });

  testWidgets('auth replacement and disposal fence pending search setup', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final authHarness = _BrowseHarness();
    final authTime = Completer<CustomerBiteSaverTimeContext>();
    var authProviderCalls = 0;
    Future<CustomerBiteSaverTimeContext> authTimeProvider() {
      authProviderCalls += 1;
      return authProviderCalls == 1
          ? Future<CustomerBiteSaverTimeContext>.value(_testTimeContext)
          : authTime.future;
    }

    await tester.pumpWidget(
      MaterialApp(
        home: authHarness.screen(
          onAction: _ignoreAction,
          timeContextProvider: authTimeProvider,
        ),
      ),
    );
    await _pumpBrowseReady(tester, authHarness.transport);
    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-content-field')),
      'stale auth search',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await authHarness.coordinator.updateAuth(
      const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
    );
    authTime.complete(_testTimeContext);
    await tester.pump(const Duration(milliseconds: 50));
    expect(authHarness.transport.startCalls, 1);

    final disposedHarness = _BrowseHarness();
    final disposedTime = Completer<CustomerBiteSaverTimeContext>();
    var disposedProviderCalls = 0;
    Future<CustomerBiteSaverTimeContext> disposedTimeProvider() {
      disposedProviderCalls += 1;
      return disposedProviderCalls == 1
          ? Future<CustomerBiteSaverTimeContext>.value(_testTimeContext)
          : disposedTime.future;
    }

    await tester.pumpWidget(
      MaterialApp(
        home: disposedHarness.screen(
          onAction: _ignoreAction,
          timeContextProvider: disposedTimeProvider,
        ),
      ),
    );
    await _pumpBrowseReady(tester, disposedHarness.transport);
    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-content-field')),
      'disposed search',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    disposedTime.complete(_testTimeContext);
    await tester.pump(const Duration(milliseconds: 50));
    expect(disposedHarness.transport.startCalls, 1);
  });

  testWidgets('current time setup failure is visible and retryable', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();
    var providerCalls = 0;
    Future<CustomerBiteSaverTimeContext> timeProvider() {
      providerCalls += 1;
      return switch (providerCalls) {
        1 => Future<CustomerBiteSaverTimeContext>.value(_testTimeContext),
        2 => Future<CustomerBiteSaverTimeContext>.error(
          Exception('Time context unavailable.'),
        ),
        3 => Future<CustomerBiteSaverTimeContext>.value(_testTimeContext),
        _ => throw StateError('Unexpected time-context request.'),
      };
    }

    await tester.pumpWidget(
      MaterialApp(
        home: harness.screen(
          onAction: _ignoreAction,
          timeContextProvider: timeProvider,
        ),
      ),
    );
    await _pumpBrowseReady(tester, harness.transport);
    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-content-field')),
      'retry time setup',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    expect(find.text('Time context unavailable.'), findsOneWidget);
    expect(harness.transport.startCalls, 1);

    await tester.tap(find.byTooltip('Search restaurants or deals'));
    await _pumpUntil(tester, () => harness.transport.startCalls == 2);
    expect(providerCalls, 3);
    expect(find.text('Time context unavailable.'), findsNothing);
    expect(harness.coordinator.criteria?.searchText, 'retry time setup');
  });

  testWidgets('preparing becomes ready and renders the first 25 in order', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(startsPreparing: true);
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Preparing nearby deals…'), findsOneWidget);
    expect(transport.restaurantPageCalls, 0);

    await _pumpBrowseReady(tester, transport);
    expect(transport.statusCalls, 1);
    expect(harness.coordinator.restaurants, hasLength(25));
    expect(
      harness.coordinator.restaurants.map(
        (restaurant) => restaurant.displayName,
      ),
      <String>[
        'Fixture Café 😀',
        for (var index = 1; index < 25; index += 1)
          'Lazy Fixture Restaurant ${index + 1}',
      ],
    );
  });

  testWidgets('zero-item partial page exposes and advances its cursor', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(zeroPartialFirst: true);
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpUntil(tester, () => transport.restaurantPageCalls == 1);
    expect(find.text('Search is still in progress.'), findsOneWidget);
    expect(find.text('Continue Search'), findsOneWidget);

    await tester.tap(find.text('Continue Search'));
    await _pumpBrowseReady(tester, transport);
    expect(transport.restaurantCursors, <String?>[null, 'bsc1.restaurant-0']);
    expect(find.text('Fixture Café 😀'), findsOneWidget);
  });

  testWidgets('first-page failure retries without starting another search', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(failFirstRestaurantPage: true);
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpUntil(tester, () => transport.restaurantPageCalls == 1);
    expect(find.text('Could not load nearby deals.'), findsOneWidget);
    expect(find.text('Try Again'), findsOneWidget);

    await tester.tap(find.text('Try Again'));
    await _pumpBrowseReady(tester, transport);
    expect(transport.startCalls, 1);
    expect(transport.restaurantPageCalls, 2);
    expect(find.text('Fixture Café 😀'), findsOneWidget);
  });

  testWidgets('append failure preserves 25 cards and retries the same cursor', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(
      restaurantPageCount: 2,
      failAppendRestaurantPage: true,
    );
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpBrowseReady(tester, transport);
    final pager = harness.coordinator.restaurantPager!;
    await pager.loadMore();
    await tester.pump();

    expect(pager.items, hasLength(25));
    expect(pager.error, isA<CustomerBiteSaverServiceException>());
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.ready,
    );

    await pager.retry();
    await tester.pump();
    expect(pager.items, hasLength(50));
    expect(pager.error, isNull);
    expect(transport.startCalls, 1);
    expect(transport.restaurantCursors, <String?>[
      null,
      'bsc1.restaurant-1',
      'bsc1.restaurant-1',
    ]);
  });

  testWidgets('offer failure remains local and retry preserves restaurants', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1050);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(failFirstOfferPage: true);
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpBrowseReady(tester, transport);
    await tester.tap(find.text('More deals'));
    await _pumpUntil(tester, () => transport.offerPageCalls == 1);

    expect(
      find.text('Could not append more deals for this restaurant.'),
      findsOneWidget,
    );
    expect(harness.coordinator.restaurants, hasLength(25));
    expect(transport.restaurantPageCalls, 1);

    await tester.tap(find.text('Retry Deals'));
    await _pumpUntil(tester, () => transport.offerPageCalls == 2);
    expect(find.text('Additional Deal 3'), findsOneWidget);
    expect(harness.coordinator.restaurants, hasLength(25));
    expect(transport.startCalls, 1);
    expect(transport.offerCursors, <String?>[null, null]);
  });

  testWidgets('expired session requires one explicit fresh search', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(
      startsPreparing: true,
      expireFirstPreparation: true,
    );
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpUntil(
      tester,
      () =>
          harness.coordinator.status ==
          CustomerBiteSaverCoordinatorStatus.expired,
    );
    expect(find.text('This search has expired.'), findsOneWidget);
    expect(transport.startCalls, 1);

    await tester.tap(find.text('Fresh Search'));
    await _pumpBrowseReady(tester, transport);
    expect(transport.startCalls, 2);
    expect(transport.freshSearchFlags, <bool>[false, true]);
    expect(transport.restaurantPageCalls, 1);
  });

  testWidgets('repeated paging retains 125 restaurants for lazy reachability', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final transport = _BrowseFixtureTransport(restaurantPageCount: 5);
    final harness = _BrowseHarness(transport: transport);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpBrowseReady(tester, transport);
    expect(find.text('Lazy Fixture Restaurant 125'), findsNothing);

    for (var page = 1; page < 5; page += 1) {
      await harness.coordinator.restaurantPager!.loadMore();
      await tester.pump();
    }
    expect(harness.coordinator.restaurants, hasLength(125));
    expect(harness.coordinator.restaurantPager!.trimmedBeforeCount, 0);
    expect(find.text('Lazy Fixture Restaurant 125'), findsNothing);

    await tester.dragUntilVisible(
      find.text('Lazy Fixture Restaurant 125'),
      find.byType(CustomScrollView),
      const Offset(0, -700),
      maxIteration: 40,
    );
    expect(find.text('Lazy Fixture Restaurant 125'), findsOneWidget);
    expect(transport.restaurantCursors, <String?>[
      null,
      'bsc1.restaurant-1',
      'bsc1.restaurant-2',
      'bsc1.restaurant-3',
      'bsc1.restaurant-4',
    ]);
  });

  testWidgets(
    'signed favorites wait for canonical state and errors do not become success',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1000);
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness(failRestaurantFavoriteWrite: true);

      await tester.pumpWidget(
        MaterialApp(home: harness.screen(onAction: _ignoreAction)),
      );
      await _pumpBrowseReady(tester, harness.transport);
      await _pumpUntil(tester, () => harness.transport.favoriteReadCalls > 0);

      final firstId = CustomerBiteSaverRestaurantId(
        harness.transport.firstRestaurantId,
      );
      expect(
        harness.coordinator.restaurantFavoriteState(firstId),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      await tester.tap(find.byTooltip('Save restaurant').first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));

      expect(harness.restaurantFavoriteWrites, 1);
      expect(
        harness.coordinator.restaurantFavoriteState(firstId),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      expect(find.byTooltip('Save restaurant'), findsWidgets);
      expect(find.byType(SnackBar), findsOneWidget);
      expect(harness.transport.startCalls, 1);
      expect(harness.transport.restaurantPageCalls, 1);
    },
  );

  testWidgets('guest browse does not read or expose favorite actions', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness(signed: false);

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpBrowseReady(tester, harness.transport);

    expect(harness.transport.favoriteReadCalls, 0);
    expect(find.byTooltip('Save restaurant'), findsNothing);
    expect(find.byTooltip('Unsave restaurant'), findsNothing);
    expect(find.byTooltip('Save deal'), findsNothing);
  });

  testWidgets('invalid content input is not truncated or sent', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 1000);
    addTearDown(tester.view.reset);
    final harness = _BrowseHarness();

    await tester.pumpWidget(
      MaterialApp(home: harness.screen(onAction: _ignoreAction)),
    );
    await _pumpBrowseReady(tester, harness.transport);
    final oversized = List<String>.filled(201, '😀').join();
    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-content-field')),
      oversized,
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();

    expect(harness.transport.startCalls, 1);
    expect(
      find.text('Search must be at most 200 characters and 800 UTF-8 bytes.'),
      findsOneWidget,
    );
    final field = tester.widget<TextField>(
      find.byKey(const ValueKey<String>('bounded-content-field')),
    );
    expect(field.controller!.text.runes.length, 201);
  });

  for (final layout in <({Size size, double textScale, String name})>[
    (size: const Size(320, 640), textScale: 1.5, name: 'narrow portrait'),
    (size: const Size(760, 360), textScale: 1.2, name: 'narrow landscape'),
    (size: const Size(1200, 900), textScale: 1, name: 'desktop'),
  ]) {
    testWidgets('${layout.name} keeps browse controls reachable', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = layout.size;
      addTearDown(tester.view.reset);
      final harness = _BrowseHarness();
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(layout.textScale)),
            child: child!,
          ),
          home: harness.screen(onAction: _ignoreAction),
        ),
      );
      await _pumpBrowseReady(tester, harness.transport);

      expect(find.text('Use My Current Location'), findsOneWidget);
      expect(find.text('City or zip code'), findsOneWidget);
      expect(find.text('Search restaurants or deals'), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('bounded-radius-field')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });
  }
}

Future<CustomerBiteSaverBrowseActionResult> _ignoreAction(
  BuildContext context,
  CustomerBiteSaverBrowseSelection selection,
) async => const CustomerBiteSaverBrowseActionResult();

Widget _productionBrowseApp(
  _BrowseHarness harness,
  CustomerBiteSaverBrowseDestinationHandler handler,
) => MaterialApp(
  navigatorKey: rootNavigatorKey,
  home: MainNavigationScreen(
    initializePlatformServices: false,
    biteSaverBrowseHomeBuilder:
        (context, navigationRefreshGeneration, authRealm) => harness.screen(
          navigationRefreshGeneration: navigationRefreshGeneration,
          onAction: handler.call,
        ),
    testPagesBuilder: (mode) => const <Widget>[
      SizedBox.shrink(),
      SizedBox.shrink(),
      SizedBox.shrink(),
    ],
  ),
);

CustomerBiteSaverRestaurantId _restaurantId(
  _BrowseFixtureTransport transport,
) => CustomerBiteSaverRestaurantId(transport.firstRestaurantId);

Future<void> _pumpBrowseReady(
  WidgetTester tester,
  _BrowseFixtureTransport transport,
) => _pumpUntil(
  tester,
  () =>
      transport.restaurantPageCalls > 0 &&
      find.text('Fixture Café 😀').evaluate().isNotEmpty,
);

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition) async {
  for (var attempt = 0; attempt < 80; attempt += 1) {
    await tester.pump(const Duration(milliseconds: 10));
    if (condition()) return;
  }
  fail('Timed out waiting for the bounded browse fixture.');
}

String _richTextAtKey(WidgetTester tester, Key key) => tester
    .widget<RichText>(
      find.descendant(
        of: find.byKey(key, skipOffstage: false),
        matching: find.byType(RichText, skipOffstage: false),
      ),
    )
    .text
    .toPlainText();

Position _position() => Position(
  longitude: -81.3792,
  latitude: 28.5383,
  timestamp: DateTime.utc(2026, 9, 12, 16),
  accuracy: 1,
  altitude: 0,
  altitudeAccuracy: 1,
  heading: 0,
  headingAccuracy: 1,
  speed: 0,
  speedAccuracy: 1,
  isMocked: false,
);

const CustomerBiteSaverTimeContext _testTimeContext =
    CustomerBiteSaverTimeContext(
      timeZone: 'America/New_York',
      utcOffsetMinutes: -240,
    );

final class _BrowseHarness {
  _BrowseHarness({
    this.signed = true,
    this.failRestaurantFavoriteWrite = false,
    _BrowseFixtureTransport? transport,
    DateTime Function()? clock,
  }) {
    final selectedTransport = transport ?? _BrowseFixtureTransport();
    this.transport = selectedTransport;
    final selectedClock =
        clock ??
        () => DateTime.fromMillisecondsSinceEpoch(
          selectedTransport.evaluationAtMillis,
          isUtc: true,
        );
    var requestSequence = 0;
    coordinator = CustomerBiteSaverSearchCoordinator(
      api: CustomerBiteSaverService(transport: selectedTransport.call),
      guestUsageStore: CustomerBiteSaverGuestUsageStore(
        guestDeviceId: 'bounded-browse-test-device',
        preferences: _MemoryGuestPreferences(),
        clock: selectedClock,
      ),
      clientInstanceId: 'bounded-browse-client-0001',
      initialAuth: signed
          ? const CustomerBiteSaverAuthSnapshot.signed('signed-a')
          : const CustomerBiteSaverAuthSnapshot.signedOut(),
      favoriteActions: CustomerBiteSaverFavoriteActions(
        upsertRestaurant: (_) async {
          restaurantFavoriteWrites += 1;
          if (failRestaurantFavoriteWrite) {
            throw StateError('synthetic favorite write failure');
          }
        },
        removeRestaurant: (_) async => restaurantFavoriteWrites += 1,
        upsertCoupon: (_) async => offerFavoriteWrites += 1,
        removeCoupon: (_) async => offerFavoriteWrites += 1,
      ),
      requestIdGenerator: () =>
          'bounded-request-${(++requestSequence).toString().padLeft(6, '0')}',
      clock: selectedClock,
    );
  }

  final bool signed;
  final bool failRestaurantFavoriteWrite;
  late final _BrowseFixtureTransport transport;
  late final CustomerBiteSaverSearchCoordinator coordinator;
  int restaurantFavoriteWrites = 0;
  int offerFavoriteWrites = 0;

  CustomerBiteSaverBrowseScreen screen({
    required CustomerBiteSaverBrowseActionHandler onAction,
    int navigationRefreshGeneration = 0,
    CustomerBiteSaverTimeContextProvider? timeContextProvider,
    SharedLocationState? restoredLocation,
  }) => CustomerBiteSaverBrowseScreen(
    coordinator: coordinator,
    timeContextProvider: timeContextProvider ?? () async => _testTimeContext,
    onAction: onAction,
    locationRestoreLoader: () async => SharedLocationRestoreResult(
      state:
          restoredLocation ??
          SharedLocationState(
            usingCurrentLocation: true,
            currentPosition: _position(),
            detectedCity: 'Orlando',
            detectedZip: '32801',
          ),
    ),
    navigationRefreshGeneration: navigationRefreshGeneration,
  );
}

final class _BrowseFixtureTransport {
  _BrowseFixtureTransport({
    this.startsPreparing = false,
    this.expireFirstPreparation = false,
    this.zeroPartialFirst = false,
    this.failFirstRestaurantPage = false,
    this.failAppendRestaurantPage = false,
    this.failFirstOfferPage = false,
    this.repeatPreviewOnSecondOfferPage = false,
    this.nonProgressSecondOfferPage = false,
    this.firstOfferIsDailySpecial = false,
    this.firstOfferOverrides = const <String, Object?>{},
    this.restaurantPageCount = 1,
  }) : fixture = _map(
         jsonDecode(
           File(
             'test/fixtures/customer_bitesaver_client_boundary_v1.json',
           ).readAsStringSync(),
         ),
       );

  final Map<String, Object?> fixture;
  final bool startsPreparing;
  final bool expireFirstPreparation;
  final bool zeroPartialFirst;
  final bool failFirstRestaurantPage;
  final bool failAppendRestaurantPage;
  final bool failFirstOfferPage;
  final bool repeatPreviewOnSecondOfferPage;
  final bool nonProgressSecondOfferPage;
  final bool firstOfferIsDailySpecial;
  final Map<String, Object?> firstOfferOverrides;
  final int restaurantPageCount;
  final List<bool> freshSearchFlags = <bool>[];
  final List<Map<String, Object?>> startRequests = <Map<String, Object?>>[];
  final List<String?> restaurantCursors = <String?>[];
  final List<String?> offerCursors = <String?>[];
  int startCalls = 0;
  int statusCalls = 0;
  int restaurantPageCalls = 0;
  int offerPageCalls = 0;
  int favoriteReadCalls = 0;
  int redemptionCalls = 0;

  Map<String, Object?> get _responses =>
      _map(_map(fixture['signed'])['responses']);

  String get firstRestaurantId =>
      _map(
            (_map(_responses['restaurantPage'])['restaurants']! as List).first,
          )['restaurantId']!
          as String;

  String get firstOfferId =>
      _map(
            (_map(
                      (_map(_responses['restaurantPage'])['restaurants']!
                              as List)
                          .first,
                    )['offers']!
                    as List)
                .first,
          )['offerId']!
          as String;

  String get currentFirstOfferOccurrence =>
      _map(
            (_map(_responses['offerPage'])['offers']! as List).first,
          )['offerOccurrence']!
          as String;

  String get repeatedFirstOfferOccurrence => 'bsoc1.${'E' * 80}';

  String get thirdOfferId => _opaqueId('bso_', 3);

  int get evaluationAtMillis =>
      _map(
            _map(_responses['restaurantPage'])['evaluationContext'],
          )['evaluationAtMillis']!
          as int;

  int get logicalExpiresAtMillis =>
      _map(_responses['start'])['logicalExpiresAtMillis']! as int;

  Future<Object?> call(
    String callableName,
    Map<String, Object?> request,
  ) async {
    switch (callableName) {
      case CustomerBiteSaverService.startCallableName:
        startCalls += 1;
        startRequests.add(_copyMap(request));
        freshSearchFlags.add(request['freshSearch']! as bool);
        final response = _copyMap(_responses['start']);
        if (!startsPreparing || startCalls > 1) response['state'] = 'ready';
        return response;
      case CustomerBiteSaverService.statusCallableName:
        statusCalls += 1;
        return _copyMap(
          _map(_responses['status'])[expireFirstPreparation
              ? 'expired'
              : 'ready'],
        );
      case CustomerBiteSaverService.restaurantPageCallableName:
        restaurantPageCalls += 1;
        final cursor = request['cursor'] as String?;
        restaurantCursors.add(cursor);
        if (failFirstRestaurantPage && restaurantPageCalls == 1) {
          throw StateError('synthetic first-page transport failure');
        }
        if (failAppendRestaurantPage && restaurantPageCalls == 2) {
          throw StateError('synthetic append transport failure');
        }
        final page = _restaurantPage(cursor);
        return request['guestStateRevision'] == null
            ? page
            : _guestRestaurantPage(page);
      case CustomerBiteSaverService.offerPageCallableName:
        offerPageCalls += 1;
        final cursor = request['cursor'] as String?;
        offerCursors.add(cursor);
        if (failFirstOfferPage && offerPageCalls == 1) {
          throw StateError('synthetic offer transport failure');
        }
        return _offerPage(request['restaurantId']! as String, cursor);
      case CustomerBiteSaverService.favoriteStatesCallableName:
        favoriteReadCalls += 1;
        return <String, Object?>{
          'schemaVersion': 1,
          'states': <Map<String, Object?>>[
            for (final id in <Object?>[
              ...(request['restaurantIds']! as List),
              ...(request['offerIds']! as List),
            ])
              <String, Object?>{'id': id, 'state': 'notFavorite'},
          ],
        };
      case CustomerBiteSaverService.guestContinuationCallableName:
        throw StateError('Signed browse must not request guest continuation.');
      case CustomerBiteSaverService.redemptionValidationCallableName:
      case CustomerBiteSaverService.redemptionStartCallableName:
        redemptionCalls += 1;
        throw StateError('Browse presentation must not start redemption.');
    }
    throw StateError('Unexpected callable $callableName');
  }

  Map<String, Object?> _restaurantPage(String? cursor) {
    final page = _copyMap(_responses['restaurantPage']);
    if (zeroPartialFirst && cursor == null) {
      page['restaurants'] = const <Object?>[];
      page['nextCursor'] = 'bsc1.restaurant-0';
      page['hasMore'] = true;
      page['partial'] = true;
      return page;
    }
    final pageIndex = cursor == null
        ? 0
        : int.parse(cursor.substring('bsc1.restaurant-'.length));
    final fixtureRestaurant = _map((page['restaurants']! as List).first);
    page['restaurants'] = <Map<String, Object?>>[
      for (var offset = 0; offset < 25; offset += 1)
        _restaurant(fixtureRestaurant, pageIndex * 25 + offset),
    ];
    final hasMore = pageIndex + 1 < restaurantPageCount;
    page['nextCursor'] = hasMore ? 'bsc1.restaurant-${pageIndex + 1}' : null;
    page['hasMore'] = hasMore;
    page['partial'] = false;
    return page;
  }

  Map<String, Object?> _guestRestaurantPage(Map<String, Object?> directPage) {
    final guestResponses = _map(_map(fixture['guest'])['responses']);
    final response = _copyMap(guestResponses['restaurantComplete']);
    final result = _copyMap(directPage)..remove('evaluationContext');
    response['guestStateRevision'] = 0;
    response['result'] = result;
    response['evaluationContext'] = directPage['evaluationContext'];
    return response;
  }

  Map<String, Object?> _restaurant(
    Map<String, Object?> fixtureRestaurant,
    int index,
  ) {
    final restaurant = _copyMap(fixtureRestaurant);
    restaurant['restaurantId'] = index == 0
        ? firstRestaurantId
        : _opaqueId('bsr_', index);
    restaurant['displayName'] = index == 0
        ? 'Fixture Café 😀'
        : 'Lazy Fixture Restaurant ${index + 1}';
    restaurant['catalogBindingAvailable'] = index == 0;
    if (index == 0) {
      if (firstOfferIsDailySpecial || firstOfferOverrides.isNotEmpty) {
        final offers = (restaurant['offers']! as List)
            .map(_copyMap)
            .toList(growable: false);
        if (firstOfferIsDailySpecial) {
          offers[0]
            ..['offerType'] = 'dailySpecial'
            ..['title'] = 'Fixture Daily Special'
            ..['usageRule'] = null
            ..['usagePolicy'] = null
            ..['availabilityMode'] = 'todayOnly'
            ..['allDay'] = true
            ..['redemptionPolicyLabel'] = null;
        }
        offers[0].addAll(firstOfferOverrides);
        restaurant['offers'] = offers;
      }
      restaurant['hasMoreOffers'] = true;
      restaurant['usableOfferCount'] = null;
      restaurant['offerCountState'] = 'unknown';
    } else {
      restaurant['offers'] = const <Object?>[];
      restaurant['hasMoreOffers'] = false;
      restaurant['usableOfferCount'] = 0;
      restaurant['offerCountState'] = 'current';
    }
    return restaurant;
  }

  Map<String, Object?> _offerPage(String restaurantId, String? cursor) {
    final page = _copyMap(_responses['offerPage']);
    page['restaurantId'] = restaurantId;
    if (cursor == null) {
      final offers = (page['offers']! as List)
          .map(_copyMap)
          .toList(growable: true);
      final third = _copyMap(offers.first)
        ..['offerId'] = _opaqueId('bso_', 3)
        ..['offerOccurrence'] = 'bsoc1.${'C' * 80}'
        ..['title'] = 'Additional Deal 3';
      offers.add(third);
      page['offers'] = offers;
      page['nextCursor'] = 'bsc1.offer-next';
      page['hasMore'] = true;
    } else {
      final repeatedPreview = _copyMap((page['offers']! as List).first)
        ..['offerOccurrence'] = repeatedFirstOfferOccurrence;
      final fourth = _copyMap((page['offers']! as List).first)
        ..['offerId'] = _opaqueId('bso_', 4)
        ..['offerOccurrence'] = 'bsoc1.${'D' * 80}'
        ..['title'] = 'Additional Deal 4';
      page['offers'] = <Map<String, Object?>>[
        if (repeatPreviewOnSecondOfferPage) repeatedPreview,
        fourth,
      ];
      page['nextCursor'] = nonProgressSecondOfferPage ? cursor : null;
      page['hasMore'] = nonProgressSecondOfferPage;
    }
    page['partial'] = false;
    return page;
  }

  String _opaqueId(String prefix, int value) {
    final suffix = value.toRadixString(36);
    return '$prefix${'A' * (43 - suffix.length)}$suffix';
  }
}

final class _MemoryGuestPreferences
    implements CustomerBiteSaverGuestUsagePreferences {
  final Map<String, String> values = <String, String>{};

  @override
  Future<String?> getString(String key) async => values[key];

  @override
  Future<void> remove(String key) async => values.remove(key);

  @override
  Future<void> setString(String key, String value) async {
    values[key] = value;
  }
}

Map<String, Object?> _map(Object? value) =>
    (value! as Map).cast<String, Object?>();

Map<String, Object?> _copyMap(Object? value) =>
    _map(jsonDecode(jsonEncode(value)));
