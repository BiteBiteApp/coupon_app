import 'package:cloud_firestore/cloud_firestore.dart';

import 'local_expert.dart';
import 'local_expert_badge.dart';
import 'local_expert_badge_calculator.dart';

enum LocalExpertBadgeCelebrationKind { earned, levelUp }

class LocalExpertBadgeCelebration {
  static const String pendingStatus = 'pending';
  static const String celebratedStatus = 'celebrated';

  final String eventKey;
  final String expertTypeId;
  final String displayName;
  final LocalExpertBadgeLevel level;
  final LocalExpertBadgeCelebrationKind kind;
  final String status;

  const LocalExpertBadgeCelebration({
    required this.eventKey,
    required this.expertTypeId,
    required this.displayName,
    required this.level,
    required this.kind,
    this.status = pendingStatus,
  });

  String get headline => 'Congratulations!';

  String get message {
    return switch (kind) {
      LocalExpertBadgeCelebrationKind.earned =>
        'You just earned the $displayName Expert Badge — ${levelLabel(level)}!',
      LocalExpertBadgeCelebrationKind.levelUp =>
        'Your $displayName Expert Badge reached ${levelLabel(level)}!',
    };
  }

  List<String> get messageLines {
    if (kind == LocalExpertBadgeCelebrationKind.earned &&
        level == LocalExpertBadgeLevel.level1) {
      return ['You just earned', '$displayName Badge ${levelLabel(level)}'];
    }

    return [message];
  }

  LocalExpertBadge get badge {
    return LocalExpertBadge(
      expertTypeId: expertTypeId,
      displayName: displayName,
      level: level,
      totalRestaurantCount: 0,
      localClusterRestaurantCount: 0,
      qualificationMethod: LocalExpertQualificationMethod.none,
    );
  }

  bool get isPending => status == pendingStatus;

  Map<String, dynamic> toFirestoreMap() {
    return {
      'eventKey': eventKey,
      'expertTypeId': expertTypeId,
      'displayName': displayName,
      'level': level.name,
      'kind': kind.name,
      'status': status,
    };
  }

  static LocalExpertBadgeCelebration? tryFromMap(
    Map<String, dynamic>? data, {
    String? fallbackEventKey,
  }) {
    if (data == null) {
      return null;
    }

    final eventKey = _readString(data['eventKey']) ?? fallbackEventKey?.trim();
    final expertTypeId = _readString(data['expertTypeId']);
    final displayName = _readString(data['displayName']);
    final level = _readLevel(data['level']);
    final kind = _readKind(data['kind']);
    if (eventKey == null ||
        eventKey.isEmpty ||
        expertTypeId == null ||
        displayName == null ||
        level == null ||
        kind == null) {
      return null;
    }

    return LocalExpertBadgeCelebration(
      eventKey: eventKey,
      expertTypeId: expertTypeId,
      displayName: displayName,
      level: level,
      kind: kind,
      status: _readString(data['status']) ?? pendingStatus,
    );
  }

  static LocalExpertBadgeCelebration? tryFromCallableData(dynamic data) {
    final map = data is Map ? Map<String, dynamic>.from(data) : null;
    return tryFromMap(map);
  }

  static String levelLabel(LocalExpertBadgeLevel level) {
    return switch (level) {
      LocalExpertBadgeLevel.level1 => 'Level 1',
      LocalExpertBadgeLevel.level2 => 'Level 2',
      LocalExpertBadgeLevel.level3 => 'Level 3',
    };
  }

  static int levelRank(LocalExpertBadgeLevel level) {
    return switch (level) {
      LocalExpertBadgeLevel.level1 => 1,
      LocalExpertBadgeLevel.level2 => 2,
      LocalExpertBadgeLevel.level3 => 3,
    };
  }

  static LocalExpertBadgeLevel? _readLevel(dynamic value) {
    final normalized = _readString(value);
    if (normalized == null) {
      return null;
    }
    for (final level in LocalExpertBadgeLevel.values) {
      if (level.name == normalized) {
        return level;
      }
    }
    return null;
  }

  static LocalExpertBadgeCelebrationKind? _readKind(dynamic value) {
    final normalized = _readString(value);
    if (normalized == null) {
      return null;
    }
    for (final kind in LocalExpertBadgeCelebrationKind.values) {
      if (kind.name == normalized) {
        return kind;
      }
    }
    return null;
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    return null;
  }
}

extension LocalExpertBadgeCelebrationFirestore
    on DocumentSnapshot<Map<String, dynamic>> {
  LocalExpertBadgeCelebration? toLocalExpertBadgeCelebration() {
    return LocalExpertBadgeCelebration.tryFromMap(data(), fallbackEventKey: id);
  }
}
