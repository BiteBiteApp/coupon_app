import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/main.dart' as bite_app;
import 'package:coupon_app/screens/bitescore_create_rate_screen.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/screens/bitescore_owner_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/screens/admin_gate_screen.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/screens/restaurant_customer_deep_link_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_management_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/services/restaurant_menu_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:coupon_app/widgets/app_mode_switcher_bar.dart';
import 'package:coupon_app/widgets/bitescore_category_picker.dart';
import 'package:coupon_app/widgets/persistent_bottom_navigation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/subscription_return_test_backend.dart';

const SubscriptionReturnOwnerScope _ownerA = SubscriptionReturnOwnerScope(
  uid: 'owner-a',
  accountDocumentId: 'owner-a',
);
const SubscriptionReturnOwnerScope _ownerB = SubscriptionReturnOwnerScope(
  uid: 'owner-b',
  accountDocumentId: 'owner-b',
);
const SubscriptionReturnOwnerScope _ownerASibling =
    SubscriptionReturnOwnerScope(
      uid: 'owner-a',
      accountDocumentId: 'owner-a-sibling',
    );
final DateTime _now = DateTime.utc(2026, 7, 31, 12);

String _token(int seed) =>
    '${seed.toRadixString(36).padLeft(3, '0')}${'A' * 40}';

typedef _ReturnCase = ({SubscriptionReturnKind kind, String message});
typedef _RuntimeRouteCase = ({
  AppMode initialMode,
  AppMode targetMode,
  String routeName,
  String restaurantId,
});

const List<_ReturnCase> _returnCases = <_ReturnCase>[
  (
    kind: SubscriptionReturnKind.checkoutSuccess,
    message:
        'Subscription started successfully. Refreshing restaurant tools...',
  ),
  (
    kind: SubscriptionReturnKind.checkoutCancel,
    message: 'Subscription checkout canceled.',
  ),
  (
    kind: SubscriptionReturnKind.customerPortal,
    message:
        'Returned from subscription management. Refreshing your subscription status.',
  ),
];

