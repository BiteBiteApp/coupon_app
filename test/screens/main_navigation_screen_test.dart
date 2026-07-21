import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
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
}

Widget _testApp({
  int initialIndex = 0,
  TextScaler textScaler = TextScaler.noScaling,
}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: MainNavigationScreen(
        initialIndex: initialIndex,
        initializePlatformServices: false,
        testPagesBuilder: (mode) => <Widget>[
          Center(child: Text('${mode.name} Home Page')),
          const Center(child: Text('Restaurant Hub Page')),
          const Center(child: Text('Account Page')),
        ],
      ),
    ),
  );
}
