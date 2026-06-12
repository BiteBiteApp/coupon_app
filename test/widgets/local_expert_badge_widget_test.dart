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
      expect(metadata.levelMarker, 'I');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.lunch_dining);
    });

    test('level 2 uses silver double-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'pizza',
        level: LocalExpertBadgeLevel.level2,
      );

      expect(metadata.ringCount, 2);
      expect(metadata.levelMarker, 'II');
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.local_pizza);
    });

    test('level 3 uses gold triple-ring metadata with no crown', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'steak',
        level: LocalExpertBadgeLevel.level3,
      );

      expect(metadata.ringCount, 3);
      expect(metadata.levelMarker, 'III');
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
                          _badge(),
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
        final statsFinder = find.text('5 qualifying restaurants');
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
      },
    );
  });
}

LocalExpertBadge _badge() {
  return const LocalExpertBadge(
    expertTypeId: 'burger',
    displayName: 'Burger',
    level: LocalExpertBadgeLevel.level1,
    totalRestaurantCount: 5,
    localClusterRestaurantCount: 3,
    qualificationMethod: LocalExpertQualificationMethod.overall,
  );
}