void main() {
  late FakeSubscriptionReturnBackend backend;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    SharedLocationStateService.resetForTesting();
    backend = FakeSubscriptionReturnBackend(clock: () => _now);
    await installFakeSubscriptionReturnService(backend, clock: () => _now);
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  tearDown(() {
    AppModeStateService.setMode(AppMode.biteSaver);
    SharedLocationStateService.resetForTesting();
  });

  test('navigation configuration has only the three public destinations', () {
    expect(mainNavigationItems.map((item) => item.label).toList(), <String>[
      'Home',
      'Restaurant\nHub',
      'Account',
    ]);
    expect(mainNavigationItems.length, 3);
    expect(mainNavigationItems.any((item) => item.label == 'Admin'), isFalse);
  });

  test('invalid and obsolete indexes fall back to Home', () {
    expect(normalizeMainNavigationIndex(-1), 0);
    expect(normalizeMainNavigationIndex(3), 0);
    expect(normalizeMainNavigationIndex(99), 0);
    expect(normalizeMainNavigationIndex(2), 2);
  });

  test('owner menu refreshes are tied to successful mutations', () {
    final ownerSource = File(
      'lib/screens/bitescore_owner_screen.dart',
    ).readAsStringSync();
    final menuSource = File(
      'lib/screens/restaurant_menu_management_screen.dart',
    ).readAsStringSync();
    final manageMenuStart = ownerSource.indexOf('Future<void> _openManageMenu');
    final manageMenuEnd = ownerSource.indexOf(
      'Future<void> _openMergeDialog',
      manageMenuStart,
    );
    final manageMenuSource = ownerSource.substring(
      manageMenuStart,
      manageMenuEnd,
    );

    expect(manageMenuSource, contains('onMenuChanged: _recordHomeChange'));
    expect(
      RegExp(r'_recordHomeChange').allMatches(manageMenuSource),
      hasLength(1),
    );
    expect(menuSource, contains('final VoidCallback? onMenuChanged;'));
    expect(
      RegExp(r'widget\.onMenuChanged\?\.call\(\);').allMatches(menuSource),
      hasLength(6),
    );
  });

  for (final saveSucceeds in <bool>[false, true]) {
    testWidgets(
      'menu item ${saveSucceeds ? 'success emits' : 'failure does not emit'} '
      'a Home change',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        var homeChangeCalls = 0;

        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantMenuManagementScreen(
              source: RestaurantMenuSource.sharedMenu('test-menu'),
              testCurrentUser: _NavigationTestUser(email: 'owner@example.com'),
              testInitialDataLoader: (user, source) async => (
                hasPostingAccess: true,
                images: const <RestaurantMenuImage>[],
                items: const <RestaurantMenuItem>[],
                sections: const <RestaurantMenuSection>[],
              ),
              testItemSaver:
                  (source, name, description, price, category) async {
                    if (!saveSucceeds) {
                      throw StateError('synthetic save failure');
                    }
                    return RestaurantMenuItem(
                      id: 'saved-item',
                      name: name,
                      description: description,
                      price: price,
                      category: category,
                      sortOrder: 1,
                    );
                  },
              onMenuChanged: () => homeChangeCalls += 1,
            ),
          ),
        );
        await _settleAsync(tester);

        final itemNameField = find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Item name',
        );
        await tester.enterText(itemNameField, 'Callback Burger');
        final addButton = find.widgetWithText(FilledButton, 'Add menu item');
        await tester.ensureVisible(addButton);
        await tester.tap(addButton);
        await _settleAsync(tester);

        expect(homeChangeCalls, saveSucceeds ? 1 : 0);
        final savedItemText = find.byWidgetPredicate(
          (widget) => widget is Text && widget.data == 'Callback Burger',
        );
        expect(savedItemText, saveSucceeds ? findsOneWidget : findsNothing);
      },
    );
  }

  for (final nextRealm in <String>['signed:owner-b', 'guest']) {
    testWidgets(
      'leaving signed A for $nextRealm retires a real above-shell auth-bound route and private dialog',
      (tester) async {
        final authChanges = StreamController<String>.broadcast(sync: true);
        final ownerALateCompletion = Completer<String>();
        var authRealm = 'signed:owner-a';
        addTearDown(authChanges.close);

        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testCustomerAuthRealmProvider: () => authRealm,
              testCustomerAuthRealmChanges: authChanges.stream,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  _RefreshGenerationProbeHome(
                    key: ValueKey('${mode.name}-realm-route-probe'),
                    navigationRefreshGeneration: navigationRefreshGeneration,
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Center(child: Text('realm route Hub')),
                const Center(child: Text('realm route Account')),
              ],
            ),
          ),
        );
        final ownerA = _NavigationTestUser(
          email: 'owner-a@example.com',
          uid: 'owner-a',
        );
        unawaited(
          rootNavigatorKey.currentState!.push<void>(
            MaterialPageRoute<void>(
              builder: (_) => BiteScoreOwnerScreen(
                currentUser: ownerA,
                testCurrentUserProvider: () => ownerA,
                testInitialDataLoader: (_) async {
                  await ownerALateCompletion.future;
                  return (
                    restaurants: <BitescoreRestaurant>[
                      _navigationBiteScoreEntry.restaurant,
                    ],
                    selectedRestaurant: _navigationBiteScoreEntry.restaurant,
                    entries: <BiteScoreHomeEntry>[
                      _navigationEntryNamed('late A private data'),
                    ],
                  );
                },
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(
          find.byType(BiteScoreOwnerScreen, skipOffstage: false),
          findsOneWidget,
        );
        unawaited(
          showDialog<void>(
            context: tester.element(
              find.byKey(
                const ValueKey('bitescore-owner-private-overlay-scope'),
                skipOffstage: false,
              ),
            ),
            barrierDismissible: false,
            builder: (_) => const PopScope<void>(
              canPop: false,
              child: AlertDialog(content: Text('A private owner dialog')),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text('A private owner dialog'), findsOneWidget);
        mainNavigationController.markHomeRefreshNeeded(
          owner: ownerA,
          navigator: rootNavigatorKey.currentState!,
          mode: AppMode.biteScore,
        );

        authRealm = nextRealm;
        authChanges.add(nextRealm);
        await tester.pumpAndSettle();

        expect(find.text('A private owner dialog'), findsNothing);
        expect(
          find.byType(BiteScoreOwnerScreen, skipOffstage: false),
          findsNothing,
        );
        expect(
          find.byType(MainNavigationScreen, skipOffstage: false),
          findsOneWidget,
        );
        expect(await rootNavigatorKey.currentState!.maybePop(), isFalse);
        await tester.pumpAndSettle();
        expect(
          find.byType(BiteScoreOwnerScreen, skipOffstage: false),
          findsNothing,
        );
        ownerALateCompletion.complete('late A private data');
        await tester.pump();
        expect(find.textContaining('late A private data'), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('Account'));
        await tester.pump();
        final home = tester.state<_RefreshGenerationProbeHomeState>(
          find.byKey(
            const ValueKey('biteScore-realm-route-probe'),
            skipOffstage: false,
          ),
        );
        expect(home.refreshes, 0);
      },
    );
  }

  testWidgets('same signed UID notification retains an above-shell route', (
    tester,
  ) async {
    final authChanges = StreamController<String>.broadcast(sync: true);
    addTearDown(authChanges.close);
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MainNavigationScreen(
          initializePlatformServices: false,
          testCustomerAuthRealmProvider: () => 'signed:A',
          testCustomerAuthRealmChanges: authChanges.stream,
          testPagesBuilder: (mode) => <Widget>[
            Text('${mode.name} same UID Home'),
            const Text('same UID Hub'),
            const Text('same UID Account'),
          ],
        ),
      ),
    );
    unawaited(
      rootNavigatorKey.currentState!.push<void>(
        MaterialPageRoute<void>(
          builder: (_) =>
              const Scaffold(body: Text('A retained private route')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    authChanges.add('signed:A');
    await tester.pumpAndSettle();

    expect(find.text('A retained private route'), findsOneWidget);
  });

  testWidgets('guest to signed auth preserves a public sign-in return route', (
    tester,
  ) async {
    final authChanges = StreamController<String>.broadcast(sync: true);
    var authRealm = 'guest';
    addTearDown(authChanges.close);
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MainNavigationScreen(
          initializePlatformServices: false,
          testCustomerAuthRealmProvider: () => authRealm,
          testCustomerAuthRealmChanges: authChanges.stream,
          testPagesBuilder: (mode) => <Widget>[
            Text('${mode.name} guest sign-in Home'),
            const Text('guest sign-in Hub'),
            const Text('guest sign-in Account'),
          ],
        ),
      ),
    );
    unawaited(
      rootNavigatorKey.currentState!.push<void>(
        MaterialPageRoute<void>(
          builder: (_) =>
              const Scaffold(body: Text('public sign-in return route')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    authRealm = 'signed:A';
    authChanges.add(authRealm);
    await tester.pumpAndSettle();

    expect(find.text('public sign-in return route'), findsOneWidget);
    expect(
      find.byType(MainNavigationScreen, skipOffstage: false),
      findsOneWidget,
    );
  });

  testWidgets(
    'owner bound during guest snapshot retires after guest to A then sign-out',
    (tester) async {
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'guest';
      User? currentUser = _NavigationTestUser(
        email: 'owner-a@example.com',
        uid: 'owner-a',
      );
      addTearDown(authChanges.close);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} owner-race Home'),
              const Text('owner-race Hub'),
              const Text('owner-race Account'),
            ],
          ),
        ),
      );
      final ownerA = currentUser;
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => BiteScoreOwnerScreen(
              currentUser: ownerA,
              testCurrentUserProvider: () => currentUser,
              testInitialDataLoader: (_) async => (
                restaurants: const <BitescoreRestaurant>[],
                selectedRestaurant: null,
                entries: const <BiteScoreHomeEntry>[],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(BiteScoreOwnerScreen), findsOneWidget);

      authRealm = 'signed:owner-a';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();
      expect(find.byType(BiteScoreOwnerScreen), findsOneWidget);

      currentUser = null;
      authRealm = 'guest';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();

      expect(find.byType(BiteScoreOwnerScreen), findsNothing);
      expect(find.text('biteScore owner-race Home'), findsOneWidget);
      expect(await rootNavigatorKey.currentState!.maybePop(), isFalse);
    },
  );

  testWidgets(
    'owner Add Dish pending before first build retires with its A parent',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'signed:A';
      User? currentUser = _NavigationTestUser(
        email: 'owner-a@example.com',
        uid: 'A',
      );
      addTearDown(authChanges.close);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} pending-owner-child Home'),
              const Text('pending-owner-child Hub'),
              const Text('pending-owner-child Account'),
            ],
          ),
        ),
      );
      final ownerA = currentUser;
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => BiteScoreOwnerScreen(
              currentUser: ownerA,
              testCurrentUserProvider: () => currentUser,
              testInitialDataLoader: (_) async => (
                restaurants: <BitescoreRestaurant>[
                  _navigationBiteScoreEntry.restaurant,
                ],
                selectedRestaurant: _navigationBiteScoreEntry.restaurant,
                entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final addDish = find.widgetWithText(OutlinedButton, 'Add Dish');
      await tester.ensureVisible(addDish);
      await tester.tap(addDish);

      currentUser = _NavigationTestUser(email: 'owner-b@example.com', uid: 'B');
      authRealm = 'signed:B';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();

      expect(find.byType(BiteScoreCreateRateScreen), findsNothing);
      expect(find.byType(BiteScoreOwnerScreen), findsNothing);
      expect(find.text('biteScore pending-owner-child Home'), findsOneWidget);
      expect(await rootNavigatorKey.currentState!.maybePop(), isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Account profile pending before first build never constructs after A to B',
    (tester) async {
      final authChanges = StreamController<String>.broadcast(sync: true);
      final accountUsers = StreamController<User?>.broadcast(sync: true);
      var authRealm = 'signed:A';
      var profileBuilds = 0;
      final userA = _NavigationTestUser(email: 'a@example.com', uid: 'A');
      final userB = _NavigationTestUser(email: 'b@example.com', uid: 'B');
      addTearDown(authChanges.close);
      addTearDown(accountUsers.close);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialIndex: 2,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} profile-race Home'),
              const Text('profile-race Hub'),
              CustomerAccountScreen(
                userStream: accountUsers.stream,
                profileDestinationBuilder: (_, user) {
                  profileBuilds += 1;
                  return CustomerProfileScreen(
                    currentUser: user,
                    testCurrentUserProvider: () => userB,
                    testProfileLoader: (_) async =>
                        const BiteScoreUserProfileData(
                          publicDisplayName: '',
                          chosenUsername: null,
                          fallbackUsername: '',
                          favoriteRestaurants: [],
                          favoriteSaverRestaurants: [],
                          favoriteDishEntries: [],
                          favoriteCoupons: [],
                          reviews: [],
                          badgeLabel: '',
                          reviewCount: 0,
                          helpfulVotesReceived: 0,
                          accountAgeDays: 0,
                          moderationFlagCount: 0,
                          contributionPoints: 0,
                        ),
                    testLocalExpertBadgesLoader: (_) async => const [],
                  );
                },
              ),
            ],
          ),
        ),
      );
      accountUsers.add(userA);
      await tester.pumpAndSettle();
      expect(find.text('My Profile'), findsOneWidget);

      await tester.tap(find.text('My Profile'));
      authRealm = 'signed:B';
      authChanges.add(authRealm);
      accountUsers.add(userB);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(profileBuilds, 0);
      expect(find.byType(CustomerProfileScreen), findsNothing);
      expect(find.byType(CustomerAccountScreen), findsOneWidget);
      expect(await rootNavigatorKey.currentState!.maybePop(), isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'auth cleanup removes registered private routes but preserves a public route above them',
    (tester) async {
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'signed:owner-a';
      User? currentUser = _NavigationTestUser(
        email: 'owner-a@example.com',
        uid: 'owner-a',
      );
      addTearDown(authChanges.close);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} selective Home'),
              const Text('selective Hub'),
              const Text('selective Account'),
            ],
          ),
        ),
      );
      final ownerA = currentUser;
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => BiteScoreOwnerScreen(
              currentUser: ownerA,
              testCurrentUserProvider: () => currentUser,
              testInitialDataLoader: (_) async => (
                restaurants: const <BitescoreRestaurant>[],
                selectedRestaurant: null,
                entries: const <BiteScoreHomeEntry>[],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final ownerContext = tester.element(
        find.descendant(
          of: find.byType(BiteScoreOwnerScreen),
          matching: find.byType(Scaffold),
        ),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              body: _NavigationProbePage(
                key: const ValueKey('selective-public-route'),
                label: 'selective-public',
                counters: _NavigationProbeCounters(),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final publicState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('selective-public-route')),
      );
      publicState.queryController.text = 'public route state survives';

      unawaited(
        showDialog<void>(
          context: ownerContext,
          barrierDismissible: false,
          builder: (_) => const PopScope<void>(
            canPop: false,
            child: AlertDialog(content: Text('owner A private overlay')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('owner A private overlay'), findsOneWidget);

      currentUser = _NavigationTestUser(
        email: 'owner-b@example.com',
        uid: 'owner-b',
      );
      authRealm = 'signed:owner-b';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();

      expect(find.text('owner A private overlay'), findsNothing);
      expect(
        find.byType(BiteScoreOwnerScreen, skipOffstage: false),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('selective-public-route')),
        findsOneWidget,
      );
      expect(
        identical(
          tester.state<_NavigationProbePageState>(
            find.byKey(const ValueKey('selective-public-route')),
          ),
          publicState,
        ),
        isTrue,
      );
      expect(publicState.queryController.text, 'public route state survives');

      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();
      expect(find.text('biteScore selective Home'), findsOneWidget);
      expect(
        find.byType(BiteScoreOwnerScreen, skipOffstage: false),
        findsNothing,
      );
    },
  );

  testWidgets('cold named deep link composes one navigation shell', (
    tester,
  ) async {
    tester.platformDispatcher.defaultRouteNameTestValue =
        '/r/bitescore/cold-start-restaurant';
    addTearDown(tester.platformDispatcher.clearDefaultRouteNameTestValue);
    final builtCustomerLinks = <RestaurantCustomerDeepLink?>[];

    await tester.pumpWidget(
      bite_app.CouponApp(
        testWrapCelebrationHosts: false,
        testNavigationBuilder: (customerLink, inviteLink) {
          builtCustomerLinks.add(customerLink);
          return const SizedBox(key: ValueKey('cold-start-single-shell'));
        },
      ),
    );

    expect(builtCustomerLinks, hasLength(1));
    expect(builtCustomerLinks.single?.side, 'bitescore');
    expect(builtCustomerLinks.single?.restaurantId, 'cold-start-restaurant');
    expect(
      find.byKey(const ValueKey('cold-start-single-shell')),
      findsOneWidget,
    );
  });

  testWidgets(
    'cold restaurant intent suppresses a delayed matching stream delivery',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      addTearDown(incoming.close);
      var destinationBuilds = 0;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialCustomerDeepLink: const RestaurantCustomerDeepLink(
              side: 'bitescore',
              restaurantId: 'cold-stream-restaurant',
            ),
            initializePlatformServices: false,
            testIncomingRawDeepLinks: incoming.stream,
            testCustomerDeepLinkBuilder: (_) {
              destinationBuilds += 1;
              return const Scaffold(
                body: Text('single cold restaurant destination'),
              );
            },
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} cold restaurant Home'),
              const Text('cold restaurant Hub'),
              const Text('cold restaurant Account'),
            ],
          ),
        ),
      );
      await _settleAsync(tester);
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 1)),
      );
      incoming.add(
        'https://go.bitestar.app/r/bitescore/cold-stream-restaurant',
      );
      await _settleAsync(tester);
      await tester.pumpAndSettle();

      expect(destinationBuilds, 1);
      expect(find.text('single cold restaurant destination'), findsOneWidget);
    },
  );

  testWidgets(
    'dismissed cold destination allows a later intentional activation of the same link',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      addTearDown(incoming.close);
      var destinationBuilds = 0;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialCustomerDeepLink: const RestaurantCustomerDeepLink(
              side: 'bitescore',
              restaurantId: 'cold-reactivation-restaurant',
            ),
            initializePlatformServices: false,
            testIncomingRawDeepLinks: incoming.stream,
            testCustomerDeepLinkBuilder: (_) {
              destinationBuilds += 1;
              return const Scaffold(body: Text('reactivated destination'));
            },
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} reactivation Home'),
              const Text('reactivation Hub'),
              const Text('reactivation Account'),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(destinationBuilds, 1);
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      incoming.add(
        'https://go.bitestar.app/r/bitescore/cold-reactivation-restaurant',
      );
      await _settleAsync(tester);
      await tester.pumpAndSettle();

      expect(destinationBuilds, 2);
      expect(find.text('reactivated destination'), findsOneWidget);
    },
  );

  testWidgets('auth reset invalidates stale cold-link suppression', (
    tester,
  ) async {
    final incoming = StreamController<String>.broadcast(sync: true);
    final authChanges = StreamController<String>.broadcast(sync: true);
    var authRealm = 'signed:A';
    var destinationBuilds = 0;
    addTearDown(incoming.close);
    addTearDown(authChanges.close);
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MainNavigationScreen(
          initialCustomerDeepLink: const RestaurantCustomerDeepLink(
            side: 'bitescore',
            restaurantId: 'auth-reset-link',
          ),
          initializePlatformServices: false,
          testIncomingRawDeepLinks: incoming.stream,
          testCustomerAuthRealmProvider: () => authRealm,
          testCustomerAuthRealmChanges: authChanges.stream,
          testCustomerDeepLinkBuilder: (_) {
            destinationBuilds += 1;
            return const Scaffold(body: Text('auth-reset destination'));
          },
          testPagesBuilder: (mode) => <Widget>[
            Text('${mode.name} auth-reset Home'),
            const Text('auth-reset Hub'),
            const Text('auth-reset Account'),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(destinationBuilds, 1);

    authRealm = 'signed:B';
    authChanges.add(authRealm);
    await tester.pump();
    incoming.add('https://go.bitestar.app/r/bitescore/auth-reset-link');
    await _settleAsync(tester);
    await tester.pumpAndSettle();

    expect(destinationBuilds, 2);
    expect(find.text('auth-reset destination'), findsOneWidget);
    expect(
      find.byType(MainNavigationScreen, skipOffstage: false),
      findsOneWidget,
    );
  });

  testWidgets(
    'distinct first-frame link supersedes cold intent and stale completion preserves newer deduplication',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      final builtRestaurantIds = <String>[];
      addTearDown(incoming.close);
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialCustomerDeepLink: const RestaurantCustomerDeepLink(
              side: 'bitescore',
              restaurantId: 'first-frame-cold',
            ),
            initializePlatformServices: false,
            testIncomingRawDeepLinks: incoming.stream,
            testCustomerDeepLinkBuilder: (link) {
              builtRestaurantIds.add(link.restaurantId);
              return Scaffold(body: Text('destination ${link.restaurantId}'));
            },
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} first-frame Home'),
              const Text('first-frame Hub'),
              const Text('first-frame Account'),
            ],
          ),
        ),
      );
      incoming.add('https://go.bitestar.app/r/bitescore/first-frame-distinct');
      await _settleAsync(tester);
      await tester.pumpAndSettle();

      expect(builtRestaurantIds.last, 'first-frame-distinct');
      expect(find.text('destination first-frame-distinct'), findsOneWidget);
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
      final buildsAfterDistinct = builtRestaurantIds.length;

      incoming.add('https://go.bitestar.app/r/bitescore/first-frame-distinct');
      await _settleAsync(tester);
      await tester.pumpAndSettle();

      expect(builtRestaurantIds, hasLength(buildsAfterDistinct));
      expect(find.text('destination first-frame-distinct'), findsOneWidget);
    },
  );

  testWidgets(
    'cold public route gives the shell and destination distinct names',
    (tester) async {
      tester.platformDispatcher.defaultRouteNameTestValue =
          '/r/bitescore/history-review';
      addTearDown(tester.platformDispatcher.clearDefaultRouteNameTestValue);

      await tester.pumpWidget(
        bite_app.CouponApp(
          testWrapCelebrationHosts: false,
          testNavigationBuilder: (customerLink, inviteLink) =>
              MainNavigationScreen(
                initialCustomerDeepLink: customerLink,
                initialInviteDeepLink: inviteLink,
                initializePlatformServices: false,
                testCustomerDeepLinkBuilder: (_) =>
                    const Scaffold(body: Text('public history destination')),
                testPagesBuilder: (mode) => <Widget>[
                  Text('${mode.name} history Home'),
                  const Text('history Hub'),
                  const Text('history Account'),
                ],
              ),
        ),
      );
      await tester.pumpAndSettle();

      final shellContext = tester.element(
        find.byType(MainNavigationScreen, skipOffstage: false),
      );
      final destinationContext = tester.element(
        find.text('public history destination'),
      );
      expect(ModalRoute.of(shellContext)?.settings.name, '/');
      expect(
        ModalRoute.of(destinationContext)?.settings.name,
        '/r/bitescore/history-review',
      );
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
    },
  );

  for (final runtimeCase in <_RuntimeRouteCase>[
    (
      initialMode: AppMode.biteSaver,
      targetMode: AppMode.biteScore,
      routeName: '/r/bitescore/runtime-from-bitesaver-account',
      restaurantId: 'runtime-from-bitesaver-account',
    ),
    (
      initialMode: AppMode.biteScore,
      targetMode: AppMode.biteSaver,
      routeName: '/r/coupons/runtime-from-bitescore-account',
      restaurantId: 'runtime-from-bitescore-account',
    ),
    (
      initialMode: AppMode.biteScore,
      targetMode: AppMode.biteScore,
      routeName: '/r/bitescore/runtime-from-bitescore-account',
      restaurantId: 'runtime-from-bitescore-account',
    ),
  ]) {
    testWidgets(
      'framework runtime route selects ${runtimeCase.targetMode.name} Home '
      'from ${runtimeCase.initialMode.name} Account and preserves the shell',
      (tester) async {
        final counters = _NavigationProbeCounters();
        var destinationBuilds = 0;
        await tester.pumpWidget(
          bite_app.CouponApp(
            testWrapCelebrationHosts: false,
            testCustomerRouteBuilder: (link) {
              destinationBuilds += 1;
              return Scaffold(
                key: ValueKey('runtime-destination-${link.restaurantId}'),
                body: Text('runtime destination ${link.restaurantId}'),
              );
            },
            testNavigationBuilder: (customerLink, inviteLink) =>
                MainNavigationScreen(
                  initialMode: runtimeCase.initialMode,
                  initializePlatformServices: false,
                  testPagesBuilder: (mode) => <Widget>[
                    _NavigationProbePage(
                      key: ValueKey('${mode.name}-runtime-home-probe'),
                      label: '${mode.name}-runtime-home',
                      counters: counters,
                    ),
                    Text('${mode.name} runtime Hub'),
                    Text('${mode.name} runtime Account'),
                  ],
                ),
          ),
        );

        final shellFinder = find.byType(MainNavigationScreen);
        final shellState = tester.state(shellFinder);
        final shellRoute = ModalRoute.of(tester.element(shellFinder));
        final sourceHomeFinder = find.byKey(
          ValueKey('${runtimeCase.initialMode.name}-runtime-home-probe'),
        );
        final sourceHomeState = tester.state<_NavigationProbePageState>(
          sourceHomeFinder,
        );
        sourceHomeState.queryController.text = 'retained source query';

        await tester.tap(find.text('Account'));
        await tester.pumpAndSettle();
        expect(
          find.text('${runtimeCase.initialMode.name} runtime Account'),
          findsOneWidget,
        );
        expect(AppModeStateService.selectedMode.value, runtimeCase.initialMode);

        expect(
          await tester.binding.handlePushRoute(runtimeCase.routeName),
          isTrue,
        );
        await tester.pumpAndSettle();

        final offstageShellFinder = find.byType(
          MainNavigationScreen,
          skipOffstage: false,
        );
        final shellSwitcherFinder = find.descendant(
          of: offstageShellFinder,
          matching: find.byType(AppModeSwitcherBar, skipOffstage: false),
          skipOffstage: false,
        );
        final selectedHomeIconFinder = find.descendant(
          of: offstageShellFinder,
          matching: find.byIcon(Icons.home, skipOffstage: false),
          skipOffstage: false,
        );
        final unselectedAccountIconFinder = find.descendant(
          of: offstageShellFinder,
          matching: find.byIcon(Icons.person_outline, skipOffstage: false),
          skipOffstage: false,
        );
        final destinationFinder = find.byKey(
          ValueKey('runtime-destination-${runtimeCase.restaurantId}'),
        );

        expect(AppModeStateService.selectedMode.value, runtimeCase.targetMode);
        expect(shellSwitcherFinder, findsOneWidget);
        expect(
          tester.widget<AppModeSwitcherBar>(shellSwitcherFinder).selectedMode,
          runtimeCase.targetMode,
        );
        expect(selectedHomeIconFinder, findsOneWidget);
        expect(unselectedAccountIconFinder, findsOneWidget);
        expect(offstageShellFinder, findsOneWidget);
        expect(
          identical(tester.state(offstageShellFinder), shellState),
          isTrue,
        );
        expect(
          identical(
            ModalRoute.of(tester.element(offstageShellFinder)),
            shellRoute,
          ),
          isTrue,
        );
        expect(destinationBuilds, 1);
        expect(destinationFinder, findsOneWidget);
        expect(
          ModalRoute.of(tester.element(destinationFinder))?.settings.name,
          runtimeCase.routeName,
        );

        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();

        expect(destinationFinder, findsNothing);
        expect(
          find.text('${runtimeCase.targetMode.name}-runtime-home page'),
          findsOneWidget,
        );
        expect(shellFinder, findsOneWidget);
        expect(identical(tester.state(shellFinder), shellState), isTrue);
        expect(
          identical(ModalRoute.of(tester.element(shellFinder)), shellRoute),
          isTrue,
        );

        AppModeStateService.setMode(runtimeCase.initialMode);
        await tester.pump();
        expect(
          identical(
            tester.state<_NavigationProbePageState>(sourceHomeFinder),
            sourceHomeState,
          ),
          isTrue,
        );
        expect(sourceHomeState.queryController.text, 'retained source query');
        expect(
          counters
              .initializations['${runtimeCase.initialMode.name}-runtime-home'],
          1,
        );
      },
    );
  }

  testWidgets(
    'framework runtime writer refreshes the selected retained Home once on Back',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final currentUser = _NavigationTestUser(
        email: 'runtime-writer@example.com',
        uid: 'runtime-writer',
      );
      var writerCalls = 0;
      await tester.pumpWidget(
        bite_app.CouponApp(
          testWrapCelebrationHosts: false,
          testCustomerRouteBuilder: (_) => BiteScoreRestaurantDishesScreen(
            restaurant: _navigationBiteScoreEntry.restaurant,
            entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
            testInitialDataLoader: () async => (
              restaurant: _navigationBiteScoreEntry.restaurant,
              entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
              isFavorite: false,
            ),
            testWriteGate: (_) async => true,
            testCurrentUserProvider: () => currentUser,
            testFavoriteSaver: (_, _) async {
              writerCalls += 1;
            },
          ),
          testNavigationBuilder: (customerLink, inviteLink) =>
              MainNavigationScreen(
                initialMode: AppMode.biteSaver,
                initializePlatformServices: false,
                testCustomerAuthRealmProvider: () => 'signed:runtime-writer',
                testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                    _RefreshGenerationProbeHome(
                      key: ValueKey('${mode.name}-runtime-writer-home'),
                      navigationRefreshGeneration: navigationRefreshGeneration,
                    ),
                testPagesBuilder: (mode) => <Widget>[
                  const SizedBox.shrink(),
                  Text('${mode.name} runtime writer Hub'),
                  Text('${mode.name} runtime writer Account'),
                ],
              ),
        ),
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.text('biteSaver runtime writer Account'), findsOneWidget);

      expect(
        await tester.binding.handlePushRoute(
          '/r/bitescore/runtime-writer-restaurant',
        ),
        isTrue,
      );
      await tester.pumpAndSettle();
      expect(find.byType(BiteScoreRestaurantDishesScreen), findsOneWidget);
      expect(AppModeStateService.selectedMode.value, AppMode.biteScore);

      await tester.tap(find.byTooltip('Save restaurant'));
      await tester.pumpAndSettle();
      expect(writerCalls, 1);

      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();

      final home = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-runtime-writer-home')),
      );
      expect(home.refreshes, 1);
      expect(find.text('refreshes 1'), findsOneWidget);
      expect(
        mainNavigationController.applyPendingHomeRefreshes(
          rootNavigatorKey.currentState!,
        ),
        isFalse,
      );
      expect(writerCalls, 1);
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
      expect(find.byType(BiteScoreRestaurantDishesScreen), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final returnCase in <({bool changed, bool markIntent, int refreshes})>[
    (changed: false, markIntent: false, refreshes: 0),
    (changed: true, markIntent: false, refreshes: 1),
    (changed: false, markIntent: true, refreshes: 1),
    (changed: true, markIntent: true, refreshes: 1),
  ]) {
    testWidgets(
      'deep-link Back changed=${returnCase.changed} intent=${returnCase.markIntent} '
      'refreshes revealed Home ${returnCase.refreshes} time(s)',
      (tester) async {
        final incoming = StreamController<String>.broadcast(sync: true);
        addTearDown(incoming.close);
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testIncomingRawDeepLinks: incoming.stream,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  _RefreshGenerationProbeHome(
                    key: ValueKey('${mode.name}-deep-link-return-home'),
                    navigationRefreshGeneration: navigationRefreshGeneration,
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Text('deep-link return Hub'),
                const Text('deep-link return Account'),
              ],
              testCustomerDeepLinkBuilder: (_) => _DeepLinkReturnProbe(
                changed: returnCase.changed,
                markIntent: returnCase.markIntent,
              ),
            ),
          ),
        );
        final home = tester.state<_RefreshGenerationProbeHomeState>(
          find.byKey(const ValueKey('biteScore-deep-link-return-home')),
        );

        incoming.add('https://go.bitestar.app/r/bitescore/dirty-return');
        await _settleAsync(tester);
        await tester.pumpAndSettle();
        expect(find.byType(_DeepLinkReturnProbe), findsOneWidget);

        await tester.tap(find.text('Return from linked restaurant'));
        await tester.pumpAndSettle();

        expect(find.byType(_DeepLinkReturnProbe), findsNothing);
        expect(find.text('refreshes ${returnCase.refreshes}'), findsOneWidget);
        expect(home.refreshes, returnCase.refreshes);
        expect(
          mainNavigationController.applyPendingHomeRefreshes(
            rootNavigatorKey.currentState!,
          ),
          isFalse,
        );
        await tester.pump();
        expect(home.refreshes, returnCase.refreshes);
      },
    );
  }

  testWidgets(
    'linked restaurant consumes only B mutation intent after A to B replacement',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final incoming = StreamController<String>.broadcast(sync: true);
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'signed:A';
      User? currentUser = _NavigationTestUser(
        email: 'linked-a@example.com',
        uid: 'A',
      );
      var writerCalls = 0;
      addTearDown(incoming.close);
      addTearDown(authChanges.close);
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testIncomingRawDeepLinks: incoming.stream,
            testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                _RefreshGenerationProbeHome(
                  key: ValueKey('${mode.name}-linked-auth-home'),
                  navigationRefreshGeneration: navigationRefreshGeneration,
                ),
            testPagesBuilder: (mode) => <Widget>[
              const SizedBox.shrink(),
              const Text('linked auth Hub'),
              const Text('linked auth Account'),
            ],
            testCustomerDeepLinkBuilder: (_) => BiteScoreRestaurantDishesScreen(
              restaurant: _navigationBiteScoreEntry.restaurant,
              entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
              testInitialDataLoader: () async => (
                restaurant: _navigationBiteScoreEntry.restaurant,
                entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
                isFavorite: false,
              ),
              testWriteGate: (_) async => true,
              testCurrentUserProvider: () => currentUser,
              testFavoriteSaver: (_, _) async {
                writerCalls += 1;
              },
            ),
          ),
        ),
      );

      incoming.add('https://go.bitestar.app/r/bitescore/auth-return');
      await _settleAsync(tester);
      await tester.pumpAndSettle();
      expect(find.byType(BiteScoreRestaurantDishesScreen), findsOneWidget);

      currentUser = _NavigationTestUser(
        email: 'linked-b@example.com',
        uid: 'B',
      );
      authRealm = 'signed:B';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Save restaurant'));
      await tester.pumpAndSettle();
      expect(writerCalls, 1);

      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();

      final home = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-linked-auth-home')),
      );
      expect(home.refreshes, 1);
      expect(find.text('refreshes 1'), findsOneWidget);
      expect(
        mainNavigationController.applyPendingHomeRefreshes(
          rootNavigatorKey.currentState!,
        ),
        isFalse,
      );
      expect(writerCalls, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('runtime canonical Home route returns to the retained shell', (
    tester,
  ) async {
    await tester.pumpWidget(
      bite_app.CouponApp(
        testWrapCelebrationHosts: false,
        testCustomerRouteBuilder: (link) => Scaffold(
          body: Text('runtime Home-return destination ${link.restaurantId}'),
        ),
        testNavigationBuilder: (customerLink, inviteLink) =>
            MainNavigationScreen(
              initializePlatformServices: false,
              testPagesBuilder: (mode) => <Widget>[
                Text('${mode.name} retained runtime Home'),
                const Text('runtime retained Hub'),
                const Text('runtime retained Account'),
              ],
            ),
      ),
    );
    final shellFinder = find.byType(MainNavigationScreen);
    final shellState = tester.state(shellFinder);

    expect(
      await tester.binding.handlePushRoute('/r/bitescore/runtime-home-return'),
      isTrue,
    );
    await tester.pumpAndSettle();
    expect(
      find.text('runtime Home-return destination runtime-home-return'),
      findsOneWidget,
    );

    expect(await tester.binding.handlePushRoute('/'), isTrue);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(
      find.text('runtime Home-return destination runtime-home-return'),
      findsNothing,
    );
    expect(find.text('biteScore retained runtime Home'), findsOneWidget);
    expect(shellFinder, findsOneWidget);
    expect(identical(tester.state(shellFinder), shellState), isTrue);
    expect(
      ModalRoute.of(tester.element(shellFinder))?.settings.name,
      Navigator.defaultRouteName,
    );
  });

  for (final mutationKind in _DelayedMutationKind.values) {
    for (final succeeds in <bool>[true, false]) {
      testWidgets(
        '${mutationKind.label} ${succeeds ? 'success' : 'failure'} after disposal '
        '${succeeds ? 'refreshes' : 'does not refresh'} the retained Home',
        (tester) async {
          tester.view.physicalSize = const Size(900, 1400);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final write = Completer<void>();
          var writerCalls = 0;
          await tester.pumpWidget(_refreshDeliveryTestApp());
          final home = tester.state<_RefreshGenerationProbeHomeState>(
            find.byKey(const ValueKey('biteScore-delivery-home')),
          );

          await _startDelayedMutationHandler(
            tester,
            mutationKind: mutationKind,
            write: write.future,
            onWriterStarted: () => writerCalls += 1,
          );
          expect(writerCalls, 1);
          final sourceContext = tester.element(mutationKind.widgetFinder);
          openMainNavigationDestination(
            sourceContext,
            mode: AppMode.biteScore,
            index: 0,
          );
          await tester.pumpAndSettle();
          expect(mutationKind.widgetFinder, findsNothing);

          if (succeeds) {
            write.complete();
          } else {
            write.completeError(StateError('synthetic delayed failure'));
          }
          await _settleAsync(tester);
          await tester.pump();

          expect(home.refreshes, succeeds ? 1 : 0);
          expect(writerCalls, 1);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  for (final mutationKind in _DelayedMutationKind.values) {
    testWidgets(
      '${mutationKind.label} completion from signed A cannot refresh signed B',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final authChanges = StreamController<String>.broadcast(sync: true);
        final write = Completer<void>();
        var authRealm = 'signed:A';
        User? currentUser = _NavigationTestUser(
          email: 'owner-a@example.com',
          uid: 'A',
        );
        var writerCalls = 0;
        addTearDown(authChanges.close);
        await tester.pumpWidget(
          _refreshDeliveryTestApp(
            keyScope: 'auth-delivery',
            authRealmProvider: () => authRealm,
            authRealmChanges: authChanges.stream,
          ),
        );

        await _startDelayedMutationHandler(
          tester,
          mutationKind: mutationKind,
          write: write.future,
          currentUserProvider: () => currentUser,
          onWriterStarted: () => writerCalls += 1,
        );
        expect(writerCalls, 1);
        authRealm = 'signed:B';
        currentUser = _NavigationTestUser(
          email: 'owner-b@example.com',
          uid: 'B',
        );
        authChanges.add(authRealm);
        await tester.pump();
        if (mutationKind.widgetFinder.evaluate().isNotEmpty) {
          openMainNavigationDestination(
            tester.element(mutationKind.widgetFinder),
            mode: AppMode.biteScore,
            index: 0,
          );
        }
        await tester.pumpAndSettle();
        final home = tester.state<_RefreshGenerationProbeHomeState>(
          find.byKey(const ValueKey('biteScore-auth-delivery-home')),
        );

        write.complete();
        await _settleAsync(tester);
        await tester.pump();

        expect(home.refreshes, 0);
        expect(writerCalls, 1);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('A to guest to A still rejects the original A delivery', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final authChanges = StreamController<String>.broadcast(sync: true);
    final write = Completer<void>();
    var authRealm = 'signed:A';
    addTearDown(authChanges.close);
    await tester.pumpWidget(
      _refreshDeliveryTestApp(
        keyScope: 'aba-delivery',
        authRealmProvider: () => authRealm,
        authRealmChanges: authChanges.stream,
      ),
    );
    await _startDelayedMutationHandler(
      tester,
      mutationKind: _DelayedMutationKind.dishReview,
      write: write.future,
      currentUserProvider: () =>
          _NavigationTestUser(email: 'a@example.com', uid: 'A'),
    );

    authRealm = 'guest';
    authChanges.add(authRealm);
    await tester.pump();
    authRealm = 'signed:A';
    authChanges.add(authRealm);
    await tester.pump();
    openMainNavigationDestination(
      tester.element(find.byType(BiteScoreDishDetailScreen)),
      mode: AppMode.biteScore,
      index: 0,
    );
    await tester.pumpAndSettle();
    final currentAHome = tester.state<_RefreshGenerationProbeHomeState>(
      find.byKey(const ValueKey('biteScore-aba-delivery-home')),
    );

    write.complete();
    await _settleAsync(tester);
    await tester.pump();

    expect(currentAHome.refreshes, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cancelled dish write gate creates no Home notification', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var saverCalls = 0;
    await tester.pumpWidget(_refreshDeliveryTestApp());
    final home = tester.state<_RefreshGenerationProbeHomeState>(
      find.byKey(const ValueKey('biteScore-delivery-home')),
    );
    unawaited(
      rootNavigatorKey.currentState!.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: _navigationBiteScoreEntry,
            scrollToReviewSection: true,
            testInitialLoader: () async {},
            testWriteGate: (_) async => false,
            testCurrentUserProvider: () => _NavigationTestUser(
              email: 'reviewer@example.com',
              uid: 'navigation-reviewer',
            ),
            testReviewSaver:
                ({
                  required dish,
                  required restaurant,
                  required overallImpression,
                  required headline,
                  required notes,
                  required tastinessScore,
                  required qualityScore,
                  required valueScore,
                }) async {
                  saverCalls += 1;
                  return _navigationReviewSaveResult('cancelled-review');
                },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final detail = find.byType(BiteScoreDishDetailScreen);
    for (final slider in tester.widgetList<Slider>(
      find.descendant(of: detail, matching: find.byType(Slider)),
    )) {
      slider.onChanged?.call(7);
    }
    await tester.pump();
    final saveButton = find.descendant(
      of: detail,
      matching: find.widgetWithText(ElevatedButton, 'Save Review'),
    );
    await tester.ensureVisible(saveButton);
    await tester.tap(saveButton);
    await _settleAsync(tester);

    expect(saverCalls, 0);
    expect(home.refreshes, 0);
    openMainNavigationDestination(
      tester.element(detail),
      mode: AppMode.biteScore,
      index: 0,
    );
    await tester.pumpAndSettle();
    expect(home.refreshes, 0);
  });

  testWidgets(
    'late success from a replaced shell cannot refresh the replacement root',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final write = Completer<void>();
      await tester.pumpWidget(
        _refreshDeliveryTestApp(keyScope: 'obsolete-root'),
      );
      await _startDelayedMutationHandler(
        tester,
        mutationKind: _DelayedMutationKind.dishReview,
        write: write.future,
      );

      unawaited(
        rootNavigatorKey.currentState!.pushAndRemoveUntil<void>(
          MaterialPageRoute<void>(
            builder: (_) => MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  _RefreshGenerationProbeHome(
                    key: ValueKey('${mode.name}-replacement-root-home'),
                    navigationRefreshGeneration: navigationRefreshGeneration,
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Text('replacement root Hub'),
                const Text('replacement root Account'),
              ],
            ),
          ),
          (_) => false,
        ),
      );
      await tester.pumpAndSettle();
      final replacementHome = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-replacement-root-home')),
      );

      write.complete();
      await _settleAsync(tester);
      await tester.pump();

      expect(replacementHome.refreshes, 0);
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'signed A create-rate draft cannot dispatch after replacement by B',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final authChanges = StreamController<String>.broadcast(sync: true);
      final gate = Completer<bool>();
      var authRealm = 'signed:draft-a';
      User? currentUser = _NavigationTestUser(
        email: 'draft-a@example.com',
        uid: 'draft-a',
      );
      var saverCalls = 0;
      addTearDown(authChanges.close);

      await tester.pumpWidget(
        _refreshDeliveryTestApp(
          authRealmProvider: () => authRealm,
          authRealmChanges: authChanges.stream,
        ),
      );
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => BiteScoreCreateRateScreen(
              existingEntry: _navigationBiteScoreEntry,
              testCurrentUserProvider: () => currentUser,
              testWriteGate: (_) => gate.future,
              testReviewSaver:
                  ({
                    required dish,
                    required restaurant,
                    required overallImpression,
                    required headline,
                    required notes,
                    required tastinessScore,
                    required qualityScore,
                    required valueScore,
                  }) async {
                    saverCalls += 1;
                    return _navigationReviewSaveResult('forbidden-B-save');
                  },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final screen = find.byType(BiteScoreCreateRateScreen);
      for (final slider in tester.widgetList<Slider>(
        find.descendant(of: screen, matching: find.byType(Slider)),
      )) {
        slider.onChanged?.call(7);
      }
      await tester.pump();
      final saveButton = find.descendant(
        of: screen,
        matching: find.widgetWithText(ElevatedButton, 'Save Review'),
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pump();

      currentUser = _NavigationTestUser(
        email: 'draft-b@example.com',
        uid: 'draft-b',
      );
      authRealm = 'signed:draft-b';
      authChanges.add(authRealm);
      await tester.pump();
      gate.complete(true);
      await _settleAsync(tester);

      expect(saverCalls, 0);
      expect(find.byType(BiteScoreCreateRateScreen), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final mutationKind in _delayedAuthGatedMutationKinds) {
    testWidgets(
      '${mutationKind.label} delayed auth gate cannot dispatch A work as B',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final authChanges = StreamController<String>.broadcast(sync: true);
        final gate = Completer<bool>();
        final unusedWrite = Completer<void>();
        var authRealm = 'signed:A';
        User? currentUser = _NavigationTestUser(
          email: 'gate-a@example.com',
          uid: 'A',
        );
        var writerCalls = 0;
        addTearDown(authChanges.close);
        await tester.pumpWidget(
          _refreshDeliveryTestApp(
            keyScope: 'delayed-gate-${mutationKind.name}',
            authRealmProvider: () => authRealm,
            authRealmChanges: authChanges.stream,
          ),
        );

        await _startDelayedMutationHandler(
          tester,
          mutationKind: mutationKind,
          write: unusedWrite.future,
          writeGate: gate.future,
          stopAtWriteGate: true,
          currentUserProvider: () => currentUser,
          onWriterStarted: () => writerCalls += 1,
        );
        expect(writerCalls, 0);

        currentUser = _NavigationTestUser(
          email: 'gate-b@example.com',
          uid: 'B',
        );
        authRealm = 'signed:B';
        authChanges.add(authRealm);
        await tester.pump();
        gate.complete(true);
        await _settleAsync(tester);

        expect(writerCalls, 0);
        expect(mutationKind.widgetFinder, findsOneWidget);
        expect(find.byType(SnackBar), findsNothing);
        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final mutationKind in _delayedAuthGatedMutationKinds) {
    testWidgets(
      '${mutationKind.label} stale A failure cannot alter or notify B',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final authChanges = StreamController<String>.broadcast(sync: true);
        final write = Completer<void>();
        var authRealm = 'signed:A';
        User? currentUser = _NavigationTestUser(
          email: 'failure-a@example.com',
          uid: 'A',
        );
        var writerCalls = 0;
        addTearDown(authChanges.close);
        await tester.pumpWidget(
          _refreshDeliveryTestApp(
            keyScope: 'stale-failure-${mutationKind.name}',
            authRealmProvider: () => authRealm,
            authRealmChanges: authChanges.stream,
          ),
        );
        await _startDelayedMutationHandler(
          tester,
          mutationKind: mutationKind,
          write: write.future,
          currentUserProvider: () => currentUser,
          onWriterStarted: () => writerCalls += 1,
        );
        expect(writerCalls, 1);

        currentUser = _NavigationTestUser(
          email: 'failure-b@example.com',
          uid: 'B',
        );
        authRealm = 'signed:B';
        authChanges.add(authRealm);
        await tester.pumpAndSettle();
        write.completeError(StateError('stale A synthetic failure'));
        await _settleAsync(tester);

        expect(writerCalls, 1);
        expect(mutationKind.widgetFinder, findsOneWidget);
        expect(find.byType(SnackBar), findsNothing);
        if (mutationKind == _DelayedMutationKind.dishFavorite) {
          expect(find.byTooltip('Save dish'), findsOneWidget);
        }
        if (mutationKind == _DelayedMutationKind.restaurantFavorite) {
          expect(find.byTooltip('Save restaurant'), findsOneWidget);
        }
        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final transition in <String>['A→B', 'A→guest', 'A→guest→A']) {
    testWidgets(
      'public dish survives $transition with private draft and favorite cleared',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final authChanges = StreamController<String>.broadcast(sync: true);
        var authRealm = 'signed:A';
        User? currentUser = _NavigationTestUser(
          email: 'dish-a@example.com',
          uid: 'A',
        );
        addTearDown(authChanges.close);
        await tester.pumpWidget(
          _refreshDeliveryTestApp(
            keyScope: 'public-dish-$transition',
            authRealmProvider: () => authRealm,
            authRealmChanges: authChanges.stream,
          ),
        );
        final routeResult = rootNavigatorKey.currentState!.push<bool>(
          MaterialPageRoute<bool>(
            builder: (_) => BiteScoreDishDetailScreen(
              entry: _navigationBiteScoreEntry,
              testInitialLoader: () async {},
              testWriteGate: (_) async => true,
              testCurrentUserProvider: () => currentUser,
              testDishFavoriteSaver: (_, _, _) async {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        final detailFinder = find.byType(BiteScoreDishDetailScreen);
        final detailState = tester.state(detailFinder);
        final headline = find.descendant(
          of: detailFinder,
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is TextField &&
                widget.decoration?.labelText == 'Review Headline (Optional)',
          ),
        );
        await tester.enterText(headline, 'A private draft');
        await tester.tap(find.byTooltip('Save dish'));
        await tester.pumpAndSettle();
        expect(find.byTooltip('Unsave dish'), findsOneWidget);

        void replaceRealm(String nextRealm, User? nextUser) {
          currentUser = nextUser;
          authRealm = nextRealm;
          authChanges.add(nextRealm);
        }

        if (transition == 'A→B') {
          replaceRealm(
            'signed:B',
            _NavigationTestUser(email: 'dish-b@example.com', uid: 'B'),
          );
        } else {
          replaceRealm('guest', null);
          await tester.pumpAndSettle();
          if (transition == 'A→guest→A') {
            replaceRealm(
              'signed:A',
              _NavigationTestUser(email: 'dish-a@example.com', uid: 'A'),
            );
          }
        }
        await tester.pumpAndSettle();

        expect(detailFinder, findsOneWidget);
        expect(identical(tester.state(detailFinder), detailState), isTrue);
        expect(find.text('Navigation Test Dish'), findsWidgets);
        expect(tester.widget<TextField>(headline).controller?.text, isEmpty);
        expect(find.byTooltip('Save dish'), findsOneWidget);

        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(await routeResult, isFalse);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'same signed UID notification retains public dish private state',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'signed:A';
      User? currentUser = _NavigationTestUser(
        email: 'dish-a@example.com',
        uid: 'A',
      );
      addTearDown(authChanges.close);
      await tester.pumpWidget(
        _refreshDeliveryTestApp(
          keyScope: 'same-user-public-dish',
          authRealmProvider: () => authRealm,
          authRealmChanges: authChanges.stream,
        ),
      );
      final routeResult = rootNavigatorKey.currentState!.push<bool>(
        MaterialPageRoute<bool>(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: _navigationBiteScoreEntry,
            testInitialLoader: () async {},
            testWriteGate: (_) async => true,
            testCurrentUserProvider: () => currentUser,
            testDishFavoriteSaver: (_, _, _) async {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final detailFinder = find.byType(BiteScoreDishDetailScreen);
      final detailState = tester.state(detailFinder);
      final headline = find.descendant(
        of: detailFinder,
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Review Headline (Optional)',
        ),
      );
      await tester.enterText(headline, 'same A draft');
      await tester.tap(find.byTooltip('Save dish'));
      await tester.pumpAndSettle();

      currentUser = _NavigationTestUser(
        email: 'dish-a-renewed@example.com',
        uid: 'A',
      );
      authRealm = 'signed:A';
      authChanges.add(authRealm);
      await tester.pumpAndSettle();

      expect(identical(tester.state(detailFinder), detailState), isTrue);
      expect(
        tester.widget<TextField>(headline).controller?.text,
        'same A draft',
      );
      expect(find.byTooltip('Unsave dish'), findsOneWidget);
      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();
      expect(await routeResult, isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'same-UID Admin loss retires a pending dish editor before its first frame',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'signed:A';
      User? currentUser = _NavigationTestUser(
        email: 'schuyler.cole@gmail.com',
        uid: 'A',
      );
      addTearDown(authChanges.close);
      await tester.pumpWidget(
        _refreshDeliveryTestApp(
          keyScope: 'dish-admin-loss',
          authRealmProvider: () => authRealm,
          authRealmChanges: authChanges.stream,
        ),
      );
      final routeResult = rootNavigatorKey.currentState!.push<bool>(
        MaterialPageRoute<bool>(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: _navigationBiteScoreEntry,
            testInitialLoader: () async {},
            testWriteGate: (_) async => true,
            testCurrentUserProvider: () => currentUser,
            testDishFavoriteSaver: (_, _, _) async {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final detailFinder = find.byType(BiteScoreDishDetailScreen);
      final detailState = tester.state(detailFinder);
      final headline = find.descendant(
        of: detailFinder,
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Review Headline (Optional)',
        ),
      );
      await tester.enterText(headline, 'same user private draft');
      await tester.tap(find.byTooltip('Save dish'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Unsave dish'), findsOneWidget);

      final editDish = find.widgetWithText(OutlinedButton, 'Edit Dish');
      await tester.ensureVisible(editDish);
      await tester.tap(editDish);

      currentUser = _NavigationTestUser(
        email: 'former-admin@example.com',
        uid: 'A',
      );
      authChanges.add(authRealm);
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Edit Dish'), findsNothing);
      expect(detailFinder, findsOneWidget);
      expect(identical(tester.state(detailFinder), detailState), isTrue);
      expect(find.text('Navigation Test Dish'), findsWidgets);
      expect(
        tester.widget<TextField>(headline).controller?.text,
        'same user private draft',
      );
      expect(find.byTooltip('Unsave dish'), findsOneWidget);
      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();
      expect(await routeResult, isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('same-UID Admin loss retires a visible restaurant editor only', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final authChanges = StreamController<String>.broadcast(sync: true);
    var authRealm = 'signed:A';
    User? currentUser = _NavigationTestUser(
      email: 'schuyler.cole@gmail.com',
      uid: 'A',
    );
    addTearDown(authChanges.close);
    await tester.pumpWidget(
      _refreshDeliveryTestApp(
        keyScope: 'restaurant-admin-loss',
        authRealmProvider: () => authRealm,
        authRealmChanges: authChanges.stream,
      ),
    );
    final routeResult = rootNavigatorKey.currentState!.push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => BiteScoreRestaurantDishesScreen(
          restaurant: _navigationBiteScoreEntry.restaurant,
          entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
          testInitialDataLoader: () async => (
            restaurant: _navigationBiteScoreEntry.restaurant,
            entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
            isFavorite: false,
          ),
          testWriteGate: (_) async => true,
          testCurrentUserProvider: () => currentUser,
          testFavoriteSaver: (_, _) async {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    final restaurantFinder = find.byType(BiteScoreRestaurantDishesScreen);
    final restaurantState = tester.state(restaurantFinder);
    await tester.tap(find.byTooltip('Save restaurant'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Unsave restaurant'), findsOneWidget);

    final editRestaurant = find.widgetWithText(
      OutlinedButton,
      'Edit Basic Info',
    );
    await tester.ensureVisible(editRestaurant);
    await tester.tap(editRestaurant);
    await tester.pumpAndSettle();
    expect(find.text('Edit Restaurant Info'), findsOneWidget);
    // The existing owner form's dropdowns emit Flutter's debug-only
    // ListTile/DecoratedBox ink warning when the full dialog is rendered.
    tester.takeException();

    currentUser = _NavigationTestUser(
      email: 'former-admin@example.com',
      uid: 'A',
    );
    authChanges.add(authRealm);
    await tester.pumpAndSettle();

    expect(find.text('Edit Restaurant Info'), findsNothing);
    expect(
      find.widgetWithText(OutlinedButton, 'Edit Basic Info'),
      findsNothing,
    );
    expect(restaurantFinder, findsOneWidget);
    expect(identical(tester.state(restaurantFinder), restaurantState), isTrue);
    expect(find.text('Navigation Score Cafe'), findsWidgets);
    expect(find.byTooltip('Unsave restaurant'), findsOneWidget);
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(await routeResult, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'same-UID Admin-email loss retains management when that user is the owner',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final authChanges = StreamController<String>.broadcast(sync: true);
      var authRealm = 'signed:A';
      User? currentUser = _NavigationTestUser(
        email: 'schuyler.cole@gmail.com',
        uid: 'A',
      );
      final ownedRestaurant = _navigationBiteScoreEntry.restaurant.copyWith(
        ownerUserId: 'A',
        isClaimed: true,
      );
      final ownedEntry = _navigationEntryForRestaurant(ownedRestaurant);
      addTearDown(authChanges.close);
      await tester.pumpWidget(
        _refreshDeliveryTestApp(
          keyScope: 'owner-verdict-control',
          authRealmProvider: () => authRealm,
          authRealmChanges: authChanges.stream,
        ),
      );
      unawaited(
        rootNavigatorKey.currentState!.push<bool>(
          MaterialPageRoute<bool>(
            builder: (_) => BiteScoreRestaurantDishesScreen(
              restaurant: ownedRestaurant,
              entries: <BiteScoreHomeEntry>[ownedEntry],
              testInitialDataLoader: () async => (
                restaurant: ownedRestaurant,
                entries: <BiteScoreHomeEntry>[ownedEntry],
                isFavorite: false,
              ),
              testCurrentUserProvider: () => currentUser,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final editRestaurant = find.widgetWithText(
        OutlinedButton,
        'Edit Basic Info',
      );
      await tester.ensureVisible(editRestaurant);
      await tester.tap(editRestaurant);
      await tester.pumpAndSettle();
      expect(find.text('Edit Restaurant Info'), findsOneWidget);
      // Consume the same pre-existing debug-only owner-form ink warning.
      tester.takeException();

      currentUser = _NavigationTestUser(email: 'owner-a@example.com', uid: 'A');
      authChanges.add(authRealm);
      await tester.pumpAndSettle();

      expect(find.text('Edit Restaurant Info'), findsOneWidget);
      expect(editRestaurant, findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Edit Restaurant Info'), findsNothing);
      expect(find.byType(BiteScoreRestaurantDishesScreen), findsOneWidget);
      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('late success after root disposal creates no shell or work', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final write = Completer<void>();
    await tester.pumpWidget(_refreshDeliveryTestApp());
    await _startDelayedMutationHandler(
      tester,
      mutationKind: _DelayedMutationKind.createRate,
      write: write.future,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    write.complete();
    await _settleAsync(tester);
    await tester.pump();

    expect(rootNavigatorKey.currentState, isNull);
    expect(find.byType(MainNavigationScreen), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'disposed menu child notifies its mounted parent once and refreshes Home once',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final write = Completer<void>();
      var parentNotifications = 0;
      await tester.pumpWidget(_refreshDeliveryTestApp());
      final home = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-delivery-home')),
      );
      await _startDelayedMutationHandler(
        tester,
        mutationKind: _DelayedMutationKind.menuItem,
        write: write.future,
        menuOnChanged: () => parentNotifications += 1,
      );

      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      write.complete();
      await _settleAsync(tester);
      await tester.pump();

      expect(parentNotifications, 1);
      expect(home.refreshes, 1);
      await tester.tap(find.text('Account'));
      await tester.pump();
      expect(home.refreshes, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'mounted dish success and ordinary Back refresh the real Home exactly once',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      SharedLocationStateService.saveTypedLocation(
        latitude: 29.1872,
        longitude: -82.1401,
        label: 'Ocala, FL',
        searchText: '34470',
      );
      var homeLoads = 0;
      var saveCalls = 0;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
            child: MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  BiteScoreHomeScreen(
                    navigationRefreshGeneration: navigationRefreshGeneration,
                    testHomeEntriesLoader: () async {
                      homeLoads += 1;
                      return <BiteScoreHomeEntry>[_navigationBiteScoreEntry];
                    },
                    testDishDetailBuilder: (context, entry, distanceLabel) =>
                        BiteScoreDishDetailScreen(
                          entry: entry,
                          distanceLabel: distanceLabel,
                          scrollToReviewSection: true,
                          testInitialLoader: () async {},
                          testWriteGate: (_) async => true,
                          testCurrentUserProvider: () => _NavigationTestUser(
                            email: 'reviewer@example.com',
                            uid: 'navigation-reviewer',
                          ),
                          testSuppressLocalExpertBadgeRecalculation: true,
                          testReviewSaver:
                              ({
                                required dish,
                                required restaurant,
                                required overallImpression,
                                required headline,
                                required notes,
                                required tastinessScore,
                                required qualityScore,
                                required valueScore,
                              }) async {
                                saveCalls += 1;
                                return _navigationReviewSaveResult(
                                  'mounted-dish-review',
                                );
                              },
                        ),
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Text('mounted writer Hub'),
                const Text('mounted writer Account'),
              ],
            ),
          ),
        ),
      );
      await _pumpUntil(
        tester,
        () => find.text('Navigation Test Dish').evaluate().isNotEmpty,
      );
      expect(homeLoads, 1);

      await tester.tap(find.text('Navigation Test Dish').first);
      await tester.pumpAndSettle();
      final detail = find.byType(BiteScoreDishDetailScreen);
      final sliders = find.descendant(
        of: detail,
        matching: find.byType(Slider),
      );
      for (final slider in tester.widgetList<Slider>(sliders)) {
        slider.onChanged?.call(7);
      }
      await tester.pump();
      final saveButton = find.descendant(
        of: detail,
        matching: find.widgetWithText(ElevatedButton, 'Save Review'),
      );
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await _settleAsync(tester);
      expect(saveCalls, 1);

      await tester.pageBack();
      await _pumpUntil(tester, () => homeLoads >= 2);
      await tester.pumpAndSettle();
      expect(homeLoads, 2);
      await tester.tap(find.text('Account').last);
      await tester.pump();
      expect(homeLoads, 2);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'consuming an older intent snapshot preserves a newer same-owner mutation',
    (tester) async {
      await tester.pumpWidget(_refreshDeliveryTestApp());
      final navigator = rootNavigatorKey.currentState!;
      final owner = Object();
      final home = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-delivery-home')),
      );

      mainNavigationController.markHomeRefreshNeeded(
        owner: owner,
        navigator: navigator,
        mode: AppMode.biteScore,
      );
      final olderSnapshot = mainNavigationController
          .capturePendingHomeRefreshes(navigator, mode: AppMode.biteScore);
      mainNavigationController.markHomeRefreshNeeded(
        owner: owner,
        navigator: navigator,
        mode: AppMode.biteScore,
      );
      mainNavigationController.consumePendingHomeRefreshes(olderSnapshot);

      expect(
        mainNavigationController.applyPendingHomeRefreshes(navigator),
        isTrue,
      );
      await tester.pump();
      expect(home.refreshes, 1);
      expect(
        mainNavigationController.applyPendingHomeRefreshes(navigator),
        isFalse,
      );
      await tester.pump();
      expect(home.refreshes, 1);
    },
  );

  testWidgets(
    'BiteScore Home keeps the newer refresh when older success is late',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      SharedLocationStateService.saveTypedLocation(
        latitude: 29.1872,
        longitude: -82.1401,
        label: 'Ocala, FL',
        searchText: '34470',
      );
      final refreshA = Completer<List<BiteScoreHomeEntry>>();
      final refreshB = Completer<List<BiteScoreHomeEntry>>();
      var loads = 0;

      Widget buildHome(int generation) => MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
          child: BiteScoreHomeScreen(
            key: const ValueKey('latest-wins-home'),
            navigationRefreshGeneration: generation,
            testHomeEntriesLoader: () {
              loads += 1;
              return loads == 1 ? refreshA.future : refreshB.future;
            },
          ),
        ),
      );

      await tester.pumpWidget(buildHome(0));
      await tester.pumpWidget(buildHome(1));
      expect(loads, 2);

      refreshB.complete(<BiteScoreHomeEntry>[
        _navigationEntryNamed('newer-result'),
      ]);
      await _pumpUntil(
        tester,
        () => find.text('newer-result').evaluate().isNotEmpty,
      );
      refreshA.complete(<BiteScoreHomeEntry>[
        _navigationEntryNamed('older-result'),
      ]);
      await _settleAsync(tester);

      expect(find.text('newer-result'), findsOneWidget);
      expect(find.text('older-result'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('late older BiteScore error cannot replace newer success', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedLocationStateService.saveTypedLocation(
      latitude: 29.1872,
      longitude: -82.1401,
      label: 'Ocala, FL',
      searchText: '34470',
    );
    final refreshA = Completer<List<BiteScoreHomeEntry>>();
    final refreshB = Completer<List<BiteScoreHomeEntry>>();
    var loads = 0;

    Widget buildHome(int generation) => MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
        child: BiteScoreHomeScreen(
          key: const ValueKey('latest-error-home'),
          navigationRefreshGeneration: generation,
          testHomeEntriesLoader: () {
            loads += 1;
            return loads == 1 ? refreshA.future : refreshB.future;
          },
        ),
      ),
    );

    await tester.pumpWidget(buildHome(0));
    await tester.pumpWidget(buildHome(1));
    refreshB.complete(const <BiteScoreHomeEntry>[]);
    await _pumpUntil(
      tester,
      () => find
          .text(
            'No BiteScore dishes found yet. Use Create and Rate to add the first one.',
          )
          .evaluate()
          .isNotEmpty,
    );
    refreshA.completeError(StateError('stale A load failed'));
    await _settleAsync(tester);

    expect(
      find.text(
        'No BiteScore dishes found yet. Use Create and Rate to add the first one.',
      ),
      findsOneWidget,
    );
    expect(find.text('Could not load BiteScore dishes.'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('older completion cannot clear a newer BiteScore loading state', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedLocationStateService.saveTypedLocation(
      latitude: 29.1872,
      longitude: -82.1401,
      label: 'Ocala, FL',
      searchText: '34470',
    );
    final refreshA = Completer<List<BiteScoreHomeEntry>>();
    final refreshB = Completer<List<BiteScoreHomeEntry>>();
    var loads = 0;

    Widget buildHome(int generation) => MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
        child: BiteScoreHomeScreen(
          key: const ValueKey('latest-loading-home'),
          navigationRefreshGeneration: generation,
          testHomeEntriesLoader: () {
            loads += 1;
            return loads == 1 ? refreshA.future : refreshB.future;
          },
        ),
      ),
    );

    await tester.pumpWidget(buildHome(0));
    await tester.pumpWidget(buildHome(1));
    refreshA.complete(<BiteScoreHomeEntry>[
      _navigationEntryNamed('stale-loading-result'),
    ]);
    await _settleAsync(tester);

    expect(find.byType(CircularProgressIndicator), findsWidgets);
    expect(find.text('stale-loading-result'), findsNothing);

    refreshB.complete(<BiteScoreHomeEntry>[
      _navigationEntryNamed('current-loading-result'),
    ]);
    await _pumpUntil(
      tester,
      () => find.text('current-loading-result').evaluate().isNotEmpty,
    );
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('auth replacement rejects a stale real BiteScore Home result', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedLocationStateService.saveTypedLocation(
      latitude: 29.1872,
      longitude: -82.1401,
      label: 'Ocala, FL',
      searchText: '34470',
    );
    final authChanges = StreamController<String>.broadcast(sync: true);
    final ownerALoad = Completer<List<BiteScoreHomeEntry>>();
    final ownerBLoad = Completer<List<BiteScoreHomeEntry>>();
    var authRealm = 'signed:A';
    var loads = 0;
    addTearDown(authChanges.close);

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
          child: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => authRealm,
            testCustomerAuthRealmChanges: authChanges.stream,
            testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                BiteScoreHomeScreen(
                  navigationRefreshGeneration: navigationRefreshGeneration,
                  testHomeEntriesLoader: () {
                    loads += 1;
                    return loads == 1 ? ownerALoad.future : ownerBLoad.future;
                  },
                ),
            testPagesBuilder: (mode) => <Widget>[
              const SizedBox.shrink(),
              const Text('latest auth Hub'),
              const Text('latest auth Account'),
            ],
          ),
        ),
      ),
    );
    expect(loads, 1);

    authRealm = 'signed:B';
    authChanges.add(authRealm);
    await tester.pump();
    expect(loads, 2);
    ownerBLoad.complete(<BiteScoreHomeEntry>[
      _navigationEntryNamed('owner B current result'),
    ]);
    await _pumpUntil(
      tester,
      () => find.text('owner B current result').evaluate().isNotEmpty,
    );
    ownerALoad.complete(<BiteScoreHomeEntry>[
      _navigationEntryNamed('owner A stale result'),
    ]);
    await _settleAsync(tester);

    expect(find.text('owner B current result'), findsOneWidget);
    expect(find.text('owner A stale result'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('disposal rejects a stale real BiteScore Home result', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedLocationStateService.saveTypedLocation(
      latitude: 29.1872,
      longitude: -82.1401,
      label: 'Ocala, FL',
      searchText: '34470',
    );
    final load = Completer<List<BiteScoreHomeEntry>>();
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
          child: BiteScoreHomeScreen(testHomeEntriesLoader: () => load.future),
        ),
      ),
    );

    await tester.pumpWidget(const SizedBox.shrink());
    load.complete(<BiteScoreHomeEntry>[
      _navigationEntryNamed('disposed stale result'),
    ]);
    await _settleAsync(tester);
    await tester.pump();

    expect(find.text('disposed stale result'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('ordinary ordered BiteScore refresh applies exactly once', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedLocationStateService.saveTypedLocation(
      latitude: 29.1872,
      longitude: -82.1401,
      label: 'Ocala, FL',
      searchText: '34470',
    );
    var loads = 0;

    Widget buildHome(int generation) => MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
        child: BiteScoreHomeScreen(
          key: const ValueKey('ordered-refresh-home'),
          navigationRefreshGeneration: generation,
          testHomeEntriesLoader: () async {
            loads += 1;
            return <BiteScoreHomeEntry>[
              _navigationEntryNamed('ordered result $loads'),
            ];
          },
        ),
      ),
    );

    await tester.pumpWidget(buildHome(0));
    await _pumpUntil(
      tester,
      () => find.text('ordered result 1').evaluate().isNotEmpty,
    );
    await tester.pumpWidget(buildHome(1));
    await _pumpUntil(
      tester,
      () => find.text('ordered result 2').evaluate().isNotEmpty,
    );

    expect(loads, 2);
    expect(find.text('ordered result 2'), findsOneWidget);
    expect(find.text('ordered result 1'), findsNothing);
  });

  testWidgets(
    'cold invite intent suppresses a delayed matching stream delivery',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      addTearDown(incoming.close);
      var destinationBuilds = 0;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialInviteDeepLink: const RestaurantInviteDeepLink(
              side: 'bitescore',
              token: 'cold-stream-invite',
            ),
            initializePlatformServices: false,
            testIncomingRawDeepLinks: incoming.stream,
            testInviteDeepLinkBuilder: (_) {
              destinationBuilds += 1;
              return const Scaffold(
                body: Text('single cold invite destination'),
              );
            },
            testPagesBuilder: (mode) => <Widget>[
              Text('${mode.name} cold invite Home'),
              const Text('cold invite Hub'),
              const Text('cold invite Account'),
            ],
          ),
        ),
      );
      await _settleAsync(tester);
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 1)),
      );
      incoming.add(
        'https://go.bitestar.app/invite/bitescore/cold-stream-invite',
      );
      await _settleAsync(tester);
      await tester.pumpAndSettle();

      expect(destinationBuilds, 1);
      expect(find.text('single cold invite destination'), findsOneWidget);
    },
  );

  testWidgets(
    'Create and Rate propagates a nested restaurant change on ordinary Back',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      bool? createRateResult;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () async {
                    createRateResult = await Navigator.of(context).push<bool>(
                      MaterialPageRoute<bool>(
                        builder: (_) => BiteScoreCreateRateScreen(
                          testRestaurantFinderLoader: () async =>
                              <BitescoreRestaurant>[
                                _navigationBiteScoreEntry.restaurant,
                              ],
                          testRestaurantEntriesLoader: (_) async =>
                              <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
                          testRestaurantDishesBuilder:
                              (context, restaurant, entries) => Scaffold(
                                body: Center(
                                  child: ElevatedButton(
                                    onPressed: () =>
                                        Navigator.of(context).pop(true),
                                    child: const Text(
                                      'Return changed restaurant',
                                    ),
                                  ),
                                ),
                              ),
                        ),
                      ),
                    );
                  },
                  child: const Text('Open Create and Rate'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open Create and Rate'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('FL').last);
      await tester.pumpAndSettle();
      final restaurantNameField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Restaurant Name',
      );
      await tester.enterText(restaurantNameField, 'Navigation Score');
      await tester.pumpAndSettle();
      final restaurantSuggestion = find.textContaining(
        'Navigation Score Cafe',
        findRichText: true,
      );
      await tester.ensureVisible(restaurantSuggestion);
      await tester.tap(restaurantSuggestion);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Return changed restaurant'));
      await tester.pumpAndSettle();

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(createRateResult, isTrue);
      expect(find.text('Open Create and Rate'), findsOneWidget);
    },
  );

  testWidgets('active navigation maps Account to index 2 and has no Admin', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp());
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Restaurant\nHub'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('Admin'), findsNothing);
    await tester.tap(find.text('Account'));
    await tester.pump();
    expect(find.text('Account Page'), findsOneWidget);
    expect(find.text('Restaurant Hub Page'), findsNothing);
  });

  testWidgets('BiteSaver popup contains no Admin and Account uses index 2', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp());
    await tester.tap(find.byTooltip('Menu'));
    await tester.pumpAndSettle();
    expect(find.text('Admin'), findsNothing);
    expect(find.text('Restaurant Hub'), findsOneWidget);
    await tester.tap(find.text('Account').last);
    await tester.pumpAndSettle();
    expect(find.text('Account Page'), findsOneWidget);
  });

  testWidgets('obsolete initial index displays Home', (tester) async {
    await tester.pumpWidget(_testApp(initialIndex: 3));
    expect(find.text('biteSaver Home Page'), findsOneWidget);
    expect(find.text('Account Page'), findsNothing);
  });

  testWidgets('mode changes reset navigation to mode-specific Home', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp(initialIndex: 2));
    expect(find.text('Account Page'), findsOneWidget);
    AppModeStateService.setMode(AppMode.biteScore);
    await tester.pump();
    expect(find.text('biteScore Home Page'), findsOneWidget);
    expect(find.text('Account Page'), findsNothing);
  });

  testWidgets(
    'Home retains State, controls, expansion, scroll, and one initial load across tabs',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final counters = _NavigationProbeCounters();

      await tester.pumpWidget(_stateRetentionTestApp(counters: counters));
      final originalHomeState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );

      await tester.enterText(
        find.byKey(const ValueKey('biteSaver-home-query')),
        'pizza near me',
      );
      await tester.tap(find.byKey(const ValueKey('biteSaver-home-radius')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('30 miles').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('biteSaver-home-expand')));
      await tester.pump();
      await tester.drag(
        find.byKey(const ValueKey('biteSaver-home-list')),
        const Offset(0, -360),
      );
      await tester.pumpAndSettle();
      final originalOffset = originalHomeState.scrollController.offset;
      expect(originalOffset, greaterThan(0));

      await tester.tap(find.text('Restaurant\nHub'));
      await tester.pump();
      expect(counters.initializations['biteSaver-home'], 1);
      expect(counters.loads['biteSaver-home'], 1);
      expect(counters.initializations['hub'], 1);
      expect(counters.initializations['account'], isNull);
      expect(counters.initializations['biteScore-home'], isNull);

      await tester.tap(find.text('Home'));
      await tester.pump();
      final returnedHomeState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );
      expect(identical(returnedHomeState, originalHomeState), isTrue);
      expect(returnedHomeState.queryController.text, 'pizza near me');
      expect(returnedHomeState.radius, '30 miles');
      expect(returnedHomeState.expanded, isTrue);
      expect(
        returnedHomeState.scrollController.offset,
        closeTo(originalOffset, 0.01),
      );
      expect(counters.initializations['biteSaver-home'], 1);
      expect(counters.loads['biteSaver-home'], 1);
      expect(counters.disposals['biteSaver-home'], isNull);

      for (final viewport in <Size>[
        const Size(320, 640),
        const Size(760, 360),
        const Size(1280, 900),
      ]) {
        tester.view.physicalSize = viewport;
        await tester.pumpWidget(
          _stateRetentionTestApp(
            counters: counters,
            textScaler: const TextScaler.linear(1.5),
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(
          identical(
            tester.state<_NavigationProbePageState>(
              find.byKey(const ValueKey('biteSaver-home-probe')),
            ),
            originalHomeState,
          ),
          isTrue,
        );
      }
      expect(counters.initializations['biteSaver-home'], 1);
      expect(counters.loads['biteSaver-home'], 1);
    },
  );

  testWidgets(
    'real Home retains search, radius, results, expansion, scroll, and refresh semantics',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final signatures = StreamController<String>.broadcast(sync: true);
      var restaurantLoads = 0;
      addTearDown(signatures.close);

      await tester.pumpWidget(
        _realHomeRetentionTestApp(
          approvedSignatures: signatures.stream,
          onRestaurantLoad: () => restaurantLoads += 1,
        ),
      );
      await tester.pumpAndSettle();
      final dynamic originalHomeState = tester.state(find.byType(HomeScreen));
      expect(restaurantLoads, 1);
      expect(find.text('Retention Cafe'), findsOneWidget);

      originalHomeState.searchController.text = '34461';
      originalHomeState.generalSearchController.text = 'a';
      originalHomeState.runGeneralSearch();
      final radiusDropdown = tester.widget<DropdownButtonFormField<String>>(
        find.byType(DropdownButtonFormField<String>),
      );
      radiusDropdown.onChanged!('30 miles');
      await tester.pump();
      await tester.ensureVisible(find.text('▼ 1 more deal'));
      await tester.tap(find.text('▼ 1 more deal'));
      await tester.pumpAndSettle();
      expect(find.text('▲ Show fewer deals'), findsOneWidget);

      expect(find.text('ZZ Lazy Cafe 24'), findsNothing);
      await tester.dragUntilVisible(
        find.text('ZZ Lazy Cafe 24'),
        find.byType(CustomScrollView),
        const Offset(0, -500),
        maxIteration: 30,
      );
      expect(find.text('ZZ Lazy Cafe 24'), findsOneWidget);
      final homeScrollController = tester
          .widget<CustomScrollView>(find.byType(CustomScrollView))
          .controller!;
      final retainedOffset = homeScrollController.offset;
      expect(retainedOffset, greaterThan(0));

      await tester.tap(find.text('Restaurant\nHub'));
      await tester.pump();
      await tester.tap(find.text('Home'));
      await tester.pump();
      final dynamic returnedHomeState = tester.state(find.byType(HomeScreen));
      expect(identical(returnedHomeState, originalHomeState), isTrue);
      expect(returnedHomeState.searchController.text, '34461');
      expect(returnedHomeState.generalSearchController.text, 'a');
      expect(returnedHomeState.generalSearchQuery, 'a');
      expect(returnedHomeState.selectedRadius, '30 miles');
      expect(homeScrollController.offset, closeTo(retainedOffset, 0.01));
      expect(restaurantLoads, 1);

      homeScrollController.jumpTo(0);
      await tester.pump();
      expect(find.text('▲ Show fewer deals'), findsOneWidget);

      signatures.add('changed-public-source');
      await tester.pump();
      await tester.pump();
      expect(restaurantLoads, 2);

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) =>
                const _NavigationRefreshDetail(mode: AppMode.biteSaver),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(restaurantLoads, 3);

      await tester.tap(find.text('Home'));
      await tester.pump();
      expect(
        identical(tester.state(find.byType(HomeScreen)), originalHomeState),
        isTrue,
      );
      expect(find.text('▲ Show fewer deals'), findsOneWidget);
      expect(restaurantLoads, 3);
    },
  );

  for (final navigationCase
      in const <
        ({
          String label,
          bool useRootNavigation,
          bool isDirty,
          bool useSystemBack,
          bool? routeResult,
          int expectedLoads,
        })
      >[
        (
          label: 'ordinary detail Back',
          useRootNavigation: false,
          isDirty: true,
          useSystemBack: false,
          routeResult: false,
          expectedLoads: 2,
        ),
        (
          label: 'clean ordinary detail Back',
          useRootNavigation: false,
          isDirty: false,
          useSystemBack: false,
          routeResult: false,
          expectedLoads: 1,
        ),
        (
          label: 'null system Back',
          useRootNavigation: false,
          isDirty: false,
          useSystemBack: true,
          routeResult: null,
          expectedLoads: 1,
        ),
        (
          label: 'confirmed successful detail Back',
          useRootNavigation: false,
          isDirty: false,
          useSystemBack: false,
          routeResult: true,
          expectedLoads: 2,
        ),
        (
          label: 'dirty root navigation',
          useRootNavigation: true,
          isDirty: true,
          useSystemBack: false,
          routeResult: null,
          expectedLoads: 2,
        ),
        (
          label: 'clean root navigation',
          useRootNavigation: true,
          isDirty: false,
          useSystemBack: false,
          routeResult: null,
          expectedLoads: 1,
        ),
      ]) {
    testWidgets(
      'real BiteScore Home load count after ${navigationCase.label}',
      (tester) async {
        tester.view.physicalSize = const Size(900, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        SharedLocationStateService.saveTypedLocation(
          latitude: 29.1872,
          longitude: -82.1401,
          label: 'Ocala, FL',
          searchText: '34470',
        );
        var homeLoads = 0;
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
              child: MainNavigationScreen(
                initialMode: AppMode.biteScore,
                initializePlatformServices: false,
                testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                    BiteScoreHomeScreen(
                      navigationRefreshGeneration: navigationRefreshGeneration,
                      testHomeEntriesLoader: () async {
                        homeLoads += 1;
                        return <BiteScoreHomeEntry>[_navigationBiteScoreEntry];
                      },
                      testDishDetailBuilder: (context, entry, distanceLabel) {
                        return Scaffold(
                          body: Center(
                            child: navigationCase.useRootNavigation
                                ? Text(navigationCase.label)
                                : ElevatedButton(
                                    onPressed: () {
                                      if (navigationCase.isDirty) {
                                        mainNavigationController
                                            .markHomeRefreshNeeded(
                                              owner: entry,
                                              navigator: Navigator.of(
                                                context,
                                                rootNavigator: true,
                                              ),
                                              mode: AppMode.biteScore,
                                            );
                                      }
                                      Navigator.of(
                                        context,
                                      ).pop(navigationCase.routeResult);
                                    },
                                    child: const Text('Close ordinary detail'),
                                  ),
                          ),
                          bottomNavigationBar: navigationCase.useRootNavigation
                              ? PersistentBottomNavigation(
                                  mode: AppMode.biteScore,
                                  requestRootRefresh: navigationCase.isDirty,
                                )
                              : null,
                        );
                      },
                    ),
                testPagesBuilder: (mode) => <Widget>[
                  const SizedBox.shrink(),
                  const Center(child: Text('real BiteScore refresh Hub')),
                  const Center(child: Text('real BiteScore refresh Account')),
                ],
              ),
            ),
          ),
        );
        await _pumpUntil(
          tester,
          () => find.text('Navigation Test Dish').evaluate().isNotEmpty,
        );
        expect(homeLoads, 1);

        await tester.tap(find.text('Navigation Test Dish').first);
        await tester.pumpAndSettle();
        if (navigationCase.useRootNavigation) {
          await tester.tap(find.text('Account'));
        } else if (navigationCase.useSystemBack) {
          expect(await tester.binding.handlePopRoute(), isTrue);
        } else {
          await tester.tap(find.text('Close ordinary detail'));
        }
        if (navigationCase.expectedLoads > 1) {
          await _pumpUntil(
            tester,
            () => homeLoads >= navigationCase.expectedLoads,
          );
        } else {
          await tester.pumpAndSettle();
        }

        expect(homeLoads, navigationCase.expectedLoads);
        if (navigationCase.useRootNavigation) {
          expect(find.text('real BiteScore refresh Account'), findsOneWidget);
        } else {
          expect(find.text('Navigation Test Dish'), findsOneWidget);
          await tester.tap(find.text('Account'));
          await tester.pump();
          expect(homeLoads, navigationCase.expectedLoads);
        }
      },
    );
  }

  testWidgets('visited mode-specific Homes are retained and remain lazy', (
    tester,
  ) async {
    final counters = _NavigationProbeCounters();
    await tester.pumpWidget(_stateRetentionTestApp(counters: counters));
    final biteSaverState = tester.state<_NavigationProbePageState>(
      find.byKey(const ValueKey('biteSaver-home-probe')),
    );
    biteSaverState.queryController.text = 'saver search';

    AppModeStateService.setMode(AppMode.biteScore);
    await tester.pump();
    final biteScoreState = tester.state<_NavigationProbePageState>(
      find.byKey(const ValueKey('biteScore-home-probe')),
    );
    biteScoreState.queryController.text = 'score search';

    AppModeStateService.setMode(AppMode.biteSaver);
    await tester.pump();
    expect(
      identical(
        tester.state<_NavigationProbePageState>(
          find.byKey(const ValueKey('biteSaver-home-probe')),
        ),
        biteSaverState,
      ),
      isTrue,
    );
    expect(biteSaverState.queryController.text, 'saver search');

    AppModeStateService.setMode(AppMode.biteScore);
    await tester.pump();
    expect(
      identical(
        tester.state<_NavigationProbePageState>(
          find.byKey(const ValueKey('biteScore-home-probe')),
        ),
        biteScoreState,
      ),
      isTrue,
    );
    expect(biteScoreState.queryController.text, 'score search');
    expect(counters.initializations['biteSaver-home'], 1);
    expect(counters.initializations['biteScore-home'], 1);
    expect(counters.initializations['hub'], isNull);
    expect(counters.initializations['account'], isNull);
  });

  testWidgets(
    'cross-mode non-Home selection does not initialize the unvisited Home',
    (tester) async {
      final counters = _NavigationProbeCounters();
      await tester.pumpWidget(_stateRetentionTestApp(counters: counters));
      final biteSaverHomeState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const _CrossModeNavigationDetail(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(AppModeStateService.selectedMode.value, AppMode.biteScore);
      expect(counters.initializations['biteScore-home'], isNull);
      expect(counters.initializations['account'], 1);

      await tester.tap(find.text('Home'));
      await tester.pump();
      expect(counters.initializations['biteScore-home'], 1);

      AppModeStateService.setMode(AppMode.biteSaver);
      await tester.pump();
      expect(
        identical(
          tester.state<_NavigationProbePageState>(
            find.byKey(const ValueKey('biteSaver-home-probe')),
          ),
          biteSaverHomeState,
        ),
        isTrue,
      );
    },
  );

  testWidgets('retained pages receive updated widget inputs', (tester) async {
    final counters = _NavigationProbeCounters();
    await tester.pumpWidget(
      _stateRetentionTestApp(counters: counters, revision: 'first'),
    );
    final originalHomeState = tester.state<_NavigationProbePageState>(
      find.byKey(const ValueKey('biteSaver-home-probe')),
    );
    expect(find.text('widget revision first'), findsOneWidget);

    await tester.pumpWidget(
      _stateRetentionTestApp(counters: counters, revision: 'second'),
    );
    await tester.pump();

    expect(find.text('widget revision second'), findsOneWidget);
    expect(
      identical(
        tester.state<_NavigationProbePageState>(
          find.byKey(const ValueKey('biteSaver-home-probe')),
        ),
        originalHomeState,
      ),
      isTrue,
    );
    expect(counters.initializations['biteSaver-home'], 1);
  });

  testWidgets(
    'auth realm changes clear private page State and reject late prior-owner completion',
    (tester) async {
      final authChanges = StreamController<String>.broadcast(sync: true);
      final ownerALateCompletion = Completer<String>();
      final counters = _NavigationProbeCounters();
      var authRealm = 'signed:A';
      addTearDown(authChanges.close);

      await tester.pumpWidget(
        _stateRetentionTestApp(
          counters: counters,
          authRealmProvider: () => authRealm,
          authRealmChanges: authChanges.stream,
          ownerALateCompletion: ownerALateCompletion.future,
        ),
      );
      final ownerAState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );
      ownerAState.queryController.text = 'A private search';

      authRealm = 'signed:B';
      authChanges.add(authRealm);
      await tester.pump();
      final ownerBState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );
      expect(identical(ownerBState, ownerAState), isFalse);
      expect(ownerBState.queryController.text, isEmpty);
      expect(find.text('auth realm signed:B'), findsOneWidget);
      expect(counters.disposals['biteSaver-home'], 1);

      ownerALateCompletion.complete('late A private result');
      await tester.pump();
      expect(find.textContaining('late A private result'), findsNothing);
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Account'));
      await tester.pump();
      authRealm = 'signed:C';
      authChanges.add(authRealm);
      await tester.pump();
      expect(find.byKey(const ValueKey('biteSaver-home-probe')), findsNothing);
      expect(counters.initializations['biteSaver-home'], 2);

      await tester.tap(find.text('Home'));
      await tester.pump();
      final ownerCState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );
      expect(find.text('auth realm signed:C'), findsOneWidget);
      expect(counters.initializations['biteSaver-home'], 3);

      authRealm = 'guest';
      authChanges.add(authRealm);
      await tester.pump();
      expect(
        identical(
          tester.state<_NavigationProbePageState>(
            find.byKey(const ValueKey('biteSaver-home-probe')),
          ),
          ownerCState,
        ),
        isFalse,
      );
      expect(find.text('auth realm guest'), findsOneWidget);
      expect(counters.initializations['biteSaver-home'], 4);
    },
  );

  testWidgets(
    'detail Back and detail navigation reuse the root shell and retained Home',
    (tester) async {
      final counters = _NavigationProbeCounters();
      await tester.pumpWidget(_stateRetentionTestApp(counters: counters));
      final originalShellState = tester.state(
        find.byType(MainNavigationScreen),
      );
      final originalHomeState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );
      originalHomeState.queryController.text = 'keep this';

      await tester.tap(
        find.byKey(const ValueKey('biteSaver-home-open-detail')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Coupon Details'), findsOneWidget);
      await tester.tap(find.byTooltip('Back'));
      await tester.pumpAndSettle();
      expect(
        identical(
          tester.state<_NavigationProbePageState>(
            find.byKey(const ValueKey('biteSaver-home-probe')),
          ),
          originalHomeState,
        ),
        isTrue,
      );

      await tester.tap(
        find.byKey(const ValueKey('biteSaver-home-open-detail')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.byType(MainNavigationScreen), findsOneWidget);
      expect(
        identical(
          tester.state(find.byType(MainNavigationScreen)),
          originalShellState,
        ),
        isTrue,
      );
      expect(find.text('account page'), findsOneWidget);

      await tester.tap(find.text('Home'));
      await tester.pump();
      expect(
        identical(
          tester.state<_NavigationProbePageState>(
            find.byKey(const ValueKey('biteSaver-home-probe')),
          ),
          originalHomeState,
        ),
        isTrue,
      );
      expect(originalHomeState.queryController.text, 'keep this');
      expect(counters.initializations['biteSaver-home'], 1);
      expect(counters.loads['biteSaver-home'], 1);
    },
  );

  testWidgets('Admin entry and Back preserve the root shell and Home State', (
    tester,
  ) async {
    final counters = _NavigationProbeCounters();
    final admin = _NavigationTestUser(email: 'schuyler.cole@gmail.com');

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MainNavigationScreen(
          initializePlatformServices: false,
          testPagesBuilder: (mode) => <Widget>[
            _NavigationProbePage(
              key: ValueKey('${mode.name}-admin-home-probe'),
              label: '${mode.name}-admin-home',
              counters: counters,
            ),
            const Center(child: Text('admin probe Hub')),
            CustomerAccountScreen(
              userStream: Stream<User?>.value(admin),
              adminDestinationBuilder: (_) => AdminGateScreen(
                userStream: Stream<User?>.value(admin),
                couponAdminBuilder: (_) => const SizedBox.expand(
                  key: ValueKey('integrated-admin-content'),
                ),
                ratingAdminBuilder: (_) => const SizedBox.shrink(),
                linkGenerationBuilder: (_) => const SizedBox.shrink(),
              ),
            ),
          ],
        ),
      ),
    );
    final originalShellState = tester.state(find.byType(MainNavigationScreen));
    final originalHomeState = tester.state<_NavigationProbePageState>(
      find.byKey(const ValueKey('biteSaver-admin-home-probe')),
    );

    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Admin Workspace'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('integrated-admin-content')),
      findsOneWidget,
    );
    expect(
      find.byType(MainNavigationScreen, skipOffstage: false),
      findsOneWidget,
    );

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(
      identical(
        tester.state(find.byType(MainNavigationScreen)),
        originalShellState,
      ),
      isTrue,
    );
    await tester.tap(find.text('Home'));
    await tester.pump();
    expect(
      identical(
        tester.state<_NavigationProbePageState>(
          find.byKey(const ValueKey('biteSaver-admin-home-probe')),
        ),
        originalHomeState,
      ),
      isTrue,
    );
  });

  testWidgets('deep-link safe Home reuses the root shell and correct mode', (
    tester,
  ) async {
    final counters = _NavigationProbeCounters();
    await tester.pumpWidget(_stateRetentionTestApp(counters: counters));
    final originalShellState = tester.state(find.byType(MainNavigationScreen));
    final originalHomeState = tester.state<_NavigationProbePageState>(
      find.byKey(const ValueKey('biteSaver-home-probe')),
    );

    unawaited(
      rootNavigatorKey.currentState!.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => RestaurantCustomerDeepLinkScreen(
            side: 'bitescore',
            restaurantId: 'missing-restaurant',
            biteScoreRestaurantLoader: (_) async => null,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('This BiteScore restaurant is not currently available.'),
      findsOneWidget,
    );

    await tester.tap(find.text('Go to Home'));
    await tester.pumpAndSettle();
    expect(find.byType(MainNavigationScreen), findsOneWidget);
    expect(
      identical(
        tester.state(find.byType(MainNavigationScreen)),
        originalShellState,
      ),
      isTrue,
    );
    expect(AppModeStateService.selectedMode.value, AppMode.biteScore);
    expect(find.byKey(const ValueKey('biteScore-home-probe')), findsOneWidget);

    AppModeStateService.setMode(AppMode.biteSaver);
    await tester.pump();
    expect(
      identical(
        tester.state<_NavigationProbePageState>(
          find.byKey(const ValueKey('biteSaver-home-probe')),
        ),
        originalHomeState,
      ),
      isTrue,
    );
  });

  testWidgets(
    'detail selection collapses duplicate shells to the canonical root',
    (tester) async {
      final counters = _NavigationProbeCounters();
      await tester.pumpWidget(_stateRetentionTestApp(counters: counters));
      final canonicalShellState = tester.state(
        find.byType(MainNavigationScreen),
      );
      final canonicalHomeState = tester.state<_NavigationProbePageState>(
        find.byKey(const ValueKey('biteSaver-home-probe')),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => MainNavigationScreen(
              initializePlatformServices: false,
              testPagesBuilder: (mode) => <Widget>[
                Text('duplicate ${mode.name} Home'),
                const Text('duplicate Hub'),
                const Text('duplicate Account'),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => CouponDetailScreen(
              coupon: const Coupon(
                id: 'duplicate-shell-coupon',
                restaurant: 'Probe Restaurant',
                title: 'Duplicate Shell Coupon',
                distance: '',
                usageRule: 'Unlimited',
              ),
              loadFavoriteState: (_) async => false,
              loadCustomerVisibility: (_, _) async => true,
              initializeRedemptionStore: () async {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.byType(MainNavigationScreen), findsOneWidget);
      expect(
        identical(
          tester.state(find.byType(MainNavigationScreen)),
          canonicalShellState,
        ),
        isTrue,
      );
      expect(find.text('account page'), findsOneWidget);

      await tester.tap(find.text('Home'));
      await tester.pump();
      expect(
        identical(
          tester.state<_NavigationProbePageState>(
            find.byKey(const ValueKey('biteSaver-home-probe')),
          ),
          canonicalHomeState,
        ),
        isTrue,
      );
    },
  );

  testWidgets(
    'dirty duplicate-shell ancestor transfers one refresh to the canonical Home',
    (tester) async {
      await tester.pumpWidget(
        _refreshDeliveryTestApp(keyScope: 'canonical-duplicate'),
      );
      final canonicalShell = tester.state(find.byType(MainNavigationScreen));
      final canonicalHome = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-canonical-duplicate-home')),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  _RefreshGenerationProbeHome(
                    key: ValueKey('${mode.name}-dirty-duplicate-home'),
                    navigationRefreshGeneration: navigationRefreshGeneration,
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Text('dirty duplicate Hub'),
                const Text('dirty duplicate Account'),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      mainNavigationController.markHomeRefreshNeeded(
        owner: Object(),
        navigator: rootNavigatorKey.currentState!,
        mode: AppMode.biteScore,
      );
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(
              body: Text('clean duplicate descendant'),
              bottomNavigationBar: PersistentBottomNavigation(
                mode: AppMode.biteScore,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(find.byType(MainNavigationScreen), findsOneWidget);
      expect(
        identical(
          tester.state(find.byType(MainNavigationScreen)),
          canonicalShell,
        ),
        isTrue,
      );
      expect(canonicalHome.refreshes, 1);
      expect(find.text('delivery Account'), findsOneWidget);
    },
  );

  testWidgets(
    'current duplicate receives late delivery before canonical pending work',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        _refreshDeliveryTestApp(keyScope: 'priority-canonical'),
      );
      final canonicalHome = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-priority-canonical-home')),
      );
      mainNavigationController.markHomeRefreshNeeded(
        owner: Object(),
        navigator: rootNavigatorKey.currentState!,
        mode: AppMode.biteScore,
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  _RefreshGenerationProbeHome(
                    key: ValueKey('${mode.name}-priority-duplicate-home'),
                    navigationRefreshGeneration: navigationRefreshGeneration,
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Text('priority duplicate Hub'),
                const Text('priority duplicate Account'),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final duplicateHome = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-priority-duplicate-home')),
      );
      final write = Completer<void>();
      await _startDelayedMutationHandler(
        tester,
        mutationKind: _DelayedMutationKind.menuItem,
        write: write.future,
      );
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();

      write.complete();
      await _settleAsync(tester);
      await tester.pump();

      expect(duplicateHome.refreshes, 1);
      expect(canonicalHome.refreshes, 0);

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(canonicalHome.refreshes, 1);
      expect(find.byType(MainNavigationScreen), findsOneWidget);
    },
  );

  testWidgets('root-owned BiteScore refresh crosses nested routes', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MainNavigationScreen(
          initialMode: AppMode.biteScore,
          initializePlatformServices: false,
          testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
              _RefreshGenerationProbeHome(
                key: ValueKey('${mode.name}-refresh-probe'),
                navigationRefreshGeneration: navigationRefreshGeneration,
              ),
          testPagesBuilder: (mode) => <Widget>[
            const SizedBox.shrink(),
            const Center(child: Text('refresh probe Hub')),
            const Center(child: Text('refresh probe Account')),
          ],
        ),
      ),
    );
    final originalShellState = tester.state(find.byType(MainNavigationScreen));
    final originalHomeState = tester.state<_RefreshGenerationProbeHomeState>(
      find.byType(_RefreshGenerationProbeHome),
    );

    await tester.tap(find.text('Open refresh chain'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open changed BiteScore detail'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();

    expect(
      identical(
        tester.state(find.byType(MainNavigationScreen)),
        originalShellState,
      ),
      isTrue,
    );
    expect(originalHomeState.refreshes, 1);
    expect(find.text('refresh probe Account'), findsOneWidget);
    await tester.tap(find.text('Home'));
    await tester.pump();
    expect(
      identical(
        tester.state<_RefreshGenerationProbeHomeState>(
          find.byType(_RefreshGenerationProbeHome),
        ),
        originalHomeState,
      ),
      isTrue,
    );
    expect(find.text('refreshes 1'), findsOneWidget);
  });

  testWidgets(
    'pending refresh survives ordinary Back through an intermediate caller',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                _RefreshGenerationProbeHome(
                  key: ValueKey('${mode.name}-ignored-return-refresh-probe'),
                  navigationRefreshGeneration: navigationRefreshGeneration,
                ),
            testPagesBuilder: (mode) => <Widget>[
              const SizedBox.shrink(),
              const Center(child: Text('ignored return refresh Hub')),
              const Center(child: Text('ignored return refresh Account')),
            ],
          ),
        ),
      );
      final biteScoreHomeState = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-ignored-return-refresh-probe')),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const _IgnoredDirtyReturnIntermediate(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open pending dirty detail'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save and ordinary Back'));
      await tester.pumpAndSettle();

      expect(find.text('Ignored dirty-return intermediate'), findsOneWidget);
      expect(biteScoreHomeState.refreshes, 0);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(biteScoreHomeState.refreshes, 0);

      await tester.tap(find.text('Account'));
      await tester.pump();
      expect(biteScoreHomeState.refreshes, 1);
      expect(find.text('ignored return refresh Account'), findsOneWidget);

      await tester.tap(find.text('Home'));
      await tester.pump();
      expect(biteScoreHomeState.refreshes, 1);
    },
  );

  testWidgets(
    'dirty ancestor refresh survives a clean legacy mode-switch descendant',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                _RefreshGenerationProbeHome(
                  key: ValueKey('${mode.name}-ancestor-refresh-probe'),
                  navigationRefreshGeneration: navigationRefreshGeneration,
                ),
            testPagesBuilder: (mode) => <Widget>[
              const SizedBox.shrink(),
              const Center(child: Text('ancestor refresh probe Hub')),
              const Center(child: Text('ancestor refresh probe Account')),
            ],
          ),
        ),
      );
      final biteScoreHomeState = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-ancestor-refresh-probe')),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const _DirtyBiteScoreAncestor(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open clean mode-switch descendant'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('BiteSaver'));
      await tester.pumpAndSettle();

      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
      expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
      expect(biteScoreHomeState.refreshes, 1);
    },
  );

  testWidgets('clean detail bottom navigation does not refresh source Home', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: rootNavigatorKey,
        scaffoldMessengerKey: rootScaffoldMessengerKey,
        home: MainNavigationScreen(
          initialMode: AppMode.biteScore,
          initializePlatformServices: false,
          testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
              _RefreshGenerationProbeHome(
                key: ValueKey('${mode.name}-clean-bottom-refresh-probe'),
                navigationRefreshGeneration: navigationRefreshGeneration,
              ),
          testPagesBuilder: (mode) => <Widget>[
            const SizedBox.shrink(),
            const Center(child: Text('clean bottom refresh probe Hub')),
            const Center(child: Text('clean bottom refresh probe Account')),
          ],
        ),
      ),
    );
    final biteScoreHomeState = tester.state<_RefreshGenerationProbeHomeState>(
      find.byKey(const ValueKey('biteScore-clean-bottom-refresh-probe')),
    );

    unawaited(
      rootNavigatorKey.currentState!.push<bool>(
        MaterialPageRoute<bool>(
          builder: (_) => const _ChangedBiteScoreDetail(isDirty: false),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();

    expect(biteScoreHomeState.refreshes, 0);
    expect(find.text('clean bottom refresh probe Account'), findsOneWidget);
  });

  for (final isDirty in <bool>[false, true]) {
    testWidgets(
      'cross-mode detail navigation refreshes only the dirty source Home '
      '(${isDirty ? 'dirty' : 'clean'})',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: MainNavigationScreen(
              initialMode: AppMode.biteScore,
              initializePlatformServices: false,
              testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                  _RefreshGenerationProbeHome(
                    key: ValueKey('${mode.name}-mode-refresh-probe'),
                    navigationRefreshGeneration: navigationRefreshGeneration,
                  ),
              testPagesBuilder: (mode) => <Widget>[
                const SizedBox.shrink(),
                const Center(child: Text('mode refresh probe Hub')),
                const Center(child: Text('mode refresh probe Account')),
              ],
            ),
          ),
        );
        final originalShellState = tester.state(
          find.byType(MainNavigationScreen),
        );
        final biteScoreHomeState = tester
            .state<_RefreshGenerationProbeHomeState>(
              find.byKey(const ValueKey('biteScore-mode-refresh-probe')),
            );
        await tester.tap(find.text('BiteSaver'));
        await tester.pump();
        final biteSaverHomeState = tester
            .state<_RefreshGenerationProbeHomeState>(
              find.byKey(const ValueKey('biteSaver-mode-refresh-probe')),
            );
        await tester.tap(find.text('BiteScore'));
        await tester.pump();
        expect(
          identical(
            tester.state<_RefreshGenerationProbeHomeState>(
              find.byKey(const ValueKey('biteScore-mode-refresh-probe')),
            ),
            biteScoreHomeState,
          ),
          isTrue,
        );

        if (isDirty) {
          mainNavigationController.markHomeRefreshNeeded(
            owner: Object(),
            navigator: rootNavigatorKey.currentState!,
            mode: AppMode.biteScore,
          );
        }
        unawaited(
          rootNavigatorKey.currentState!.push<bool>(
            MaterialPageRoute<bool>(
              builder: (_) => _ChangedBiteScoreDetail(isDirty: isDirty),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('BiteSaver'));
        await tester.pumpAndSettle();

        expect(
          find.byType(MainNavigationScreen, skipOffstage: false),
          findsOneWidget,
        );
        expect(
          identical(
            tester.state(find.byType(MainNavigationScreen)),
            originalShellState,
          ),
          isTrue,
        );
        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(
          identical(
            tester.state<_RefreshGenerationProbeHomeState>(
              find.byKey(const ValueKey('biteSaver-mode-refresh-probe')),
            ),
            biteSaverHomeState,
          ),
          isTrue,
        );
        expect(biteSaverHomeState.refreshes, 0);
        expect(biteScoreHomeState.refreshes, isDirty ? 1 : 0);

        await tester.tap(find.text('BiteScore'));
        await tester.pump();
        expect(
          identical(
            tester.state<_RefreshGenerationProbeHomeState>(
              find.byKey(const ValueKey('biteScore-mode-refresh-probe')),
            ),
            biteScoreHomeState,
          ),
          isTrue,
        );
        expect(biteScoreHomeState.refreshes, isDirty ? 1 : 0);
      },
    );
  }

  for (final returnCase in _returnCases) {
    testWidgets(
      '${returnCase.kind.name} is redeemed and navigated only after server claim',
      (tester) async {
        final incoming = StreamController<String>.broadcast(sync: true);
        final claims = <SubscriptionReturnEvent>[];
        final messages = <String>[];
        addTearDown(incoming.close);
        final token = _token(returnCase.kind.index);
        backend.reserve(
          returnToken: token,
          ownerScope: _ownerA,
          family: returnCase.kind.family,
        );

        await tester.pumpWidget(
          _testApp(
            initialMode: AppMode.biteScore,
            initialIndex: 2,
            incomingRawDeepLinks: incoming.stream,
            ownerScopeProvider: () => _ownerA,
            onNavigationClaimed: claims.add,
            onMessageEmitted: messages.add,
          ),
        );
        incoming.add(
          subscriptionReturnUri(kind: returnCase.kind, returnToken: token),
        );
        await _pumpUntil(tester, () => claims.isNotEmpty);

        expect(claims, hasLength(1));
        expect(claims.single.kind, returnCase.kind);
        expect(messages, <String>[returnCase.message]);
        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(find.text('Restaurant Hub Page'), findsOneWidget);
        expect(find.text(returnCase.message), findsOneWidget);
        expect(backend.claimCalls, 1);
        expect(
          await _awaitServiceOperation(
            tester,
            SubscriptionReturnService.pendingLocalDeliveryCount,
          ),
          0,
        );
      },
    );
  }

  testWidgets(
    'subscription route collapse applies pending retained-Home refresh',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      final claims = <SubscriptionReturnEvent>[];
      final token = _token(18);
      addTearDown(incoming.close);
      backend.reserve(
        returnToken: token,
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.customerPortal,
      );

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialMode: AppMode.biteScore,
            initializePlatformServices: false,
            testIncomingRawDeepLinks: incoming.stream,
            testSubscriptionReturnOwnerScopeProvider: () => _ownerA,
            testOnSubscriptionReturnNavigationClaimed: claims.add,
            testSuppressSubscriptionReturnSnackBar: true,
            testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
                _RefreshGenerationProbeHome(
                  key: ValueKey('${mode.name}-subscription-refresh-probe'),
                  navigationRefreshGeneration: navigationRefreshGeneration,
                ),
            testPagesBuilder: (mode) => <Widget>[
              const SizedBox.shrink(),
              const Center(child: Text('subscription refresh Hub')),
              const Center(child: Text('subscription refresh Account')),
            ],
          ),
        ),
      );
      final biteScoreHomeState = tester.state<_RefreshGenerationProbeHomeState>(
        find.byKey(const ValueKey('biteScore-subscription-refresh-probe')),
      );
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(
              body: Center(child: Text('Pending subscription detail')),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      mainNavigationController.markHomeRefreshNeeded(
        owner: Object(),
        navigator: rootNavigatorKey.currentState!,
        mode: AppMode.biteScore,
      );

      incoming.add(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.customerPortal,
          returnToken: token,
        ),
      );
      await _pumpUntil(tester, () => claims.isNotEmpty);
      await tester.pumpAndSettle();

      expect(biteScoreHomeState.refreshes, 1);
      expect(find.text('subscription refresh Hub'), findsOneWidget);
      expect(find.text('Pending subscription detail'), findsNothing);
    },
  );

  testWidgets(
    'signed-out return shows neutral auth gate then matching owner redeems',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      final ownerChanges =
          StreamController<SubscriptionReturnOwnerScope?>.broadcast(sync: true);
      final claims = <SubscriptionReturnEvent>[];
      SubscriptionReturnOwnerScope? currentOwner;
      addTearDown(incoming.close);
      addTearDown(ownerChanges.close);
      backend.reserve(
        returnToken: _token(10),
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.checkout,
      );

      await tester.pumpWidget(
        _testApp(
          initialMode: AppMode.biteScore,
          initialIndex: 2,
          incomingRawDeepLinks: incoming.stream,
          ownerScopeProvider: () => currentOwner,
          ownerScopeChanges: ownerChanges.stream,
          onNavigationClaimed: claims.add,
          restaurantHubPage: RestaurantAuthScreen(
            authStateStream: Stream.value(null),
          ),
        ),
      );
      incoming.add(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: _token(10),
        ),
      );
      await _pumpUntil(
        tester,
        () => find.text('Restaurant Sign In').evaluate().isNotEmpty,
      );
      expect(claims, isEmpty);
      expect(backend.redeemCalls, 0);
      expect(
        await _awaitServiceOperation(
          tester,
          SubscriptionReturnService.pendingLocalDeliveryCount,
        ),
        1,
      );

      currentOwner = _ownerA;
      backend.authenticatedUid = _ownerA.uid;
      ownerChanges.add(_ownerA);
      await _pumpUntil(tester, () => claims.isNotEmpty);
      expect(claims, hasLength(1));
      expect(
        await _awaitServiceOperation(
          tester,
          SubscriptionReturnService.pendingLocalDeliveryCount,
        ),
        0,
      );
    },
  );

  testWidgets('wrong owner stays silent and matching owner can redeem later', (
    tester,
  ) async {
    final incoming = StreamController<String>.broadcast(sync: true);
    final ownerChanges =
        StreamController<SubscriptionReturnOwnerScope?>.broadcast(sync: true);
    final claims = <SubscriptionReturnEvent>[];
    final messages = <String>[];
    var currentOwner = _ownerB;
    addTearDown(incoming.close);
    addTearDown(ownerChanges.close);
    backend.reserve(
      returnToken: _token(11),
      ownerScope: _ownerA,
      family: SubscriptionReturnFamily.customerPortal,
    );
    backend.authenticatedUid = _ownerB.uid;

    await tester.pumpWidget(
      _testApp(
        initialMode: AppMode.biteScore,
        initialIndex: 2,
        incomingRawDeepLinks: incoming.stream,
        ownerScopeProvider: () => currentOwner,
        ownerScopeChanges: ownerChanges.stream,
        onNavigationClaimed: claims.add,
        onMessageEmitted: messages.add,
      ),
    );
    incoming.add(
      subscriptionReturnUri(
        kind: SubscriptionReturnKind.customerPortal,
        returnToken: _token(11),
      ),
    );
    await _settleAsync(tester);
    expect(claims, isEmpty);
    expect(messages, isEmpty);
    expect(find.text('Account Page'), findsOneWidget);
    expect(
      await _awaitServiceOperation(
        tester,
        SubscriptionReturnService.pendingLocalDeliveryCount,
      ),
      1,
    );

    currentOwner = _ownerA;
    backend.authenticatedUid = _ownerA.uid;
    ownerChanges.add(_ownerA);
    await _pumpUntil(tester, () => claims.isNotEmpty);
    expect(claims, hasLength(1));
    expect(messages, hasLength(1));
  });

  testWidgets('same UID different document cannot consume or claim', (
    tester,
  ) async {
    final incoming = StreamController<String>.broadcast(sync: true);
    final ownerChanges =
        StreamController<SubscriptionReturnOwnerScope?>.broadcast(sync: true);
    final claims = <SubscriptionReturnEvent>[];
    var currentOwner = _ownerASibling;
    addTearDown(incoming.close);
    addTearDown(ownerChanges.close);
    backend.reserve(
      returnToken: _token(12),
      ownerScope: _ownerA,
      family: SubscriptionReturnFamily.checkout,
    );
    backend.authenticatedUid = _ownerA.uid;
    await tester.pumpWidget(
      _testApp(
        incomingRawDeepLinks: incoming.stream,
        ownerScopeProvider: () => currentOwner,
        ownerScopeChanges: ownerChanges.stream,
        onNavigationClaimed: claims.add,
      ),
    );
    incoming.add(
      subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutCancel,
        returnToken: _token(12),
      ),
    );
    await _settleAsync(tester);
    expect(claims, isEmpty);
    expect(
      await _awaitServiceOperation(
        tester,
        SubscriptionReturnService.pendingLocalDeliveryCount,
      ),
      1,
    );

    currentOwner = _ownerA;
    ownerChanges.add(_ownerA);
    await _pumpUntil(tester, () => claims.isNotEmpty);
    expect(claims, hasLength(1));
  });

  testWidgets(
    'noncanonical subscription claimant selects the canonical shell Hub',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      final claims = <String>[];
      addTearDown(incoming.close);
      backend.reserve(
        returnToken: _token(13),
        ownerScope: _ownerA,
        family: SubscriptionReturnFamily.checkout,
      );
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            key: const ValueKey<String>('first'),
            initializePlatformServices: false,
            testSubscriptionReturnOwnerScopeProvider: () => _ownerA,
            testSuppressSubscriptionReturnSnackBar: true,
            testPagesBuilder: (mode) => <Widget>[
              Text('first ${mode.name} home'),
              const Text('first hub'),
              const Text('first account'),
            ],
          ),
        ),
      );
      final canonicalShellState = tester.state(
        find.byType(MainNavigationScreen),
      );

      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => MainNavigationScreen(
              key: const ValueKey<String>('second'),
              initializePlatformServices: false,
              testIncomingRawDeepLinks: incoming.stream,
              testSubscriptionReturnOwnerScopeProvider: () => _ownerA,
              testOnSubscriptionReturnNavigationClaimed: (_) =>
                  claims.add('second'),
              testSuppressSubscriptionReturnSnackBar: true,
              testAuthenticatedRestaurantHubBuilder: (_) =>
                  const Text('second authenticated hub'),
              testPagesBuilder: (mode) => <Widget>[
                Text('second ${mode.name} home'),
                const Text('second hub'),
                const Text('second account'),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsNWidgets(2),
      );

      incoming.add(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: _token(13),
        ),
      );
      await _pumpUntil(tester, () => claims.isNotEmpty);
      await _settleAsync(tester);
      await tester.pumpAndSettle();
      expect(claims, <String>['second']);
      expect(find.text('second authenticated hub'), findsOneWidget);
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
      expect(
        identical(
          tester.state(find.byType(MainNavigationScreen, skipOffstage: false)),
          canonicalShellState,
        ),
        isTrue,
      );
      rootNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.text('first hub'), findsOneWidget);
      expect(find.text('first biteSaver home'), findsNothing);
    },
  );

  testWidgets(
    'permanent navigation claim failure does not retry its own announcement',
    (tester) async {
      final claims = <SubscriptionReturnEvent>[];
      backend
        ..addPendingEvent(
          ownerScope: _ownerA,
          eventId: '1',
          kind: SubscriptionReturnKind.customerPortal,
        )
        ..failClaim = true;

      await tester.pumpWidget(
        _testApp(
          incomingRawDeepLinks: const Stream<String>.empty(),
          ownerScopeProvider: () => _ownerA,
          onNavigationClaimed: claims.add,
        ),
      );
      await _pumpUntil(tester, () => backend.claimCalls == 1);
      await _settleAsync(tester);

      expect(backend.claimCalls, 1);
      expect(claims, isEmpty);
      expect(find.text('biteSaver Home Page'), findsOneWidget);
    },
  );

  testWidgets(
    'genuine delivery during a blocked failed claim schedules one later drain',
    (tester) async {
      final incoming = StreamController<String>.broadcast(sync: true);
      final claims = <SubscriptionReturnEvent>[];
      final secondToken = _token(31);
      addTearDown(incoming.close);
      backend
        ..addPendingEvent(
          ownerScope: _ownerA,
          eventId: '1',
          kind: SubscriptionReturnKind.customerPortal,
        )
        ..reserve(
          returnToken: secondToken,
          ownerScope: _ownerA,
          family: SubscriptionReturnFamily.checkout,
        )
        ..failClaim = true
        ..claimStarted = Completer<void>()
        ..releaseClaim = Completer<void>();

      await tester.pumpWidget(
        _testApp(
          incomingRawDeepLinks: incoming.stream,
          ownerScopeProvider: () => _ownerA,
          onNavigationClaimed: claims.add,
        ),
      );
      await _pumpUntil(tester, () => backend.claimStarted!.isCompleted);

      incoming.add(
        subscriptionReturnUri(
          kind: SubscriptionReturnKind.checkoutSuccess,
          returnToken: secondToken,
        ),
      );
      expect(
        await _awaitServiceOperation(
          tester,
          SubscriptionReturnService.pendingLocalDeliveryCount,
        ),
        1,
      );

      backend.releaseClaim!.complete();
      await _pumpUntil(
        tester,
        () => backend.claimCalls == 2 && backend.redeemCalls == 1,
      );
      await _settleAsync(tester);

      expect(backend.claimCalls, 2);
      expect(backend.redeemCalls, 1);
      expect(claims, isEmpty);
      expect(
        await _awaitServiceOperation(
          tester,
          SubscriptionReturnService.pendingLocalDeliveryCount,
        ),
        0,
      );
    },
  );

  testWidgets(
    'owner transition waits for the active claim drain before later retry',
    (tester) async {
      final ownerChanges =
          StreamController<SubscriptionReturnOwnerScope?>.broadcast(sync: true);
      final claims = <SubscriptionReturnEvent>[];
      var currentOwner = _ownerA;
      addTearDown(ownerChanges.close);
      backend
        ..addPendingEvent(
          ownerScope: _ownerA,
          eventId: '1',
          kind: SubscriptionReturnKind.checkoutCancel,
        )
        ..claimStarted = Completer<void>()
        ..releaseClaim = Completer<void>();

      await tester.pumpWidget(
        _testApp(
          incomingRawDeepLinks: const Stream<String>.empty(),
          ownerScopeProvider: () => currentOwner,
          ownerScopeChanges: ownerChanges.stream,
          onNavigationClaimed: claims.add,
        ),
      );
      await _pumpUntil(tester, () => backend.claimStarted!.isCompleted);
      expect(backend.claimCalls, 1);

      currentOwner = _ownerB;
      backend.authenticatedUid = _ownerB.uid;
      ownerChanges.add(_ownerB);
      await _settleAsync(tester);
      expect(backend.claimCalls, 1);

      backend.releaseClaim!.complete();
      await _settleAsync(tester);
      expect(backend.claimCalls, 1);
      expect(claims, isEmpty);

      currentOwner = _ownerA;
      backend.authenticatedUid = _ownerA.uid;
      ownerChanges.add(_ownerA);
      await _pumpUntil(tester, () => claims.isNotEmpty);

      expect(backend.claimCalls, 2);
      expect(claims, hasLength(1));
      expect(claims.single.ownerScope, _ownerA);
    },
  );

  testWidgets('three destinations do not overflow narrow scaled layouts', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_testApp(textScaler: const TextScaler.linear(1.5)));
    await tester.pump();
    expect(find.text('Restaurant\nHub'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Widget _testApp({
  int initialIndex = 0,
  AppMode initialMode = AppMode.biteSaver,
  TextScaler textScaler = TextScaler.noScaling,
  Stream<String>? incomingRawDeepLinks,
  Widget? restaurantHubPage,
  ValueChanged<SubscriptionReturnEvent>? onNavigationClaimed,
  ValueChanged<String>? onMessageEmitted,
  SubscriptionReturnOwnerScope? Function()? ownerScopeProvider,
  Stream<SubscriptionReturnOwnerScope?>? ownerScopeChanges,
}) {
  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    home: MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: MainNavigationScreen(
        initialMode: initialMode,
        initialIndex: initialIndex,
        initializePlatformServices: false,
        testIncomingRawDeepLinks: incomingRawDeepLinks,
        testOnSubscriptionReturnNavigationClaimed: onNavigationClaimed,
        testOnSubscriptionReturnMessageEmitted: onMessageEmitted,
        testSubscriptionReturnOwnerScopeProvider: ownerScopeProvider,
        testSubscriptionReturnOwnerScopeChanges: ownerScopeChanges,
        testAuthenticatedRestaurantHubBuilder: (_) =>
            const Center(child: Text('Restaurant Hub Page')),
        testPagesBuilder: (mode) => <Widget>[
          Center(child: Text('${mode.name} Home Page')),
          restaurantHubPage ?? const Center(child: Text('Restaurant Hub Page')),
          const Center(child: Text('Account Page')),
        ],
      ),
    ),
  );
}

