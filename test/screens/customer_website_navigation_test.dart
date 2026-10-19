@TestOn('browser')
library;

import 'package:coupon_app/services/customer_website_routes.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';

import '../customer_website_fixture/main.dart' show FixtureBrowse;
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:coupon_app/services/customer_browser_location_service.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/main.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/customer_website_runtime.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../customer_website_fixture/score_data.dart'
    show dishProjection, restaurantProjection;

Widget _app({
  Stream<Uri>? links,
  Widget Function(AppMode)? homeBuilder,
  String Function()? authRealm,
  Stream<String>? authChanges,
  Widget Function(CustomerWebsiteDetailRoute)? detailBuilder,
}) => CouponApp(
  testInitializePlatformServices: false,
  testWrapCelebrationHosts: false,
  testWebsiteDetailBuilder: detailBuilder,
  testCustomerRouteBuilder: (link) => Scaffold(
    appBar: AppBar(leading: const BackButton()),
    body: Text('Destination ${link.side} ${link.restaurantId}'),
  ),
  testNavigationBuilder: (_, _) => Builder(
    builder: (context) {
      final name = ModalRoute.of(context)?.settings.name;
      return MainNavigationScreen(
        initializePlatformServices: false,
        initialMode: name == '/browse/bitescore'
            ? AppMode.biteScore
            : AppMode.biteSaver,
        initialIndex: name == '/account' ? 2 : 0,
        testIncomingDeepLinks: links,
        testCustomerAuthRealmProvider: authRealm ?? () => 'guest',
        testCustomerAuthRealmChanges: authChanges,
        testModeHomeBuilder: (mode, _) =>
            homeBuilder?.call(mode) ?? Text('${mode.name} browse'),
        testPagesBuilder: (_) => const [
          SizedBox(),
          Text('OWNER MUST NOT OPEN'),
          Text('Customer account'),
        ],
      );
    },
  ),
);

class _UsagePreferences implements CustomerBiteSaverGuestUsagePreferences {
  final values = <String, String>{};
  @override
  Future<String?> getString(String key) async => values[key];
  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }

  @override
  Future<void> setString(String key, String value) async {
    values[key] = value;
  }
}

class _Owner extends Fake implements User {
  @override
  String get uid => 'local-owner';
  @override
  bool get isAnonymous => false;
}

const _restaurant = BitescoreRestaurant(
  id: 'restaurant-1',
  name: 'Cafe',
  normalizedName: 'cafe',
  address: '',
  city: '',
  state: 'FL',
  zipCode: '',
  location: GeoPoint(28.5, -81.3),
  ownerUserId: 'local-owner',
  restaurantWriteRevision: 0,
);

