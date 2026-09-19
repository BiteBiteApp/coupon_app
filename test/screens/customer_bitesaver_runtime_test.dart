import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/main.dart';
import 'package:coupon_app/models/customer_bitesaver_saved.dart';
import 'package:coupon_app/services/customer_bitesaver_device_use_service.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:geocoding/geocoding.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/customer_bitesaver_browse_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/services.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import '../services/customer_bitescore_search_service_test.dart'
    as score_fixtures;
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_customer_deep_link_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitesaver_favorite_service.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_runtime.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/customer_bitesaver_device_use_fixture.dart';

const _now = 1789225200000;
Map<String, dynamic> _copy(Object? value) =>
    jsonDecode(jsonEncode(value)) as Map<String, dynamic>;

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SharedPreferences.getInstance();
    SharedLocationStateService.resetForTesting();
    CustomerBiteSaverRuntime.testEnabled = null;
    CustomerBiteSaverRuntime.testComposition = null;
    mainNavigationController.resetBiteSaverCustomerPathForTesting();
    await DemoRedemptionStore.resetForTesting();
    AppModeStateService.setMode(AppMode.biteSaver);
  });
  tearDown(() async {
    CustomerBiteSaverRuntime.testEnabled = null;
    CustomerBiteSaverRuntime.testComposition = null;
    mainNavigationController.resetBiteSaverCustomerPathForTesting();
    SharedLocationStateService.resetForTesting();
    await DemoRedemptionStore.resetForTesting();
  });

  testWidgets('actual CouponApp factory stays default off', (tester) async {
    expect(CustomerBiteSaverRuntime.isEnabled, isFalse);
    late BuildContext context;
    await tester.pumpWidget(
      Builder(
        builder: (value) {
          context = value;
          return const SizedBox.shrink();
        },
      ),
    );
    final app = const CouponApp().build(context) as MaterialApp;
    final route = app.onGenerateInitialRoutes!('/').single as MaterialPageRoute;
    final shell = route.builder(context) as MainNavigationScreen;
    expect(shell.biteSaverBrowseHomeBuilder, isNull);
    expect(shell.biteSaverSavedAccountBuilder, isNull);
    expect(DemoRedemptionStore.legacyWritesEnabled, isTrue);
  });

  testWidgets(
    'actual selected startup retains pair through shell and owner return',
    (tester) async {
      final harness = _Harness(signed: false);
      addTearDown(harness.dispose);
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      await tester.pumpWidget(
        const CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
        ),
      );
      await tester.pumpAndSettle();
      var screen = tester.widget<CustomerBiteSaverBrowseScreen>(
        find.byType(CustomerBiteSaverBrowseScreen),
      );
      expect(screen.coordinator, same(harness.composition.browse));
      expect(screen.disposeCoordinator, isFalse);
      expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
      final shell = tester.widget<MainNavigationScreen>(
        find.byType(MainNavigationScreen),
      );
      expect(shell.biteSaverBrowseHomeBuilder, isNotNull);
      expect(shell.biteSaverSavedAccountBuilder, isNotNull);
      expect(harness.device.stages, isEmpty);

      // Reconstructed/owner return shells omit the pair and inherit its owner.
      unawaited(
        rootNavigatorKey.currentState!.pushAndRemoveUntil<void>(
          MaterialPageRoute(
            builder: (_) => const MainNavigationScreen(
              initializePlatformServices: false,
              initialIndex: 2,
            ),
          ),
          (_) => false,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(CustomerAccountScreen), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Sign In'), findsWidgets);
      expect(harness.composition.browse.isDisposed, isFalse);
      final context = tester.element(find.byType(CustomerAccountScreen));
      openMainNavigationDestination(context, mode: AppMode.biteSaver, index: 0);
      await tester.pumpAndSettle();
      screen = tester.widget<CustomerBiteSaverBrowseScreen>(
        find.byType(CustomerBiteSaverBrowseScreen),
      );
      expect(screen.coordinator, same(harness.composition.browse));
      expect(harness.composition.browse.isDisposed, isFalse);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'production Browse submits OS context and committed use survives removal',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final harness = _Harness();
      addTearDown(harness.dispose);
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      SharedLocationStateService.saveTypedLocation(
        latitude: 28.5383,
        longitude: -81.3792,
        label: 'Orlando, FL',
        searchText: 'Orlando, FL',
      );
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          home: MainNavigationScreen(
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'signed:owner-a',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Fixture Café 😀'),
        findsOneWidget,
        reason:
            'state=${harness.composition.browse.status}, error=${harness.composition.browse.error}, calls=${harness.calls}',
      );
      expect(harness.starts.single['timeZone'], 'America/New_York');
      expect(harness.starts.single['utcOffsetMinutes'], -240);
      expect(harness.device.timeContextReads, 1);
      expect(harness.device.stages, isEmpty);
      expect(
        harness.composition.browse.favoriteStateOwner,
        same(harness.composition.saved),
      );
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      final pending = Completer<void>();
      harness.device.beforeStage = (stage) async {
        if (stage == 'use') await pending.future;
      };
      await tester.tap(find.text('Use Coupon'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey<String>('bitesaver_use_confirm')),
      );
      for (var i = 0; i < 30 && harness.device.submissions.isEmpty; i++) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(harness.device.submissions, hasLength(1));
      final use = harness.device.submissions.single['request']! as Map;
      expect(use['timeZone'], 'America/New_York');
      expect(use['utcOffsetMinutes'], -240);
      expect((use['origin']! as Map)['kind'], 'discovery');
      await tester.pumpWidget(const SizedBox.shrink());
      expect(harness.composition.browse.isDisposed, isFalse);
      // Reconstruct the whole shell while the final request is pending.
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          home: MainNavigationScreen(
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'signed:owner-a',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(harness.starts, hasLength(1));
      expect(harness.device.timeContextReads, 1);
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use Coupon'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey<String>('bitesaver_use_confirm')),
      );
      await tester.pump();
      expect(harness.device.submissions, hasLength(1));
      pending.complete();
      await tester.pump();
      await tester.pump();
      final offer = harness.composition.browse.restaurants.first.offers.first;
      final timer = harness.composition.browse.redemptionPresentationFor(
        offer.offerId,
      )!;
      expect(timer.timerStartedAtMillis, _now);
      expect(timer.timerExpiresAtMillis, _now + 300000);
      await tester.pumpAndSettle();
      expect(find.text('Redeem Timer Active'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      harness.user = null;
      harness.changes.add(null);
      await tester.pump();
      final priorStages = List<String>.of(harness.device.stages);
      tester.binding.platformDispatcher.defaultRouteNameTestValue =
          '/r/coupons/permanent-catalog-id';
      addTearDown(
        tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
      );
      await tester.pumpWidget(
        const CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Fixture Coupon 1'));
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      expect(find.text('Redeem Timer Active'), findsOneWidget);
      expect(harness.device.stages, priorStages);
      expect(
        harness.composition.browse
            .redemptionPresentationFor(offer.offerId)!
            .timerExpiresAtMillis,
        timer.timerExpiresAtMillis,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      harness.dispose();
      expect(harness.device.submissions, hasLength(1));
      expect(
        harness.calls.where((name) => name.contains('Redemption')),
        isEmpty,
      );
    },
  );

  testWidgets(
    'Saved factory shares favorites and fresh OS context with auth fencing',
    (tester) async {
      final harness = _Harness();
      addTearDown(harness.dispose);
      late BuildContext context;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (value) {
              context = value;
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      final account =
          harness.composition.buildAccount(context, 'signed:owner-a')
              as CustomerAccountScreen;
      final profile =
          account.profileDestinationBuilder!(context, harness.user!)
              as CustomerProfileScreen;
      final saved = harness.composition.saved!;
      expect(profile.boundedSavedCoordinator, same(saved));
      expect(saved.canUseCoupons, isTrue);
      expect(harness.composition.browse.favoriteStateOwner, same(saved));
      harness.device.timeZone = 'Asia/Kathmandu';
      harness.device.utcOffsetMinutes = 345;
      await saved.ensureLoaded(CustomerBiteSaverSavedSection.coupons);
      final entry = saved.entries(CustomerBiteSaverSavedSection.coupons).single;
      final access = saved.captureAccess(entry);
      final result = await saved.useCoupon(access);
      expect(result.timerStartedAtMillis, _now);
      final request = harness.device.submissions.single['request']! as Map;
      expect(request['timeZone'], 'Asia/Kathmandu');
      expect(request['utcOffsetMinutes'], 345);
      expect((request['origin']! as Map)['kind'], 'saved');
      harness.changes.add(harness.user);
      await tester.pump();
      expect(harness.composition.saved, same(saved));
      expect(access.isCurrent, isTrue);
      harness.user = null;
      harness.changes.add(null);
      await tester.pump();
      expect(saved.isDisposed, isTrue);
      expect(access.isCurrent, isFalse);
      harness.user = _User('owner-a');
      harness.changes.add(harness.user);
      await tester.pump();
      expect(harness.composition.saved, isNot(same(saved)));
      expect(access.isCurrent, isFalse);
      expect(
        harness.composition.saved!.redemptionPresentationFor(entry.offerId!),
        same(result),
      );
      expect(
        harness.composition.browse.redemptionPresentationFor(entry.offerId!),
        same(result),
      );
      expect(harness.device.submissions, hasLength(1));
      expect(
        harness.composition.browse.favoriteStateOwner,
        same(harness.composition.saved),
      );
      expect(
        harness.calls.where((name) => name.contains('Redemption')),
        isEmpty,
      );
    },
  );

  testWidgets('borrowed Browse accepts a new typed center after remount', (
    tester,
  ) async {
    final harness = _Harness();
    addTearDown(harness.dispose);
    await harness.composition.browse.startSearch(
      CustomerBiteSaverSearchCriteria(
        latitude: 28.5383,
        longitude: -81.3792,
        radiusMiles: 15,
        locationMode: CustomerBiteSaverLocationMode.typed,
        typedLocation: CustomerBiteSaverCityLocation(
          city: 'Orlando',
          state: 'FL',
        ),
        searchText: '',
        timeZone: 'America/New_York',
        utcOffsetMinutes: -240,
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: CustomerBiteSaverBrowseScreen(
          coordinator: harness.composition.browse,
          disposeCoordinator: false,
          timeContextProvider: () async => const CustomerBiteSaverTimeContext(
            timeZone: 'America/New_York',
            utcOffsetMinutes: -240,
          ),
          onAction: (_, _) async => const CustomerBiteSaverBrowseActionResult(),
          locationGeocoder: (_) async => [
            Location(
              latitude: 42.3601,
              longitude: -71.0589,
              timestamp: DateTime.fromMillisecondsSinceEpoch(_now),
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(harness.starts, hasLength(1));
    await tester.enterText(
      find.byKey(const ValueKey<String>('bounded-location-field')),
      'Boston, MA',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    for (var i = 0; i < 40 && harness.starts.length < 2; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(
      harness.starts,
      hasLength(2),
      reason:
          'state=${harness.composition.browse.status}, location=${SharedLocationStateService.state.searchText}, error=${harness.composition.browse.error}',
    );
    expect(harness.starts.last['latitude'], 42.3601);
    expect(harness.starts.last['longitude'], -71.0589);
    expect(harness.starts.last['typedLocation'], {
      'kind': 'city',
      'city': 'boston',
      'state': 'MA',
    });
    await tester.pumpWidget(const SizedBox.shrink());
    harness.dispose();
  });

  for (final mode in AppMode.values) {
    testWidgets('${mode.name} late Account gets initial signed auth content', (
      tester,
    ) async {
      final harness = _Harness();
      addTearDown(harness.dispose);
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(); // Runtime has consumed its stream's initial event.
      await tester.pumpWidget(
        MaterialApp(
          home: MainNavigationScreen(
            initialMode: mode,
            initialIndex: 2,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'signed:owner-a',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('My Profile'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(
        tester
            .widget<CustomerAccountScreen>(find.byType(CustomerAccountScreen))
            .profileDestinationBuilder,
        isNotNull,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  test(
    'queued A to guest to A never resurrects prior Saved authority',
    () async {
      final harness = _Harness();
      addTearDown(harness.dispose);
      await Future<void>.delayed(Duration.zero);
      final previous = harness.composition.saved!;
      await previous.ensureLoaded(CustomerBiteSaverSavedSection.coupons);
      final access = previous.captureAccess(
        previous.entries(CustomerBiteSaverSavedSection.coupons).single,
      );
      harness.changes.add(null);
      harness.changes.add(harness.user);
      await Future<void>.delayed(Duration.zero);
      expect(harness.composition.saved, isNot(same(previous)));
      expect(previous.isDisposed, isTrue);
      expect(access.isCurrent, isFalse);
    },
  );

  for (final kind in ['expired', 'unlimited', 'legacy']) {
    test('auth carryover excludes $kind presentations', () async {
      final harness = _Harness();
      addTearDown(harness.dispose);
      await Future<void>.delayed(Duration.zero);
      final previous = harness.composition.saved!;
      await previous.ensureLoaded(CustomerBiteSaverSavedSection.coupons);
      final entry = previous
          .entries(CustomerBiteSaverSavedSection.coupons)
          .single;
      previous.recordRedemptionPresentation(
        CustomerBiteSaverRedemptionPresentation(
          restaurantId: entry.restaurantId!,
          offerId: entry.offerId!,
          offerOccurrence: entry.offer!.offerOccurrence,
          status: kind == 'unlimited'
              ? CustomerBiteSaverRedemptionPresentationStatus.unlimited
              : CustomerBiteSaverRedemptionPresentationStatus.started,
          usagePolicy: entry.offer!.usagePolicy!,
          timerStartedAtMillis: _now - 300000,
          timerExpiresAtMillis: kind == 'expired' ? _now : _now + 300000,
          isDeviceAuthoritative: kind != 'legacy',
        ),
        expectedAuthRealmKey: 'signed:owner-a',
      );
      harness.changes.add(null);
      harness.changes.add(harness.user);
      await Future<void>.delayed(Duration.zero);
      expect(
        harness.composition.browse.redemptionPresentationFor(entry.offerId!),
        isNull,
      );
      expect(
        harness.composition.saved!.redemptionPresentationFor(entry.offerId!),
        isNull,
      );
    });
  }

  test(
    'selected Saved proof rejection creates no timer or legacy fallback',
    () async {
      final harness = _Harness();
      addTearDown(harness.dispose);
      harness.device.status = 'denied';
      final saved = harness.composition.saved!;
      await saved.ensureLoaded(CustomerBiteSaverSavedSection.coupons);
      final entry = saved.entries(CustomerBiteSaverSavedSection.coupons).single;
      await expectLater(
        saved.useCoupon(saved.captureAccess(entry)),
        throwsA(isA<CustomerBiteSaverRedemptionDeniedException>()),
      );
      expect(saved.redemptionPresentationFor(entry.offerId!), isNull);
      expect(harness.device.submissions, hasLength(1));
      expect(
        harness.calls.where((name) => name.contains('Redemption')),
        isEmpty,
      );
    },
  );

  for (final cold in [true, false]) {
    testWidgets(
      '${cold ? 'cold' : 'warm'} production QR opens existing public profile without use',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final harness = _Harness(signed: false);
        addTearDown(harness.dispose);
        CustomerBiteSaverRuntime.testEnabled = true;
        CustomerBiteSaverRuntime.testComposition = harness.composition;
        if (cold) {
          tester.binding.platformDispatcher.defaultRouteNameTestValue =
              '/r/coupons/permanent-catalog-id';
          addTearDown(
            tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
          );
        }
        await tester.pumpWidget(
          const CouponApp(
            testWrapCelebrationHosts: false,
            testInitializePlatformServices: false,
          ),
        );
        await tester.pumpAndSettle();
        if (!cold) {
          unawaited(
            rootNavigatorKey.currentState!.pushNamed(
              '/r/coupons/permanent-catalog-id',
            ),
          );
          await tester.pumpAndSettle();
        }
        final profile = tester.widget<RestaurantProfileScreen>(
          find.byType(RestaurantProfileScreen),
        );
        expect(
          profile.publicProfile?.catalogRestaurantId,
          'permanent-catalog-id',
        );
        expect(profile.boundedRestaurant?.displayName, 'Fixture Café 😀');
        expect(find.text('0 miles'), findsNothing);
        expect(find.text('Fixture Daily Special'), findsOneWidget);
        await tester.tap(find.text('Restaurant Information'));
        await tester.pumpAndSettle();
        expect(find.text('Synthetic public fixture'), findsOneWidget);
        await tester.ensureVisible(find.text('Menu'));
        await tester.tap(find.text('Menu'));
        await tester.pumpAndSettle();
        expect(find.byType(RestaurantMenuScreen), findsOneWidget);
        expect(harness.device.stages, isEmpty);
        rootNavigatorKey.currentState!.pop();
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Fixture Coupon 1'));
        await tester.tap(find.text('Fixture Coupon 1'));
        await tester.pumpAndSettle();
        expect(find.byType(CouponDetailScreen), findsOneWidget);
        expect(find.text('Use Coupon'), findsOneWidget);
        expect(harness.device.stages, isEmpty);
        rootNavigatorKey.currentState!.pop();
        await tester.pumpAndSettle();
        expect(find.byType(RestaurantCustomerDeepLinkScreen), findsOneWidget);
        expect(harness.device.stages, isEmpty);
        expect(
          harness.calls,
          everyElement(CustomerBiteSaverService.restaurantPageCallableName),
        );
        expect(harness.starts, isEmpty);
        expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
  testWidgets(
    'signed public profile resolves canonical Save state without use',
    (tester) async {
      final harness = _Harness();
      addTearDown(harness.dispose);
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      tester.binding.platformDispatcher.defaultRouteNameTestValue =
          '/r/coupons/permanent-catalog-id';
      addTearDown(
        tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
      );
      await tester.pumpWidget(
        const CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
        ),
      );
      await tester.pumpAndSettle();
      final profile = tester.widget<RestaurantProfileScreen>(
        find.byType(RestaurantProfileScreen),
      );
      expect(
        harness.composition.saved!.restaurantFavoriteState(
          profile.boundedRestaurant!.restaurantId,
        ),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      final heart = find.ancestor(
        of: find.byIcon(Icons.favorite_border),
        matching: find.byType(IconButton),
      );
      expect(tester.widget<IconButton>(heart).onPressed, isNotNull);
      expect(harness.device.stages, isEmpty);
      expect(harness.starts, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'same SA URL before and after participation opens real profile and pages offers',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final harness = _Harness(signed: false)
        ..profileState = 'notParticipating';
      addTearDown(harness.dispose);
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      await tester.pumpWidget(
        const CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
        ),
      );
      await tester.pumpAndSettle();
      const route = '/r/coupons/permanent-catalog-id';
      unawaited(rootNavigatorKey.currentState!.pushNamed(route));
      await tester.pumpAndSettle();
      expect(
        find.text('This restaurant is not currently available in BiteSaver.'),
        findsOneWidget,
      );
      expect(find.byType(RestaurantProfileScreen), findsNothing);
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      harness.profileState = 'available';
      harness.profileHasMore = true;
      unawaited(rootNavigatorKey.currentState!.pushNamed(route));
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantProfileScreen), findsOneWidget);
      await tester.ensureVisible(find.text('More offers'));
      await tester.tap(find.text('More offers'));
      await tester.pumpAndSettle();
      expect(find.text('Continued public coupon'), findsOneWidget);
      expect(find.text('More offers'), findsNothing);
      await tester.ensureVisible(find.text('Fixture Coupon 1'));
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<CouponDetailScreen>(find.byType(CouponDetailScreen))
            .boundedSavedCoordinator,
        isNull,
      );
      final readsBeforeSignIn = harness.calls.length;
      harness.profileFavoriteState = 'favorite';
      harness.user = _User('new-owner');
      harness.changes.add(harness.user);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<CouponDetailScreen>(find.byType(CouponDetailScreen))
            .boundedSavedCoordinator,
        same(harness.composition.saved),
      );
      final detail = tester.widget<CouponDetailScreen>(
        find.byType(CouponDetailScreen),
      );
      expect(harness.calls.length, greaterThan(readsBeforeSignIn));
      expect(detail.publicProfile!.contains(detail.boundedOffer!), isTrue);
      expect(
        harness.composition.saved!.offerFavoriteState(
          detail.boundedOffer!.offerId,
        ),
        CustomerBiteSaverFavoriteState.favorite,
      );
      harness.profileFavoriteState = 'notFavorite';
      harness.user = _User('other-owner');
      harness.changes.add(harness.user);
      await tester.pumpAndSettle();
      expect(
        harness.composition.saved!.offerFavoriteState(
          detail.boundedOffer!.offerId,
        ),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Continued public coupon'));
      await tester.tap(find.text('Continued public coupon'));
      await tester.pumpAndSettle();
      final continuedDetail = tester.widget<CouponDetailScreen>(
        find.byType(CouponDetailScreen),
      );
      expect(continuedDetail.boundedOffer!.title, 'Continued public coupon');
      expect(
        harness.composition.saved!.offerFavoriteState(
          continuedDetail.boundedOffer!.offerId,
        ),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      harness.user = null;
      harness.changes.add(null);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<CouponDetailScreen>(find.byType(CouponDetailScreen))
            .boundedSavedCoordinator,
        isNull,
      );
      expect(harness.device.stages, isEmpty);
      expect(harness.starts, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final signed in [false, true]) {
    for (final stage in ['context', 'proof', 'use']) {
      testWidgets(
        'profile ${signed ? 'signed' : 'guest'} final tap survives Back during $stage and rescan retains original timer',
        (tester) async {
          tester.view.physicalSize = const Size(1000, 1400);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final harness = _Harness(signed: signed);
          addTearDown(harness.dispose);
          CustomerBiteSaverRuntime.testEnabled = true;
          CustomerBiteSaverRuntime.testComposition = harness.composition;
          tester.binding.platformDispatcher.defaultRouteNameTestValue =
              '/r/coupons/permanent-catalog-id';
          addTearDown(
            tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
          );
          await tester.pumpWidget(
            const CouponApp(
              testWrapCelebrationHosts: false,
              testInitializePlatformServices: false,
            ),
          );
          await tester.pumpAndSettle();
          expect(find.byType(RestaurantProfileScreen), findsOneWidget);
          expect(find.text('Fixture Daily Special'), findsOneWidget);
          await tester.tap(find.text('Fixture Daily Special'));
          await tester.pumpAndSettle();
          expect(find.text('Use Coupon'), findsNothing);
          expect(harness.profileUseRequests, isEmpty);
          expect(harness.device.stages, isEmpty);
          rootNavigatorKey.currentState!.pop();
          await tester.pumpAndSettle();
          await tester.tap(find.text('Fixture Coupon 1'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Use Coupon'));
          await tester.pumpAndSettle();
          expect(harness.profileUseRequests, isEmpty);
          expect(harness.device.stages, isEmpty);
          await tester.tap(
            find.byKey(const ValueKey<String>('bitesaver_use_cancel')),
          );
          await tester.pumpAndSettle();
          expect(harness.device.stages, isEmpty);
          final barrier = Completer<void>();
          if (stage == 'context') {
            harness.beforeProfileContext = () => barrier.future;
          }
          harness.device.beforeStage = (name) async {
            if (name == stage) await barrier.future;
          };
          await _confirmProfileUse(tester);
          for (
            var i = 0;
            i < 30 &&
                (stage == 'context'
                    ? harness.profileUseRequests.isEmpty
                    : !harness.device.stages.contains(stage));
            i++
          ) {
            await tester.pump(const Duration(milliseconds: 10));
          }
          expect(harness.profileUseRequests, hasLength(1));
          rootNavigatorKey.currentState!.pop();
          await tester.pumpAndSettle();
          rootNavigatorKey.currentState!.pop();
          await tester.pump(const Duration(milliseconds: 400));
          unawaited(
            rootNavigatorKey.currentState!.pushNamed(
              '/r/coupons/permanent-catalog-id',
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Fixture Coupon 1'));
          await tester.pumpAndSettle();
          await _confirmProfileUse(tester);
          await tester.pump(const Duration(milliseconds: 10));
          expect(harness.profileUseRequests, hasLength(1));
          barrier.complete();
          await tester.pumpAndSettle();
          expect(harness.device.submissions, hasLength(1));
          final result = harness.composition.browse.redemptionPresentationFor(
            tester
                .widget<CouponDetailScreen>(find.byType(CouponDetailScreen))
                .boundedOffer!
                .offerId,
          )!;
          expect(result.timerStartedAtMillis, _now);
          if (signed) {
            expect(
              harness.composition.saved!.redemptionPresentationFor(
                result.offerId,
              ),
              same(result),
            );
          }
          harness.nowMillis += 60000;
          await tester.pump(const Duration(seconds: 1));
          expect(find.textContaining('04:00'), findsWidgets);
          rootNavigatorKey.currentState!.pop();
          await tester.pumpAndSettle();
          harness.nowMillis = _now + 300001;
          await tester.tap(find.text('Fixture Coupon 1'));
          await tester.pumpAndSettle();
          expect(find.text('05:00'), findsNothing);
          expect(harness.device.submissions, hasLength(1));
          expect(harness.coordinateReads, 0);
          expect(harness.starts, isEmpty);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
        },
      );
    }
  }

  testWidgets(
    'profile ambiguous result retries identical request and proof with one context and fresh proximity read',
    (tester) async {
      final harness = _Harness()..profileProximity = true;
      addTearDown(harness.dispose);
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      await tester.pumpWidget(
        const CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
        ),
      );
      await tester.pump(const Duration(milliseconds: 400));
      unawaited(
        rootNavigatorKey.currentState!.pushNamed(
          '/r/coupons/permanent-catalog-id',
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Fixture Coupon 1'));
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      var uncertain = true;
      harness.device.beforeStage = (stage) async {
        if (stage == 'use' && uncertain) {
          uncertain = false;
          throw const CustomerBiteSaverDeviceUseTransportException(
            ambiguous: true,
            code: 'unavailable',
          );
        }
      };
      await _confirmProfileUse(tester);
      await tester.pumpAndSettle();
      expect(harness.device.submissions, hasLength(1));
      final first = jsonEncode(harness.device.submissions.single);
      expect(find.text('05:00'), findsNothing);
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      await _confirmProfileUse(tester);
      await tester.pumpAndSettle();
      expect(harness.device.submissions, hasLength(2));
      expect(jsonEncode(harness.device.submissions.last), first);
      expect(harness.device.stages.where((s) => s == 'proof'), hasLength(1));
      expect(harness.profileUseRequests, hasLength(1));
      expect(harness.coordinateReads, 1);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final signed in [false, true]) {
    testWidgets(
      'profile ${signed ? 'signed' : 'guest'} denial never starts a timer',
      (tester) async {
        final harness = _Harness(signed: signed);
        addTearDown(harness.dispose);
        harness.device.status = 'denied';
        CustomerBiteSaverRuntime.testEnabled = true;
        CustomerBiteSaverRuntime.testComposition = harness.composition;
        await tester.pumpWidget(
          const CouponApp(
            testWrapCelebrationHosts: false,
            testInitializePlatformServices: false,
          ),
        );
        await tester.pump(const Duration(milliseconds: 400));
        unawaited(
          rootNavigatorKey.currentState!.pushNamed(
            '/r/coupons/permanent-catalog-id',
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Fixture Coupon 1'));
        await tester.tap(find.text('Fixture Coupon 1'));
        await tester.pumpAndSettle();
        await _confirmProfileUse(tester);
        await tester.pumpAndSettle();
        final offer = tester
            .widget<CouponDetailScreen>(find.byType(CouponDetailScreen))
            .boundedOffer!;
        expect(
          harness.composition.browse.redemptionPresentationFor(offer.offerId),
          isNull,
        );
        expect(find.textContaining('05:00'), findsNothing);
        expect(harness.device.submissions, hasLength(1));
        expect(
          harness.calls.where((name) => name.contains('Redemption')),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'guest profile Unlimited confirmation survives Back and reopen without fresh proof',
    (tester) async {
      final harness = _Harness(signed: false);
      addTearDown(harness.dispose);
      harness.device.status = 'unlimited';
      harness.profileUsagePolicy = 'unlimited';
      CustomerBiteSaverRuntime.testEnabled = true;
      CustomerBiteSaverRuntime.testComposition = harness.composition;
      await tester.pumpWidget(
        const CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
        ),
      );
      await tester.pump(const Duration(milliseconds: 400));
      unawaited(
        rootNavigatorKey.currentState!.pushNamed(
          '/r/coupons/permanent-catalog-id',
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Fixture Coupon 1'));
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      await _confirmProfileUse(tester);
      await tester.pumpAndSettle();
      expect(find.text('Coupon Ready'), findsOneWidget);
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fixture Coupon 1'));
      await tester.pumpAndSettle();
      expect(find.text('Coupon Ready'), findsOneWidget);
      expect(find.textContaining('05:00'), findsNothing);
      expect(harness.profileUseRequests, hasLength(1));
      expect(harness.device.submissions, hasLength(1));
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final stage in ['context', 'proof', 'use']) {
    testWidgets(
      'profile auth replacement fences $stage without a timer under new owner',
      (tester) async {
        final harness = _Harness();
        addTearDown(harness.dispose);
        CustomerBiteSaverRuntime.testEnabled = true;
        CustomerBiteSaverRuntime.testComposition = harness.composition;
        await tester.pumpWidget(
          const CouponApp(
            testWrapCelebrationHosts: false,
            testInitializePlatformServices: false,
          ),
        );
        await tester.pump(const Duration(milliseconds: 400));
        unawaited(
          rootNavigatorKey.currentState!.pushNamed(
            '/r/coupons/permanent-catalog-id',
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Fixture Coupon 1'));
        await tester.tap(find.text('Fixture Coupon 1'));
        await tester.pumpAndSettle();
        final barrier = Completer<void>();
        if (stage == 'context') {
          harness.beforeProfileContext = () => barrier.future;
        }
        harness.device.beforeStage = (name) async {
          if (name == stage) await barrier.future;
        };
        await _confirmProfileUse(tester);
        for (
          var i = 0;
          i < 30 &&
              (stage == 'context'
                  ? harness.profileUseRequests.isEmpty
                  : !harness.device.stages.contains(stage));
          i++
        ) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        harness.user = _User('owner-b');
        // Context completion must inspect real current auth even before the stream event.
        if (stage != 'context') harness.changes.add(harness.user);
        barrier.complete();
        await tester.pumpAndSettle();
        final detail = tester.widget<CouponDetailScreen>(
          find.byType(CouponDetailScreen),
        );
        expect(
          harness.composition.browse.redemptionPresentationFor(
            detail.boundedOffer!.offerId,
          ),
          isNull,
        );
        expect(
          harness.composition.saved!.redemptionPresentationFor(
            detail.boundedOffer!.offerId,
          ),
          isNull,
        );
        if (stage != 'use') expect(harness.device.submissions, isEmpty);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  for (final cold in [true, false]) {
    for (final target in ['catalog-same-name-a', 'catalog-same-name-b']) {
      testWidgets('${cold ? 'cold' : 'warm'} SR exact main profile $target', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(1000, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final harness = _Harness(signed: false);
        addTearDown(harness.dispose);
        CustomerBiteSaverRuntime.testEnabled = true;
        CustomerBiteSaverRuntime.testComposition = harness.composition;
        CustomerBiteScoreRuntime.testEnabled = true;
        addTearDown(() => CustomerBiteScoreRuntime.testEnabled = null);
        setupFirebaseCoreMocks();
        await Firebase.initializeApp();
        const channel = BasicMessageChannel<Object?>(
          'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
          StandardMessageCodec(),
        );
        final detailIds = <String>[];
        final parents = <String>[];
        final calls = <String>[];
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockDecodedMessageHandler<Object?>(channel, (message) async {
              final arguments = Map<String, Object?>.from(
                (message! as List).single as Map,
              );
              final name = arguments['functionName']! as String;
              final request = Map<String, Object?>.from(
                arguments['parameters']! as Map,
              );
              calls.add(name);
              Object response;
              if (name == 'getCustomerBiteScoreDetail') {
                expect(request['kind'], 'restaurant');
                expect(request['id'], target);
                detailIds.add(request['id']! as String);
                response = {
                  'kind': 'restaurant',
                  'restaurant': score_fixtures.restaurantProjection(target),
                  'isFavorite': false,
                  'canManage': false,
                };
              } else if (name == 'startCustomerBiteScoreSearch') {
                final criteria = request['criteria']! as Map;
                expect(criteria['kind'], 'dish');
                expect(criteria['restaurantId'], target);
                parents.add(criteria['restaurantId']! as String);
                response = score_fixtures.response();
              } else if (name == 'getCustomerBiteScoreSearchPage') {
                response = score_fixtures.response();
              } else {
                throw StateError('Unexpected read or mutation: $name');
              }
              return [response];
            });
        addTearDown(
          () => TestDefaultBinaryMessengerBinding
              .instance
              .defaultBinaryMessenger
              .setMockDecodedMessageHandler<Object?>(channel, null),
        );
        final route = '/r/bitescore/$target';
        if (cold) {
          tester.binding.platformDispatcher.defaultRouteNameTestValue = route;
          addTearDown(
            tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
          );
        }
        await tester.pumpWidget(
          const CouponApp(
            testWrapCelebrationHosts: false,
            testInitializePlatformServices: false,
          ),
        );
        await tester.pumpAndSettle();
        if (!cold) {
          unawaited(rootNavigatorKey.currentState!.pushNamed(route));
          await tester.pumpAndSettle();
        }
        final profile = tester.widget<BiteScoreRestaurantDishesScreen>(
          find.byType(BiteScoreRestaurantDishesScreen),
        );
        expect(profile.restaurant.id, target);
        expect(profile.restaurant.name, 'Kitchen');
        expect(detailIds, isNotEmpty);
        expect(detailIds, everyElement(target));
        expect(parents, isNotEmpty);
        expect(parents, everyElement(target));
        expect(harness.device.stages, isEmpty);
        expect(harness.device.submissions, isEmpty);
        expect(
          calls,
          everyElement(
            isIn([
              'getCustomerBiteScoreDetail',
              'startCustomerBiteScoreSearch',
              'getCustomerBiteScoreSearchPage',
            ]),
          ),
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      });
    }
  }
}

Future<void> _confirmProfileUse(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Use Coupon'));
  await tester.tap(find.text('Use Coupon'));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey<String>('bitesaver_use_confirm')));
  await tester.pump();
}

final class _Harness {
  _Harness({bool signed = true}) {
    user = signed ? _User('owner-a') : null;
    device = CustomerBiteSaverDeviceUseFixture(
      authenticatedUserId: signed ? 'owner-a' : null,
      evaluatedAtMillis: _now,
    );
    composition = CustomerBiteSaverComposition(
      api: CustomerBiteSaverService(transport: call),
      favoriteService: CustomerBiteSaverFavoriteService(
        auth: _FavoriteAuth(this),
        store: _NoFavoriteWrites(),
      ),
      guestUsageStore: CustomerBiteSaverGuestUsageStore(
        guestDeviceId: 'runtime-test-device',
        clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis),
        preferences: _Preferences(),
      ),
      currentUser: () => user,
      userChanges: () => Stream<User?>.multi((controller) {
        controller.add(user);
        final subscription = changes.stream.listen(controller.add);
        controller.onCancel = subscription.cancel;
      }, isBroadcast: true),
      proofService: device.proofService,
      deviceTransport: device.transport,
      currentCoordinatesProvider: () async {
        coordinateReads += 1;
        return CustomerBiteSaverCoordinates(
          latitude: 28.5383,
          longitude: -81.3792,
          capturedAtMillis: nowMillis,
        );
      },
      clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis),
    );
  }
  final changes = StreamController<User?>.broadcast(sync: true);
  User? user;
  late final CustomerBiteSaverDeviceUseFixture device;
  late final CustomerBiteSaverComposition composition;
  int nowMillis = _now;
  int coordinateReads = 0;
  bool profileProximity = false;
  String profileUsagePolicy = 'oncePerCustomer';
  Future<void> Function()? beforeProfileContext;
  final profileUseRequests = <Map<String, Object?>>[];
  String profileState = 'available';
  String profileFavoriteState = 'notFavorite';
  bool profileHasMore = false;
  final calls = <String>[];
  final starts = <Map<String, Object?>>[];
  final fixture =
      jsonDecode(
            File(
              'test/fixtures/customer_bitesaver_client_boundary_v1.json',
            ).readAsStringSync(),
          )
          as Map;
  Future<Object?> call(String name, Map<String, Object?> request) async {
    calls.add(name);
    final responses = fixture['signed']['responses'] as Map;
    if (name == CustomerBiteSaverService.startCallableName) {
      starts.add(request);
      return _copy(responses['start'])..['state'] = 'ready';
    }
    final page = _copy(responses['restaurantPage']);
    final restaurant = (page['restaurants'] as List).first as Map;
    restaurant['imageUrl'] = null;
    restaurant['hasMoreOffers'] = false;
    for (final offer in restaurant['offers'] as List) {
      (offer as Map)['imageUrl'] = null;
    }
    if (request['kind'] == 'publicProfileUse') {
      expectSync(name, CustomerBiteSaverService.restaurantPageCallableName);
      profileUseRequests.add(Map.of(request));
      await beforeProfileContext?.call();
      final start = responses['start'] as Map;
      return {
        'schemaVersion': 1,
        'kind': 'publicProfileUse',
        'catalogRestaurantId': request['catalogRestaurantId'],
        'restaurantId': request['restaurantId'],
        'offerId': request['offerId'],
        'sessionId': start['sessionId'],
        'capability': start['capability'],
        'criteriaFingerprint': start['criteriaFingerprint'],
        'offerOccurrence': 'sealed-profile-use-test-context',
        'freshExpiresAtMillis': nowMillis + 900000,
        'isProximityOnly': profileProximity,
        'usagePolicy': profileUsagePolicy,
      };
    }
    if (request['kind'] == 'publicProfile') {
      expectSync(request['catalogRestaurantId'], 'permanent-catalog-id');
      expectSync(request.containsKey('sessionId'), isFalse);
      expectSync(request.containsKey('capability'), isFalse);
      if (request['section'] == 'menu') {
        return {
          'schemaVersion': 1,
          'state': 'available',
          'attemptGeneration': 0,
          'queryFingerprint': 'a' * 64,
          'restaurantId': restaurant['restaurantId'],
          'menuStyle': 'biteSaver',
          'entries': [],
          'nextCursor': null,
          'hasMore': false,
        };
      }
      if (profileState != 'available') {
        return {
          'schemaVersion': 1,
          'kind': 'publicProfile',
          'catalogRestaurantId': request['catalogRestaurantId'],
          'favoriteStates': [],
          'state': profileState,
          'restaurant': null,
          'nextCursor': null,
          'hasMore': false,
          'partial': false,
        };
      }
      restaurant['hasMoreOffers'] = profileHasMore && request['cursor'] == null;
      restaurant['usableOfferCount'] = null;
      restaurant['offerCountState'] = 'unknown';
      final offers = restaurant['offers'] as List;
      for (final offer in offers) {
        offer['available'] = false;
        offer['usageState'] = 'unknown';
        offer['availabilityReason'] = 'savedReadOnly';
        offer['offerOccurrence'] = 'bsoc1.${'a' * 43}';
      }
      final special = offers.last as Map;
      special['offerType'] = 'dailySpecial';
      special['title'] = 'Fixture Daily Special';
      special['usagePolicy'] = null;
      special['usageState'] = 'available';
      special['available'] = true;
      if (request['cursor'] != null) {
        final continued = _copy(offers.first);
        continued['offerId'] = 'bso_${'b' * 43}';
        continued['title'] = 'Continued public coupon';
        restaurant['offers'] = [continued];
      }
      return {
        'schemaVersion': 1,
        'kind': 'publicProfile',
        'catalogRestaurantId': request['catalogRestaurantId'],
        'state': 'available',
        'restaurant': restaurant,
        'favoriteStates': user == null
            ? []
            : [
                {
                  'id': restaurant['restaurantId'],
                  'state': profileFavoriteState,
                },
                for (final offer in restaurant['offers'] as List)
                  if (offer['offerType'] == 'coupon')
                    {'id': offer['offerId'], 'state': profileFavoriteState},
              ],
        'nextCursor': restaurant['hasMoreOffers'] == true
            ? 'public-next'
            : null,
        'hasMore': restaurant['hasMoreOffers'],
        'partial': false,
      };
    }
    if (name == CustomerBiteSaverService.restaurantPageCallableName) {
      return page;
    }
    if (name == CustomerBiteSaverService.favoriteStatesCallableName) {
      return {
        'schemaVersion': 1,
        'states': [
          for (final id in [
            ...request['restaurantIds'] as List,
            ...request['offerIds'] as List,
          ])
            {'id': id, 'state': 'notFavorite'},
        ],
      };
    }
    if (name == CustomerBiteSaverService.savedPageCallableName) {
      return {
        'schemaVersion': 1,
        'section': request['section'],
        'entries': [
          {
            'favoriteKind': 'bitesaverCoupon',
            'restaurantId': restaurant['restaurantId'],
            'offerId': (restaurant['offers'] as List).first['offerId'],
            'availability': 'available',
            'restaurant': restaurant,
            'offer': (restaurant['offers'] as List).first,
            'accessToken': 'bssv1.synthetic-runtime-authority',
          },
        ],
        'nextCursor': null,
        'hasMore': false,
        'partial': false,
      };
    }
    throw StateError('Unexpected or legacy callable: $name');
  }

  bool _disposed = false;
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    composition.dispose();
    device.dispose();
    unawaited(changes.close());
  }
}

final class _User implements User {
  _User(this.uid);
  @override
  final String uid;
  @override
  bool get isAnonymous => false;
  @override
  String? get displayName => 'Fixture Customer';
  @override
  String? get email => 'fixture@example.test';
  @override
  bool get emailVerified => true;
  @override
  List<UserInfo> get providerData => [];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _FavoriteAuth implements CustomerBiteSaverFavoriteAuth {
  _FavoriteAuth(this.harness);
  final _Harness harness;
  @override
  CustomerBiteSaverFavoriteUser? get currentUser => harness.user == null
      ? null
      : CustomerBiteSaverFavoriteUser(
          uid: harness.user!.uid,
          isAnonymous: false,
        );
}

final class _NoFavoriteWrites implements CustomerBiteSaverFavoriteStore {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected favorite write');
}

final class _Preferences implements CustomerBiteSaverGuestUsagePreferences {
  final values = <String, String>{};
  @override
  Future<String?> getString(String key) async => values[key];
  @override
  Future<void> setString(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }
}
