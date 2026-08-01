import 'dart:async';

import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/subscription_return_service.dart';
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
    backend = FakeSubscriptionReturnBackend(clock: () => _now);
    await installFakeSubscriptionReturnService(backend, clock: () => _now);
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  tearDown(() {
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

  testWidgets('two shells produce one server-authoritative navigation action', (
    tester,
  ) async {
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
        home: Stack(
          children: <Widget>[
            for (final shell in <String>['first', 'second'])
              MainNavigationScreen(
                key: ValueKey<String>(shell),
                initializePlatformServices: false,
                testIncomingRawDeepLinks: incoming.stream,
                testSubscriptionReturnOwnerScopeProvider: () => _ownerA,
                testOnSubscriptionReturnNavigationClaimed: (_) =>
                    claims.add(shell),
                testSuppressSubscriptionReturnSnackBar: true,
                testAuthenticatedRestaurantHubBuilder: (_) =>
                    Text('$shell authenticated hub'),
                testPagesBuilder: (mode) => <Widget>[
                  Text('$shell ${mode.name} home'),
                  Text('$shell hub'),
                  Text('$shell account'),
                ],
              ),
          ],
        ),
      ),
    );
    incoming.add(
      subscriptionReturnUri(
        kind: SubscriptionReturnKind.checkoutSuccess,
        returnToken: _token(13),
      ),
    );
    await _pumpUntil(tester, () => claims.isNotEmpty);
    await _settleAsync(tester);
    expect(claims, hasLength(1));
  });

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
