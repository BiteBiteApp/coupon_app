import 'package:cloud_firestore/cloud_firestore.dart';

import 'local_expert.dart';
import 'local_expert_badge_calculator.dart';

class LocalExpertBadge {
  final String expertTypeId;
  final String displayName;
  final LocalExpertBadgeLevel level;
  final int totalRestaurantCount;
  final int localClusterRestaurantCount;
  final LocalExpertQualificationMethod qualificationMethod;
  final DateTime? earnedAt;
  final DateTime? updatedAt;

  const LocalExpertBadge({
    required this.expertTypeId,
    required this.displayName,
    required this.level,
    required this.totalRestaurantCount,
    required this.localClusterRestaurantCount,
    required this.qualificationMethod,
    this.earnedAt,
    this.updatedAt,
  });

  String get levelLabel {
    return switch (level) {
      LocalExpertBadgeLevel.level1 => 'Level 1',
      LocalExpertBadgeLevel.level2 => 'Level 2',
      LocalExpertBadgeLevel.level3 => 'Level 3',
    };
  }

  static LocalExpertBadge? tryFromMap(
    Map<String, dynamic>? data, {
    String? fallbackExpertTypeId,
  }) {
    if (data == null) {
      return null;
    }

    final expertTypeId =
        _readString(data['expertTypeId']) ?? _readString(fallbackExpertTypeId);
    final displayName = _readString(data['displayName']);
    final level = _readLevel(data['level']);
    final totalRestaurantCount = _readNonNegativeInt(
      data['totalRestaurantCount'],
    );
    final localClusterRestaurantCount = _readNonNegativeInt(
      data['localClusterRestaurantCount'],
    );

    if (expertTypeId == null ||
        displayName == null ||
        level == null ||
        totalRestaurantCount == null ||
        localClusterRestaurantCount == null) {
      return null;
    }

    return LocalExpertBadge(
      expertTypeId: expertTypeId,
      displayName: displayName,
      level: level,
      totalRestaurantCount: totalRestaurantCount,
      localClusterRestaurantCount: localClusterRestaurantCount,
      qualificationMethod:
          _readQualificationMethod(data['qualificationMethod']) ??
          LocalExpertQualificationMethod.none,
      earnedAt: _readDateTime(data['earnedAt']),
      updatedAt: _readDateTime(data['updatedAt']),
    );
  }

  static List<LocalExpertBadge> sortBadges(Iterable<LocalExpertBadge> badges) {
    final sorted = List<LocalExpertBadge>.from(badges);
    sorted.sort(compare);
    return sorted;
  }

  static int compare(LocalExpertBadge a, LocalExpertBadge b) {
    final byLevel = _levelRank(b.level).compareTo(_levelRank(a.level));
    if (byLevel != 0) {
      return byLevel;
    }

    final byName = a.displayName.toLowerCase().compareTo(
      b.displayName.toLowerCase(),
    );
    if (byName != 0) {
      return byName;
    }

    return a.expertTypeId.compareTo(b.expertTypeId);
  }

  static int _levelRank(LocalExpertBadgeLevel level) {
    return switch (level) {
      LocalExpertBadgeLevel.level1 => 1,
      LocalExpertBadgeLevel.level2 => 2,
      LocalExpertBadgeLevel.level3 => 3,
    };
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static int? _readNonNegativeInt(dynamic value) {
    if (value is num) {
      final parsed = value.toInt();
      return parsed < 0 ? null : parsed;
    }

    return null;
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

  static LocalExpertQualificationMethod? _readQualificationMethod(
    dynamic value,
  ) {
    final normalized = _readString(value);
    if (normalized == null) {
      return null;
    }

    for (final method in LocalExpertQualificationMethod.values) {
      if (method.name == normalized) {
        return method;
      }
    }

    return null;
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate().toLocal();
    }
    if (value is DateTime) {
      return value.toLocal();
    }

    return null;
  }
}

class LocalExpertBadgeOverflowSummary {
  final List<LocalExpertBadge> visibleBadges;
  final int hiddenCount;

  const LocalExpertBadgeOverflowSummary({
    required this.visibleBadges,
    required this.hiddenCount,
  });

  factory LocalExpertBadgeOverflowSummary.fromBadges(
    Iterable<LocalExpertBadge> badges, {
    int maxVisible = 2,
  }) {
    final limit = maxVisible < 0 ? 0 : maxVisible;
    final sorted = LocalExpertBadge.sortBadges(badges);
    return LocalExpertBadgeOverflowSummary(
      visibleBadges: sorted.take(limit).toList(growable: false),
      hiddenCount: sorted.length > limit ? sorted.length - limit : 0,
    );
  }

  factory LocalExpertBadgeOverflowSummary.fromPrioritizedBadges(
    Iterable<LocalExpertBadge> badges, {
    int maxVisible = 2,
  }) {
    final limit = maxVisible < 0 ? 0 : maxVisible;
    final ordered = badges.toList(growable: false);
    return LocalExpertBadgeOverflowSummary(
      visibleBadges: ordered.take(limit).toList(growable: false),
      hiddenCount: ordered.length > limit ? ordered.length - limit : 0,
    );
  }
}

class LocalExpertBadgePrioritizer {
  static List<LocalExpertBadge> prioritizeForDish({
    required Iterable<LocalExpertBadge> badges,
    String? dishName,
    String? categoryId,
    String? categoryName,
    String? subcategory,
    Iterable<String> categoryTags = const [],
  }) {
    final sorted = LocalExpertBadge.sortBadges(badges);
    final matchingExpertType = LocalExperts.matchDish(
      dishName: dishName,
      categoryId: categoryId,
      categoryName: categoryName,
      subcategory: subcategory,
      categoryTags: categoryTags,
    );
    if (matchingExpertType == null) {
      return sorted;
    }

    final matching = <LocalExpertBadge>[];
    final remaining = <LocalExpertBadge>[];
    for (final badge in sorted) {
      if (badge.expertTypeId == matchingExpertType.id) {
        matching.add(badge);
      } else {
        remaining.add(badge);
      }
    }

    return <LocalExpertBadge>[...matching, ...remaining];
  }
}
