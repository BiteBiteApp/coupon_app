import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/local_expert.dart';
import '../models/local_expert_badge_celebration.dart';
import '../models/local_expert_badge_calculator.dart';
import '../widgets/local_expert_badge_celebration_overlay.dart';

class LocalExpertBadgeCelebrationService {
  static const Duration displayDuration = Duration(milliseconds: 5200);
  static const String soundAsset = 'sounds/badge_sparkle.wav';
  static const String celebrationSubcollection =
      'local_expert_badge_celebrations';

  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  static final List<LocalExpertBadgeCelebration> _queue =
      <LocalExpertBadgeCelebration>[];
  static final Set<String> _queuedEventKeys = <String>{};
  static Completer<void>? _activeCelebration;
  static bool _soundPlaying = false;

  const LocalExpertBadgeCelebrationService._();

  static Duration displayDurationForLevel(LocalExpertBadgeLevel level) {
    return switch (level) {
      LocalExpertBadgeLevel.level1 => displayDuration,
      LocalExpertBadgeLevel.level2 => const Duration(milliseconds: 5600),
      LocalExpertBadgeLevel.level3 => const Duration(milliseconds: 6000),
    };
  }

  static CollectionReference<Map<String, dynamic>> _collection(String userId) {
    return _firestore
        .collection(LocalExpertBadgePaths.userProfilesCollection)
        .doc(userId.trim())
        .collection(celebrationSubcollection);
  }

