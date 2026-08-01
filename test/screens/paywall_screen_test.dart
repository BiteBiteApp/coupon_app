import 'dart:async';

import 'package:coupon_app/screens/paywall_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Paywall delegates checkout to one supplied scoped callback', (
    tester,
  ) async {
    final pending = Completer<void>();
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: PaywallScreen(
          startSubscription: () {
            calls += 1;
            return pending.future;
          },
        ),
      ),
    );

    final startButton = find.widgetWithText(FilledButton, 'Start Subscription');
    await tester.ensureVisible(startButton);
    await tester.tap(startButton);
    await tester.pump();

    expect(calls, 1);
    final opening = find.widgetWithText(FilledButton, 'Opening Checkout...');
    expect(opening, findsOneWidget);
    expect(tester.widget<FilledButton>(opening).onPressed, isNull);

    pending.complete();
    await tester.pumpAndSettle();

    expect(
      find.widgetWithText(FilledButton, 'Start Subscription'),
      findsOneWidget,
    );
    expect(calls, 1);
  });

  testWidgets(
    'Paywall shows controlled feedback for current callback failure',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: PaywallScreen(
            startSubscription: () async {
              throw StateError('sensitive-owner-token-canary');
            },
          ),
        ),
      );

      final startButton = find.widgetWithText(
        FilledButton,
        'Start Subscription',
      );
      await tester.ensureVisible(startButton);
      await tester.tap(startButton);
      await tester.pumpAndSettle();

      expect(find.text('Something went wrong'), findsOneWidget);
      expect(find.textContaining('sensitive-owner-token-canary'), findsNothing);
    },
  );
}
