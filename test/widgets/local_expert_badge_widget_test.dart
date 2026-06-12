import 'package:coupon_app/models/local_expert_badge.dart';
import 'package:coupon_app/models/local_expert_badge_calculator.dart';
import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/widgets/local_expert_badge_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertBadgeVisuals', () {
    test('level 1 uses bronze single-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'burger',
        level: LocalExpertBadgeLevel.level1,
      );

      expect(metadata.ringCount, 1);
      expect(metadata.levelMarker, '1');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.lunch_dining);
    });

    test('level 2 uses silver double-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'pizza',
        level: LocalExpertBadgeLevel.level2,
      );

      expect(metadata.ringCount, 2);
      expect(metadata.levelMarker, '2');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.local_pizza);
    });

    test('level 3 uses gold triple-ring metadata with no crown', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'steak',
        level: LocalExpertBadgeLevel.level3,
      );

      expect(metadata.ringCount, 3);
      expect(metadata.levelMarker, '3');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.restaurant_menu);
    });

    test('central icon mapping falls back safely', () {
      expect(LocalExpertBadgeVisuals.iconForName('set_meal'), Icons.set_meal);
      expect(
        LocalExpertBadgeVisuals.iconForName('not_a_known_icon'),
        Icons.restaurant_menu,
      );
    });

    test(
      'badge review button target uses reviewer id and stable expert id',
      () {
        final request = LocalExpertBadgeReviewNavigationRequest.tryCreate(
          badge: _badge(),
          reviewerUserId: ' reviewer-1 ',
          reviewerDisplayName: ' Sam ',
        );

        expect(request, isNotNull);
        expect(request!.reviewerUserId, 'reviewer-1');
        expect(request.reviewerDisplayName, 'Sam');
        expect(request.expertTypeId, 'burger');
        expect(request.expertDisplayName, 'Burger');
      },
    );

    test('badge review button target is omitted without reviewer id', () {
      expect(
        LocalExpertBadgeReviewNavigationRequest.tryCreate(
          badge: _badge(),
          reviewerUserId: ' ',
          reviewerDisplayName: 'Sam',
        ),
        isNull,
      );
    });

    testWidgets(
      'badge detail sheet shows review button before user stats without level explanations',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) {
                return Scaffold(
                  body: Center(
                    child: ElevatedButton(
                      onPressed: () {
                        showLocalExpertBadgeDetails(
                          context,
                          _badge(totalRestaurantCount: 4, localClusterCount: 4),
                          reviewerUserId: 'reviewer-1',
                          reviewerDisplayName: 'Sam',
                        );
                      },
                      child: const Text('Open badge'),
                    ),
                  ),
                );
              },
            ),
          ),
        );

        await tester.tap(find.text('Open badge'));
        await tester.pumpAndSettle();

        final buttonFinder = find.text('View Burger Reviews');
        final statsFinder = find.text('4 qualifying restaurants');
        expect(find.text('Burger Expert'), findsOneWidget);
        expect(find.text('Level 1'), findsOneWidget);
        expect(buttonFinder, findsOneWidget);
        expect(statsFinder, findsOneWidget);
        expect(
          tester.getTopLeft(buttonFinder).dy,
          lessThan(tester.getTopLeft(statsFinder).dy),
        );
        expect(find.text('Badge levels'), findsNothing);
        expect(find.textContaining('Level 1: Earned'), findsNothing);
        expect(find.textContaining('25 restaurants overall'), findsNothing);
        expect(find.text('Progress toward Level 2'), findsOneWidget);
        expect(find.text('Local cluster: 4 of 5 restaurants'), findsOneWidget);
        expect(
          find.text('Overall restaurants: 4 of 10 restaurants'),
          findsOneWidget,
        );
        expect(
          find.text('Earned through overall qualifying restaurant count.'),
          findsOneWidget,
        );
      },
    );

    testWidgets('Pizza Expert uses the same cleaned-up dynamic layout', (
      tester,
    ) async {
      await _openBadgeSheet(
        tester,
        _badge(
          expertTypeId: 'pizza',
          displayName: 'Pizza',
          level: LocalExpertBadgeLevel.level1,
          totalRestaurantCount: 4,
          localClusterCount: 4,
          method: LocalExpertQualificationMethod.localCluster,
        ),
        reviewerUserId: 'pizza-reviewer',
        reviewerDisplayName: 'Maria',
      );

      expect(find.text('Pizza Expert'), findsOneWidget);
      expect(find.text('Level 1'), findsOneWidget);
      expect(find.text('View Pizza Reviews'), findsOneWidget);
      expect(find.text('4 qualifying restaurants'), findsOneWidget);
      expect(
        find.text('4 restaurants in the best local cluster'),
        findsOneWidget,
      );
      expect(
        find.text('Earned through local 30-mile-area qualification.'),
        findsOneWidget,
      );
      expect(find.text('Badge levels'), findsNothing);
      expect(find.textContaining('Level 2: Earned'), findsNothing);
    });

    testWidgets('another expert category uses the same shared detail sheet', (
      tester,
    ) async {
      await _openBadgeSheet(
        tester,
        _badge(
          expertTypeId: 'tacos',
          displayName: 'Tacos',
          totalRestaurantCount: 6,
          localClusterCount: 5,
          method: LocalExpertQualificationMethod.both,
        ),
        reviewerUserId: 'other-user',
        reviewerDisplayName: 'Alex',
      );

      expect(find.text('Tacos Expert'), findsOneWidget);
      expect(find.text('View Tacos Reviews'), findsOneWidget);
      expect(find.text('6 qualifying restaurants'), findsOneWidget);
      expect(find.text('Progress toward Level 2'), findsOneWidget);
      expect(find.text('Badge levels'), findsNothing);
    });

    testWidgets('highest-level badge shows completed state', (tester) async {
      await _openBadgeSheet(
        tester,
        _badge(
          expertTypeId: 'steak',
          displayName: 'Steak',
          level: LocalExpertBadgeLevel.level3,
          totalRestaurantCount: 25,
          localClusterCount: 5,
        ),
        reviewerUserId: 'reviewer-3',
        reviewerDisplayName: 'Sam',
      );

      expect(find.text('Steak Expert'), findsOneWidget);
      expect(find.text('Level 3'), findsOneWidget);
      expect(find.text('Highest expert level reached'), findsOneWidget);
      expect(find.textContaining('Progress toward Level'), findsNothing);
    });

    testWidgets('multiple shared badge widgets wrap on narrow width', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 220,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  LocalExpertBadgeWidget(badge: _badge()),
                  LocalExpertBadgeWidget(
                    badge: _badge(
                      expertTypeId: 'pizza',
                      displayName: 'Pizza',
                      level: LocalExpertBadgeLevel.level2,
                      totalRestaurantCount: 10,
                      localClusterCount: 5,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );

      expect(find.text('Burger Expert'), findsOneWidget);
      expect(find.text('Pizza Expert'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

Future<void> _openBadgeSheet(
  WidgetTester tester,
  LocalExpertBadge badge, {
  required String reviewerUserId,
  required String reviewerDisplayName,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) {
          return Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () {
                  showLocalExpertBadgeDetails(
                    context,
                    badge,
                    reviewerUserId: reviewerUserId,
                    reviewerDisplayName: reviewerDisplayName,
                  );
                },
                child: const Text('Open badge'),
              ),
            ),
          );
        },
      ),
    ),
  );

  await tester.tap(find.text('Open badge'));
  await tester.pumpAndSettle();
}

LocalExpertBadge _badge({
  String expertTypeId = 'burger',
  String displayName = 'Burger',
  LocalExpertBadgeLevel level = LocalExpertBadgeLevel.level1,
  int totalRestaurantCount = 5,
  int localClusterCount = 3,
  LocalExpertQualificationMethod method =
      LocalExpertQualificationMethod.overall,
}) {
  return LocalExpertBadge(
    expertTypeId: expertTypeId,
    displayName: displayName,
    level: level,
    totalRestaurantCount: totalRestaurantCount,
    localClusterRestaurantCount: localClusterCount,
    qualificationMethod: method,
  );
}
