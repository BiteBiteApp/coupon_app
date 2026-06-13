import 'package:coupon_app/widgets/reviewer_activity_pill.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ReviewerActivityPresenter', () {
    test('maps public review counts to activity tiers', () {
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(0).label,
        'Beginner',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(2).label,
        'Beginner',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(3).label,
        'Intermediate',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(9).label,
        'Intermediate',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(10).label,
        'Advanced',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(24).label,
        'Advanced',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(25).label,
        '♠ Ace ♠',
      );
      expect(
        ReviewerActivityPresenter.visualsForReviewCount(250).label,
        '♠ Ace ♠',
      );
    });

    test('pill tint changes by tier', () {
      final beginner = ReviewerActivityPresenter.visualsForReviewCount(0);
      final intermediate = ReviewerActivityPresenter.visualsForReviewCount(3);
      final advanced = ReviewerActivityPresenter.visualsForReviewCount(10);
      final ace = ReviewerActivityPresenter.visualsForReviewCount(25);

      expect(beginner.backgroundColor, isNot(intermediate.backgroundColor));
      expect(intermediate.backgroundColor, isNot(advanced.backgroundColor));
      expect(advanced.backgroundColor, isNot(ace.backgroundColor));
    });
  });

  group('ReviewerActivityPill', () {
    testWidgets('all activity tiers are tappable', (tester) async {
      for (final count in <int>[0, 3, 10, 25]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(body: ReviewerActivityPill(reviewCount: count)),
          ),
        );

        await tester.tap(find.byKey(const ValueKey('reviewer-activity-pill')));
        await tester.pumpAndSettle();

        expect(find.text('Reviewer Activity'), findsOneWidget);
        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();
      }
    });

    testWidgets('tapping pill opens general explanation without thresholds', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                Text('Profile page'),
                ReviewerActivityPill(reviewCount: 25),
              ],
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const ValueKey('reviewer-activity-pill')));
      await tester.pumpAndSettle();

      expect(find.text('Profile page'), findsOneWidget);
      expect(find.text('Reviewer Activity'), findsOneWidget);
      expect(find.text('Beginner'), findsOneWidget);
      expect(find.text('Intermediate'), findsOneWidget);
      expect(find.text('Advanced'), findsOneWidget);
      expect(find.text('♠ Ace ♠'), findsWidgets);
      expect(find.text('New to reviewing.'), findsOneWidget);
      expect(
        find.text('Has started contributing regular dish ratings.'),
        findsOneWidget,
      );
      expect(
        find.text('An active reviewer with a stronger review history.'),
        findsOneWidget,
      );
      expect(
        find.text('One of the most active BiteScore reviewers.'),
        findsOneWidget,
      );
      expect(find.textContaining('3 reviews'), findsNothing);
      expect(find.textContaining('25 reviews'), findsNothing);
      expect(find.textContaining('0-2'), findsNothing);
      expect(find.textContaining('10-24'), findsNothing);
    });

    testWidgets('renders compactly beside a long username without overflow', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 180,
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('ReallyLongReviewerUsername'),
                  ReviewerActivityPill(reviewCount: 25),
                ],
              ),
            ),
          ),
        ),
      );

      expect(find.text('♠ Ace ♠'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('uses no flame or sparkle icon', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: ReviewerActivityPill(reviewCount: 10)),
        ),
      );

      expect(find.byIcon(Icons.local_fire_department_outlined), findsNothing);
      expect(find.byIcon(Icons.auto_awesome_outlined), findsNothing);
      expect(find.text('Advanced'), findsOneWidget);
    });
  });
}