Widget _stateRetentionTestApp({
  required _NavigationProbeCounters counters,
  TextScaler textScaler = TextScaler.noScaling,
  String revision = 'initial',
  String Function()? authRealmProvider,
  Stream<String>? authRealmChanges,
  Future<String>? ownerALateCompletion,
}) {
  Widget buildShell() {
    return MainNavigationScreen(
      initializePlatformServices: false,
      testCustomerAuthRealmProvider: authRealmProvider,
      testCustomerAuthRealmChanges: authRealmChanges,
      testPagesBuilder: (mode) => <Widget>[
        _NavigationProbePage(
          key: ValueKey('${mode.name}-home-probe'),
          label: '${mode.name}-home',
          counters: counters,
          revision: revision,
          authRealm: authRealmProvider?.call() ?? 'guest',
          latePrivateCompletion: authRealmProvider?.call() == 'signed:A'
              ? ownerALateCompletion
              : null,
          canOpenDetail: true,
        ),
        _NavigationProbePage(
          key: const ValueKey('hub-probe'),
          label: 'hub',
          counters: counters,
        ),
        _NavigationProbePage(
          key: const ValueKey('account-probe'),
          label: 'account',
          counters: counters,
        ),
      ],
    );
  }

  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    home: MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: buildShell(),
    ),
  );
}

