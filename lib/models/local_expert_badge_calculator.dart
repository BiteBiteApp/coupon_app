import 'dart:math' as math;

import 'package:cloud_firestore/cloud_firestore.dart';

import 'bitescore_dish.dart';
import 'bitescore_restaurant.dart';
import 'dish_review.dart';
import 'local_expert.dart';

enum LocalExpertQualificationMethod { none, localCluster, overall, both }

class LocalExpertBadgePaths {
  static const String userProfilesCollection = 'user_profiles';
  static const String badgeSubcollection = 'local_expert_badges';

  static String badgeDocumentPath({
    required String userId,
    required String expertTypeId,
  }) {
    return '$userProfilesCollection/${userId.trim()}/'
        '$badgeSubcollection/${expertTypeId.trim()}';
  }
}

class LocalExpertRestaurantLocation {
  final String restaurantId;
  final double? latitude;
  final double? longitude;
  final String? county;
  final String? state;

  const LocalExpertRestaurantLocation({
    required this.restaurantId,
    this.latitude,
    this.longitude,
    this.county,
    this.state,
  });

  bool get hasUsableCoordinates {
    final lat = latitude;
    final lng = longitude;
    return lat != null &&
        lng != null &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
  }

  String? get countyKey {
    final normalizedCounty = LocalExpertCountyKey.normalizeCounty(county);
    final normalizedState = LocalExpertCountyKey.normalizeState(state);
    if (normalizedCounty == null || normalizedState == null) {
      return null;
    }
    return '$normalizedState:$normalizedCounty';
  }
}

class LocalExpertCountyKey {
  static String? normalizeCounty(String? value) {
    var normalized = value
        ?.trim()
        .toLowerCase()
        .replaceAll('&', ' and ')
        .replaceAll(RegExp(r"[\u2018\u2019\u201B\u2032']"), '')
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    if (normalized == null || normalized.isEmpty) {
      return null;
    }
    normalized = normalized.replaceFirst(RegExp(r'\s+county$'), '').trim();
    return normalized.isEmpty ? null : normalized;
  }

