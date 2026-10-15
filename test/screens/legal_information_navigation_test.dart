import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(() => AppModeStateService.setMode(AppMode.biteSaver));

  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    for (final scale in [1.0, 2.0, 3.0]) {
      for (final mode in AppMode.values) {
        for (final menuLabel in ['Privacy Policy', 'Terms of Service']) {
          testWidgets('$menuLabel menu at $platform $scale ${mode.name}', (
            tester,
          ) async {
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = Size(
              platform == TargetPlatform.android ? 320 : 390,
              700,
            );
            addTearDown(tester.view.reset);
            await tester.pumpWidget(
              MaterialApp(
                theme: ThemeData(platform: platform),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: MainNavigationScreen(
                  initialMode: mode,
                  initializePlatformServices: false,
                  testCustomerAuthRealmProvider: () => 'guest',
                  testCustomerAuthRealmChanges: const Stream<String>.empty(),
                  testPagesBuilder: (_) => const [
                    SizedBox(),
                    SizedBox(),
                    SizedBox(),
                  ],
                ),
              ),
            );
            await tester.pumpAndSettle();
            final shell = tester.state(find.byType(MainNavigationScreen));
            await tester.tap(find.byTooltip('Menu'));
            await tester.pumpAndSettle();
            await Scrollable.ensureVisible(
              tester.element(find.text(menuLabel)),
              alignment: .5,
            );
            await tester.pumpAndSettle();
            expect(find.text(menuLabel).hitTestable(), findsOneWidget);
            await tester.tap(find.text(menuLabel));
            await tester.pumpAndSettle();
            expect(find.text('BiteStar $menuLabel'), findsOneWidget);
            expect(
              find.text('Draft for Owner Review — Not Yet Published'),
              findsOneWidget,
            );
            expect(AppModeStateService.selectedMode.value, mode);
            if (platform == TargetPlatform.android) {
              await tester.binding.handlePopRoute();
            } else {
              await tester.tap(find.byTooltip('Back'));
            }
            await tester.pumpAndSettle();
            expect(
              tester.state(find.byType(MainNavigationScreen)),
              same(shell),
            );
            expect(AppModeStateService.selectedMode.value, mode);
            expect(find.byTooltip('Menu'), findsOneWidget);
            expect(find.text('Restaurant\nHub'), findsOneWidget);
            expect(find.text('My Profile'), findsOneWidget);
            expect(tester.takeException(), isNull);
          });
        }
      }
    }
  }
}
