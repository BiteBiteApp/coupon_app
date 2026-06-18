import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/local_expert_badge_celebration.dart';
import '../services/local_expert_badge_celebration_service.dart';

typedef LocalExpertCelebrationUserIdProvider = String? Function();
typedef LocalExpertCelebrationLoader =
    Future<List<LocalExpertBadgeCelebration>> Function(String userId);
typedef LocalExpertCelebrationMarker =
    Future<void> Function({
      required String userId,
      required Iterable<String> eventKeys,
    });
typedef LocalExpertCelebrationShower =
    Future<List<String>> Function(
      BuildContext context, {
      required Iterable<LocalExpertBadgeCelebration> celebrations,
    });

class LocalExpertBadgeCelebrationHost extends StatefulWidget {
  final Widget child;
  final LocalExpertCelebrationUserIdProvider? currentUserIdProvider;
  final LocalExpertCelebrationLoader? loadPendingCelebrations;
  final LocalExpertCelebrationMarker? markCelebrated;
  final LocalExpertCelebrationShower? showCelebrations;

  const LocalExpertBadgeCelebrationHost({
    super.key,
    required this.child,
    this.currentUserIdProvider,
    this.loadPendingCelebrations,
    this.markCelebrated,
    this.showCelebrations,
  });

  @override
  State<LocalExpertBadgeCelebrationHost> createState() =>
      _LocalExpertBadgeCelebrationHostState();
}

class _LocalExpertBadgeCelebrationHostState
    extends State<LocalExpertBadgeCelebrationHost>
    with WidgetsBindingObserver {
  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;
  bool _isChecking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_checkForPendingCelebrations());
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
      unawaited(_checkForPendingCelebrations());
    }
  }

  Future<void> _checkForPendingCelebrations() async {
    if (_isChecking || !localExpertCelebrationIsForeground(_lifecycleState)) {
      return;
    }

    final userId = _currentUserId();
    if (userId == null || userId.isEmpty) {
      return;
    }

    _isChecking = true;
    try {
      await Future<void>.delayed(Duration.zero);
      if (!mounted ||
          !localExpertCelebrationIsForeground(_lifecycleState) ||
          _currentUserId() != userId) {
        return;
      }

      final celebrations = await _loadPending(userId);
      if (!mounted ||
          celebrations.isEmpty ||
          !localExpertCelebrationIsForeground(_lifecycleState) ||
          _currentUserId() != userId) {
        return;
      }

      final shownEventKeys = await _showCelebrations(
        context,
        celebrations: celebrations,
      );
      if (!mounted ||
          shownEventKeys.isEmpty ||
          !localExpertCelebrationIsForeground(_lifecycleState) ||
          _currentUserId() != userId) {
        return;
      }

      await _markCelebrated(userId: userId, eventKeys: shownEventKeys);
    } catch (_) {
    } finally {
      _isChecking = false;
    }
  }

  String? _currentUserId() {
    final provided = widget.currentUserIdProvider?.call();
    if (provided != null) {
      return provided.trim().isEmpty ? null : provided.trim();
    }
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      return null;
    }
    return user.uid.trim();
  }

  Future<List<LocalExpertBadgeCelebration>> _loadPending(String userId) {
    final loader =
        widget.loadPendingCelebrations ??
        LocalExpertBadgeCelebrationService.loadPendingCelebrations;
    return loader(userId);
  }

  Future<List<String>> _showCelebrations(
    BuildContext context, {
    required Iterable<LocalExpertBadgeCelebration> celebrations,
  }) {
    final shower =
        widget.showCelebrations ?? LocalExpertBadgeCelebrationService.showAll;
    return shower(context, celebrations: celebrations);
  }

  Future<void> _markCelebrated({
    required String userId,
    required Iterable<String> eventKeys,
  }) {
    final marker =
        widget.markCelebrated ??
        LocalExpertBadgeCelebrationService.markCelebrated;
    return marker(userId: userId, eventKeys: eventKeys);
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}

@visibleForTesting
bool localExpertCelebrationIsForeground(AppLifecycleState state) {
  return state == AppLifecycleState.resumed;
}