  static String? normalizeState(String? value) {
    final trimmed = value?.trim();
    if (trimmed == null || trimmed.isEmpty) {
      return null;
    }
    final stateName = trimmed
        .toUpperCase()
        .replaceAll(RegExp(r'[^A-Z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final stateCode = _localExpertStateNameToCode[stateName];
    if (stateCode != null) {
      return stateCode;
    }
    final normalized = trimmed.toUpperCase().replaceAll(
      RegExp(r'[^A-Z0-9]+'),
      '',
    );
    return normalized.isEmpty ? null : normalized;
  }
}

const Map<String, String> _localExpertStateNameToCode = {
  'ALABAMA': 'AL',
  'ALASKA': 'AK',
  'ARIZONA': 'AZ',
  'ARKANSAS': 'AR',
  'CALIFORNIA': 'CA',
  'COLORADO': 'CO',
  'CONNECTICUT': 'CT',
  'DELAWARE': 'DE',
  'FLORIDA': 'FL',
  'GEORGIA': 'GA',
  'HAWAII': 'HI',
  'IDAHO': 'ID',
  'ILLINOIS': 'IL',
  'INDIANA': 'IN',
  'IOWA': 'IA',
  'KANSAS': 'KS',
  'KENTUCKY': 'KY',
  'LOUISIANA': 'LA',
  'MAINE': 'ME',
  'MARYLAND': 'MD',
  'MASSACHUSETTS': 'MA',
  'MICHIGAN': 'MI',
  'MINNESOTA': 'MN',
  'MISSISSIPPI': 'MS',
  'MISSOURI': 'MO',
  'MONTANA': 'MT',
  'NEBRASKA': 'NE',
  'NEVADA': 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  'OHIO': 'OH',
  'OKLAHOMA': 'OK',
  'OREGON': 'OR',
  'PENNSYLVANIA': 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  'TENNESSEE': 'TN',
  'TEXAS': 'TX',
  'UTAH': 'UT',
  'VERMONT': 'VT',
  'VIRGINIA': 'VA',
  'WASHINGTON': 'WA',
  'WEST VIRGINIA': 'WV',
  'WISCONSIN': 'WI',
  'WYOMING': 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
};

class LocalExpertReviewCandidate {
  final String reviewId;
  final String userId;
  final String restaurantId;
  final String? dishName;
  final String? categoryId;
  final String? categoryName;
  final String? subcategory;
  final List<String> categoryTags;
  final String? headline;
  final String? body;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final double? restaurantLatitude;
  final double? restaurantLongitude;
  final String? restaurantCounty;
  final String? restaurantState;
  final bool isPublic;

  const LocalExpertReviewCandidate({
    required this.reviewId,
    required this.userId,
    required this.restaurantId,
    this.dishName,
    this.categoryId,
    this.categoryName,
    this.subcategory,
    this.categoryTags = const [],
    this.headline,
    this.body,
    this.createdAt,
    this.updatedAt,
    this.restaurantLatitude,
    this.restaurantLongitude,
    this.restaurantCounty,
    this.restaurantState,
    this.isPublic = true,
  });

  factory LocalExpertReviewCandidate.fromReview({
    required DishReview review,
    required BitescoreDish? dish,
    required BitescoreRestaurant? restaurant,
  }) {
    return LocalExpertReviewCandidate(
      reviewId: review.id,
      userId: review.userId,
      restaurantId: review.restaurantId,
      dishName: dish?.name,
      categoryName: dish?.category,
      subcategory: dish?.subcategory,
      categoryTags: dish?.categoryTags ?? const [],
      headline: review.headline,
      body: review.notes,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      restaurantLatitude: restaurant?.latitude,
      restaurantLongitude: restaurant?.longitude,
      restaurantCounty: restaurant?.county,
      restaurantState: restaurant?.state,
      isPublic:
          (dish == null || (dish.isActive && !dish.isMerged)) &&
          (restaurant == null || restaurant.isActive),
    );
  }

  DateTime? get representativeTimestamp => updatedAt ?? createdAt;

  LocalExpertRestaurantLocation get location => LocalExpertRestaurantLocation(
    restaurantId: restaurantId,
    latitude: restaurantLatitude,
    longitude: restaurantLongitude,
    county: restaurantCounty,
    state: restaurantState,
  );
}

class LocalExpertBadgeResult {
  final String expertTypeId;
  final String displayName;
  final LocalExpertBadgeLevel? earnedLevel;
  final int totalDistinctRestaurantCount;
  final int bestLocalClusterRestaurantCount;
  final int bestSameCountyRestaurantCount;
  final List<String> qualifyingReviewIds;
  final List<String> qualifyingRestaurantIds;
  final LocalExpertQualificationMethod qualificationMethod;
  final DateTime calculatedAt;

  const LocalExpertBadgeResult({
    required this.expertTypeId,
    required this.displayName,
    required this.earnedLevel,
    required this.totalDistinctRestaurantCount,
    required this.bestLocalClusterRestaurantCount,
    required this.bestSameCountyRestaurantCount,
    required this.qualifyingReviewIds,
    required this.qualifyingRestaurantIds,
    required this.qualificationMethod,
    required this.calculatedAt,
  });

  bool get isEarned => earnedLevel != null;

  Map<String, dynamic> toFirestoreMap({DateTime? earnedAt}) {
    final level = earnedLevel;
    if (level == null) {
      throw StateError('Cannot persist an unearned Local Expert badge result.');
    }

    final persistedEarnedAt = earnedAt ?? calculatedAt;
    return {
      'expertTypeId': expertTypeId,
      'displayName': displayName,
      'level': level.name,
      'totalRestaurantCount': totalDistinctRestaurantCount,
      'localClusterRestaurantCount': bestLocalClusterRestaurantCount,
      'qualificationMethod': qualificationMethod.name,
      'qualifyingReviewIds': qualifyingReviewIds,
      'qualifyingRestaurantIds': qualifyingRestaurantIds,
      'earnedAt': Timestamp.fromDate(persistedEarnedAt),
      'updatedAt': Timestamp.fromDate(calculatedAt),
      'calculatedAt': Timestamp.fromDate(calculatedAt),
      'source': 'localExpertBadgeCalculatorV1',
    };
  }
}

class LocalExpertBadgeCalculation {
  final String userId;
  final DateTime calculatedAt;
  final List<LocalExpertBadgeResult> results;

  const LocalExpertBadgeCalculation({
    required this.userId,
    required this.calculatedAt,
    required this.results,
  });

  List<LocalExpertBadgeResult> get earnedResults {
    return results.where((result) => result.isEarned).toList(growable: false);
  }

  LocalExpertBadgeResult? resultFor(String expertTypeId) {
    final normalized = expertTypeId.trim().toLowerCase();
    for (final result in results) {
      if (result.expertTypeId == normalized) {
        return result;
      }
    }
    return null;
  }

  List<String> badgeTypeIdsToRemove(Iterable<String> existingBadgeTypeIds) {
    final earnedTypeIds = earnedResults
        .map((result) => result.expertTypeId)
        .toSet();
    final removals =
        existingBadgeTypeIds
            .map((id) => id.trim().toLowerCase())
            .where(
              (id) =>
                  id.isNotEmpty &&
                  !earnedTypeIds.contains(id) &&
                  !LocalExperts.legacyExpertTypeIds.contains(id),
            )
            .toSet()
            .toList()
          ..sort();
    return removals;
  }
}

class LocalExpertBadgeCalculator {
  static LocalExpertBadgeCalculation calculateForUser({
    required String userId,
    required Iterable<LocalExpertReviewCandidate> reviews,
    DateTime? calculatedAt,
    double clusterRadiusMiles = LocalExpertBadgeThresholds.clusterRadiusMiles,
  }) {
    final normalizedUserId = userId.trim().toLowerCase();
    final timestamp = calculatedAt ?? DateTime.now();
    final representativesByDedupKey =
        <String, _ResolvedExpertReviewCandidate>{};

    for (final review in reviews) {
      if (review.userId.trim().toLowerCase() != normalizedUserId) {
        continue;
      }
      if (!review.isPublic ||
          !LocalExperts.hasValidRestaurant(review.restaurantId) ||
          !LocalExperts.hasMinimumWrittenReview(
            headline: review.headline,
            body: review.body,
          )) {
        continue;
      }

      final expertTypes = LocalExperts.matchDishes(
        dishName: review.dishName,
        categoryId: review.categoryId,
        categoryName: review.categoryName,
        subcategory: review.subcategory,
        categoryTags: review.categoryTags,
      );
      if (expertTypes.isEmpty) {
        continue;
      }

      for (final expertType in expertTypes) {
        final resolved = _ResolvedExpertReviewCandidate(
          review: review,
          expertType: expertType,
        );
        final dedupKey = LocalExperts.deduplicationKey(
          userId: normalizedUserId,
          restaurantId: review.restaurantId,
          expertTypeId: expertType.id,
        );
        final existing = representativesByDedupKey[dedupKey];
        if (existing == null ||
            _isPreferredRepresentative(resolved, existing)) {
          representativesByDedupKey[dedupKey] = resolved;
        }
      }
    }

    final representativesByType =
        <String, List<_ResolvedExpertReviewCandidate>>{};
    for (final representative in representativesByDedupKey.values) {
      representativesByType
          .putIfAbsent(
            representative.expertType.id,
            () => <_ResolvedExpertReviewCandidate>[],
          )
          .add(representative);
    }

    final results = <LocalExpertBadgeResult>[];
    for (final expertType in LocalExperts.all) {
      final representatives = [...?representativesByType[expertType.id]];
      representatives.sort(_compareResolvedCandidates);
      results.add(
        _calculateResultForType(
          expertType: expertType,
          representatives: representatives,
          calculatedAt: timestamp,
          clusterRadiusMiles: clusterRadiusMiles,
        ),
      );
    }

    return LocalExpertBadgeCalculation(
      userId: normalizedUserId,
      calculatedAt: timestamp,
      results: results,
    );
  }

  static LocalExpertBadgeResult _calculateResultForType({
    required LocalExpertType expertType,
    required List<_ResolvedExpertReviewCandidate> representatives,
    required DateTime calculatedAt,
    required double clusterRadiusMiles,
  }) {
    final restaurantIds =
        representatives
            .map((candidate) => candidate.review.restaurantId.trim())
            .where((id) => id.isNotEmpty)
            .toSet()
            .toList()
          ..sort();
    final reviewIds =
        representatives.map((candidate) => candidate.review.reviewId).toList()
          ..sort();
    final totalRestaurantCount = restaurantIds.length;
    final bestLocalClusterRestaurantCount = _bestPairwiseClusterCount(
      representatives.map((candidate) => candidate.review.location),
      clusterRadiusMiles: clusterRadiusMiles,
    );
    final bestSameCountyRestaurantCount = _bestSameCountyCount(
      representatives.map((candidate) => candidate.review.location),
    );
    final level = _highestQualifiedLevel(
      totalRestaurantCount: totalRestaurantCount,
      bestLocalClusterRestaurantCount: bestLocalClusterRestaurantCount,
      bestSameCountyRestaurantCount: bestSameCountyRestaurantCount,
    );
    final qualificationMethod = _qualificationMethodFor(
      level: level,
      totalRestaurantCount: totalRestaurantCount,
      bestLocalClusterRestaurantCount: bestLocalClusterRestaurantCount,
      bestSameCountyRestaurantCount: bestSameCountyRestaurantCount,
    );

    return LocalExpertBadgeResult(
      expertTypeId: expertType.id,
      displayName: expertType.displayName,
      earnedLevel: level,
      totalDistinctRestaurantCount: totalRestaurantCount,
      bestLocalClusterRestaurantCount: bestLocalClusterRestaurantCount,
      bestSameCountyRestaurantCount: bestSameCountyRestaurantCount,
      qualifyingReviewIds: reviewIds,
      qualifyingRestaurantIds: restaurantIds,
      qualificationMethod: qualificationMethod,
      calculatedAt: calculatedAt,
    );
  }

  static LocalExpertBadgeLevel? _highestQualifiedLevel({
    required int totalRestaurantCount,
    required int bestLocalClusterRestaurantCount,
    required int bestSameCountyRestaurantCount,
  }) {
    if (_qualifiesOverall(LocalExpertBadgeLevel.level3, totalRestaurantCount)) {
      return LocalExpertBadgeLevel.level3;
    }
    if (_qualifies(
      LocalExpertBadgeLevel.level2,
      totalRestaurantCount: totalRestaurantCount,
      bestLocalClusterRestaurantCount: bestLocalClusterRestaurantCount,
      bestSameCountyRestaurantCount: bestSameCountyRestaurantCount,
    )) {
      return LocalExpertBadgeLevel.level2;
    }
    if (_qualifies(
      LocalExpertBadgeLevel.level1,
      totalRestaurantCount: totalRestaurantCount,
      bestLocalClusterRestaurantCount: bestLocalClusterRestaurantCount,
      bestSameCountyRestaurantCount: bestSameCountyRestaurantCount,
    )) {
      return LocalExpertBadgeLevel.level1;
    }
    return null;
  }

  static bool _qualifies(
    LocalExpertBadgeLevel level, {
    required int totalRestaurantCount,
    required int bestLocalClusterRestaurantCount,
    required int bestSameCountyRestaurantCount,
  }) {
    return _qualifiesOverall(level, totalRestaurantCount) ||
        _qualifiesLocal(level, bestLocalClusterRestaurantCount) ||
        _qualifiesLocal(level, bestSameCountyRestaurantCount);
  }

  static bool _qualifiesOverall(
    LocalExpertBadgeLevel level,
    int totalRestaurantCount,
  ) {
    return totalRestaurantCount >=
        LocalExpertBadgeThresholds.forLevel(level).distinctRestaurantsOverall;
  }

  static bool _qualifiesLocal(
    LocalExpertBadgeLevel level,
    int bestLocalClusterRestaurantCount,
  ) {
    final localThreshold = LocalExpertBadgeThresholds.forLevel(
      level,
    ).distinctRestaurantsInCluster;
    return localThreshold != null &&
        bestLocalClusterRestaurantCount >= localThreshold;
  }

  static LocalExpertQualificationMethod _qualificationMethodFor({
    required LocalExpertBadgeLevel? level,
    required int totalRestaurantCount,
    required int bestLocalClusterRestaurantCount,
    required int bestSameCountyRestaurantCount,
  }) {
    if (level == null) {
      return LocalExpertQualificationMethod.none;
    }

    final qualifiesOverall = _qualifiesOverall(level, totalRestaurantCount);
    final qualifiesLocal =
        _qualifiesLocal(level, bestLocalClusterRestaurantCount) ||
        _qualifiesLocal(level, bestSameCountyRestaurantCount);
    if (qualifiesOverall && qualifiesLocal) {
      return LocalExpertQualificationMethod.both;
    }
    if (qualifiesLocal) {
      return LocalExpertQualificationMethod.localCluster;
    }
    return LocalExpertQualificationMethod.overall;
  }

  static int _bestPairwiseClusterCount(
    Iterable<LocalExpertRestaurantLocation> locations, {
    required double clusterRadiusMiles,
  }) {
    final uniqueLocations = <String, LocalExpertRestaurantLocation>{};
    for (final location in locations) {
      if (location.hasUsableCoordinates) {
        uniqueLocations[location.restaurantId.trim()] = location;
      }
    }
    final sortedLocations = uniqueLocations.values.toList()
      ..sort((a, b) => a.restaurantId.compareTo(b.restaurantId));
    if (sortedLocations.length < 2) {
      return sortedLocations.length;
    }

    final adjacency = <int, Set<int>>{};
    for (var i = 0; i < sortedLocations.length; i += 1) {
      adjacency[i] = <int>{};
    }
    for (var i = 0; i < sortedLocations.length; i += 1) {
      for (var j = i + 1; j < sortedLocations.length; j += 1) {
        final miles = distanceMiles(sortedLocations[i], sortedLocations[j]);
        if (miles <= clusterRadiusMiles) {
          adjacency[i]!.add(j);
          adjacency[j]!.add(i);
        }
      }
    }

    var best = 0;
    void expand(List<int> clique, List<int> candidates) {
      if (clique.length + candidates.length <= best) {
        return;
      }
      if (candidates.isEmpty) {
        best = math.max(best, clique.length);
        return;
      }

      while (candidates.isNotEmpty) {
        if (clique.length + candidates.length <= best) {
          return;
        }
        final next = candidates.removeAt(0);
        final nextCandidates = candidates
            .where((candidate) => adjacency[next]!.contains(candidate))
            .toList();
        expand([...clique, next], nextCandidates);
        best = math.max(best, clique.length + 1);
      }
    }

    expand(
      const [],
      List<int>.generate(sortedLocations.length, (index) => index),
    );
    return best;
  }

  static int _bestSameCountyCount(
    Iterable<LocalExpertRestaurantLocation> locations,
  ) {
    final restaurantIdsByCounty = <String, Set<String>>{};
    for (final location in locations) {
      final countyKey = location.countyKey;
      final restaurantId = location.restaurantId.trim();
      if (countyKey == null || restaurantId.isEmpty) {
        continue;
      }
      restaurantIdsByCounty
          .putIfAbsent(countyKey, () => <String>{})
          .add(restaurantId);
    }
    if (restaurantIdsByCounty.isEmpty) {
      return 0;
    }
    return restaurantIdsByCounty.values
        .map((restaurantIds) => restaurantIds.length)
        .reduce(math.max);
  }

  static double distanceMiles(
    LocalExpertRestaurantLocation first,
    LocalExpertRestaurantLocation second,
  ) {
    final firstLat = first.latitude;
    final firstLng = first.longitude;
    final secondLat = second.latitude;
    final secondLng = second.longitude;
    if (firstLat == null ||
        firstLng == null ||
        secondLat == null ||
        secondLng == null) {
      return double.infinity;
    }

    const earthRadiusMiles = 3958.7613;
    final lat1 = _degreesToRadians(firstLat);
    final lat2 = _degreesToRadians(secondLat);
    final deltaLat = _degreesToRadians(secondLat - firstLat);
    final deltaLng = _degreesToRadians(secondLng - firstLng);
    final a =
        math.sin(deltaLat / 2) * math.sin(deltaLat / 2) +
        math.cos(lat1) *
            math.cos(lat2) *
            math.sin(deltaLng / 2) *
            math.sin(deltaLng / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return earthRadiusMiles * c;
  }

  static double _degreesToRadians(double degrees) {
    return degrees * math.pi / 180;
  }

  static bool _isPreferredRepresentative(
    _ResolvedExpertReviewCandidate candidate,
    _ResolvedExpertReviewCandidate existing,
  ) {
    final candidateTimestamp = candidate.review.representativeTimestamp;
    final existingTimestamp = existing.review.representativeTimestamp;
    if (candidateTimestamp != null && existingTimestamp != null) {
      final comparison = candidateTimestamp.compareTo(existingTimestamp);
      if (comparison != 0) {
        return comparison > 0;
      }
    } else if (candidateTimestamp != null) {
      return true;
    } else if (existingTimestamp != null) {
      return false;
    }

    return candidate.review.reviewId.compareTo(existing.review.reviewId) > 0;
  }

  static int _compareResolvedCandidates(
    _ResolvedExpertReviewCandidate first,
    _ResolvedExpertReviewCandidate second,
  ) {
    final restaurantComparison = first.review.restaurantId.compareTo(
      second.review.restaurantId,
    );
    if (restaurantComparison != 0) {
      return restaurantComparison;
    }
    return first.review.reviewId.compareTo(second.review.reviewId);
  }
}

class _ResolvedExpertReviewCandidate {
  final LocalExpertReviewCandidate review;
  final LocalExpertType expertType;

  const _ResolvedExpertReviewCandidate({
    required this.review,
    required this.expertType,
  });
}
