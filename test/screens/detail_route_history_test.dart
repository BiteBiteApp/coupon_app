import 'package:coupon_app/screens/about_us_screen.dart';
import 'package:coupon_app/screens/privacy_policy_screen.dart';
import 'package:coupon_app/screens/terms_of_service_screen.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
                  .text(
                    mode == AppMode.biteSaver
                        ? 'Dish Ratings'
                        : 'Coupons & Specials',
                  )
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
          final modeBeforeInformation = AppModeStateService.selectedMode.value;
          for (final destination in [
            (label: 'About Us', type: AboutUsScreen),
            (label: 'Privacy Policy', type: PrivacyPolicyScreen),
            (label: 'Terms of Service', type: TermsOfServiceScreen),
          ]) {
            await tester.tap(find.byTooltip('Menu'));
            await tester.pumpAndSettle();
            await tester.tap(find.text(destination.label));
            await tester.pumpAndSettle();
            expect(find.byType(destination.type), findsOneWidget);
            expect(
              tester.state(find.byType(type, skipOffstage: false)),
              same(detail),
            );
            await tester.tap(find.byTooltip('Back'));
            await tester.pumpAndSettle();
            expect(
              AppModeStateService.selectedMode.value,
              modeBeforeInformation,
            );
          }
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
  for (final scale in [1.0, 2.0, 3.0]) {
    testWidgets('profile switcher labels and drag at 320dp scale $scale', (
      tester,
    ) async {
      await openFixture(tester, AppMode.biteSaver);
      await tester.tap(find.text('Open restaurant detail'));
      await tester.pumpAndSettle();
      final detail = tester.state(find.byType(RestaurantProfileScreen));
      tester.view.physicalSize = const Size(320, 700);
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpAndSettle();
      for (final mode in AppMode.values) {
        AppModeStateService.setMode(mode);
        await tester.pumpAndSettle();
        for (final label in ['Coupons & Specials', 'Dish Ratings']) {
          expect(find.bySemanticsLabel(label), findsOneWidget);
          for (final element in find.text(label).evaluate()) {
            final paragraph = element.renderObject! as RenderParagraph;
            expect(paragraph.textScaler.scale(14), closeTo(14 * scale, .01));
            expect(paragraph.didExceedMaxLines, isFalse);
            for (var i = 0; i < label.length; i++) {
              if (label[i] == ' ') continue;
              for (final box in paragraph.getBoxesForSelection(
                TextSelection(baseOffset: i, extentOffset: i + 1),
              )) {
                expect(box.left, greaterThanOrEqualTo(-.01));
                expect(
                  box.right,
                  lessThanOrEqualTo(paragraph.size.width + .01),
                );
                expect(
                  box.bottom,
                  lessThanOrEqualTo(paragraph.size.height + .01),
                );
              }
            }
          }
        }
        expect(tester.takeException(), isNull);
      }
      // Growing labels can move profile actions below the fold. They must stay
      // reachable and retain their accessible button actions after scrolling.
      final menu = find.byKey(const ValueKey('profile-menu-main'));
      await Scrollable.ensureVisible(tester.element(menu), alignment: .5);
      await tester.pumpAndSettle();
      for (final action in [menu, find.widgetWithText(TextButton, 'Report')]) {
        expect(action.hitTestable(), findsOneWidget);
        final semantics = tester.getSemantics(action).getSemanticsData();
        expect(semantics.flagsCollection.isHidden, isFalse);
        expect(semantics.flagsCollection.isButton, isTrue);
        expect(semantics.hasAction(SemanticsAction.tap), isTrue);
      }
      if (scale == 2) {
        await tester.tap(menu);
        await tester.pumpAndSettle();
        expect(find.text('Menu is not available right now.'), findsOneWidget);
        await tester.pump(const Duration(seconds: 4));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(TextButton, 'Report'));
        await tester.pumpAndSettle();
        expect(
          tester
              .state<DetailHistoryFixtureState>(
                find.byType(DetailHistoryFixture),
              )
              .reportPromptCalls,
          1,
        );
        expect(
          tester.state(find.byType(RestaurantProfileScreen)),
          same(detail),
        );
      }
      AppModeStateService.setMode(AppMode.biteSaver);
      await tester.pumpAndSettle();
      // Return to the switcher before checking its gestures.
      await tester.ensureVisible(find.text('Dish Ratings').last);
      await tester.pumpAndSettle();
      final left = tester.getCenter(find.text('Coupons & Specials').last);
      await tester.dragFrom(left, const Offset(240, 0));
      await tester.pumpAndSettle();
      expect(find.text('biteScore local Home'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(RestaurantProfileScreen)), same(detail));
      await tester.tap(find.text('Dish Ratings').last);
      await tester.pumpAndSettle();
      expect(find.text('biteScore local Home'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(RestaurantProfileScreen)), same(detail));
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'Score restaurant explicit mode callback retains the same route',
    (tester) async {
      await openFixture(tester, AppMode.biteScore);
      await tester.tap(find.text('Open Score restaurant detail'));
      await tester.pumpAndSettle();
      final state = tester.state(find.byType(BiteScoreRestaurantDishesScreen));
      await tester.tap(find.text('Coupons & Specials').first);
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
      await tester.tap(find.text('Dish Ratings').first);
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