void main() {
  setUp(() {
    expect(
      CustomerWebsiteRuntime.enabled,
      isTrue,
      reason: 'Run with --dart-define=BITESTAR_CUSTOMER_WEBSITE=true',
    );
    SharedPreferences.setMockInitialValues({});
    mainNavigationController.resetBiteSaverCustomerPathForTesting();
  });
  testWidgets('browser location submit closes focused input before loading', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    SharedLocationStateService.resetForTesting();
    final response = Completer<Object?>();
    var calls = 0;
    SharedLocationStateService.setBrowserResolverForTesting(
      CustomerBrowserLocationService(
        transport: (_) {
          calls++;
          return response.future;
        },
      ),
    );
    await tester.pumpWidget(
      _app(
        homeBuilder: (_) =>
            FixtureBrowse(usagePreferences: _UsagePreferences()),
      ),
    );
    await tester.pumpAndSettle();
    final field = find.byKey(const ValueKey<String>('bounded-location-field'));
    await tester.enterText(field, '34461');
    final input = tester.widget<EditableText>(
      find.descendant(of: field, matching: find.byType(EditableText)),
    );
    expect(input.focusNode.hasFocus, isTrue);
    await tester.tap(find.byTooltip('Search location'));
    await tester.pump();
    expect(input.focusNode.hasFocus, isFalse);
    expect(calls, 1);
    response.complete({
      'schemaVersion': 1,
      'latitude': 28.86,
      'longitude': -82.49,
      'provider': 'google',
      'cacheSeconds': 86400,
    });
    await tester.pumpAndSettle();
    expect(SharedLocationStateService.state.typedLatitude, 28.86);
    expect(tester.takeException(), isNull);
    final dynamic fixture = tester.state(find.byType(FixtureBrowse));
    final coordinator =
        fixture.coordinator as CustomerBiteSaverSearchCoordinator;
    final criteria = coordinator.criteria!;
    final access = coordinator.captureBrowseAccess(
      restaurant: coordinator.restaurants.first,
    );
    coordinator.invalidateSearchLocation();
    expect(coordinator.criteria, isNull);
    expect(coordinator.isBrowseAccessCurrent(access), isFalse);
    await coordinator.startSearch(criteria);
    await tester.pumpAndSettle();
    expect(coordinator.criteria, same(criteria));
    await tester.pumpWidget(const SizedBox());
    expect(coordinator.criteria, isNull);
    SharedLocationStateService.resetForTesting();
    semantics.dispose();
  });
  testWidgets(
    'named customer modes, account and permanent routes support return',
    (tester) async {
      await tester.pumpWidget(_app());
      await tester.pumpAndSettle();
      expect(find.text('Restaurant\nHub'), findsNothing);
      await tester.tap(find.text('Dish Ratings'));
      await tester.pumpAndSettle();
      expect(find.text('biteScore browse'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('biteSaver browse'), findsOneWidget);
      expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
      AppModeStateService.setMode(AppMode.biteScore);
      await tester.pumpAndSettle();
      expect(find.text('biteScore browse'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      unawaited(
        rootNavigatorKey.currentState!.pushNamed(
          '/r/bitescore/permanent%252Fid',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Destination bitescore permanent%2Fid'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      expect(find.text('Customer account'), findsOneWidget);
      expect(find.text('OWNER MUST NOT OPEN'), findsNothing);
    },
  );
  testWidgets(
    'browser-applied restaurant route synchronizes mode and retains safe Back',
    (tester) async {
      await tester.pumpWidget(_app());
      await tester.pumpAndSettle();
      final router = tester.widget<Router<Object>>(find.byType(Router<Object>));
      await router.routerDelegate.setNewRoutePath(
        CustomerWebsiteLocation('/r/bitescore/browser-catalog-id'),
      );
      await tester.pumpAndSettle();
      expect(AppModeStateService.selectedMode.value, AppMode.biteScore);
      expect(
        find.text('Destination bitescore browser-catalog-id'),
        findsOneWidget,
      );
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('biteScore browse'), findsOneWidget);
    },
  );
  testWidgets(
    'initial route arriving after Navigator mount opens the restaurant',
    (tester) async {
      await tester.pumpWidget(_app());
      await tester.pumpAndSettle();
      final router = tester.widget<Router<Object>>(find.byType(Router<Object>));
      await router.routerDelegate.setInitialRoutePath(
        CustomerWebsiteLocation('/r/coupons/permanent%252Fidentity'),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Destination coupons permanent%2Fidentity'),
        findsOneWidget,
      );
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('biteSaver browse'), findsOneWidget);
    },
  );
  testWidgets('unsupported browser location shows a safe recovery', (
    tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    final router = tester.widget<Router<Object>>(find.byType(Router<Object>));
    await router.routerDelegate.setNewRoutePath(
      CustomerWebsiteLocation('/unknown-customer-route'),
    );
    await tester.pumpAndSettle();
    expect(find.text('This page is not available.'), findsOneWidget);
    await tester.tap(find.text('Go to BiteStar'));
    await tester.pumpAndSettle();
    expect(find.text('biteSaver browse'), findsOneWidget);
  });
  testWidgets(
    'nested session visits restore Back Forward with fresh auth bindings',
    (tester) async {
      await tester.pumpWidget(_app());
      await tester.pumpAndSettle();
      final router = tester.widget<Router<Object>>(find.byType(Router<Object>));
      CustomerWebsiteLocation current() =>
          router.routerDelegate.currentConfiguration!
              as CustomerWebsiteLocation;
      final home = current();
      var valid = true;
      var builds = 0;
      Future<void> open(String label) async {
        unawaited(
          pushMainNavigationPrivateRoute<void>(
            rootNavigatorKey.currentContext!,
            parentBinding: null,
            originatingAuthRealm: 'guest',
            webCanReplay: () => valid,
            builder: (_) {
              builds++;
              return Scaffold(appBar: AppBar(), body: Text(label));
            },
          ),
        );
        await tester.pumpAndSettle();
      }

      await open('Session restaurant');
      final restaurant = current();
      await open('Session coupon');
      final coupon = current();
      expect(coupon.location, home.location);
      expect(coupon.entryKey, isNot(restaurant.entryKey));
      await router.routerDelegate.setNewRoutePath(restaurant);
      await tester.pumpAndSettle();
      expect(find.text('Session restaurant'), findsOneWidget);
      await router.routerDelegate.setNewRoutePath(home);
      await tester.pumpAndSettle();
      expect(find.text('biteSaver browse'), findsOneWidget);
      final previousBuilds = builds;
      await router.routerDelegate.setNewRoutePath(coupon);
      await tester.pumpAndSettle();
      expect(find.text('Session coupon'), findsOneWidget);
      expect(builds, greaterThan(previousBuilds));
      await router.routerDelegate.setNewRoutePath(restaurant);
      await tester.pumpAndSettle();
      expect(find.text('Session restaurant'), findsOneWidget);
      await router.routerDelegate.setNewRoutePath(home);
      await tester.pumpAndSettle();
      valid = false;
      await router.routerDelegate.setNewRoutePath(coupon);
      await tester.pumpAndSettle();
      expect(find.text('Session restaurant'), findsNothing);
      expect(find.text('Session coupon'), findsNothing);
      expect(find.text('biteSaver browse'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'real Browse access cannot replay after account A guest A replacement',
    (tester) async {
      SharedLocationStateService.resetForTesting();
      SharedLocationStateService.saveTypedLocation(
        latitude: 28.5,
        longitude: -81.3,
        label: '32801',
        searchText: '32801',
      );
      addTearDown(SharedLocationStateService.resetForTesting);
      var realm = 'signed:local-fixture';
      final events = StreamController<String>.broadcast(sync: true);
      addTearDown(events.close);
      tester.view.physicalSize = const Size(1100, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        _app(
          authRealm: () => realm,
          authChanges: events.stream,
          homeBuilder: (_) =>
              FixtureBrowse(usagePreferences: _UsagePreferences()),
        ),
      );
      await tester.pumpAndSettle();
      final router = tester.widget<Router<Object>>(find.byType(Router<Object>));
      final home =
          router.routerDelegate.currentConfiguration!
              as CustomerWebsiteLocation;
      final dynamic fixture = tester.state(find.byType(FixtureBrowse));
      final coordinator =
          fixture.coordinator as CustomerBiteSaverSearchCoordinator;
      await tester.tap(find.text('LOCAL FIXTURE Cafe').first);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('LOCAL unlimited coupon').first);
      await tester.tap(find.text('LOCAL unlimited coupon').first);
      await tester.pumpAndSettle();
      expect(find.text('Offer Details'), findsOneWidget);
      final coupon =
          router.routerDelegate.currentConfiguration!
              as CustomerWebsiteLocation;
      await router.routerDelegate.setNewRoutePath(home);
      await tester.pumpAndSettle();
      realm = 'guest';
      events.add(realm);
      await coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      // Both replacements happen before the lazy test Home is rebuilt;
      // the original coordinator must fence A→guest→A even with equal UID.
      realm = 'signed:local-fixture';
      events.add(realm);
      await coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.signed('local-fixture'),
      );
      await tester.pumpAndSettle();
      await router.routerDelegate.setNewRoutePath(coupon);
      await tester.pumpAndSettle();
      expect(find.text('Offer Details'), findsNothing);
      expect(
        find.text('LOCAL SYNTHETIC DATA — no production connection'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final browserBack in [false, true]) {
    testWidgets(
      'review return visibly refreshes dish (browser Back: $browserBack)',
      (tester) async {
        var title = 'Before review';
        final reads = CustomerBiteScoreReads(
          actorKey: () => 'guest',
          boundary: (name, request) async {
            if (name == 'getCustomerBiteScoreDetail') {
              return {
                'kind': 'dish',
                'dish': dishProjection('local-dish')
                  ..['displayName'] = title
                  ..['normalizedName'] = title.toLowerCase(),
                'restaurant': restaurantProjection('restaurant-1'),
                'isFavorite': false,
                'canManage': false,
              };
            }
            return {'items': <Object>[], 'nextCursor': null};
          },
        );
        final entry = CustomerBiteScorePublicData.entry(
          dishProjection('local-dish'),
        );
        await tester.pumpWidget(
          _app(
            homeBuilder: (mode) => mode == AppMode.biteScore
                ? BiteScoreDishDetailScreen(
                    entry: entry,
                    testCustomerReads: reads,
                    testCurrentUserProvider: () => null,
                    testSuppressLocalExpertBadgeRecalculation: true,
                  )
                : const Text('Coupon browse'),
            detailBuilder: (route) => Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () {
                    title = 'After review';
                    if (!browserBack) Navigator.pop(context, true);
                  },
                  child: const Text('Simulate changed review'),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Dish Ratings'));
        await tester.pumpAndSettle();
        expect(find.text('Before review'), findsOneWidget);
        final router = Router.of(rootNavigatorKey.currentContext!);
        final parent =
            router.routerDelegate.currentConfiguration!
                as CustomerWebsiteLocation;
        await tester.ensureVisible(find.text('Rate & Review').first);
        await tester.tap(find.text('Rate & Review').first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Simulate changed review'));
        if (browserBack) {
          await router.routerDelegate.setNewRoutePath(parent);
        }
        await tester.pumpAndSettle();
        expect(find.text('After review'), findsOneWidget);
        expect(find.text('Before review'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('website does not ingest or claim owner subscription events', (
    tester,
  ) async {
    final links = StreamController<Uri>.broadcast();
    addTearDown(links.close);
    await tester.pumpWidget(_app(links: links.stream));
    await tester.pumpAndSettle();
    expect(links.hasListener, isFalse);
    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    expect(find.text('Restaurant Hub'), findsNothing);
  });
  testWidgets('protected invite stays outside customer browser shortcuts', (
    tester,
  ) async {
    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();
    unawaited(
      rootNavigatorKey.currentState!.pushNamed('/invite/coupon/private-token'),
    );
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Open this secure restaurant invitation in the installed BiteStar app.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('private-token'), findsNothing);
  });
  testWidgets(
    'restaurant owner keeps customer actions without claim/publishing',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: BiteScoreRestaurantDishesScreen(
            restaurant: _restaurant,
            entries: const [],
            testCurrentUserProvider: () => _Owner(),
            testInitialDataLoader: () async => (
              restaurant: _restaurant,
              entries: <BiteScoreHomeEntry>[],
              isFavorite: false,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Owner Controls'), findsNothing);
      expect(find.text('Claim restaurant'), findsNothing);
      expect(find.text('Edit Basic Info'), findsNothing);
      expect(find.text('Add Dish'), findsOneWidget);
      expect(find.text('Report issue'), findsOneWidget);
    },
  );
  testWidgets('dish owner has customer review interface without management', (
    tester,
  ) async {
    final entry = CustomerBiteScorePublicData.entry(
      dishProjection('local-dish'),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreDishDetailScreen(
          entry: BiteScoreHomeEntry(
            dish: entry.dish,
            restaurant: _restaurant,
            aggregate: entry.aggregate,
          ),
          testInitialLoader: () async {},
          testCurrentUserProvider: () => _Owner(),
          testSuppressLocalExpertBadgeRecalculation: true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Dish Management'), findsNothing);
    expect(find.text('Merge Dish'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
