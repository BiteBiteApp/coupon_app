import 'package:coupon_app/models/local_expert_badge.dart';
import 'package:coupon_app/models/local_expert_badge_calculator.dart';
import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/screens/expert_badge_gallery_screen.dart';
import 'package:coupon_app/widgets/local_expert_badge_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LocalExpertBadgeVisuals', () {
    test('level 1 uses grayscale single-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'burger',
        level: LocalExpertBadgeLevel.level1,
      );

      expect(metadata.isPlain, isTrue);
      expect(metadata.isSilverMedal, isFalse);
      expect(metadata.isGoldPremium, isFalse);
      expect(metadata.ringCount, 1);
      expect(metadata.ringColor, const Color(0xFFA8AFB7));
      expect(metadata.fillColor, const Color(0xFFF8FAFC));
      expect(metadata.edgeColor, const Color(0xFF7E8791));
      expect(metadata.innerRimWidth, 0);
      expect(metadata.outerRingWidth, lessThan(2));
      expect(metadata.iconColor, const Color(0xFF15191F));
      expect(metadata.levelTextColor, const Color(0xFF3D4651));
      expect(metadata.borderWidth, 1.35);
      expect(metadata.shadowBlur, 0);
      expect(metadata.haloAlpha, 0);
      expect(metadata.hasGlint, isFalse);
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.lunch_dining);
    });

    test('level 2 uses silver double-ring metadata', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'pizza',
        level: LocalExpertBadgeLevel.level2,
      );

      expect(metadata.isSilverMedal, isTrue);
      expect(metadata.ringCount, 2);
      expect(metadata.ringColor, const Color(0xFFC8D0D8));
      expect(metadata.edgeColor, const Color(0xFF707A86));
      expect(metadata.innerRimColor, const Color(0xFF8E98A4));
      expect(metadata.outerRingWidth, greaterThan(4));
      expect(metadata.innerRimWidth, greaterThan(0));
      expect(metadata.iconColor, const Color(0xFF15191F));
      expect(metadata.levelTextColor, const Color(0xFF3F4A56));
      expect(metadata.borderWidth, greaterThanOrEqualTo(1.35));
      expect(metadata.shadowBlur, greaterThan(0));
      expect(metadata.haloAlpha, 0);
      expect(metadata.hasGlint, isTrue);
      expect(metadata.usesCrown, isFalse);
      expect(metadata.icon, Icons.local_pizza);
    });

    test('level 3 uses gold triple-ring metadata with no crown', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'steak',
        level: LocalExpertBadgeLevel.level3,
      );

      expect(metadata.isGoldPremium, isTrue);
      expect(metadata.ringCount, 3);
      expect(metadata.ringColor, const Color(0xFFE6B43A));
      expect(metadata.edgeColor, const Color(0xFF9B6500));
      expect(metadata.innerRimColor, const Color(0xFFB37A05));
      expect(metadata.outerRingWidth, greaterThan(4));
      expect(metadata.innerRimWidth, greaterThan(0));
      expect(metadata.iconColor, const Color(0xFF15191F));
      expect(metadata.levelTextColor, const Color(0xFF684300));
      expect(metadata.borderWidth, greaterThan(1.35));
      expect(metadata.shadowBlur, greaterThan(7));
      expect(metadata.haloAlpha, greaterThan(0));
      expect(metadata.hasGlint, isTrue);
      expect(metadata.usesCrown, isFalse);
      expect(metadata.abbreviation, 'ST');
    });

    test('level materials progress while food icon stays high contrast', () {
      final level1 = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'burger',
        level: LocalExpertBadgeLevel.level1,
      );
      final level2 = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'pizza',
        level: LocalExpertBadgeLevel.level2,
      );
      final level3 = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: 'mexican',
        level: LocalExpertBadgeLevel.level3,
      );

      expect(level2.edgeColor, isNot(level1.edgeColor));
      expect(level3.edgeColor, isNot(level2.edgeColor));
      expect(level2.outerRingWidth, greaterThan(level1.outerRingWidth));
      expect(level3.haloAlpha, greaterThan(level2.haloAlpha));
      expect(level2.shadowBlur, greaterThan(level1.shadowBlur));
      expect(level3.shadowBlur, greaterThan(level2.shadowBlur));
      expect(level2.hasGlint, isTrue);
      expect(level3.hasGlint, isTrue);
      expect(level1.iconColor, level2.iconColor);
      expect(level2.iconColor, level3.iconColor);
      expect(level2.iconColor, isNot(level2.ringColor));
      expect(level3.iconColor, isNot(level3.ringColor));
      expect(level2.iconColor, isNot(level2.fillColor));
      expect(level3.iconColor, isNot(level3.fillColor));
      expect(
        _contrastRatio(level1.iconColor, level1.fillColor),
        greaterThan(12),
      );
      expect(
        _contrastRatio(level2.iconColor, level2.fillColor),
        greaterThan(12),
      );
      expect(
        _contrastRatio(level3.iconColor, level3.fillColor),
        greaterThan(12),
      );
      expect(
        _contrastRatio(level1.levelTextColor, level1.fillColor),
        greaterThan(7),
      );
      expect(
        _contrastRatio(level2.levelTextColor, level2.fillColor),
        greaterThan(7),
      );
      expect(
        _contrastRatio(level3.levelTextColor, level3.fillColor),
        greaterThan(7),
      );
    });

    test('burger pizza and mexican all use shared level styling rules', () {
      for (final expertTypeId in <String>['burger', 'pizza', 'mexican']) {
        final level1 = LocalExpertBadgeVisuals.metadataFor(
          expertTypeId: expertTypeId,
          level: LocalExpertBadgeLevel.level1,
        );
        final level2 = LocalExpertBadgeVisuals.metadataFor(
          expertTypeId: expertTypeId,
          level: LocalExpertBadgeLevel.level2,
        );
        final level3 = LocalExpertBadgeVisuals.metadataFor(
          expertTypeId: expertTypeId,
          level: LocalExpertBadgeLevel.level3,
        );

        expect(level1.isPlain, isTrue);
        expect(level2.isSilverMedal, isTrue);
        expect(level3.isGoldPremium, isTrue);
        expect(level1.iconColor, level2.iconColor);
        expect(level2.iconColor, level3.iconColor);
        expect(level2.outerRingWidth, greaterThan(level1.outerRingWidth));
        expect(level3.haloAlpha, greaterThan(level2.haloAlpha));
      }
    });

    testWidgets('full badge level text uses readable metadata color', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                LocalExpertBadgeWidget(badge: _badge()),
                LocalExpertBadgeWidget(
                  badge: _badge(
                    expertTypeId: 'pizza',
                    displayName: 'Pizza',
                    level: LocalExpertBadgeLevel.level2,
                  ),
                ),
                LocalExpertBadgeWidget(
                  badge: _badge(
                    expertTypeId: 'steak',
                    displayName: 'Steak',
                    level: LocalExpertBadgeLevel.level3,
                  ),
                ),
              ],
            ),
          ),
        ),
      );

      expect(_textColor(tester, 'Level 1'), const Color(0xFF3D4651));
      expect(_textColor(tester, 'Level 2'), const Color(0xFF3F4A56));
      expect(_textColor(tester, 'Level 3'), const Color(0xFF684300));
    });

    test('central icon mapping falls back safely', () {
      expect(LocalExpertBadgeVisuals.iconForName('set_meal'), Icons.set_meal);
      expect(
        LocalExpertBadgeVisuals.iconForName('not_a_known_icon'),
        Icons.restaurant_menu,
      );
    });

    test('Wings and Donuts use custom inner artwork only', () {
      final wings = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: LocalExperts.wings.id,
        level: LocalExpertBadgeLevel.level1,
      );
      final donuts = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: LocalExperts.donuts.id,
        level: LocalExpertBadgeLevel.level1,
      );
      final bbq = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: LocalExperts.bbq.id,
        level: LocalExpertBadgeLevel.level1,
      );

      expect(wings.customArtwork, 'chicken_wing');
      expect(wings.icon, isNot(Icons.sports_bar));
      expect(donuts.customArtwork, 'donut_ring');
      expect(donuts.icon, isNot(Icons.bakery_dining));
      expect(bbq.customArtwork, isNull);
      expect(bbq.icon, Icons.outdoor_grill);
    });

    testWidgets('Wings and Donuts render custom painted symbols', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Row(
              children: [
                LocalExpertBadgeWidget(
                  badge: _badge(
                    expertTypeId: LocalExperts.wings.id,
                    displayName: LocalExperts.wings.displayName,
                  ),
                ),
                LocalExpertBadgeWidget(
                  badge: _badge(
                    expertTypeId: LocalExperts.donuts.id,
                    displayName: LocalExperts.donuts.displayName,
                  ),
                ),
              ],
            ),
          ),
        ),
      );

      expect(
        find.byKey(const ValueKey('local-expert-badge-artwork-chicken_wing')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('local-expert-badge-artwork-donut_ring')),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.sports_bar), findsNothing);
      expect(find.byIcon(Icons.bakery_dining), findsNothing);
    });

    test('Subs badge uses the unique SUB abbreviation', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: LocalExperts.subsSandwiches.id,
        level: LocalExpertBadgeLevel.level1,
      );

      expect(metadata.abbreviation, 'SUB');
      expect(metadata.icon, Icons.restaurant_menu);
    });

    test('Chili badge uses the unique CI abbreviation', () {
      final metadata = LocalExpertBadgeVisuals.metadataFor(
        expertTypeId: LocalExperts.chili.id,
        level: LocalExpertBadgeLevel.level1,
      );

      expect(metadata.abbreviation, 'CI');
      expect(metadata.icon, Icons.restaurant_menu);
    });

    test('final badge list uses icons or unique abbreviations', () {
      final abbreviations = <String>{};

      for (final type in LocalExperts.all) {
        final metadata = LocalExpertBadgeVisuals.metadataFor(
          expertTypeId: type.id,
          level: LocalExpertBadgeLevel.level1,
        );
        final abbreviation = metadata.abbreviation;
        if (abbreviation != null) {
          expect(abbreviation.trim(), isNotEmpty);
          expect(abbreviations.add(abbreviation), isTrue);
        } else if (metadata.customArtwork != null) {
          expect(metadata.customArtwork!.trim(), isNotEmpty);
        } else {
          expect(metadata.icon, isNot(Icons.restaurant));
          expect(metadata.icon, isNot(Icons.restaurant_menu));
        }
      }
      expect(
        LocalExperts.all.map((type) => type.id),
        isNot(containsAll(['burrito', 'tacos', 'lobster', 'pasta'])),
      );
    });

    testWidgets('temporary gallery includes Subs badge', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: ExpertBadgeGalleryScreen())),
      );

      await tester.drag(
        find.byKey(const ValueKey('expert-badge-gallery-grid')),
        const Offset(0, -1600),
      );
      await tester.pumpAndSettle();

      expect(find.text('Subs / Sandwiches'), findsOneWidget);
      expect(find.text('subs_sandwiches'), findsOneWidget);
      expect(find.text('Chili'), findsOneWidget);
      expect(find.text('chili'), findsOneWidget);
    });

    test('gallery preview controls are admin or debug gated', () {
      expect(
        expertBadgeGalleryPreviewControlsVisible(
          isAdmin: false,
          isDebug: false,
        ),
        isFalse,
      );
      expect(
        expertBadgeGalleryPreviewControlsVisible(isAdmin: true, isDebug: false),
        isTrue,
      );
      expect(
        expertBadgeGalleryPreviewControlsVisible(isAdmin: false, isDebug: true),
        isTrue,
      );
    });

    testWidgets('gallery preview controls are hidden unless enabled', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: ExpertBadgeGalleryScreen())),
      );

      expect(
        find.byKey(const ValueKey('preview-local-expert-celebration-button')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('preview-point-celebration-button')),
        findsNothing,
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ExpertBadgeGalleryScreen(showPreviewControls: true),
          ),
        ),
      );

      expect(
        find.byKey(const ValueKey('preview-local-expert-celebration-button')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('preview-point-celebration-button')),
        findsOneWidget,
      );
    });

    testWidgets('gallery preview buttons use local callbacks only', (
      tester,
    ) async {
      LocalExpertType? previewedBadge;
      var previewedPoints = 0;
      var simulatedFirestoreWrites = 0;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExpertBadgeGalleryScreen(
              showPreviewControls: true,
              onPreviewBadge: (context, type) async {
                previewedBadge = type;
              },
              onPreviewPoint: (context) async {
                previewedPoints += 1;
              },
            ),
          ),
        ),
      );

      await tester.tap(
        find.byKey(const ValueKey('preview-local-expert-celebration-button')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('preview-point-celebration-button')),
      );
      await tester.pump();

      expect(previewedBadge?.id, 'bbq');
      expect(previewedPoints, 1);
      expect(simulatedFirestoreWrites, 0);
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
        expect(find.byType(LinearProgressIndicator), findsOneWidget);
        expect(find.textContaining('4 of 5 restaurants'), findsNothing);
        expect(find.textContaining('4 of 10 restaurants'), findsNothing);
        expect(find.textContaining('Overall restaurants:'), findsNothing);
        expect(find.textContaining('Local cluster:'), findsNothing);
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
          expertTypeId: 'mexican',
          displayName: 'Mexican',
          totalRestaurantCount: 6,
          localClusterCount: 5,
          method: LocalExpertQualificationMethod.both,
        ),
        reviewerUserId: 'other-user',
        reviewerDisplayName: 'Alex',
      );

      expect(find.text('Mexican Expert'), findsOneWidget);
      expect(find.text('View Mexican Reviews'), findsOneWidget);
      expect(find.text('6 qualifying restaurants'), findsOneWidget);
      expect(find.text('Progress toward Level 2'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.text('Badge levels'), findsNothing);
    });

    testWidgets('another user receives the same cleaned-up detail layout', (
      tester,
    ) async {
      await _openBadgeSheet(
        tester,
        _badge(
          expertTypeId: 'pizza',
          displayName: 'Pizza',
          totalRestaurantCount: 7,
          localClusterCount: 3,
          method: LocalExpertQualificationMethod.overall,
        ),
        reviewerUserId: 'different-reviewer',
        reviewerDisplayName: 'Taylor',
      );

      expect(find.text('Pizza Expert'), findsOneWidget);
      expect(find.text('Level 1'), findsOneWidget);
      expect(find.text('View Pizza Reviews'), findsOneWidget);
      expect(find.text('7 qualifying restaurants'), findsOneWidget);
      expect(
        find.text('Earned through overall qualifying restaurant count.'),
        findsOneWidget,
      );
      expect(find.text('Progress toward Level 2'), findsOneWidget);
      expect(find.textContaining('7 of 10 restaurants'), findsNothing);
      expect(find.text('Badge levels'), findsNothing);
      expect(find.textContaining('Level 1: Earned'), findsNothing);
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

    testWidgets('food icon is enlarged and numeric level bubble is absent', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: LocalExpertBadgeWidget(
              badge: _badge(
                level: LocalExpertBadgeLevel.level2,
                totalRestaurantCount: 10,
                localClusterCount: 5,
              ),
            ),
          ),
        ),
      );

      expect(
        find.byKey(const ValueKey('local-expert-level-marker-2')),
        findsNothing,
      );
      final icon = tester.widget<Icon>(find.byIcon(Icons.lunch_dining));
      expect(icon.size, greaterThanOrEqualTo(30));
      expect(icon.color, const Color(0xFF15191F));
      expect(
        find.byKey(const ValueKey('local-expert-badge-glint')),
        findsOneWidget,
      );
      expect(find.text('Level 2'), findsOneWidget);
    });

    testWidgets('badge footprint stays stable across levels', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Row(
              children: [
                LocalExpertBadgeWidget(badge: _badge()),
                LocalExpertBadgeWidget(
                  badge: _badge(level: LocalExpertBadgeLevel.level2),
                ),
                LocalExpertBadgeWidget(
                  badge: _badge(level: LocalExpertBadgeLevel.level3),
                ),
              ],
            ),
          ),
        ),
      );

      final sizes = tester
          .widgetList<SizedBox>(
            find.descendant(
              of: find.byType(LocalExpertBadgeWidget),
              matching: find.byType(SizedBox),
            ),
          )
          .where((box) => box.width == 42 && box.height == 42)
          .toList();
      expect(sizes, hasLength(3));
      expect(tester.takeException(), isNull);
    });
  });
}

Color? _textColor(WidgetTester tester, String text) {
  return tester.widget<Text>(find.text(text).first).style?.color;
}

double _contrastRatio(Color foreground, Color background) {
  final foregroundLuminance = foreground.computeLuminance();
  final backgroundLuminance = background.computeLuminance();
  final lighter = foregroundLuminance > backgroundLuminance
      ? foregroundLuminance
      : backgroundLuminance;
  final darker = foregroundLuminance > backgroundLuminance
      ? backgroundLuminance
      : foregroundLuminance;
  return (lighter + 0.05) / (darker + 0.05);
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
