import 'package:coupon_app/models/contribution_point_ledger_entry.dart';
import 'package:coupon_app/services/contribution_points_celebration_service.dart';
import 'package:coupon_app/services/contribution_points_service.dart';
import 'package:coupon_app/widgets/contribution_points_celebration_host.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(
    ContributionPointsCelebrationService.resetShownLedgerEntriesForTesting,
  );

  test('celebration message uses correct singular and plural wording', () {
    expect(
      ContributionPointsCelebrationService.pointMessage(1),
      'You just earned 1 point!',
    );
    expect(
      ContributionPointsCelebrationService.pointMessage(2),
      'You just earned 2 points!',
    );
    expect(
      ContributionPointsCelebrationService.pointMessage(4),
      'You just earned 4 points!',
    );
  });

  test('point celebration stays visible slightly longer', () {
    expect(
      ContributionPointsCelebrationService.displayDuration,
      const Duration(milliseconds: 4100),
    );
  });

  testWidgets('newly awarded points show one dismissible overlay', (
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

    final showFuture = ContributionPointsCelebrationService.show(
      hostContext,
      points: 3,
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 260));

    expect(find.text('Congratulations!'), findsOneWidget);
    expect(find.text('You just earned 3 points!'), findsOneWidget);

    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(await showFuture, isTrue);
    await tester.pumpAndSettle();
    expect(find.text('Congratulations!'), findsNothing);
  });

  testWidgets('award result celebration is nonfatal if marking fails', (
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

    final showFuture = ContributionPointsCelebrationService.showAwardResult(
      hostContext,
      userId: 'user-1',
      award: _awardResult('ledger-1', points: 2),
      markCelebrated: ({required userId, required ledgerEntryIds}) async {
        throw StateError('Injected marker failure');
      },
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 260));

    expect(find.text('Congratulations!'), findsOneWidget);
    expect(find.text('You just earned 2 points!'), findsOneWidget);

    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(await showFuture, isTrue);
    await tester.pumpAndSettle();
  });

  testWidgets('award result celebration does not repeat in one session', (
    tester,
  ) async {
    late BuildContext hostContext;
    var markCalls = 0;
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

    final firstShowFuture =
        ContributionPointsCelebrationService.showAwardResult(
          hostContext,
          userId: 'user-1',
          award: _awardResult('ledger-1'),
          markCelebrated: ({required userId, required ledgerEntryIds}) async {
            markCalls += 1;
            return ContributionPointCelebrationMarkResult(
              attemptedEntryIds: ledgerEntryIds.toSet(),
              markedEntryIds: ledgerEntryIds.toSet(),
            );
          },
        );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 260));
    await tester.tap(find.byTooltip('Close'));
    await tester.pump();
    expect(await firstShowFuture, isTrue);

    final secondShown =
        await ContributionPointsCelebrationService.showAwardResult(
          hostContext,
          userId: 'user-1',
          award: _awardResult('ledger-1'),
          markCelebrated: ({required userId, required ledgerEntryIds}) async {
            markCalls += 1;
            return const ContributionPointCelebrationMarkResult();
          },
        );

    expect(secondShown, isFalse);
    expect(markCalls, 1);
  });

  test(
    'delayed celebration totals ignore reversals and zero-point entries',
    () {
      final total = contributionPointTotalForCelebration([
        _entry(id: 'dish', pointsDelta: 1),
        _entry(id: 'image', pointsDelta: 1),
        _entry(
          id: 'reversal',
          pointsDelta: -1,
          actionType: ContributionPointAction.contributionReversed,
        ),
        _entry(id: 'zero', pointsDelta: 0),
      ]);

      expect(total, 2);
    },
  );

  test('delayed entries can be represented as pending then celebrated', () {
    final pending = _entry(
      id: 'edit',
      actionType: ContributionPointAction.dishEditApproved,
      celebrationStatus: ContributionPointLedgerEntry.celebrationStatusPending,
    );
    final celebrated = _entry(
      id: 'edit',
      actionType: ContributionPointAction.dishEditApproved,
      celebrationStatus:
          ContributionPointLedgerEntry.celebrationStatusCelebrated,
    );

    expect(
      pending.celebrationStatus,
      ContributionPointLedgerEntry.celebrationStatusPending,
    );
    expect(
      celebrated.celebrationStatus,
      ContributionPointLedgerEntry.celebrationStatusCelebrated,
    );
  });

  test('shown ledger entries are filtered for the current app session', () {
    expect(
      ContributionPointsCelebrationService.unshownLedgerEntryIdsThisSession([
        'ledger-1',
        'ledger-2',
      ]),
      ['ledger-1', 'ledger-2'],
    );

    ContributionPointsCelebrationService.rememberLedgerEntriesShownThisSession([
      'ledger-1',
      'ledger-1',
      ' ',
    ]);

    expect(
      ContributionPointsCelebrationService.unshownLedgerEntryIdsThisSession([
        'ledger-1',
        'ledger-2',
      ]),
      ['ledger-2'],
    );
  });
}

ContributionPointAwardResult _awardResult(
  String ledgerEntryId, {
  int points = 1,
}) {
  return ContributionPointAwardResult(
    entries: [
      ContributionPointAwardEntryResult(
        ledgerEntryId: ledgerEntryId,
        points: points,
        wasCreated: true,
      ),
    ],
  );
}

ContributionPointLedgerEntry _entry({
  required String id,
  int pointsDelta = 1,
  String actionType = ContributionPointAction.dishCreated,
  String? celebrationStatus,
}) {
  return ContributionPointLedgerEntry(
    id: id,
    userId: 'user-1',
    pointsDelta: pointsDelta,
    actionType: actionType,
    sourceKey: '$actionType:$id',
    description: 'Award',
    celebrationStatus: celebrationStatus,
  );
}