  static Future<List<LocalExpertBadgeCelebration>> loadPendingCelebrations(
    String userId,
  ) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return const <LocalExpertBadgeCelebration>[];
    }

    final snapshot = await _collection(trimmedUserId)
        .where('status', isEqualTo: LocalExpertBadgeCelebration.pendingStatus)
        .limit(10)
        .get();
    return snapshot.docs
        .map((doc) => doc.toLocalExpertBadgeCelebration())
        .whereType<LocalExpertBadgeCelebration>()
        .toList(growable: false);
  }

  static Future<List<LocalExpertBadgeCelebration>>
  loadPendingCelebrationsCreatedSince(String userId, DateTime createdAt) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return const <LocalExpertBadgeCelebration>[];
    }

    final snapshot = await _collection(trimmedUserId)
        .where(
          'createdAt',
          isGreaterThanOrEqualTo: Timestamp.fromDate(createdAt),
        )
        .limit(20)
        .get();
    final celebrations = snapshot.docs
        .map((doc) => doc.toLocalExpertBadgeCelebration())
        .whereType<LocalExpertBadgeCelebration>()
        .where((celebration) {
          final celebrationCreatedAt = celebration.createdAt;
          return celebration.isPending &&
              celebrationCreatedAt != null &&
              !celebrationCreatedAt.isBefore(createdAt);
        })
        .toList(growable: false);
    celebrations.sort((a, b) {
      final aCreatedAt = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bCreatedAt = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return aCreatedAt.compareTo(bCreatedAt);
    });
    return celebrations;
  }

  static Future<void> markCelebrated({
    required String userId,
    required Iterable<String> eventKeys,
  }) async {
    final trimmedUserId = userId.trim();
    final uniqueEventKeys = eventKeys
        .map((key) => key.trim())
        .where((key) => key.isNotEmpty)
        .toSet();
    if (trimmedUserId.isEmpty || uniqueEventKeys.isEmpty) {
      return;
    }

    final batch = _firestore.batch();
    for (final eventKey in uniqueEventKeys) {
      batch.set(_collection(trimmedUserId).doc(eventKey), {
        'status': LocalExpertBadgeCelebration.celebratedStatus,
        'celebratedAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
    await batch.commit();
  }

  static Future<bool> showAllAndMarkCelebrated(
    BuildContext context, {
    required String userId,
    required Iterable<LocalExpertBadgeCelebration> celebrations,
  }) async {
    final shownEventKeys = await showAll(context, celebrations: celebrations);
    if (shownEventKeys.isEmpty) {
      return false;
    }
    await markCelebrated(userId: userId, eventKeys: shownEventKeys);
    return true;
  }

  static Future<List<String>> showAll(
    BuildContext context, {
    required Iterable<LocalExpertBadgeCelebration> celebrations,
  }) async {
    final shownEventKeys = <String>[];
    for (final celebration in _dedupe(celebrations)) {
      final shown = await show(context, celebration: celebration);
      if (shown) {
        shownEventKeys.add(celebration.eventKey);
      }
    }
    return shownEventKeys;
  }

  static Future<bool> show(
    BuildContext context, {
    required LocalExpertBadgeCelebration celebration,
  }) async {
    final eventKey = celebration.eventKey.trim();
    if (eventKey.isEmpty || !_queuedEventKeys.add(eventKey)) {
      return false;
    }
    _queue.add(celebration);

    while (_queue.first.eventKey != eventKey || _activeCelebration != null) {
      await _activeCelebration?.future;
      if (!_queue.any((entry) => entry.eventKey == eventKey)) {
        return false;
      }
    }

    if (!context.mounted) {
      _removeQueued(eventKey);
      return false;
    }
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) {
      _removeQueued(eventKey);
      return false;
    }

    final completer = Completer<void>();
    _activeCelebration = completer;
    late final OverlayEntry entry;
    var dismissed = false;
    var shown = false;

    void dismiss() {
      if (dismissed) {
        return;
      }
      dismissed = true;
      shown = true;
      entry.remove();
      _removeQueued(eventKey);
      _activeCelebration = null;
      if (!completer.isCompleted) {
        completer.complete();
      }
    }

    entry = OverlayEntry(
      builder: (context) => LocalExpertBadgeCelebrationOverlay(
        celebration: celebration,
        displayDuration: displayDurationForLevel(celebration.level),
        onDismiss: dismiss,
        onLanded: () {
          unawaited(_playCelebrationHaptics(celebration.level));
          unawaited(_playAchievementSound(celebration.level));
        },
      ),
    );

    overlay.insert(entry);
    await completer.future;
    return shown;
  }

  static List<LocalExpertBadgeCelebration> _dedupe(
    Iterable<LocalExpertBadgeCelebration> celebrations,
  ) {
    final seen = <String>{};
    final deduped = <LocalExpertBadgeCelebration>[];
    for (final celebration in celebrations) {
      if (seen.add(celebration.eventKey)) {
        deduped.add(celebration);
      }
    }
    return deduped;
  }

  static void _removeQueued(String eventKey) {
    _queue.removeWhere((entry) => entry.eventKey == eventKey);
    _queuedEventKeys.remove(eventKey);
  }

  static Future<void> _playAchievementSound(LocalExpertBadgeLevel level) async {
    if (_soundPlaying) {
      return;
    }
    _soundPlaying = true;
    final player = AudioPlayer();
    try {
      await player.setVolume(_soundVolumeForLevel(level));
      await player.play(AssetSource(soundAsset));
      await Future<void>.delayed(const Duration(milliseconds: 950));
    } catch (_) {
    } finally {
      await player.dispose();
      _soundPlaying = false;
    }
  }

  static double _soundVolumeForLevel(LocalExpertBadgeLevel level) {
    return switch (level) {
      LocalExpertBadgeLevel.level1 => 0.4,
      LocalExpertBadgeLevel.level2 => 0.45,
      LocalExpertBadgeLevel.level3 => 0.5,
    };
  }

  static Future<void> _playCelebrationHaptics(
    LocalExpertBadgeLevel level,
  ) async {
    try {
      await HapticFeedback.heavyImpact();
      await Future<void>.delayed(const Duration(milliseconds: 140));
      await HapticFeedback.mediumImpact();
      await Future<void>.delayed(const Duration(milliseconds: 130));
      await HapticFeedback.selectionClick();
      await Future<void>.delayed(const Duration(milliseconds: 160));
      await HapticFeedback.heavyImpact();
      if (level == LocalExpertBadgeLevel.level1) {
        return;
      }

      await Future<void>.delayed(const Duration(milliseconds: 170));
      await HapticFeedback.selectionClick();
      await Future<void>.delayed(const Duration(milliseconds: 150));
      await HapticFeedback.mediumImpact();
      if (level == LocalExpertBadgeLevel.level2) {
        return;
      }

      await Future<void>.delayed(const Duration(milliseconds: 160));
      await HapticFeedback.selectionClick();
      await Future<void>.delayed(const Duration(milliseconds: 170));
      await HapticFeedback.heavyImpact();
      await Future<void>.delayed(const Duration(milliseconds: 180));
      await HapticFeedback.mediumImpact();
      await Future<void>.delayed(const Duration(milliseconds: 150));
      await HapticFeedback.selectionClick();
      await Future<void>.delayed(const Duration(milliseconds: 170));
      await HapticFeedback.mediumImpact();
      await Future<void>.delayed(const Duration(milliseconds: 160));
      await HapticFeedback.selectionClick();
      await Future<void>.delayed(const Duration(milliseconds: 190));
      await HapticFeedback.heavyImpact();
    } catch (_) {}
  }

  @visibleForTesting
  static void resetForTesting() {
    _queue.clear();
    _queuedEventKeys.clear();
    _activeCelebration = null;
    _soundPlaying = false;
  }
}
