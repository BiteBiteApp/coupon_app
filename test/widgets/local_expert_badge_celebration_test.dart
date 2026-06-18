import 'package:coupon_app/models/local_expert.dart';
import 'package:coupon_app/models/local_expert_badge_celebration.dart';
import 'package:coupon_app/services/local_expert_badge_celebration_service.dart';
import 'package:coupon_app/services/local_expert_badge_recalculation_service.dart';
import 'package:coupon_app/widgets/local_expert_badge_celebration_host.dart';
import 'package:coupon_app/widgets/local_expert_badge_celebration_overlay.dart';
import 'package:coupon_app/widgets/local_expert_badge_widget.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(LocalExpertBadgeCelebrationService.resetForTesting);

  test('badge celebration messages always include the reached level', () {
    expect(_celebration(displayName: 'Pizza').messageLines, [
      'You just earned',
      'Pizza Badge Level 1',
    ]);
    expect(
      _celebration(
        displayName: 'Subs / Sandwiches',
        level: LocalExpertBadgeLevel.level2,
        kind: LocalExpertBadgeCelebrationKind.levelUp,
      ).message,
      'Your Subs / Sandwiches Expert Badge reached Level 2!',
    );
    expect(
      _celebration(
        displayName: 'Chicken Pie / Chicken Pot Pie',
        level: LocalExpertBadgeLevel.level3,
        kind: LocalExpertBadgeCelebrationKind.levelUp,
      ).message,
      'Your Chicken Pie / Chicken Pot Pie Expert Badge reached Level 3!',
    );
  });

  test(
    'recalculation results only create celebrations from explicit events',
    () {
      final existing = LocalExpertBadgeRecalculationResult.fromData({
        'earnedBadgeCount': 2,
        'removedBadgeCount': 0,
      });
      final awarded = LocalExpertBadgeRecalculationResult.fromData({
        'earnedBadgeCount': 3,
        'removedBadgeCount': 0,
        'celebrations': [_celebration(displayName: 'Burger').toFirestoreMap()],
      });

      expect(existing.celebrations, isEmpty);
      expect(awarded.celebrations, hasLength(1));
      expect(awarded.celebrations.single.displayName, 'Burger');
    },
  );

  test('foreground helper only treats resumed as foreground', () {
    expect(localExpertCelebrationIsForeground(AppLifecycleState.resumed), true);
    expect(localExpertCelebrationIsForeground(AppLifecycleState.paused), false);
    expect(
      localExpertCelebrationIsForeground(AppLifecycleState.inactive),
      false,
    );
    expect(
      localExpertCelebrationIsForeground(AppLifecycleState.detached),
      false,
    );
  });

  test('badge celebration uses level-aware timing and sparkle sound', () {
    expect(
      LocalExpertBadgeCelebrationService.displayDuration,
      const Duration(milliseconds: 5200),
    );
    expect(
      LocalExpertBadgeCelebrationService.displayDurationForLevel(
        LocalExpertBadgeLevel.level1,
      ),
      const Duration(milliseconds: 5200),
    );
    expect(
      LocalExpertBadgeCelebrationService.displayDurationForLevel(
        LocalExpertBadgeLevel.level2,
      ),
      const Duration(milliseconds: 5600),
    );
    expect(
      LocalExpertBadgeCelebrationService.displayDurationForLevel(
        LocalExpertBadgeLevel.level3,
      ),
      const Duration(milliseconds: 6000),
    );
    expect(
      LocalExpertBadgeCelebrationService.soundAsset,
      'sounds/badge_sparkle.wav',
    );
  });

  test('level celebration styles become richer without changing level 1', () {
    final level1 = LocalExpertBadgeCelebrationLevelStyle.forLevel(
      LocalExpertBadgeLevel.level1,
    );
    final level2 = LocalExpertBadgeCelebrationLevelStyle.forLevel(
      LocalExpertBadgeLevel.level2,
    );
    final level3 = LocalExpertBadgeCelebrationLevelStyle.forLevel(
      LocalExpertBadgeLevel.level3,
    );

    expect(level1.fireworkBurstCount, 5);
    expect(level1.particlesPerBurst, 14);
    expect(level1.hasLandingPulse, isFalse);
    expect(level1.hasBadgeSpin, isFalse);
    expect(level1.hasBadgeFlare, isFalse);
    expect(level1.hasCornerSparklers, isFalse);
    expect(level2.fireworkBurstCount, greaterThan(level1.fireworkBurstCount));
    expect(level2.particlesPerBurst, level1.particlesPerBurst);
    expect(level2.hasLandingPulse, isTrue);
    expect(level2.hasBadgeSpin, isFalse);
    expect(level2.hasCornerSparklers, isFalse);
    expect(level3.fireworkDurationScale, 2);
    expect(level3.particlesPerBurst, greaterThanOrEqualTo(42));
    expect(level3.particlesPerBurst, greaterThan(level2.particlesPerBurst * 3));
    expect(level3.hasBadgeSpin, isTrue);
    expect(level3.hasBadgeFlare, isTrue);
    expect(level3.hasCornerSparklers, isTrue);
  });

  test('level 1 uses the existing simple visual style', () {
    final level1 = LocalExpertBadgeCelebrationLevelStyle.forLevel(
      LocalExpertBadgeLevel.level1,
    );

    expect(level1.fireworkBurstCount, 5);
    expect(level1.particlesPerBurst, 14);
    expect(level1.sparkleDotsPerBurst, 7);
    expect(level1.fireworkDurationScale, 1);
    expect(level1.hasLandingPulse, isFalse);
    expect(level1.hasBadgeSpin, isFalse);
    expect(level1.hasBadgeFlare, isFalse);
    expect(level1.hasCornerSparklers, isFalse);
  });

  testWidgets('overlay uses real badge artwork and level-up text', (
    tester,
  ) async {
    var landed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: LocalExpertBadgeCelebrationOverlay(
          celebration: _celebration(
            displayName: 'Pizza',
            kind: LocalExpertBadgeCelebrationKind.levelUp,
            level: LocalExpertBadgeLevel.level2,
          ),
          displayDuration: const Duration(milliseconds: 1200),
          onDismiss: () {},
          onLanded: () => landed = true,
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 620));

    expect(find.text('Congratulations!'), findsOneWidget);
    expect(
      find.text('Your Pizza Expert Badge reached Level 2!'),
      findsOneWidget,
    );
    expect(find.byType(LocalExpertBadgeWidget), findsOneWidget);
    expect(landed, isTrue);
  });

  testWidgets('badge celebration enters from above the screen', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LocalExpertBadgeCelebrationOverlay(
          celebration: _celebration(displayName: 'Pizza'),
          displayDuration: LocalExpertBadgeCelebrationService.displayDuration,
          onDismiss: () {},
        ),
      ),
    );

    final badgeTop = tester.getTopLeft(find.byType(LocalExpertBadgeWidget)).dy;

    expect(badgeTop, lessThan(0));
  });

  testWidgets('badge celebration respects reduced motion for fireworks', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: LocalExpertBadgeCelebrationOverlay(
            celebration: _celebration(
              displayName: 'Pizza',
              level: LocalExpertBadgeLevel.level3,
              kind: LocalExpertBadgeCelebrationKind.levelUp,
            ),
            displayDuration: const Duration(milliseconds: 1200),
            onDismiss: () {},
          ),
        ),
      ),
    );

    final fireworks = tester.widget<LocalExpertBadgeFireworks>(
      find.byType(LocalExpertBadgeFireworks),
    );
    expect(fireworks.reducedMotion, isTrue);
    expect(fireworks.levelStyle.hasBadgeSpin, isTrue);
    expect(fireworks.levelStyle.hasCornerSparklers, isTrue);
  });

  testWidgets('level 1 overlay uses the requested stacked wording', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LocalExpertBadgeCelebrationOverlay(
          celebration: _celebration(
            displayName: 'Chicken Pie / Chicken Pot Pie',
          ),
          displayDuration: const Duration(milliseconds: 1200),
          onDismiss: () {},
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('Congratulations!'), findsOneWidget);
    expect(find.text('You just earned'), findsOneWidget);
    expect(
      find.text('Chicken Pie / Chicken Pot Pie Badge Level 1'),
      findsOneWidget,
    );
    expect(find.textContaining('Expert Badge — Level 1'), findsNothing);
  });

  testWidgets('level 3 spins the badge artwork but not the card', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LocalExpertBadgeCelebrationOverlay(
          celebration: _celebration(
            displayName: 'Pizza',
            level: LocalExpertBadgeLevel.level3,
            kind: LocalExpertBadgeCelebrationKind.levelUp,
          ),
          displayDuration: const Duration(milliseconds: 2400),
          onDismiss: () {},
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 450));

    final cardFinder = find.byKey(
      const ValueKey('local-expert-celebration-card'),
    );
    final badgeSpin = tester.widget<Transform>(
      find.byKey(const ValueKey('local-expert-celebration-badge-spin')),
    );

    expect(cardFinder, findsOneWidget);
    expect(_hasRotation(badgeSpin.transform), isTrue);
  });

  testWidgets('reduced motion disables the level 3 badge spin transform', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: LocalExpertBadgeCelebrationOverlay(
            celebration: _celebration(
              displayName: 'Pizza',
              level: LocalExpertBadgeLevel.level3,
              kind: LocalExpertBadgeCelebrationKind.levelUp,
            ),
            displayDuration: const Duration(milliseconds: 2400),
            onDismiss: () {},
          ),
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 450));

    final badgeSpin = tester.widget<Transform>(
      find.byKey(const ValueKey('local-expert-celebration-badge-spin')),
    );
    expect(_hasRotation(badgeSpin.transform), isFalse);
  });

  testWidgets('multiple celebrations queue instead of stacking', (
    tester,
  ) async {
    late BuildContext hostContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            hostContext = context;
            return const Scaffold(body: Text('Home'));
          },
        ),
      ),
    );

    final firstFuture = LocalExpertBadgeCelebrationService.show(
      hostContext,
      celebration: _celebration(displayName: 'Burger', eventKey: 'burger_l1'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    final secondFuture = LocalExpertBadgeCelebrationService.show(
      hostContext,
      celebration: _celebration(displayName: 'Pizza', eventKey: 'pizza_l1'),
    );
    await tester.pump();

    expect(find.text('Burger Badge Level 1'), findsOneWidget);
    expect(find.text('Pizza Badge Level 1'), findsNothing);

    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(await firstFuture, isTrue);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('Burger Badge Level 1'), findsNothing);
    expect(find.text('Pizza Badge Level 1'), findsOneWidget);

    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(await secondFuture, isTrue);
  });

  testWidgets('duplicate celebration event keys are shown once', (
    tester,
  ) async {
    late BuildContext hostContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            hostContext = context;
            return const Scaffold(body: Text('Home'));
          },
        ),
      ),
    );

    final showFuture = LocalExpertBadgeCelebrationService.showAll(
      hostContext,
      celebrations: [
        _celebration(displayName: 'Burger', eventKey: 'burger_l1'),
        _celebration(displayName: 'Burger', eventKey: 'burger_l1'),
      ],
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('Burger Badge Level 1'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();

    expect(await showFuture, ['burger_l1']);
  });

  testWidgets('same badge can queue separate celebrations for each level', (
    tester,
  ) async {
    late BuildContext hostContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            hostContext = context;
            return const Scaffold(body: Text('Home'));
          },
        ),
      ),
    );

    final showFuture = LocalExpertBadgeCelebrationService.showAll(
      hostContext,
      celebrations: [
        _celebration(displayName: 'BBQ', eventKey: 'user_bbq_level1'),
        _celebration(
          displayName: 'BBQ',
          eventKey: 'user_bbq_level2',
          level: LocalExpertBadgeLevel.level2,
          kind: LocalExpertBadgeCelebrationKind.levelUp,
        ),
        _celebration(
          displayName: 'BBQ',
          eventKey: 'user_bbq_level3',
          level: LocalExpertBadgeLevel.level3,
          kind: LocalExpertBadgeCelebrationKind.levelUp,
        ),
      ],
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('BBQ Badge Level 1'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('Your BBQ Expert Badge reached Level 2!'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('Your BBQ Expert Badge reached Level 3!'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();

    expect(await showFuture, [
      'user_bbq_level1',
      'user_bbq_level2',
      'user_bbq_level3',
    ]);
  });

  testWidgets('host loads and marks pending celebrations while foregrounded', (
    tester,
  ) async {
    final marked = <String>[];
    var loadCount = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: LocalExpertBadgeCelebrationHost(
          currentUserIdProvider: () => 'user-1',
          loadPendingCelebrations: (userId) async {
            loadCount += 1;
            return [_celebration(displayName: 'Burger', eventKey: 'burger_l1')];
          },
          showCelebrations: (context, {required celebrations}) async {
            return celebrations.map((event) => event.eventKey).toList();
          },
          markCelebrated: ({required userId, required eventKeys}) async {
            marked.addAll(eventKeys);
          },
          child: const Scaffold(body: Text('Home')),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(loadCount, 1);
    expect(marked, ['burger_l1']);
  });
}

bool _hasRotation(Matrix4 matrix) {
  final values = matrix.storage;
  return values[1].abs() > 0.0001 || values[4].abs() > 0.0001;
}

LocalExpertBadgeCelebration _celebration({
  String eventKey = 'pizza_level1',
  String expertTypeId = 'pizza',
  String displayName = 'Pizza',
  LocalExpertBadgeLevel level = LocalExpertBadgeLevel.level1,
  LocalExpertBadgeCelebrationKind kind = LocalExpertBadgeCelebrationKind.earned,
}) {
  return LocalExpertBadgeCelebration(
    eventKey: eventKey,
    expertTypeId: expertTypeId,
    displayName: displayName,
    level: level,
    kind: kind,
  );
}
