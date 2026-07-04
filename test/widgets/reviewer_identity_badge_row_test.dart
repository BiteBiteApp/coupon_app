import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/models/local_expert_badge.dart';
import 'package:coupon_app/models/local_expert_badge_calculator.dart';
import 'package:coupon_app/widgets/local_expert_badge_widget.dart';
import 'package:coupon_app/widgets/reviewer_identity_badge_row.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ReviewerIdentityBadgeRow', () {
    testWidgets('shows activity pill and separator when expert badges exist', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: _row(
              badges: [_badge('pizza', 'Pizza'), _badge('burger', 'Burger')],
            ),
          ),
        ),
      );

      expect(find.text('Intermediate'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('reviewer-expert-badge-separator')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('reviewer-local-expert-badge-pizza')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('reviewer-local-expert-badge-burger')),
        findsNothing,
      );
      expect(find.text('+1'), findsOneWidget);
    });

    testWidgets('omits separator when no expert badges exist', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: _row(badges: const [])),
        ),
      );

      expect(find.text('Intermediate'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('reviewer-expert-badge-separator')),
        findsNothing,
      );
      expect(find.byType(LocalExpertBadgeWidget), findsNothing);
    });

    testWidgets('visible badge and overflow remain independently tappable', (
      tester,
    ) async {
      final tappedExpertIds = <String>[];
      var overflowTapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: _row(
              badges: [_badge('pizza', 'Pizza'), _badge('burger', 'Burger')],
              onBadgeTap: (badge) => tappedExpertIds.add(badge.expertTypeId),
              onOverflowTap: () => overflowTapped = true,
            ),
          ),
        ),
      );

      await tester.tap(
        find.byKey(const ValueKey('reviewer-local-expert-badge-pizza')),
      );
      await tester.tap(
        find.byKey(const ValueKey('reviewer-local-expert-badge-overflow')),
      );

      expect(tappedExpertIds, ['pizza']);
      expect(overflowTapped, isTrue);
    });

    testWidgets('tapping one expert badge opens correct expert detail', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              return Scaffold(
                body: _row(
                  badges: [
                    _badge(
                      'pizza',
                      'Pizza',
                      level: LocalExpertBadgeLevel.level2,
                    ),
                    _badge('burger', 'Burger'),
                  ],
                  onBadgeTap: (badge) => showLocalExpertBadgeDetails(
                    context,
                    badge,
                    reviewerUserId: 'reviewer-1',
                    reviewerDisplayName: 'FoodDood',
                  ),
                ),
              );
            },
          ),
        ),
      );

      await tester.tap(
        find.byKey(const ValueKey('reviewer-local-expert-badge-pizza')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Pizza Expert'), findsOneWidget);
      expect(find.text('Level 2'), findsOneWidget);
      expect(find.text('Burger Expert'), findsNothing);
    });

    testWidgets('activity pill remains independently tappable', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: _row(badges: [_badge('pizza', 'Pizza')])),
        ),
      );

      await tester.tap(find.byKey(const ValueKey('reviewer-activity-pill')));
      await tester.pumpAndSettle();

      expect(find.text('Reviewer Activity'), findsOneWidget);
      expect(find.text('Pizza Expert'), findsNothing);
    });

    testWidgets('shows one badge with compact overflow count', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 240,
              child: _row(
                reviewerName: 'LongReviewerName',
                badges: [
                  _badge('pizza', 'Pizza'),
                  _badge('burger', 'Burger'),
                  _badge('tacos', 'Tacos'),
                ],
              ),
            ),
          ),
        ),
      );

      expect(find.text('LongReviewerName'), findsOneWidget);
      expect(find.text('Intermediate'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('reviewer-expert-badge-separator')),
        findsOneWidget,
      );
      expect(find.byType(LocalExpertBadgeWidget), findsOneWidget);
      expect(find.text('+2'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('reviewer-local-expert-badge-burger')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('reviewer-local-expert-badge-tacos')),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    });
  });
}

Widget _row({
  String reviewerName = 'FoodDood',
  List<LocalExpertBadge> badges = const <LocalExpertBadge>[],
  int hiddenBadgeCount = 0,
  ValueChanged<LocalExpertBadge>? onBadgeTap,
  VoidCallback? onOverflowTap,
}) {
  return ReviewerIdentityBadgeRow(
    reviewerName: Text(
      reviewerName,
      style: const TextStyle(fontWeight: FontWeight.w900),
    ),
    reviewCount: 3,
    visibleBadges: badges,
    hiddenBadgeCount: hiddenBadgeCount,
    onBadgeTap: onBadgeTap ?? (_) {},
    onOverflowTap: onOverflowTap,
  );
}

LocalExpertBadge _badge(
  String expertTypeId,
  String displayName, {
  LocalExpertBadgeLevel level = LocalExpertBadgeLevel.level1,
}) {
  return LocalExpertBadge(
    expertTypeId: expertTypeId,
    displayName: displayName,
    level: level,
    totalRestaurantCount: 5,
    localClusterRestaurantCount: 3,
    qualificationMethod: LocalExpertQualificationMethod.overall,
  );
}