Widget _realHomeRetentionTestApp({
  required Stream<String> approvedSignatures,
  required VoidCallback onRestaurantLoad,
}) {
  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    home: MainNavigationScreen(
      initializePlatformServices: false,
      testPagesBuilder: (mode) => <Widget>[
        const SizedBox.shrink(),
        const Center(child: Text('real Restaurant Hub')),
        const Center(child: Text('real Account')),
      ],
      testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
          mode == AppMode.biteSaver
          ? HomeScreen(
              key: const ValueKey('real-bitesaver-home'),
              approvedAccountsSignatureStream: approvedSignatures,
              restaurantLoader: () async {
                onRestaurantLoad();
                return _retentionRestaurants;
              },
              locationRestoreLoader: () async =>
                  const SharedLocationRestoreResult(
                    state: SharedLocationState(
                      usingTypedSearchLocation: true,
                      typedLatitude: 28.8517,
                      typedLongitude: -82.4870,
                      typedLabel: '34461',
                      searchText: '34461',
                    ),
                  ),
              initializeFirebaseBackedState: false,
              navigationRefreshGeneration: navigationRefreshGeneration,
            )
          : const Center(child: Text('real BiteScore Home')),
    ),
  );
}

final BiteScoreHomeEntry _navigationBiteScoreEntry = BiteScoreHomeEntry(
  dish: const BitescoreDish(
    id: 'navigation-dish',
    restaurantId: 'navigation-score-restaurant',
    restaurantName: 'Navigation Score Cafe',
    name: 'Navigation Test Dish',
    normalizedName: 'navigation test dish',
    category: 'Test',
  ),
  restaurant: const BitescoreRestaurant(
    id: 'navigation-score-restaurant',
    name: 'Navigation Score Cafe',
    normalizedName: 'navigation score cafe',
    address: '1 Test Way',
    city: 'Ocala',
    state: 'FL',
    zipCode: '34470',
    location: GeoPoint(29.1872, -82.1401),
    restaurantWriteRevision: 0,
  ),
  aggregate: const DishRatingAggregate(
    dishId: 'navigation-dish',
    restaurantId: 'navigation-score-restaurant',
    overallBiteScore: 80,
    ratingCount: 1,
  ),
);

