import 'dart:async';

import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/screens/restaurant_create_coupon_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/subscription_return_service_test.dart'
    as subscription_return_fixtures;

typedef _SubscriptionReturnCase = ({
  String uri,
  SubscriptionReturnKind kind,
  String message,
});

const List<_SubscriptionReturnCase>
_subscriptionReturnCases = <_SubscriptionReturnCase>[
  (
    uri: subscriptionPortalReturnUri,
    kind: SubscriptionReturnKind.customerPortal,
    message:
        'Returned from subscription management. Refreshing your subscription status.',
  ),
  (
    uri: subscriptionCheckoutSuccessReturnUri,
    kind: SubscriptionReturnKind.checkoutSuccess,
    message:
        'Subscription started successfully. Refreshing restaurant tools...',
  ),
  (
    uri: subscriptionCheckoutCancelReturnUri,
    kind: SubscriptionReturnKind.checkoutCancel,
    message: 'Subscription checkout canceled.',
  ),
];

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SubscriptionReturnService.resetForTesting();
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  tearDown(() async {
    await SubscriptionReturnService.resetForTesting();
    AppModeStateService.setMode(AppMode.biteSaver);
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
    'portal return selects BiteSaver Restaurant Hub and dispatches neutrally',
    (tester) async {
      final incomingLinks = StreamController<String>.broadcast();
      final navigationClaims = <SubscriptionReturnEvent>[];
      addTearDown(incomingLinks.close);

      await tester.pumpWidget(
        _testApp(
          initialMode: AppMode.biteScore,
          initialIndex: 2,
          incomingRawDeepLinks: incomingLinks.stream,
          onSubscriptionReturnNavigationClaimed: navigationClaims.add,
        ),
      );
      expect(find.text('Account Page'), findsOneWidget);

      incomingLinks.add(subscriptionPortalReturnUri);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
      expect(find.text('Restaurant Hub Page'), findsOneWidget);
      expect(navigationClaims, hasLength(1));
      expect(
        navigationClaims.single.kind,
        SubscriptionReturnKind.customerPortal,
      );
      expect(
        SubscriptionReturnService.peekPendingRefresh()?.id,
        navigationClaims.single.id,
      );
      expect(SubscriptionReturnService.peekPendingNavigation(), isNull);
      expect(
        find.text(
          'Returned from subscription management. Refreshing your subscription status.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('started successfully'), findsNothing);
      expect(find.textContaining('checkout canceled'), findsNothing);
      expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
      expect(tester.takeException(), isNull);

      expect(
        SubscriptionReturnService.claimRefresh(navigationClaims.single.id),
        isTrue,
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pump();
      await tester.pumpWidget(
        _testApp(
          initialMode: AppMode.biteScore,
          initialIndex: 2,
          incomingRawDeepLinks: incomingLinks.stream,
          onSubscriptionReturnNavigationClaimed: navigationClaims.add,
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(navigationClaims, hasLength(1));
      expect(find.text('Account Page'), findsOneWidget);
      expect(
        find.textContaining('Returned from subscription management'),
        findsNothing,
      );
    },
  );

  for (final returnCase in _subscriptionReturnCases) {
    testWidgets(
      'signed-out ${returnCase.kind.name} return remains on the Restaurant Hub auth gate',
      (tester) async {
        final incomingLinks = StreamController<Uri>.broadcast();
        final navigationClaims = <SubscriptionReturnEvent>[];
        final emittedMessages = <String>[];
        addTearDown(incomingLinks.close);
        // A stale mounted-Hub count must never override current signed-out
        // authentication state.
        SubscriptionReturnService.registerRestaurantHub();

        await tester.pumpWidget(
          _testApp(
            initialMode: AppMode.biteScore,
            initialIndex: 2,
            incomingDeepLinks: incomingLinks.stream,
            onSubscriptionReturnNavigationClaimed: navigationClaims.add,
            onSubscriptionReturnMessageEmitted: emittedMessages.add,
            restaurantUserSignedIn: false,
            restaurantHubPage: RestaurantAuthScreen(
              authStateStream: Stream.value(null),
            ),
          ),
        );

        incomingLinks.add(Uri.parse(returnCase.uri));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(find.text('Restaurant Sign In'), findsOneWidget);
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.byType(MainNavigationScreen), findsOneWidget);
        expect(find.text('Admin'), findsNothing);
        expect(navigationClaims, hasLength(1));
        expect(navigationClaims.single.kind, returnCase.kind);
        expect(emittedMessages, <String>[returnCase.message]);
        expect(find.text(returnCase.message), findsOneWidget);
        for (final otherCase in _subscriptionReturnCases.where(
          (candidate) => candidate.kind != returnCase.kind,
        )) {
          expect(find.text(otherCase.message), findsNothing);
        }
        expect(
          SubscriptionReturnService.peekPendingRefresh()?.id,
          navigationClaims.single.id,
        );
        expect(SubscriptionReturnService.peekPendingNavigation(), isNull);

        await tester.pump(const Duration(seconds: 1));
        expect(navigationClaims, hasLength(1));
        expect(emittedMessages, hasLength(1));
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final fixture
      in subscription_return_fixtures.malformedCheckoutReturnFixtures) {
    testWidgets(
      'rejects ${fixture.kind.name} ${fixture.category} before valid follow-up',
      (tester) async {
        final validCase = _subscriptionReturnCases.singleWhere(
          (candidate) => candidate.kind == fixture.kind,
        );
        final incomingLinks = StreamController<String>.broadcast();
        final logicalEvents = <SubscriptionReturnEvent>[];
        final navigationClaims = <SubscriptionReturnEvent>[];
        final emittedMessages = <String>[];
        final eventSubscription = SubscriptionReturnService.events.listen(
          logicalEvents.add,
        );
        addTearDown(eventSubscription.cancel);
        addTearDown(incomingLinks.close);

        await tester.pumpWidget(
          _testApp(
            initialMode: AppMode.biteScore,
            initialIndex: 2,
            incomingRawDeepLinks: incomingLinks.stream,
            onSubscriptionReturnNavigationClaimed: navigationClaims.add,
            onSubscriptionReturnMessageEmitted: emittedMessages.add,
            restaurantUserSignedIn: false,
            restaurantHubPage: RestaurantAuthScreen(
              authStateStream: Stream.value(null),
            ),
          ),
        );

        final pendingCountBefore = SubscriptionReturnService.pendingEventCount;
        incomingLinks.add(fixture.rawUri);
        await tester.pump();

        expect(logicalEvents, isEmpty, reason: fixture.rawUri);
        expect(navigationClaims, isEmpty, reason: fixture.rawUri);
        expect(emittedMessages, isEmpty, reason: fixture.rawUri);
        expect(
          SubscriptionReturnService.pendingEventCount,
          pendingCountBefore,
          reason: fixture.rawUri,
        );
        expect(
          SubscriptionReturnService.peekPendingNavigation(),
          isNull,
          reason: fixture.rawUri,
        );
        expect(
          SubscriptionReturnService.peekPendingRefresh(),
          isNull,
          reason: fixture.rawUri,
        );
        expect(AppModeStateService.selectedMode.value, AppMode.biteScore);
        expect(
          find.text('Account Page'),
          findsOneWidget,
          reason: fixture.rawUri,
        );
        expect(
          find.text('Restaurant Sign In'),
          findsNothing,
          reason: fixture.rawUri,
        );
        expect(
          find.byType(RestaurantCreateCouponScreen),
          findsNothing,
          reason: fixture.rawUri,
        );
        for (final returnCase in _subscriptionReturnCases) {
          expect(
            find.text(returnCase.message),
            findsNothing,
            reason: fixture.rawUri,
          );
        }
        expect(find.text('Admin'), findsNothing, reason: fixture.rawUri);

        incomingLinks.add(
          subscription_return_fixtures.canonicalUriForMalformedCheckoutFixture(
            fixture,
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(logicalEvents, hasLength(1), reason: fixture.rawUri);
        expect(
          logicalEvents.single.id,
          subscription_return_fixtures.freshCoordinatorFirstEventId,
          reason: fixture.rawUri,
        );
        expect(logicalEvents.single.kind, fixture.kind, reason: fixture.rawUri);
        expect(navigationClaims, hasLength(1), reason: fixture.rawUri);
        expect(
          navigationClaims.single.id,
          logicalEvents.single.id,
          reason: fixture.rawUri,
        );
        expect(emittedMessages, <String>[validCase.message]);
        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(find.text('Restaurant Sign In'), findsOneWidget);
        expect(find.text('Account Page'), findsNothing);
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text(validCase.message), findsOneWidget);
        for (final otherCase in _subscriptionReturnCases.where(
          (candidate) => candidate.kind != fixture.kind,
        )) {
          expect(find.text(otherCase.message), findsNothing);
        }
        expect(SubscriptionReturnService.pendingEventCount, 1);
        expect(SubscriptionReturnService.peekPendingNavigation(), isNull);
        expect(
          SubscriptionReturnService.peekPendingRefresh()?.id,
          logicalEvents.single.id,
        );

        expect(
          SubscriptionReturnService.claimRefresh(logicalEvents.single.id),
          isTrue,
        );
        SubscriptionReturnService.finishRefresh(logicalEvents.single.id);
        await tester.pump(const Duration(seconds: 1));

        expect(SubscriptionReturnService.pendingEventCount, 0);
        expect(navigationClaims, hasLength(1));
        expect(emittedMessages, hasLength(1));
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final checkoutCase in _subscriptionReturnCases.where(
    (returnCase) => returnCase.kind != SubscriptionReturnKind.customerPortal,
  )) {
    testWidgets(
      'signed-out ${checkoutCase.kind.name} is globally claimed once across two auth-gated shells',
      (tester) async {
        final incomingLinks = StreamController<Uri>();
        final logicalEvents = <SubscriptionReturnEvent>[];
        final navigationClaims =
            <({String shell, SubscriptionReturnEvent event})>[];
        final emittedMessages = <String>[];
        final eventSubscription = SubscriptionReturnService.events.listen(
          logicalEvents.add,
        );
        addTearDown(eventSubscription.cancel);
        addTearDown(incomingLinks.close);

        await tester.pumpWidget(
          _twoShellTestApp(
            incomingDeepLinks: incomingLinks.stream,
            onNavigationClaimed: (shell, event) {
              navigationClaims.add((shell: shell, event: event));
            },
            onMessageEmitted: emittedMessages.add,
            restaurantUserSignedIn: false,
            useRestaurantAuthGate: true,
          ),
        );

        incomingLinks.add(Uri.parse(checkoutCase.uri));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(logicalEvents, hasLength(1));
        expect(logicalEvents.single.kind, checkoutCase.kind);
        expect(navigationClaims, hasLength(1));
        expect(navigationClaims.single.event.id, logicalEvents.single.id);
        expect(emittedMessages, <String>[checkoutCase.message]);
        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(find.text('Restaurant Sign In'), findsOneWidget);
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(
          SubscriptionReturnService.peekPendingRefresh()?.id,
          logicalEvents.single.id,
        );
        expect(SubscriptionReturnService.peekPendingNavigation(), isNull);

        await tester.pump(const Duration(seconds: 1));
        expect(logicalEvents, hasLength(1));
        expect(navigationClaims, hasLength(1));
        expect(emittedMessages, hasLength(1));
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'one source delivery is globally claimed once across two navigation shells',
    (tester) async {
      final incomingLinks = StreamController<Uri>();
      final logicalEvents = <SubscriptionReturnEvent>[];
      final navigationClaims =
          <({String shell, SubscriptionReturnEvent event})>[];
      final emittedMessages = <String>[];
      final eventSubscription = SubscriptionReturnService.events.listen(
        logicalEvents.add,
      );
      addTearDown(eventSubscription.cancel);
      addTearDown(incomingLinks.close);

      await tester.pumpWidget(
        _twoShellTestApp(
          incomingDeepLinks: incomingLinks.stream,
          onNavigationClaimed: (shell, event) {
            navigationClaims.add((shell: shell, event: event));
          },
          onMessageEmitted: emittedMessages.add,
        ),
      );

      final portalUri = Uri.parse(subscriptionPortalReturnUri);
      incomingLinks.add(portalUri);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(logicalEvents, hasLength(1));
      expect(logicalEvents.single.kind, SubscriptionReturnKind.customerPortal);
      expect(navigationClaims, hasLength(1));
      expect(navigationClaims.single.event.id, logicalEvents.single.id);
      expect(emittedMessages, <String>[
        'Returned from subscription management. Refreshing your subscription status.',
      ]);
      expect(find.textContaining('Restaurant Hub Page'), findsOneWidget);
      expect(find.byType(MainNavigationScreen), findsNWidgets(2));
      expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
      expect(
        find.text(
          'Returned from subscription management. Refreshing your subscription status.',
        ),
        findsWidgets,
      );

      expect(
        SubscriptionReturnService.claimRefresh(logicalEvents.single.id),
        isTrue,
      );
      SubscriptionReturnService.finishRefresh(logicalEvents.single.id);
      expect(SubscriptionReturnService.pendingEventCount, 0);

      // A later physical delivery of the same static URI remains a new event.
      incomingLinks.add(portalUri);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(logicalEvents, hasLength(2));
      expect(logicalEvents.last.id, isNot(logicalEvents.first.id));
      expect(navigationClaims, hasLength(2));
      expect(navigationClaims.last.event.id, logicalEvents.last.id);
      expect(emittedMessages, hasLength(2));
      expect(find.textContaining('Restaurant Hub Page'), findsOneWidget);
      expect(find.byType(MainNavigationScreen), findsNWidgets(2));
      expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
      expect(
        SubscriptionReturnService.claimRefresh(logicalEvents.last.id),
        isTrue,
      );
      SubscriptionReturnService.finishRefresh(logicalEvents.last.id);
      expect(SubscriptionReturnService.pendingEventCount, 0);
      expect(tester.takeException(), isNull);
    },
  );

  for (final checkoutCase in _subscriptionReturnCases.where(
    (returnCase) => returnCase.kind != SubscriptionReturnKind.customerPortal,
  )) {
    testWidgets(
      'checkout ${checkoutCase.kind.name} is globally claimed once across two active-Hub shells',
      (tester) async {
        final incomingLinks = StreamController<Uri>();
        final logicalEvents = <SubscriptionReturnEvent>[];
        final navigationClaims =
            <({String shell, SubscriptionReturnEvent event})>[];
        final emittedMessages = <String>[];
        final eventSubscription = SubscriptionReturnService.events.listen(
          logicalEvents.add,
        );
        addTearDown(eventSubscription.cancel);
        addTearDown(incomingLinks.close);
        SubscriptionReturnService.registerRestaurantHub();

        await tester.pumpWidget(
          _twoShellTestApp(
            incomingDeepLinks: incomingLinks.stream,
            onNavigationClaimed: (shell, event) {
              navigationClaims.add((shell: shell, event: event));
            },
            onMessageEmitted: emittedMessages.add,
            restaurantUserSignedIn: true,
          ),
        );

        incomingLinks.add(Uri.parse(checkoutCase.uri));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(logicalEvents, hasLength(1));
        expect(logicalEvents.single.kind, checkoutCase.kind);
        expect(navigationClaims, hasLength(1));
        expect(navigationClaims.single.event.id, logicalEvents.single.id);
        expect(emittedMessages, <String>[checkoutCase.message]);
        // One global ScaffoldMessenger emission is rendered by each mounted
        // test Scaffold; the callback above is the once-only assertion.
        expect(find.text(checkoutCase.message), findsWidgets);
        expect(find.textContaining('Restaurant Hub Page'), findsOneWidget);
        expect(find.byType(MainNavigationScreen), findsNWidgets(2));
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(
          SubscriptionReturnService.peekPendingRefresh()?.id,
          logicalEvents.single.id,
        );

        expect(
          SubscriptionReturnService.claimRefresh(logicalEvents.single.id),
          isTrue,
        );
        SubscriptionReturnService.finishRefresh(logicalEvents.single.id);
        await tester.pump(const Duration(seconds: 1));

        expect(navigationClaims, hasLength(1));
        expect(emittedMessages, hasLength(1));
        expect(SubscriptionReturnService.pendingEventCount, 0);
        expect(find.byType(MainNavigationScreen), findsNWidgets(2));
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final checkoutCase in _subscriptionReturnCases.where(
    (returnCase) => returnCase.kind != SubscriptionReturnKind.customerPortal,
  )) {
    testWidgets(
      'authenticated no-active-Hub ${checkoutCase.kind.name} keeps the direct Hub route',
      (tester) async {
        final incomingLinks = StreamController<Uri>.broadcast();
        final navigationClaims = <SubscriptionReturnEvent>[];
        final emittedMessages = <String>[];
        final navigatorObserver = _RecordingNavigatorObserver();
        addTearDown(incomingLinks.close);

        await tester.pumpWidget(
          _testApp(
            initialMode: AppMode.biteScore,
            initialIndex: 2,
            incomingDeepLinks: incomingLinks.stream,
            onSubscriptionReturnNavigationClaimed: navigationClaims.add,
            onSubscriptionReturnMessageEmitted: emittedMessages.add,
            restaurantUserSignedIn: true,
            authenticatedRestaurantHubBuilder: (_) => const Scaffold(
              body: Center(child: Text('Authenticated Restaurant Hub Route')),
            ),
            navigatorObservers: <NavigatorObserver>[navigatorObserver],
          ),
        );

        incomingLinks.add(Uri.parse(checkoutCase.uri));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.pumpAndSettle();

        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(find.text('Authenticated Restaurant Hub Route'), findsOneWidget);
        expect(
          find.byType(MainNavigationScreen, skipOffstage: false),
          findsOneWidget,
        );
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(navigationClaims, hasLength(1));
        expect(navigationClaims.single.kind, checkoutCase.kind);
        expect(emittedMessages, <String>[checkoutCase.message]);
        expect(
          navigatorObserver.pushedRoutes.where(
            (route) =>
                route.settings.name == RestaurantCreateCouponScreen.routeName,
          ),
          hasLength(1),
        );
        expect(
          SubscriptionReturnService.peekPendingRefresh()?.id,
          navigationClaims.single.id,
        );
        expect(SubscriptionReturnService.peekPendingNavigation(), isNull);

        await tester.pump(const Duration(seconds: 1));
        expect(navigationClaims, hasLength(1));
        expect(emittedMessages, hasLength(1));
        expect(
          navigatorObserver.pushedRoutes.where(
            (route) =>
                route.settings.name == RestaurantCreateCouponScreen.routeName,
          ),
          hasLength(1),
        );
        expect(
          find.byType(MainNavigationScreen, skipOffstage: false),
          findsOneWidget,
        );
        expect(find.text('Admin'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final checkoutCase in _subscriptionReturnCases.where(
    (returnCase) => returnCase.kind != SubscriptionReturnKind.customerPortal,
  )) {
    testWidgets(
      'authenticated active-Hub ${checkoutCase.kind.name} routing remains unchanged',
      (tester) async {
        final incomingLinks = StreamController<Uri>.broadcast();
        final navigationClaims = <SubscriptionReturnEvent>[];
        final emittedMessages = <String>[];
        addTearDown(incomingLinks.close);
        SubscriptionReturnService.registerRestaurantHub();

        await tester.pumpWidget(
          _testApp(
            initialMode: AppMode.biteScore,
            incomingDeepLinks: incomingLinks.stream,
            onSubscriptionReturnNavigationClaimed: navigationClaims.add,
            onSubscriptionReturnMessageEmitted: emittedMessages.add,
            restaurantUserSignedIn: true,
          ),
        );

        incomingLinks.add(Uri.parse(checkoutCase.uri));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
        expect(find.text('Restaurant Hub Page'), findsOneWidget);
        expect(navigationClaims, hasLength(1));
        expect(navigationClaims.single.kind, checkoutCase.kind);
        expect(
          SubscriptionReturnService.peekPendingRefresh()?.id,
          navigationClaims.single.id,
        );
        expect(emittedMessages, <String>[checkoutCase.message]);
        expect(find.text(checkoutCase.message), findsOneWidget);
        for (final otherCase in _subscriptionReturnCases.where(
          (candidate) => candidate.kind != checkoutCase.kind,
        )) {
          expect(find.text(otherCase.message), findsNothing);
        }
        expect(find.byType(MainNavigationScreen), findsOneWidget);
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);

        await tester.pump(const Duration(seconds: 1));
        expect(navigationClaims, hasLength(1));
        expect(emittedMessages, hasLength(1));
        expect(find.byType(MainNavigationScreen), findsOneWidget);
        expect(find.byType(RestaurantCreateCouponScreen), findsNothing);
        expect(find.text('Admin'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('three destinations do not overflow narrow scaled layouts', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_testApp(textScaler: const TextScaler.linear(2.5)));

    expect(tester.takeException(), isNull);
    expect(find.text('Restaurant\nHub'), findsOneWidget);
  });

  testWidgets('portal return remains safe in a narrow scaled layout', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final incomingLinks = StreamController<Uri>.broadcast();
    addTearDown(incomingLinks.close);

    await tester.pumpWidget(
      _testApp(
        textScaler: const TextScaler.linear(2.5),
        incomingDeepLinks: incomingLinks.stream,
      ),
    );
    incomingLinks.add(Uri.parse(subscriptionPortalReturnUri));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Restaurant Hub Page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Widget _testApp({
  int initialIndex = 0,
  AppMode initialMode = AppMode.biteSaver,
  TextScaler textScaler = TextScaler.noScaling,
  Stream<Uri>? incomingDeepLinks,
  Stream<String>? incomingRawDeepLinks,
  Widget? restaurantHubPage,
  ValueChanged<SubscriptionReturnEvent>? onSubscriptionReturnNavigationClaimed,
  ValueChanged<String>? onSubscriptionReturnMessageEmitted,
  bool? restaurantUserSignedIn,
  WidgetBuilder? authenticatedRestaurantHubBuilder,
  List<NavigatorObserver> navigatorObservers = const <NavigatorObserver>[],
}) {
  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    navigatorObservers: navigatorObservers,
    home: MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: MainNavigationScreen(
        initialMode: initialMode,
        initialIndex: initialIndex,
        initializePlatformServices: false,
        testIncomingDeepLinks: incomingDeepLinks,
        testIncomingRawDeepLinks: incomingRawDeepLinks,
        testOnSubscriptionReturnNavigationClaimed:
            onSubscriptionReturnNavigationClaimed,
        testOnSubscriptionReturnMessageEmitted:
            onSubscriptionReturnMessageEmitted,
        testRestaurantUserSignedIn: restaurantUserSignedIn,
        testAuthenticatedRestaurantHubBuilder:
            authenticatedRestaurantHubBuilder,
        testPagesBuilder: (mode) => <Widget>[
          Center(child: Text('${mode.name} Home Page')),
          restaurantHubPage ?? const Center(child: Text('Restaurant Hub Page')),
          const Center(child: Text('Account Page')),
        ],
      ),
    ),
  );
}

class _RecordingNavigatorObserver extends NavigatorObserver {
  final List<Route<dynamic>> pushedRoutes = <Route<dynamic>>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushedRoutes.add(route);
    super.didPush(route, previousRoute);
  }
}

Widget _twoShellTestApp({
  required Stream<Uri> incomingDeepLinks,
  required void Function(String shell, SubscriptionReturnEvent event)
  onNavigationClaimed,
  required ValueChanged<String> onMessageEmitted,
  bool? restaurantUserSignedIn,
  bool useRestaurantAuthGate = false,
}) {
  MainNavigationScreen shell(String label) {
    final restaurantHubPage = useRestaurantAuthGate
        ? RestaurantAuthScreen(
            key: ValueKey<String>('$label-auth-gate'),
            authStateStream: Stream.value(null),
          )
        : Center(child: Text('$label Restaurant Hub Page'));
    return MainNavigationScreen(
      key: ValueKey<String>(label),
      initialMode: AppMode.biteScore,
      initialIndex: 2,
      initializePlatformServices: false,
      testIncomingDeepLinks: incomingDeepLinks,
      testOnSubscriptionReturnNavigationClaimed: (event) {
        onNavigationClaimed(label, event);
      },
      testOnSubscriptionReturnMessageEmitted: onMessageEmitted,
      testRestaurantUserSignedIn: restaurantUserSignedIn,
      testPagesBuilder: (mode) => <Widget>[
        Center(child: Text('$label ${mode.name} Home Page')),
        restaurantHubPage,
        Center(child: Text('$label Account Page')),
      ],
    );
  }

  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    home: Stack(children: <Widget>[shell('First'), shell('Second')]),
  );
}
