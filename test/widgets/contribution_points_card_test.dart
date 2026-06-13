import 'package:coupon_app/widgets/contribution_points_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Contribution Points card displays zero safely', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ContributionPointsCard(points: 0)),
      ),
    );

    expect(find.text('Contribution Points'), findsOneWidget);
    expect(find.text('0'), findsOneWidget);
  });

  testWidgets('Contribution Points card displays total points', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ContributionPointsCard(points: 42)),
      ),
    );

    expect(find.text('Contribution Points'), findsOneWidget);
    expect(find.text('42'), findsOneWidget);
  });

  testWidgets('decorative styling does not overflow on narrow width', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 260,
            child: ContributionPointsCard(points: 123),
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.text('123'), findsOneWidget);
  });

  testWidgets('card does not imply monetary value or rewards', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: ContributionPointsCard(points: 7)),
      ),
    );

    expect(find.textContaining('cash', findRichText: true), findsNothing);
    expect(find.textContaining('money', findRichText: true), findsNothing);
    expect(find.textContaining('reward', findRichText: true), findsNothing);
    expect(find.textContaining('\$', findRichText: true), findsNothing);
  });
}