final BiteScoreHomeEntry _navigationUncategorizedBiteScoreEntry =
    BiteScoreHomeEntry(
      dish: const BitescoreDish(
        id: 'navigation-uncategorized-dish',
        restaurantId: 'navigation-score-restaurant',
        restaurantName: 'Navigation Score Cafe',
        name: 'Navigation Uncategorized Dish',
        normalizedName: 'navigation uncategorized dish',
      ),
      restaurant: _navigationBiteScoreEntry.restaurant,
      aggregate: const DishRatingAggregate(
        dishId: 'navigation-uncategorized-dish',
        restaurantId: 'navigation-score-restaurant',
        overallBiteScore: 80,
        ratingCount: 1,
      ),
    );

BiteScoreHomeEntry _navigationEntryForRestaurant(
  BitescoreRestaurant restaurant,
) {
  return BiteScoreHomeEntry(
    dish: _navigationBiteScoreEntry.dish,
    restaurant: restaurant,
    aggregate: _navigationBiteScoreEntry.aggregate,
  );
}

BiteScoreHomeEntry _navigationEntryNamed(String name) {
  return BiteScoreHomeEntry(
    dish: BitescoreDish(
      id: 'navigation-$name',
      restaurantId: 'navigation-score-restaurant',
      restaurantName: 'Navigation Score Cafe',
      name: name,
      normalizedName: name.toLowerCase(),
      category: 'Test',
    ),
    restaurant: _navigationBiteScoreEntry.restaurant,
    aggregate: DishRatingAggregate(
      dishId: 'navigation-$name',
      restaurantId: 'navigation-score-restaurant',
      overallBiteScore: 80,
      ratingCount: 1,
    ),
  );
}

