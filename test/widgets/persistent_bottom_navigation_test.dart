import 'dart:async';

import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/widgets/persistent_bottom_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() {
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  tearDown(() {
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  testWidgets('persistent navigation has three destinations and no Admin', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp());

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Restaurant\nHub'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('Admin'), findsNothing);
  });

  testWidgets(
    'cold-start Account fallback preserves BiteScore mode and index',
    (tester) async {
      AppMode? capturedMode;
      int? capturedIndex;
      var fallbackBuilds = 0;
      final navigationController = MainNavigationController();

      await tester.pumpWidget(
        _testApp(
          mode: AppMode.biteScore,
          navigationController: navigationController,
          destinationBuilder: (mode, index) {
            fallbackBuilds += 1;
            capturedMode = mode;
            capturedIndex = index;
            return MainNavigationScreen(
              initialMode: mode,
              initialIndex: index,
              navigationController: navigationController,
              initializePlatformServices: false,
              testPagesBuilder: (mode) => <Widget>[
                Text('fallback ${mode.name} Home'),
                const Text('fallback Restaurant Hub'),
                const Text('fallback Account'),
              ],
            );
          },
        ),
      );

      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(capturedMode, AppMode.biteScore);
      expect(capturedIndex, 2);
      expect(fallbackBuilds, 1);
      expect(find.text('fallback Account'), findsOneWidget);
      expect(find.text('standalone detail', skipOffstage: false), findsNothing);
      expect(find.byType(MainNavigationScreen), findsOneWidget);

      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      unawaited(
        navigator.push<void>(
          MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              body: const Text('later detail'),
              bottomNavigationBar: PersistentBottomNavigation(
                mode: AppMode.biteScore,
                navigationController: navigationController,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();

      expect(fallbackBuilds, 1);
      expect(find.byType(MainNavigationScreen), findsOneWidget);
      expect(find.text('fallback biteScore Home'), findsOneWidget);
      expect(find.text('later detail', skipOffstage: false), findsNothing);
    },
  );

  testWidgets('narrow scaled layout has no overflow', (tester) async {
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
  AppMode mode = AppMode.biteSaver,
  TextScaler textScaler = TextScaler.noScaling,
  Widget Function(AppMode mode, int index)? destinationBuilder,
  MainNavigationController? navigationController,
}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: Scaffold(
        body: const Center(child: Text('standalone detail')),
        bottomNavigationBar: PersistentBottomNavigation(
          mode: mode,
          destinationBuilder: destinationBuilder,
          navigationController: navigationController,
        ),
      ),
    ),
  );
}
