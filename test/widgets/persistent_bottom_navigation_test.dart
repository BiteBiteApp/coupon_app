import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/widgets/persistent_bottom_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('persistent navigation has three destinations and no Admin', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp());

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Restaurant\nHub'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('Admin'), findsNothing);
  });

  testWidgets('Account uses index 2 and preserves BiteScore mode', (
    tester,
  ) async {
    AppMode? capturedMode;
    int? capturedIndex;

    await tester.pumpWidget(
      _testApp(
        mode: AppMode.biteScore,
        destinationBuilder: (mode, index) {
          capturedMode = mode;
          capturedIndex = index;
          return const Scaffold(body: Text('Account destination'));
        },
      ),
    );

    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();

    expect(capturedMode, AppMode.biteScore);
    expect(capturedIndex, 2);
    expect(find.text('Account destination'), findsOneWidget);
  });

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
}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: Scaffold(
        body: const SizedBox.expand(),
        bottomNavigationBar: PersistentBottomNavigation(
          mode: mode,
          destinationBuilder: destinationBuilder,
        ),
      ),
    ),
  );
}