BiteScoreReviewSaveResult _navigationReviewSaveResult(String id) {
  return BiteScoreReviewSaveResult(
    dish: _navigationBiteScoreEntry.dish,
    restaurant: _navigationBiteScoreEntry.restaurant,
    review: DishReview(
      id: id,
      dishId: _navigationBiteScoreEntry.dish.id,
      restaurantId: _navigationBiteScoreEntry.restaurant.id,
      userId: 'navigation-reviewer',
      overallImpression: 7,
      tastinessScore: 7,
      qualityScore: 7,
      valueScore: 7,
      overallBiteScore: 70,
    ),
  );
}

enum _DelayedMutationKind {
  dishReview,
  createRate,
  menuItem,
  dishCategory,
  dishFavorite,
  missingDishImage,
  restaurantFavorite,
  restaurantDishCategory,
}

const List<_DelayedMutationKind> _delayedAuthGatedMutationKinds =
    <_DelayedMutationKind>[
      _DelayedMutationKind.dishCategory,
      _DelayedMutationKind.dishFavorite,
      _DelayedMutationKind.missingDishImage,
      _DelayedMutationKind.restaurantFavorite,
      _DelayedMutationKind.restaurantDishCategory,
    ];

extension on _DelayedMutationKind {
  String get label => switch (this) {
    _DelayedMutationKind.dishReview => 'dish review',
    _DelayedMutationKind.createRate => 'create/rate review',
    _DelayedMutationKind.menuItem => 'menu item',
    _DelayedMutationKind.dishCategory => 'dish category',
    _DelayedMutationKind.dishFavorite => 'dish favorite',
    _DelayedMutationKind.missingDishImage => 'missing-image upload',
    _DelayedMutationKind.restaurantFavorite => 'restaurant favorite',
    _DelayedMutationKind.restaurantDishCategory => 'restaurant dish category',
  };

