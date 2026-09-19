import 'dart:async';

import 'package:coupon_app/main.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _coupon = Coupon(
  id: 'public-qr-coupon',
  restaurant: 'Permanent QR Restaurant',
  title: 'Permanent QR Coupon',
  distance: '',
  usageRule: 'Once per customer',
);

Widget _detail({Coupon coupon = _coupon}) => CouponDetailScreen(
  coupon: coupon,
  loadFavoriteState: (_) async => false,
  loadCustomerVisibility: (_, _) async => true,
  initializeRedemptionStore: () async {},
);

MainNavigationScreen _boundedShell({
  AppMode mode = AppMode.biteSaver,
  int index = 0,
  RestaurantCustomerDeepLink? link,
  Stream<String>? authChanges,
  String Function()? authRealm,
}) => MainNavigationScreen(
  initialMode: mode,
  initialIndex: index,
  initialCustomerDeepLink: link,
  initializePlatformServices: false,
  testCustomerAuthRealmProvider: authRealm ?? () => 'guest',
  testCustomerAuthRealmChanges: authChanges,
  testCustomerDeepLinkBuilder: (_) => _detail(),
  biteSaverBrowseHomeBuilder: (_, _, _) => const Text('Canonical Browse'),
  biteSaverSavedAccountBuilder: (_, realm) => Text('Canonical Saved $realm'),
);

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    mainNavigationController.resetBiteSaverCustomerPathForTesting();
    await DemoRedemptionStore.resetForTesting();
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  tearDown(() async {
    mainNavigationController.resetBiteSaverCustomerPathForTesting();
    await DemoRedemptionStore.resetForTesting();
  });

  testWidgets('default-off legacy detail keeps its existing redeem action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: _detail()));
    await tester.pumpAndSettle();

    expect(DemoRedemptionStore.legacyWritesEnabled, isTrue);
    expect(
      find.widgetWithText(ElevatedButton, 'Redeem Coupon'),
      findsOneWidget,
    );
    expect(find.text('Browse coupons'), findsNothing);
    expect(DemoRedemptionStore.memoryStateForTesting(_coupon.id), isNull);
  });

  for (final mode in AppMode.values) {
    testWidgets(
      '${mode.name} Account retains canonical Saved through auth changes',
      (tester) async {
        final changes = StreamController<String>.broadcast(sync: true);
        addTearDown(changes.close);
        var realm = 'guest';
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            home: _boundedShell(
              mode: mode,
              index: 2,
              authChanges: changes.stream,
              authRealm: () => realm,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Canonical Saved guest'), findsOneWidget);
        expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
        for (final next in ['signed:owner-a', 'signed:owner-b', 'guest']) {
          realm = next;
          changes.add(next);
          await tester.pumpAndSettle();
          expect(find.text('Canonical Saved $next'), findsOneWidget);
          expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
        }
      },
    );
  }

  testWidgets('reconstructed shell inherits the paired bounded composition', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(navigatorKey: rootNavigatorKey, home: _boundedShell()),
    );
    await tester.pumpAndSettle();
    unawaited(
      rootNavigatorKey.currentState!.pushAndRemoveUntil<void>(
        MaterialPageRoute<void>(
          builder: (_) => const MainNavigationScreen(
            initialIndex: 2,
            initializePlatformServices: false,
          ),
        ),
        (_) => false,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Canonical Saved guest'), findsOneWidget);
    expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(find.text('Canonical Browse'), findsOneWidget);
  });

  testWidgets('standalone Account routes My Profile to canonical Account', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(navigatorKey: rootNavigatorKey, home: _boundedShell()),
    );
    await tester.pumpAndSettle();
    unawaited(
      rootNavigatorKey.currentState!.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => CustomerAccountScreen(
            userStream: Stream<User?>.value(_SignedUser()),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('My Profile'));
    await tester.pumpAndSettle();
    expect(find.text('Canonical Saved guest'), findsOneWidget);
    expect(find.byType(CustomerAccountScreen), findsNothing);
    expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
  });

  testWidgets(
    'public unlimited coupon still routes into authoritative Browse',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(navigatorKey: rootNavigatorKey, home: _boundedShell()),
      );
      await tester.pumpAndSettle();
      unawaited(
        rootNavigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => _detail(
              coupon: const Coupon(
                id: 'unlimited-qr',
                restaurant: 'Permanent QR Restaurant',
                title: 'Unlimited QR Coupon',
                distance: '',
                usageRule: 'Unlimited',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Browse coupons'));
      await tester.pumpAndSettle();
      expect(find.text('Canonical Browse'), findsOneWidget);
      expect(DemoRedemptionStore.memoryStateForTesting('unlimited-qr'), isNull);
    },
  );

  for (final coldStart in [true, false]) {
    testWidgets(
      '${coldStart ? 'initial' : 'runtime'} permanent QR routes final use to canonical Browse',
      (tester) async {
        tester.view.physicalSize = const Size(1000, 1400);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        const route = '/r/coupons/permanent-restaurant-id';
        if (coldStart) {
          tester.binding.platformDispatcher.defaultRouteNameTestValue = route;
          addTearDown(
            tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
          );
        }
        final resolvedIds = <String>[];
        await tester.pumpWidget(
          CouponApp(
            testWrapCelebrationHosts: false,
            testNavigationBuilder: (link, _) {
              if (link != null) resolvedIds.add(link.restaurantId);
              return _boundedShell(link: link);
            },
            testCustomerRouteBuilder: (link) {
              resolvedIds.add(link.restaurantId);
              return _detail();
            },
          ),
        );
        await tester.pumpAndSettle();
        if (!coldStart) {
          unawaited(rootNavigatorKey.currentState!.pushNamed<void>(route));
          await tester.pumpAndSettle();
        }
        expect(resolvedIds, ['permanent-restaurant-id']);
        expect(find.text('Permanent QR Coupon'), findsWidgets);
        expect(
          find.widgetWithText(ElevatedButton, 'Browse coupons'),
          findsOneWidget,
        );
        expect(find.text('Redeem Coupon'), findsNothing);
        expect(DemoRedemptionStore.memoryStateForTesting(_coupon.id), isNull);
        await tester.tap(find.widgetWithText(ElevatedButton, 'Browse coupons'));
        await tester.pumpAndSettle();
        expect(find.text('Canonical Browse'), findsOneWidget);
        expect(find.byType(CouponDetailScreen), findsNothing);
        expect(DemoRedemptionStore.memoryStateForTesting(_coupon.id), isNull);
      },
    );
  }
}

final class _SignedUser implements User {
  @override
  String get uid => 'owner-a';
  @override
  bool get isAnonymous => false;
  @override
  bool get emailVerified => true;
  @override
  String? get displayName => 'Owner';
  @override
  String? get email => null;
  @override
  List<UserInfo> get providerData => <UserInfo>[];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
