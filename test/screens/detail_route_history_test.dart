import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../detail_route_history_fixture/main.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AppModeStateService.setMode(AppMode.biteSaver);
  });
  for (final mode in AppMode.values) {
    for (final switchMode in [false, true]) {
      testWidgets(
        '${mode.name} real detail survives ${switchMode ? 'mode' : 'tab'} visit with same State',
        (tester) async {
          await openFixture(tester, mode);
          final type = mode == AppMode.biteSaver
              ? RestaurantProfileScreen
              : BiteScoreDishDetailScreen;
          await tester.tap(
            find.text(
              mode == AppMode.biteSaver
                  ? 'Open restaurant detail'
                  : 'Open dish detail',
            ),
          );
          await tester.pumpAndSettle();
          final detail = tester.state(find.byType(type));
          if (switchMode) {
            await tester.tap(
              find
                  .text(mode == AppMode.biteSaver ? 'BiteScore' : 'BiteSaver')
                  .first,
            );
          } else {
            await tester.tap(find.text('My Profile'));
          }
          await tester.pumpAndSettle();
          expect(find.byType(type), findsNothing);
          expect(
            tester.state(find.byType(type, skipOffstage: false)),
            same(detail),
          );
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(tester.state(find.byType(type)), same(detail));
          expect(AppModeStateService.selectedMode.value, mode);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(find.text('${mode.name} local Home'), findsOneWidget);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(find.text('${mode.name} local Home'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
  testWidgets(
    'Score restaurant explicit mode callback retains the same route',
    (tester) async {
      await openFixture(tester, AppMode.biteScore);
      await tester.tap(find.text('Open Score restaurant detail'));
      await tester.pumpAndSettle();
      final state = tester.state(find.byType(BiteScoreRestaurantDishesScreen));
      await tester.tap(find.text('BiteSaver').first);
      await tester.pumpAndSettle();
      expect(find.text('biteSaver local Home'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester.state(find.byType(BiteScoreRestaurantDishesScreen)),
        same(state),
      );
      expect(AppModeStateService.selectedMode.value, AppMode.biteScore);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'multiple native visits reverse without duplicates and dismiss modal first',
    (tester) async {
      await openFixture(tester, AppMode.biteSaver);
      await tester.tap(find.text('Open restaurant detail'));
      await tester.pumpAndSettle();
      final restaurant = tester.state(find.byType(RestaurantProfileScreen));
      await tester.tap(find.text('BiteScore').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open dish detail'));
      await tester.pumpAndSettle();
      final dish = tester.state(find.byType(BiteScoreDishDetailScreen));
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Restaurant\nHub'));
      await tester.pumpAndSettle();
      showDialog<void>(
        context: tester.element(find.text('Local Restaurant Hub')),
        builder: (_) => const AlertDialog(title: Text('Local dialog')),
      );
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Local dialog'), findsNothing);
      expect(find.text('Local Restaurant Hub'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Local My Profile'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(BiteScoreDishDetailScreen)), same(dish));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('biteScore local Home'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester.state(find.byType(RestaurantProfileScreen)),
        same(restaurant),
      );
      expect(AppModeStateService.selectedMode.value, AppMode.biteSaver);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        find.byType(MainNavigationScreen, skipOffstage: false),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
  for (final nextUser in <String?>[null, 'owner-b']) {
    testWidgets(
      'covered private detail cannot return after ${nextUser == null ? 'sign out' : 'account switch'}',
      (tester) async {
        final fixture = await openFixture(tester, AppMode.biteSaver);
        await tester.tap(find.text('Open protected coupon detail'));
        await tester.pumpAndSettle();
        expect(find.byType(CouponDetailScreen), findsOneWidget);
        await tester.tap(find.text('My Profile'));
        await tester.pumpAndSettle();
        fixture.changeUser(nextUser);
        await tester.pumpAndSettle();
        expect(
          find.byType(CouponDetailScreen, skipOffstage: false),
          findsNothing,
        );
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(
          find.byType(CouponDetailScreen, skipOffstage: false),
          findsNothing,
        );
        expect(find.text('biteSaver local Home'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('a stale detail control cannot reset the current visit', (
    tester,
  ) async {
    await openFixture(tester, AppMode.biteSaver);
    await tester.tap(find.text('Open restaurant detail'));
    await tester.pumpAndSettle();
    final sourceContext = tester.element(find.byType(RestaurantProfileScreen));
    final detail = tester.state(find.byType(RestaurantProfileScreen));
    await tester.tap(find.text('My Profile'));
    await tester.pumpAndSettle();
    final visit = tester.state(find.byType(MainNavigationScreen));
    openMainNavigationDetailDestination(
      sourceContext,
      mode: AppMode.biteScore,
      index: 1,
    );
    await tester.pumpAndSettle();
    expect(find.text('Local My Profile'), findsOneWidget);
    expect(tester.state(find.byType(MainNavigationScreen)), same(visit));
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(tester.state(find.byType(RestaurantProfileScreen)), same(detail));
  });

  testWidgets(
    'retained public dish clears previous-account draft on auth replacement',
    (tester) async {
      final fixture = await openFixture(tester, AppMode.biteScore);
      await tester.tap(find.text('Open dish detail'));
      await tester.pumpAndSettle();
      final detail = tester.state(find.byType(BiteScoreDishDetailScreen));
      final field = find.byType(TextField).first;
      await tester.ensureVisible(field);
      await tester.enterText(field, 'Owner A private draft');
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      fixture.changeUser('owner-b');
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester.state(find.byType(BiteScoreDishDetailScreen)),
        same(detail),
      );
      expect(
        find.text('Owner A private draft', skipOffstage: false),
        findsNothing,
      );
      expect(
        tester.widget<TextField>(find.byType(TextField).first).controller!.text,
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );
}

Future<DetailHistoryFixtureState> openFixture(
  WidgetTester tester,
  AppMode mode,
) async {
  tester.view.physicalSize = const Size(1080, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(DetailHistoryFixture(initialMode: mode));
  await tester.pumpAndSettle();
  return tester.state<DetailHistoryFixtureState>(
    find.byType(DetailHistoryFixture),
  );
}
