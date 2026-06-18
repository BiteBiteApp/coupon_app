import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/contribution_point_ledger_entry.dart';
import '../services/contribution_points_celebration_service.dart';
import '../services/contribution_points_service.dart';

class ContributionPointsCelebrationHost extends StatefulWidget {
  final Widget child;

  const ContributionPointsCelebrationHost({super.key, required this.child});

  @override
  State<ContributionPointsCelebrationHost> createState() =>
      _ContributionPointsCelebrationHostState();
}

class _ContributionPointsCelebrationHostState
    extends State<ContributionPointsCelebrationHost>
    with WidgetsBindingObserver {
  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;
  bool _isChecking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_checkForDelayedCelebrations());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _lifecycleState = state;
    if (state == AppLifecycleState.resumed) {
      unawaited(_checkForDelayedCelebrations());
    }
  }

  Future<void> _checkForDelayedCelebrations() async {
    if (_isChecking || _lifecycleState != AppLifecycleState.resumed) {
      return;
    }

    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      return;
    }

    _isChecking = true;
    final userId = user.uid;
    try {
      await Future<void>.delayed(Duration.zero);
      if (!mounted || _lifecycleState != AppLifecycleState.resumed) {
        return;
      }

      final entries =
          await ContributionPointsService.loadUncelebratedPositiveLedgerEntries(
            userId,
          );
      if (!mounted ||
          _lifecycleState != AppLifecycleState.resumed ||
          entries.isEmpty ||
          FirebaseAuth.instance.currentUser?.uid != userId) {
        return;
      }

      final entriesToShow = entries
          .where(
            (entry) =>
                ContributionPointsCelebrationService.unshownLedgerEntryIdsThisSession(
                  [entry.id],
                ).isNotEmpty,
          )
          .toList(growable: false);
      if (entriesToShow.isEmpty) {
        return;
      }

      final points = entriesToShow.fold<int>(
        0,
        (total, entry) => total + entry.pointsDelta,
      );
      final ledgerIds = entriesToShow
          .map((entry) => entry.id)
          .toList(growable: false);
      final shown = await ContributionPointsCelebrationService.show(
        context,
        points: points,
      );
      if (!shown ||
          !mounted ||
          _lifecycleState != AppLifecycleState.resumed ||
          FirebaseAuth.instance.currentUser?.uid != userId) {
        return;
      }

      ContributionPointsCelebrationService.rememberLedgerEntriesShownThisSession(
        ledgerIds,
      );
      try {
        final result =
            await ContributionPointsService.markCelebratedLedgerEntries(
              userId: userId,
              ledgerEntryIds: ledgerIds,
            );
        if (result.hasProblems) {
          ContributionPointsCelebrationService.logCelebrationMarkResult(
            source: 'contribution_points_celebration_host',
            result: result,
          );
        }
      } catch (error, stackTrace) {
        ContributionPointsCelebrationService.logPostSaveAwardResultFailure(
          source: 'contribution_points_celebration_host',
          ledgerEntryIds: ledgerIds,
          error: error,
          stackTrace: stackTrace,
        );
      }
    } catch (error, stackTrace) {
      debugPrint('Contribution point celebration host failed: $error');
      debugPrintStack(stackTrace: stackTrace);
    } finally {
      _isChecking = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}

@visibleForTesting
int contributionPointTotalForCelebration(
  Iterable<ContributionPointLedgerEntry> entries,
) {
  return entries.fold<int>(
    0,
    (total, entry) => entry.pointsDelta > 0 && !entry.isReversal
        ? total + entry.pointsDelta
        : total,
  );
}
