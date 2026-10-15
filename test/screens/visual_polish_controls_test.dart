import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/widgets/app_mode_switcher_bar.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/widgets/bitesaver_colors.dart';
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart'; // ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart'; // ignore: depend_on_referenced_packages
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../visual_polish_fixture/main.dart';

void main() {
  late FirebasePlatform core;
  late FirebaseAuthPlatform auth;
  setUp(() {
    core = FirebasePlatform.instance;
    auth = FirebaseAuthPlatform.instance;
    initializeVisualFixture();
  });
  tearDown(() {
    FirebasePlatform.instance = core;
    FirebaseAuthPlatform.instance = auth;
    AppModeStateService.setMode(AppMode.biteSaver);
  });
  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'compact dish suggestion and report workflows at 320dp scale $scale',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(320, 640);
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: visualDish(),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Suggest Dish Edits'), findsNothing);
        expect(find.text('Suggest Rename'), findsNothing);
        expect(find.text('Suggest Merge'), findsNothing);
        final entry = find.byKey(const ValueKey('dish-suggest-edit'));
        await tester.ensureVisible(entry);
        await tester.pumpAndSettle();
        expect(tester.getSize(entry).height, greaterThanOrEqualTo(48));
        expect(tester.getRect(entry).right, lessThanOrEqualTo(320));
        await tester.tap(entry);
        await tester.pumpAndSettle();
        expect(find.text('Suggest Rename'), findsOneWidget);
        expect(find.text('Suggest Merge'), findsOneWidget);
        await tester.tap(find.text('Suggest Rename'));
        await tester.pumpAndSettle();
        expect(find.text('Suggested dish name'), findsOneWidget);
        await tester.enterText(find.byType(TextField).last, '');
        await tester.tap(find.text('Submit'));
        await tester.pumpAndSettle();
        expect(find.text('Suggested dish name is required.'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        ScaffoldMessenger.of(tester.element(entry)).hideCurrentSnackBar();
        await tester.pumpAndSettle();
        await tester.tap(entry);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Suggest Merge'));
        await tester.pumpAndSettle();
        expect(find.text('Suggest Merge'), findsOneWidget);
        await tester.tap(find.text('Submit'));
        await tester.pumpAndSettle();
        expect(find.text('Choose a dish to merge into.'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        ScaffoldMessenger.of(tester.element(entry)).hideCurrentSnackBar();
        await tester.pumpAndSettle();
        final report = find.widgetWithText(TextButton, 'Report dish');
        await tester.ensureVisible(report);
        await tester.tap(report);
        await tester.pumpAndSettle();
        expect(find.text('Reason (Optional)'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(find.text('Reviews'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('unverified contributor cannot enter suggestion dialog', (
    tester,
  ) async {
    visualAuth.currentUser = VisualUser(visualAuth, verified: false);
    await tester.pumpWidget(MaterialApp(home: visualDish()));
    await tester.pumpAndSettle();
    final entry = find.byKey(const ValueKey('dish-suggest-edit'));
    await tester.ensureVisible(entry);
    await tester.tap(entry);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Suggest Rename'));
    await tester.pumpAndSettle();
    expect(find.text('Suggested dish name'), findsNothing);
    expect(
      find.textContaining('Please verify your email', findRichText: true),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  for (final mode in AppMode.values) {
    testWidgets('shared hamburger appearance and contents on ${mode.name}', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: MainNavigationScreen(
            initialMode: mode,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'guest',
            testCustomerAuthRealmChanges: const Stream<String>.empty(),
            testPagesBuilder: (_) => const [SizedBox(), SizedBox(), SizedBox()],
          ),
        ),
      );
      await tester.pumpAndSettle();
      final menu = find.byTooltip('Menu');
      expect(menu, findsOneWidget);
      final circle = tester
          .widgetList<Container>(
            find.descendant(of: menu, matching: find.byType(Container)),
          )
          .where(
            (c) =>
                c.decoration is BoxDecoration &&
                (c.decoration as BoxDecoration).shape == BoxShape.circle,
          )
          .single;
      final decoration = circle.decoration! as BoxDecoration;
      expect(decoration.color, BiteSaverColors.green);
      expect(decoration.border, isNull);
      final icon = tester.widget<Icon>(
        find.descendant(of: menu, matching: find.byIcon(Icons.menu)),
      );
      expect(icon.color, Colors.black);
      expect(tester.getSize(menu).width, greaterThanOrEqualTo(48));
      await tester.tap(menu);
      await tester.pumpAndSettle();
      expect(find.text('Restaurant Hub'), findsOneWidget);
      expect(
        find.widgetWithText(PopupMenuItem<int>, 'My Profile'),
        findsOneWidget,
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Restaurant Hub'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    '320dp at 200 percent keeps mode labels and tap drag Back usable',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 640);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(2)),
            child: child!,
          ),
          home: MainNavigationScreen(
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'guest',
            testCustomerAuthRealmChanges: const Stream<String>.empty(),
            testPagesBuilder: (mode) => [
              Text('${mode.name} local home'),
              const SizedBox(),
              const SizedBox(),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();
      final switcher = find.byType(AppModeSwitcherBar);
      for (final label in ['Coupons & Specials', 'Dish Ratings']) {
        for (final f in find.text(label).evaluate()) {
          final rect = tester.getRect(
            find.byElementPredicate((e) => identical(e, f)),
          );
          expect(rect.top, greaterThanOrEqualTo(tester.getRect(switcher).top));
          expect(
            rect.bottom,
            lessThanOrEqualTo(tester.getRect(switcher).bottom),
          );
        }
      }
      await tester.tap(find.text('Dish Ratings').last);
      await tester.pumpAndSettle();
      expect(find.text('biteScore local home'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('biteSaver local home'), findsOneWidget);
      await tester.drag(switcher, const Offset(180, 0));
      await tester.pumpAndSettle();
      expect(find.text('biteScore local home'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('biteSaver local home'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
