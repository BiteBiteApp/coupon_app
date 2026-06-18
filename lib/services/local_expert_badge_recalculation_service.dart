import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/local_expert_badge_celebration.dart';
import '../models/local_expert_badge.dart';

class LocalExpertBadgeRecalculationResult {
  final int earnedBadgeCount;
  final int removedBadgeCount;
  final List<LocalExpertBadgeCelebration> celebrations;

  const LocalExpertBadgeRecalculationResult({
    required this.earnedBadgeCount,
    required this.removedBadgeCount,
    this.celebrations = const <LocalExpertBadgeCelebration>[],
  });

  factory LocalExpertBadgeRecalculationResult.fromData(dynamic data) {
    final map = data is Map ? data : const <Object?, Object?>{};
    final rawCelebrations = map['celebrations'];
    return LocalExpertBadgeRecalculationResult(
      earnedBadgeCount: _readInt(map['earnedBadgeCount']) ?? 0,
      removedBadgeCount: _readInt(map['removedBadgeCount']) ?? 0,
      celebrations: rawCelebrations is Iterable
          ? rawCelebrations
                .map(LocalExpertBadgeCelebration.tryFromCallableData)
                .whereType<LocalExpertBadgeCelebration>()
                .toList(growable: false)
          : const <LocalExpertBadgeCelebration>[],
    );
  }

  static int? _readInt(dynamic value) {
    if (value is num) {
      return value.toInt();
    }

    return null;
  }
}

typedef LocalExpertRecalculationCallable = Future<dynamic> Function();
typedef LocalExpertCurrentUserIdProvider = String? Function();

class LocalExpertBadgeRecalculationClient {
  final LocalExpertCurrentUserIdProvider currentUserIdProvider;
  final LocalExpertRecalculationCallable callable;

  const LocalExpertBadgeRecalculationClient({
    required this.currentUserIdProvider,
    required this.callable,
  });

  Future<LocalExpertBadgeRecalculationResult> recalculateMyBadges() async {
    final currentUserId = currentUserIdProvider()?.trim();
    if (currentUserId == null || currentUserId.isEmpty) {
      throw StateError('Sign in to recalculate Local Expert badges.');
    }

    final data = await callable();
    return LocalExpertBadgeRecalculationResult.fromData(data);
  }
}

class LocalExpertBadgeRecalculationService {
  static final FirebaseFunctions _functions = FirebaseFunctions.instanceFor(
    region: 'us-central1',
  );

  static Future<LocalExpertBadgeRecalculationResult>
  recalculateMyLocalExpertBadges() {
    final client = LocalExpertBadgeRecalculationClient(
      currentUserIdProvider: () => FirebaseAuth.instance.currentUser?.uid,
      callable: () async {
        final callable = _functions.httpsCallable(
          'recalculateMyLocalExpertBadges',
        );
        final result = await callable.call();
        return result.data;
      },
    );

    return client.recalculateMyBadges();
  }
}

class LocalExpertBadgeProfileRefreshBridge {
  bool _hasRequestedRecalculation = false;

  bool get hasRequestedRecalculation => _hasRequestedRecalculation;

  Future<List<LocalExpertBadge>> loadBadgesAfterSessionRecalculation({
    required String? userId,
    required Future<LocalExpertBadgeRecalculationResult> Function() recalculate,
    required Future<List<LocalExpertBadge>> Function(String? userId) loadBadges,
    void Function(Object error, StackTrace stackTrace)? onRecalculationError,
  }) async {
    if (!_hasRequestedRecalculation) {
      _hasRequestedRecalculation = true;
      try {
        await recalculate();
      } catch (error, stackTrace) {
        onRecalculationError?.call(error, stackTrace);
      }
    }

    return loadBadges(userId);
  }
}