  Finder get widgetFinder => switch (this) {
    _DelayedMutationKind.dishReview ||
    _DelayedMutationKind.dishCategory ||
    _DelayedMutationKind.dishFavorite ||
    _DelayedMutationKind.missingDishImage => find.byType(
      BiteScoreDishDetailScreen,
    ),
    _DelayedMutationKind.createRate => find.byType(BiteScoreCreateRateScreen),
    _DelayedMutationKind.menuItem => find.byType(
      RestaurantMenuManagementScreen,
    ),
    _DelayedMutationKind.restaurantFavorite ||
    _DelayedMutationKind.restaurantDishCategory => find.byType(
      BiteScoreRestaurantDishesScreen,
    ),
  };
}

Widget _refreshDeliveryTestApp({
  String keyScope = 'delivery',
  String Function()? authRealmProvider,
  Stream<String>? authRealmChanges,
}) {
  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    home: MainNavigationScreen(
      initialMode: AppMode.biteScore,
      initializePlatformServices: false,
      testCustomerAuthRealmProvider: authRealmProvider,
      testCustomerAuthRealmChanges: authRealmChanges,
      testModeHomeBuilder: (mode, navigationRefreshGeneration) =>
          _RefreshGenerationProbeHome(
            key: ValueKey('${mode.name}-$keyScope-home'),
            navigationRefreshGeneration: navigationRefreshGeneration,
          ),
      testPagesBuilder: (mode) => <Widget>[
        const SizedBox.shrink(),
        const Center(child: Text('delivery Hub')),
        const Center(child: Text('delivery Account')),
      ],
    ),
  );
}

