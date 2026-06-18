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

  test('new badge and level-up messages use the real display name', () {
    expect(
      _celebration(displayName: 'Pizza').message,
      'You just earned the Pizza Expert Badge!',
    );
    expect(
      _celebration(
        displayName: 'Subs / Sandwiches',
        level: LocalExpertBadgeLevel.level2,
        kind: LocalExpertBadgeCelebrationKind.levelUp,
      ).message,
      'Your Subs / Sandwiches Expert Badge reached Level 2!',
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

  test('badge celebration uses longer display timing and sparkle sound', () {
    expect(
      LocalExpertBadgeCelebrationService.displayDuration,
      const Duration(milliseconds: 5200),
    );
    expect(
      LocalExpertBadgeCelebrationService.soundAsset,
      'sounds/badge_sparkle.wav',
    );
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
            celebration: _celebration(displayName: 'Pizza'),
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

    expect(
      find.text('You just earned the Burger Expert Badge!'),
      findsOneWidget,
    );
    expect(find.text('You just earned the Pizza Expert Badge!'), findsNothing);

    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(await firstFuture, isTrue);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(find.text('You just earned the Burger Expert Badge!'), findsNothing);
    expect(
      find.text('You just earned the Pizza Expert Badge!'),
      findsOneWidget,
    );

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

    expect(
      find.text('You just earned the Burger Expert Badge!'),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();

    expect(await showFuture, ['burger_l1']);
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