Future<void> _startDelayedMutationHandler(
  WidgetTester tester, {
  required _DelayedMutationKind mutationKind,
  required Future<void> write,
  VoidCallback? menuOnChanged,
  User? Function()? currentUserProvider,
  VoidCallback? onWriterStarted,
  Future<bool>? writeGate,
  bool stopAtWriteGate = false,
}) async {
  final effectiveCurrentUserProvider =
      currentUserProvider ??
      () => _NavigationTestUser(
        email: 'reviewer@example.com',
        uid: 'navigation-reviewer',
      );
  final route = switch (mutationKind) {
    _DelayedMutationKind.dishReview => MaterialPageRoute<void>(
      builder: (_) => BiteScoreDishDetailScreen(
        entry: _navigationBiteScoreEntry,
        scrollToReviewSection: true,
        testInitialLoader: () async {},
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testSuppressLocalExpertBadgeRecalculation: true,
        testReviewSaver:
            ({
              required dish,
              required restaurant,
              required overallImpression,
              required headline,
              required notes,
              required tastinessScore,
              required qualityScore,
              required valueScore,
            }) async {
              onWriterStarted?.call();
              await write;
              return _navigationReviewSaveResult('delayed-dish-review');
            },
      ),
    ),
    _DelayedMutationKind.createRate => MaterialPageRoute<void>(
      builder: (_) => BiteScoreCreateRateScreen(
        existingEntry: _navigationBiteScoreEntry,
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testReviewSaver:
            ({
              required dish,
              required restaurant,
              required overallImpression,
              required headline,
              required notes,
              required tastinessScore,
              required qualityScore,
              required valueScore,
            }) async {
              onWriterStarted?.call();
              await write;
              return _navigationReviewSaveResult('delayed-create-rate');
            },
      ),
    ),
    _DelayedMutationKind.menuItem => MaterialPageRoute<void>(
      builder: (_) => RestaurantMenuManagementScreen(
        source: RestaurantMenuSource.sharedMenu('delayed-menu'),
        testCurrentUser: effectiveCurrentUserProvider(),
        testInitialDataLoader: (user, source) async => (
          hasPostingAccess: true,
          images: const <RestaurantMenuImage>[],
          items: const <RestaurantMenuItem>[],
          sections: const <RestaurantMenuSection>[],
        ),
        testItemSaver: (source, name, description, price, category) async {
          onWriterStarted?.call();
          await write;
          return RestaurantMenuItem(
            id: 'delayed-menu-item',
            name: name,
            description: description,
            price: price,
            category: category,
            sortOrder: 1,
          );
        },
        onMenuChanged: menuOnChanged,
      ),
    ),
    _DelayedMutationKind.dishCategory => MaterialPageRoute<void>(
      builder: (_) => BiteScoreDishDetailScreen(
        entry: _navigationUncategorizedBiteScoreEntry,
        testInitialLoader: () async {},
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testDishCategorySaver: (dish, selection) async {
          onWriterStarted?.call();
          await write;
        },
      ),
    ),
    _DelayedMutationKind.dishFavorite => MaterialPageRoute<void>(
      builder: (_) => BiteScoreDishDetailScreen(
        entry: _navigationBiteScoreEntry,
        testInitialLoader: () async {},
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testDishFavoriteSaver: (dish, restaurant, isFavorite) async {
          onWriterStarted?.call();
          await write;
        },
      ),
    ),
    _DelayedMutationKind.missingDishImage => MaterialPageRoute<void>(
      builder: (_) => BiteScoreDishDetailScreen(
        entry: _navigationBiteScoreEntry,
        testInitialLoader: () async {},
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testMissingDishImageSaver: (dish, restaurant, user) async {
          onWriterStarted?.call();
          await write;
        },
      ),
    ),
    _DelayedMutationKind.restaurantFavorite => MaterialPageRoute<void>(
      builder: (_) => BiteScoreRestaurantDishesScreen(
        restaurant: _navigationBiteScoreEntry.restaurant,
        entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
        testInitialDataLoader: () async => (
          restaurant: _navigationBiteScoreEntry.restaurant,
          entries: <BiteScoreHomeEntry>[_navigationBiteScoreEntry],
          isFavorite: false,
        ),
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testFavoriteSaver: (restaurant, isFavorite) async {
          onWriterStarted?.call();
          await write;
        },
      ),
    ),
    _DelayedMutationKind.restaurantDishCategory => MaterialPageRoute<void>(
      builder: (_) => BiteScoreRestaurantDishesScreen(
        restaurant: _navigationBiteScoreEntry.restaurant,
        entries: <BiteScoreHomeEntry>[_navigationUncategorizedBiteScoreEntry],
        testInitialDataLoader: () async => (
          restaurant: _navigationBiteScoreEntry.restaurant,
          entries: <BiteScoreHomeEntry>[_navigationUncategorizedBiteScoreEntry],
          isFavorite: false,
        ),
        testWriteGate: (_) => writeGate ?? Future<bool>.value(true),
        testCurrentUserProvider: effectiveCurrentUserProvider,
        testDishCategorySaver: (dish, selection) async {
          onWriterStarted?.call();
          await write;
        },
      ),
    ),
  };
  unawaited(rootNavigatorKey.currentState!.push<void>(route));
  await tester.pumpAndSettle();

  if (mutationKind == _DelayedMutationKind.menuItem) {
    final itemNameField = find.descendant(
      of: find.byType(RestaurantMenuManagementScreen),
      matching: find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == 'Item name',
      ),
    );
    await tester.enterText(itemNameField, 'Delayed Burger');
    final addButton = find.widgetWithText(FilledButton, 'Add menu item');
    await tester.ensureVisible(addButton);
    await tester.tap(addButton);
    await tester.pump();
    return;
  }

  if (mutationKind == _DelayedMutationKind.dishCategory ||
      mutationKind == _DelayedMutationKind.restaurantDishCategory) {
    final addCategory = find.descendant(
      of: mutationKind.widgetFinder,
      matching: find.text('+ Add category'),
    );
    await tester.ensureVisible(addCategory.first);
    await tester.tap(addCategory.first);
    await tester.pump();
    if (stopAtWriteGate) {
      return;
    }
    await tester.pumpAndSettle();
    final picker = tester.widget<BitescoreCategoryPicker>(
      find.byType(BitescoreCategoryPicker),
    );
    picker.onChanged(
      const BitescoreCategorySelection(legacyCategory: 'Test Category'),
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
    await tester.pump();
    return;
  }

  if (mutationKind == _DelayedMutationKind.dishFavorite) {
    final saveDish = find.byTooltip('Save dish');
    await tester.ensureVisible(saveDish);
    await tester.tap(saveDish);
    await tester.pump();
    return;
  }

  if (mutationKind == _DelayedMutationKind.missingDishImage) {
    final addImage = find.byKey(
      const ValueKey('bitescore-dish-add-image-button'),
    );
    await tester.ensureVisible(addImage);
    await tester.tap(addImage);
    await tester.pump();
    return;
  }

  if (mutationKind == _DelayedMutationKind.restaurantFavorite) {
    final saveRestaurant = find.byTooltip('Save restaurant');
    await tester.ensureVisible(saveRestaurant);
    await tester.tap(saveRestaurant);
    await tester.pump();
    return;
  }

  final screenFinder = mutationKind.widgetFinder;
  final sliderFinder = find.descendant(
    of: screenFinder,
    matching: find.byType(Slider),
  );
  expect(sliderFinder, findsNWidgets(4));
  for (final slider in tester.widgetList<Slider>(sliderFinder)) {
    slider.onChanged?.call(7);
  }
  await tester.pump();
  final saveButton = find.descendant(
    of: screenFinder,
    matching: find.widgetWithText(ElevatedButton, 'Save Review'),
  );
  await tester.ensureVisible(saveButton);
  await tester.tap(saveButton);
  await tester.pump();
}

const Restaurant _retentionRestaurant = Restaurant(
  documentId: 'retention-restaurant',
  name: 'Retention Cafe',
  distance: Restaurant.defaultDistanceLabel,
  city: 'Lecanto',
  state: 'FL',
  zipCode: '34461',
  latitude: 28.8517,
  longitude: -82.4870,
  coupons: <Coupon>[
    Coupon(
      id: 'retention-1',
      restaurant: 'Retention Cafe',
      title: 'Pizza special one',
      distance: '',
      usageRule: 'Unlimited',
    ),
    Coupon(
      id: 'retention-2',
      restaurant: 'Retention Cafe',
      title: 'Pizza special two',
      distance: '',
      usageRule: 'Unlimited',
    ),
    Coupon(
      id: 'retention-3',
      restaurant: 'Retention Cafe',
      title: 'Pizza special three',
      distance: '',
      usageRule: 'Unlimited',
    ),
  ],
);

final List<Restaurant> _retentionRestaurants = <Restaurant>[
  _retentionRestaurant,
  for (var index = 0; index < 25; index += 1)
    Restaurant(
      documentId: 'lazy-restaurant-$index',
      name: 'ZZ Lazy Cafe ${index.toString().padLeft(2, '0')}',
      distance: Restaurant.defaultDistanceLabel,
      city: 'Lecanto',
      state: 'FL',
      zipCode: '34461',
      latitude: 28.8517 + (index + 1) * 0.001,
      longitude: -82.4870,
      coupons: <Coupon>[
        Coupon(
          id: 'lazy-coupon-$index',
          restaurant: 'ZZ Lazy Cafe $index',
          title: 'Available deal $index',
          distance: '',
          usageRule: 'Unlimited',
        ),
      ],
    ),
];

class _RefreshGenerationProbeHome extends StatefulWidget {
  final int navigationRefreshGeneration;

  const _RefreshGenerationProbeHome({
    super.key,
    required this.navigationRefreshGeneration,
  });

  @override
  State<_RefreshGenerationProbeHome> createState() =>
      _RefreshGenerationProbeHomeState();
}

class _RefreshGenerationProbeHomeState
    extends State<_RefreshGenerationProbeHome> {
  int refreshes = 0;

  @override
  void didUpdateWidget(covariant _RefreshGenerationProbeHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.navigationRefreshGeneration !=
        widget.navigationRefreshGeneration) {
      refreshes += 1;
    }
  }

  Future<void> _openRefreshChain() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => const _RefreshChainIntermediate(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text('refreshes $refreshes'),
          ElevatedButton(
            onPressed: _openRefreshChain,
            child: const Text('Open refresh chain'),
          ),
        ],
      ),
    );
  }
}

class _RefreshChainIntermediate extends StatelessWidget {
  const _RefreshChainIntermediate();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Refresh chain intermediate')),
      body: Center(
        child: ElevatedButton(
          onPressed: () {
            unawaited(
              Navigator.of(context).push<bool>(
                MaterialPageRoute<bool>(
                  builder: (_) => const _ChangedBiteScoreDetail(),
                ),
              ),
            );
          },
          child: const Text('Open changed BiteScore detail'),
        ),
      ),
    );
  }
}

class _IgnoredDirtyReturnIntermediate extends StatelessWidget {
  const _IgnoredDirtyReturnIntermediate();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ignored dirty-return intermediate')),
      body: Center(
        child: ElevatedButton(
          onPressed: () async {
            await Navigator.of(context).push<bool>(
              MaterialPageRoute<bool>(
                builder: (_) => const _PendingDirtyBackDetail(),
              ),
            );
          },
          child: const Text('Open pending dirty detail'),
        ),
      ),
    );
  }
}

class _PendingDirtyBackDetail extends StatefulWidget {
  const _PendingDirtyBackDetail();

  @override
  State<_PendingDirtyBackDetail> createState() =>
      _PendingDirtyBackDetailState();
}

class _PendingDirtyBackDetailState extends State<_PendingDirtyBackDetail> {
  final Object _refreshIntentOwner = Object();

  void _saveAndPop() {
    mainNavigationController.markHomeRefreshNeeded(
      owner: _refreshIntentOwner,
      navigator: Navigator.of(context, rootNavigator: true),
      mode: AppMode.biteScore,
    );
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pending dirty detail')),
      body: Center(
        child: ElevatedButton(
          onPressed: _saveAndPop,
          child: const Text('Save and ordinary Back'),
        ),
      ),
    );
  }
}

class _DeepLinkReturnProbe extends StatefulWidget {
  final bool changed;
  final bool markIntent;

  const _DeepLinkReturnProbe({required this.changed, required this.markIntent});

  @override
  State<_DeepLinkReturnProbe> createState() => _DeepLinkReturnProbeState();
}

class _DeepLinkReturnProbeState extends State<_DeepLinkReturnProbe> {
  final Object _refreshIntentOwner = Object();

  void _return() {
    if (widget.markIntent) {
      mainNavigationController.markHomeRefreshNeeded(
        owner: _refreshIntentOwner,
        navigator: Navigator.of(context, rootNavigator: true),
        mode: AppMode.biteScore,
      );
    }
    Navigator.of(context).pop(widget.changed);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Linked restaurant return probe')),
      body: Center(
        child: ElevatedButton(
          onPressed: _return,
          child: const Text('Return from linked restaurant'),
        ),
      ),
    );
  }
}

class _DirtyBiteScoreAncestor extends StatefulWidget {
  const _DirtyBiteScoreAncestor();

  @override
  State<_DirtyBiteScoreAncestor> createState() =>
      _DirtyBiteScoreAncestorState();
}

class _DirtyBiteScoreAncestorState extends State<_DirtyBiteScoreAncestor> {
  final Object _refreshIntentOwner = Object();

  void _openCleanDescendant() {
    mainNavigationController.markHomeRefreshNeeded(
      owner: _refreshIntentOwner,
      navigator: Navigator.of(context, rootNavigator: true),
      mode: AppMode.biteScore,
    );
    unawaited(
      Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => const _CleanLegacyModeSwitchDetail(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Dirty BiteScore ancestor')),
      body: Center(
        child: ElevatedButton(
          onPressed: _openCleanDescendant,
          child: const Text('Open clean mode-switch descendant'),
        ),
      ),
    );
  }
}

class _CleanLegacyModeSwitchDetail extends StatelessWidget {
  const _CleanLegacyModeSwitchDetail();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Clean legacy mode-switch detail')),
      body: Column(
        children: <Widget>[
          buildPersistentAppModeSwitcher(context),
          const Expanded(child: SizedBox.expand()),
        ],
      ),
    );
  }
}

class _ChangedBiteScoreDetail extends StatelessWidget {
  final bool isDirty;

  const _ChangedBiteScoreDetail({this.isDirty = true});

  @override
  Widget build(BuildContext context) {
    return PopScope<bool>(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) {
          Navigator.of(context).pop(true);
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Changed BiteScore detail')),
        body: Column(
          children: <Widget>[
            buildPersistentAppModeSwitcher(
              context,
              onModeNavigationRequested: (destinationMode) {
                openMainNavigationDestination(
                  context,
                  mode: destinationMode,
                  index: 0,
                  refreshHomeMode: isDirty ? AppMode.biteScore : null,
                );
              },
            ),
            const Expanded(child: SizedBox.expand()),
          ],
        ),
        bottomNavigationBar: PersistentBottomNavigation(
          mode: AppMode.biteScore,
          requestRootRefresh: isDirty,
        ),
      ),
    );
  }
}

class _CrossModeNavigationDetail extends StatelessWidget {
  const _CrossModeNavigationDetail();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Cross-mode detail')),
      bottomNavigationBar: PersistentBottomNavigation(mode: AppMode.biteScore),
    );
  }
}

class _NavigationRefreshDetail extends StatelessWidget {
  final AppMode mode;

  const _NavigationRefreshDetail({required this.mode});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: const Center(child: Text('Navigation refresh detail')),
      bottomNavigationBar: PersistentBottomNavigation(
        mode: mode,
        requestRootRefresh: true,
      ),
    );
  }
}

class _NavigationProbeCounters {
  final Map<String, int> initializations = <String, int>{};
  final Map<String, int> disposals = <String, int>{};
  final Map<String, int> loads = <String, int>{};
  void increment(Map<String, int> counter, String label) {
    counter.update(label, (value) => value + 1, ifAbsent: () => 1);
  }
}

class _NavigationProbePage extends StatefulWidget {
  final String label;
  final _NavigationProbeCounters counters;
  final bool canOpenDetail;
  final String revision;
  final String authRealm;
  final Future<String>? latePrivateCompletion;

  const _NavigationProbePage({
    super.key,
    required this.label,
    required this.counters,
    this.canOpenDetail = false,
    this.revision = 'initial',
    this.authRealm = 'guest',
    this.latePrivateCompletion,
  });

  @override
  State<_NavigationProbePage> createState() => _NavigationProbePageState();
}

class _NavigationProbePageState extends State<_NavigationProbePage> {
  final TextEditingController queryController = TextEditingController();
  final ScrollController scrollController = ScrollController();
  String radius = '15 miles';
  bool expanded = false;
  String? latePrivateValue;

  @override
  void initState() {
    super.initState();
    widget.counters.increment(widget.counters.initializations, widget.label);
    widget.counters.increment(widget.counters.loads, widget.label);
    final initialRealm = widget.authRealm;
    widget.latePrivateCompletion?.then((value) {
      if (mounted) {
        setState(() => latePrivateValue = '$initialRealm:$value');
      }
    });
  }

  @override
  void dispose() {
    widget.counters.increment(widget.counters.disposals, widget.label);
    queryController.dispose();
    scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: ValueKey('${widget.label}-list'),
      controller: scrollController,
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Text('${widget.label} page'),
        Text('widget revision ${widget.revision}'),
        Text('auth realm ${widget.authRealm}'),
        if (latePrivateValue != null) Text(latePrivateValue!),
        TextField(
          key: ValueKey('${widget.label}-query'),
          controller: queryController,
        ),
        DropdownButton<String>(
          key: ValueKey('${widget.label}-radius'),
          value: radius,
          items: const <DropdownMenuItem<String>>[
            DropdownMenuItem(value: '15 miles', child: Text('15 miles')),
            DropdownMenuItem(value: '30 miles', child: Text('30 miles')),
          ],
          onChanged: (value) {
            if (value != null) {
              setState(() => radius = value);
            }
          },
        ),
        ElevatedButton(
          key: ValueKey('${widget.label}-expand'),
          onPressed: () => setState(() => expanded = !expanded),
          child: Text(expanded ? 'Collapse result' : 'Expand result'),
        ),
        if (expanded) const Text('Representative result is expanded'),
        if (widget.canOpenDetail)
          ElevatedButton(
            key: ValueKey('${widget.label}-open-detail'),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => CouponDetailScreen(
                    coupon: const Coupon(
                      id: 'navigation-probe-coupon',
                      restaurant: 'Probe Restaurant',
                      title: 'Navigation Probe Coupon',
                      distance: '',
                      usageRule: 'Unlimited',
                    ),
                    loadFavoriteState: (_) async => false,
                    loadCustomerVisibility: (_, _) async => true,
                    initializeRedemptionStore: () async {},
                  ),
                ),
              );
            },
            child: const Text('Open detail'),
          ),
        for (var index = 0; index < 30; index += 1)
          SizedBox(height: 48, child: Text('row $index')),
      ],
    );
  }
}

class _NavigationTestUser extends Fake implements User {
  @override
  final String? email;

  final String _uid;

  _NavigationTestUser({required this.email, String uid = 'navigation-admin'})
    : _uid = uid;

  @override
  bool get isAnonymous => false;

  @override
  String get uid => _uid;

  @override
  String? get displayName => null;

  @override
  bool get emailVerified => true;

  @override
  List<UserInfo> get providerData => const <UserInfo>[];
}

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition) async {
  for (var attempt = 0; attempt < 60; attempt += 1) {
    if (condition()) {
      await tester.pump();
      return;
    }
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await tester.pump(const Duration(milliseconds: 25));
  }
  expect(condition(), isTrue);
}

Future<void> _settleAsync(WidgetTester tester) async {
  for (var attempt = 0; attempt < 12; attempt += 1) {
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await tester.pump(const Duration(milliseconds: 25));
  }
}

Future<T> _awaitServiceOperation<T>(
  WidgetTester tester,
  Future<T> operation,
) async {
  T? result;
  Object? error;
  StackTrace? stackTrace;
  var completed = false;
  operation.then<void>(
    (value) {
      result = value;
      completed = true;
    },
    onError: (Object caught, StackTrace caughtStackTrace) {
      error = caught;
      stackTrace = caughtStackTrace;
      completed = true;
    },
  );
  await _pumpUntil(tester, () => completed);
  if (error != null) {
    Error.throwWithStackTrace(error!, stackTrace!);
  }
  return result as T;
}
