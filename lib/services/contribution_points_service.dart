import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/contribution_point_ledger_entry.dart';
import '../models/dish_edit_proposal.dart';
import 'admin_access_service.dart';

typedef ContributionPointCallable =
    Future<Object?> Function(Map<String, dynamic> payload);

class ContributionPointAction {
  static const reviewMilestone = 'review_milestone';
  static const dishCreated = 'dish_created';
  static const dishImageAdded = 'dish_image_added';
  static const restaurantFirstDish = 'restaurant_first_dish';
  static const newRestaurantFirstDish = 'new_restaurant_first_dish';
  static const dishEditApproved = 'dish_edit_approved';
  static const dishRenameApproved = 'dish_rename_approved';
  static const dishMergeApproved = 'dish_merge_approved';
  static const contributionReversed = 'contribution_reversed';
}

class ContributionPointAwardDraft {
  final String userId;
  final int points;
  final String actionType;
  final String sourceKey;
  final String description;
  final String? dishId;
  final String? dishName;
  final String? restaurantId;
  final String? restaurantName;
  final String? restaurantCity;
  final String? restaurantState;
  final String? restaurantAddress;
  final String? restaurantPhone;
  final String? reviewId;
  final String? requestId;
  final String? imageId;
  final String? oldValue;
  final String? newValue;
  final String? mergeSourceDishId;
  final String? mergeSourceDishName;
  final String? mergeTargetDishId;
  final String? mergeTargetDishName;

  const ContributionPointAwardDraft({
    required this.userId,
    required this.points,
    required this.actionType,
    required this.sourceKey,
    required this.description,
    this.dishId,
    this.dishName,
    this.restaurantId,
    this.restaurantName,
    this.restaurantCity,
    this.restaurantState,
    this.restaurantAddress,
    this.restaurantPhone,
    this.reviewId,
    this.requestId,
    this.imageId,
    this.oldValue,
    this.newValue,
    this.mergeSourceDishId,
    this.mergeSourceDishName,
    this.mergeTargetDishId,
    this.mergeTargetDishName,
  });
}

class ContributionPointAwardEntryResult {
  final String ledgerEntryId;
  final int points;
  final bool wasCreated;

  const ContributionPointAwardEntryResult({
    required this.ledgerEntryId,
    required this.points,
    required this.wasCreated,
  });

  factory ContributionPointAwardEntryResult.fromCallableData(Object? data) {
    final map = _callableMap(data);
    final ledgerEntryId = _callableString(map?['ledgerEntryId']);
    final points = _callableInt(map?['points']);
    final wasCreated = _callableBool(map?['wasCreated']);
    if (ledgerEntryId == null || points == null || wasCreated == null) {
      throw const FormatException('Invalid contribution point award entry.');
    }
    return ContributionPointAwardEntryResult(
      ledgerEntryId: ledgerEntryId,
      points: points,
      wasCreated: wasCreated,
    );
  }
}

class ContributionPointAwardResult {
  final List<ContributionPointAwardEntryResult> entries;
  final String? actionGroupId;

  const ContributionPointAwardResult({
    this.entries = const <ContributionPointAwardEntryResult>[],
    this.actionGroupId,
  });

  factory ContributionPointAwardResult.fromCallableData(Object? data) {
    final envelope = _callableMap(data);
    if (envelope == null) {
      return const ContributionPointAwardResult();
    }
    final result = _callableMap(envelope['result']) ?? envelope;
    final rawEntries = result['entries'];
    final entries = rawEntries is Iterable
        ? rawEntries
              .map(ContributionPointAwardEntryResult.fromCallableData)
              .toList(growable: false)
        : const <ContributionPointAwardEntryResult>[];
    return ContributionPointAwardResult(
      entries: entries,
      actionGroupId: _callableString(result['actionGroupId']),
    );
  }

  int get newlyAwardedPoints => entries.fold<int>(
    0,
    (total, entry) => entry.wasCreated ? total + entry.points : total,
  );

  List<String> get newlyCreatedLedgerEntryIds => entries
      .where((entry) => entry.wasCreated && entry.points > 0)
      .map((entry) => entry.ledgerEntryId)
      .toList(growable: false);

  bool get hasNewPositivePoints => newlyAwardedPoints > 0;

  ContributionPointAwardResult merge(
    ContributionPointAwardResult other, {
    String? actionGroupId,
  }) {
    return ContributionPointAwardResult(
      entries: <ContributionPointAwardEntryResult>[
        ...entries,
        ...other.entries,
      ],
      actionGroupId: actionGroupId ?? this.actionGroupId ?? other.actionGroupId,
    );
  }

  static ContributionPointAwardResult combine(
    Iterable<ContributionPointAwardResult> results, {
    String? actionGroupId,
  }) {
    return ContributionPointAwardResult(
      entries: results.expand((result) => result.entries).toList(),
      actionGroupId: actionGroupId,
    );
  }
}

Map<Object?, Object?>? _callableMap(Object? value) {
  if (value is Map) {
    return value;
  }
  return null;
}

String? _callableString(Object? value) {
  if (value is String) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
  return null;
}

int? _callableInt(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  return null;
}

bool? _callableBool(Object? value) {
  return value is bool ? value : null;
}

Set<String> _callableStringSet(Object? value) {
  if (value is! Iterable) {
    return const <String>{};
  }
  return value.map(_callableString).whereType<String>().toSet();
}

class ContributionPointUserSummary {
  final String userId;
  final String displayName;
  final int totalPoints;
  final DateTime? lastActivityAt;

  const ContributionPointUserSummary({
    required this.userId,
    required this.displayName,
    required this.totalPoints,
    this.lastActivityAt,
  });
}

class ContributionPointCelebrationMarkResult {
  final Set<String> attemptedEntryIds;
  final Set<String> markedEntryIds;
  final Set<String> alreadyCelebratedEntryIds;
  final Set<String> missingEntryIds;
  final Set<String> ignoredEntryIds;

  const ContributionPointCelebrationMarkResult({
    this.attemptedEntryIds = const <String>{},
    this.markedEntryIds = const <String>{},
    this.alreadyCelebratedEntryIds = const <String>{},
    this.missingEntryIds = const <String>{},
    this.ignoredEntryIds = const <String>{},
  });

  factory ContributionPointCelebrationMarkResult.fromCallableData(
    Object? data,
  ) {
    final envelope = _callableMap(data);
    if (envelope == null) {
      return const ContributionPointCelebrationMarkResult();
    }
    final result = _callableMap(envelope['result']) ?? envelope;
    return ContributionPointCelebrationMarkResult(
      attemptedEntryIds: _callableStringSet(result['attemptedEntryIds']),
      markedEntryIds: _callableStringSet(result['markedEntryIds']),
      alreadyCelebratedEntryIds: _callableStringSet(
        result['alreadyCelebratedEntryIds'],
      ),
      missingEntryIds: _callableStringSet(result['missingEntryIds']),
      ignoredEntryIds: _callableStringSet(result['ignoredEntryIds']),
    );
  }

  bool get hasProblems =>
      missingEntryIds.isNotEmpty || ignoredEntryIds.isNotEmpty;
}

enum ContributionPointSort {
  mostPoints,
  fewestPoints,
  displayNameAz,
  mostRecentActivity,
}

class ContributionPointsService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  static final FirebaseFunctions _functions = FirebaseFunctions.instanceFor(
    region: 'us-central1',
  );

  static CollectionReference<Map<String, dynamic>> ledgerCollection() {
    return _firestore.collection(ContributionPointLedgerEntry.collectionName);
  }

  static DocumentReference<Map<String, dynamic>> userProfileDocument(
    String userId,
  ) {
    return _firestore.collection('user_profiles').doc(userId.trim());
  }

  static CollectionReference<Map<String, dynamic>>
  publicReviewerProfilesCollection() {
    return _firestore.collection('public_reviewer_profiles');
  }

  static int reviewMilestonePointsForCount(int validReviewCount) {
    if (validReviewCount <= 0) {
      return 0;
    }
    return validReviewCount ~/ 5;
  }

  static List<int> reviewMilestonesForCount(int validReviewCount) {
    final milestoneCount = reviewMilestonePointsForCount(validReviewCount);
    return List<int>.generate(milestoneCount, (index) => (index + 1) * 5);
  }

  static int ledgerTotal(Iterable<ContributionPointLedgerEntry> entries) {
    return entries.fold<int>(0, (total, entry) => total + entry.pointsDelta);
  }

  static List<ContributionPointUserSummary> sortUserPointSummaries(
    Iterable<ContributionPointUserSummary> summaries,
    ContributionPointSort sort,
  ) {
    final sorted = summaries.toList();
    sorted.sort((a, b) {
      switch (sort) {
        case ContributionPointSort.fewestPoints:
          final byPoints = a.totalPoints.compareTo(b.totalPoints);
          return byPoints != 0
              ? byPoints
              : a.displayName.compareTo(b.displayName);
        case ContributionPointSort.displayNameAz:
          final byName = a.displayName.toLowerCase().compareTo(
            b.displayName.toLowerCase(),
          );
          return byName != 0 ? byName : a.userId.compareTo(b.userId);
        case ContributionPointSort.mostRecentActivity:
          final aDate =
              a.lastActivityAt ?? DateTime.fromMillisecondsSinceEpoch(0);
          final bDate =
              b.lastActivityAt ?? DateTime.fromMillisecondsSinceEpoch(0);
          final byDate = bDate.compareTo(aDate);
          return byDate != 0 ? byDate : b.totalPoints.compareTo(a.totalPoints);
        case ContributionPointSort.mostPoints:
          final byPoints = b.totalPoints.compareTo(a.totalPoints);
          return byPoints != 0
              ? byPoints
              : a.displayName.compareTo(b.displayName);
      }
    });
    return sorted;
  }

  static int pointsForDishContribution({
    required bool createdNewRestaurant,
    required bool createdNewDish,
    required bool restaurantHadNoDishesBefore,
  }) {
    if (!createdNewDish) {
      return 0;
    }
    if (createdNewRestaurant) {
      return 3;
    }
    return restaurantHadNoDishesBefore ? 3 : 1;
  }

  static String reviewMilestoneSourceKey({
    required String userId,
    required int milestone,
  }) {
    return 'review_milestone:${userId.trim()}:$milestone';
  }

  static String dishCreatedSourceKey(String dishId) {
    return 'dish_created:${dishId.trim()}';
  }

  static String dishImageAddedSourceKey({
    required String dishId,
    required String imageId,
  }) {
    return 'dish_image_added:${dishId.trim()}:${imageId.trim()}';
  }

  static String restaurantFirstDishSourceKey({
    required String restaurantId,
    required String dishId,
  }) {
    return 'restaurant_first_dish:${restaurantId.trim()}:${dishId.trim()}';
  }

  static String newRestaurantFirstDishSourceKey({
    required String restaurantId,
    required String dishId,
  }) {
    return 'new_restaurant_first_dish:${restaurantId.trim()}:${dishId.trim()}';
  }

  static String approvedProposalSourceKey({
    required String actionType,
    required String requestId,
  }) {
    return '$actionType:${requestId.trim()}';
  }

  static String approvedDishProposalDescription({
    required String actionType,
    String? dishName,
    String? oldValue,
    String? newValue,
    String? mergeSourceDishName,
    String? mergeTargetDishName,
  }) {
    final trimmedDishName = dishName?.trim();
    final trimmedOldValue = oldValue?.trim();
    final trimmedNewValue = newValue?.trim();
    final trimmedMergeSource = mergeSourceDishName?.trim();
    final trimmedMergeTarget = mergeTargetDishName?.trim();

    if (actionType == ContributionPointAction.dishMergeApproved) {
      if ((trimmedMergeSource ?? '').isNotEmpty &&
          (trimmedMergeTarget ?? '').isNotEmpty) {
        return 'Approved merge of $trimmedMergeSource into $trimmedMergeTarget';
      }
      return 'Approved dish merge contribution';
    }

    if (actionType == ContributionPointAction.dishRenameApproved) {
      if ((trimmedOldValue ?? '').isNotEmpty &&
          (trimmedNewValue ?? '').isNotEmpty) {
        return 'Approved dish rename: $trimmedOldValue -> $trimmedNewValue';
      }
      return 'Approved dish rename contribution';
    }

    if ((trimmedDishName ?? '').isNotEmpty) {
      return 'Approved dish information edit for $trimmedDishName';
    }
    return 'Approved dish edit contribution';
  }

  static bool isMeaningfulApprovedDishRename({
    required String currentName,
    required String currentNormalizedName,
    required String proposedName,
    required String proposedNormalizedName,
  }) {
    final trimmedCurrentName = currentName.trim();
    final trimmedProposedName = proposedName.trim();
    if (trimmedProposedName.isEmpty) {
      return false;
    }

    return trimmedCurrentName != trimmedProposedName ||
        currentNormalizedName.trim() != proposedNormalizedName.trim();
  }

  static String ledgerDocumentIdForSourceKey(String sourceKey) {
    return Uri.encodeComponent(sourceKey.trim());
  }

  static String reversalDocumentId(String ledgerEntryId) {
    return 'reversal:${Uri.encodeComponent(ledgerEntryId.trim())}';
  }

  static Future<int> loadContributionPointTotal(String userId) async {
    final snapshot = await userProfileDocument(userId).get();
    final value = snapshot.data()?['contributionPoints'];
    if (value is num) {
      return value.toInt();
    }
    return 0;
  }

  static Future<ContributionPointAwardResult> awardDishContribution({
    required String userId,
    required BitescoreDish dish,
    required BitescoreRestaurant restaurant,
    required bool createdNewRestaurant,
    required bool createdNewDish,
    required bool restaurantHadNoDishesBefore,
  }) async {
    final points = pointsForDishContribution(
      createdNewRestaurant: createdNewRestaurant,
      createdNewDish: createdNewDish,
      restaurantHadNoDishesBefore: restaurantHadNoDishesBefore,
    );
    if (points == 0) {
      return const ContributionPointAwardResult();
    }

    final sourceKey = createdNewRestaurant
        ? newRestaurantFirstDishSourceKey(
            restaurantId: restaurant.id,
            dishId: dish.id,
          )
        : restaurantHadNoDishesBefore
        ? restaurantFirstDishSourceKey(
            restaurantId: restaurant.id,
            dishId: dish.id,
          )
        : dishCreatedSourceKey(dish.id);
    final description = createdNewRestaurant
        ? 'Added a new restaurant and its first dish'
        : restaurantHadNoDishesBefore
        ? 'Added the first dish to an existing restaurant'
        : 'Added a dish to an existing restaurant';

    return awardPoints(
      ContributionPointAwardDraft(
        userId: userId,
        points: points,
        actionType: createdNewRestaurant
            ? ContributionPointAction.newRestaurantFirstDish
            : restaurantHadNoDishesBefore
            ? ContributionPointAction.restaurantFirstDish
            : ContributionPointAction.dishCreated,
        sourceKey: sourceKey,
        description: description,
        dishId: dish.id,
        dishName: dish.name,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantCity: restaurant.city,
        restaurantState: restaurant.state,
        restaurantAddress: restaurant.address,
        restaurantPhone: restaurant.phone,
      ),
    );
  }

  static Future<ContributionPointAwardResult> awardDishImage({
    required String userId,
    required String imageId,
    required BitescoreDish dish,
    required BitescoreRestaurant restaurant,
  }) async {
    return awardPoints(
      ContributionPointAwardDraft(
        userId: userId,
        points: 1,
        actionType: ContributionPointAction.dishImageAdded,
        sourceKey: dishImageAddedSourceKey(dishId: dish.id, imageId: imageId),
        description: 'Added a dish image',
        dishId: dish.id,
        dishName: dish.name,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantCity: restaurant.city,
        restaurantState: restaurant.state,
        restaurantAddress: restaurant.address,
        restaurantPhone: restaurant.phone,
        imageId: imageId,
      ),
    );
  }

  static Future<ContributionPointAwardResult>
  awardReviewMilestoneContributionPoints({
    required String userId,
    ContributionPointCallable? callable,
  }) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return const ContributionPointAwardResult();
    }

    final response = await (callable ?? _awardReviewMilestoneCallable)({
      'userId': trimmedUserId,
    });
    return ContributionPointAwardResult.fromCallableData(response);
  }

  static Future<ContributionPointAwardResult> awardDishImageContributionPoints({
    required String imageId,
    String? dishId,
    ContributionPointCallable? callable,
  }) async {
    final trimmedImageId = imageId.trim();
    final trimmedDishId = dishId?.trim();
    if (trimmedImageId.isEmpty) {
      return const ContributionPointAwardResult();
    }

    final response = await (callable ?? _awardDishImageCallable)({
      'imageId': trimmedImageId,
      if (trimmedDishId != null && trimmedDishId.isNotEmpty)
        'dishId': trimmedDishId,
    });
    return ContributionPointAwardResult.fromCallableData(response);
  }

  static Future<ContributionPointAwardResult>
  awardCreatedDishContributionPoints({
    required String restaurantId,
    required String dishId,
    required String reviewId,
    ContributionPointCallable? callable,
  }) async {
    final trimmedRestaurantId = restaurantId.trim();
    final trimmedDishId = dishId.trim();
    final trimmedReviewId = reviewId.trim();
    if (trimmedRestaurantId.isEmpty ||
        trimmedDishId.isEmpty ||
        trimmedReviewId.isEmpty) {
      return const ContributionPointAwardResult();
    }

    final response = await (callable ?? _awardCreatedDishCallable)({
      'restaurantId': trimmedRestaurantId,
      'dishId': trimmedDishId,
      'reviewId': trimmedReviewId,
    });
    return ContributionPointAwardResult.fromCallableData(response);
  }

  static Future<ContributionPointAwardResult> awardApprovedDishProposal({
    required DishEditProposal proposal,
    required BitescoreDish? dish,
    required BitescoreRestaurant? restaurant,
    String? oldValue,
    String? newValue,
    BitescoreDish? mergeSourceDish,
    BitescoreDish? mergeTargetDish,
  }) async {
    final actionType = proposal.isMerge
        ? ContributionPointAction.dishMergeApproved
        : proposal.isRename
        ? ContributionPointAction.dishRenameApproved
        : ContributionPointAction.dishEditApproved;
    final description = approvedDishProposalDescription(
      actionType: actionType,
      dishName: dish?.name ?? proposal.proposedName,
      oldValue: oldValue,
      newValue: newValue,
      mergeSourceDishName: mergeSourceDish?.name,
      mergeTargetDishName: mergeTargetDish?.name,
    );

    return awardPoints(
      ContributionPointAwardDraft(
        userId: proposal.userId,
        points: 1,
        actionType: actionType,
        sourceKey: approvedProposalSourceKey(
          actionType: actionType,
          requestId: proposal.id,
        ),
        description: description,
        dishId: proposal.targetDishId,
        dishName: dish?.name ?? proposal.proposedName,
        restaurantId: proposal.restaurantId,
        restaurantName: restaurant?.name,
        restaurantCity: restaurant?.city,
        restaurantState: restaurant?.state,
        restaurantAddress: restaurant?.address,
        restaurantPhone: restaurant?.phone,
        requestId: proposal.id,
        oldValue: oldValue,
        newValue: newValue,
        mergeSourceDishId: mergeSourceDish?.id,
        mergeSourceDishName: mergeSourceDish?.name,
        mergeTargetDishId: mergeTargetDish?.id,
        mergeTargetDishName: mergeTargetDish?.name,
      ),
    );
  }

  static Future<ContributionPointAwardResult>
  awardApprovedDishProposalContributionPoints({
    required String proposalId,
    String? oldValue,
    String? newValue,
    ContributionPointCallable? callable,
  }) async {
    final trimmedProposalId = proposalId.trim();
    final trimmedOldValue = oldValue?.trim();
    final trimmedNewValue = newValue?.trim();
    if (trimmedProposalId.isEmpty) {
      return const ContributionPointAwardResult();
    }

    final response = await (callable ?? _awardApprovedDishProposalCallable)({
      'proposalId': trimmedProposalId,
      if (trimmedOldValue != null && trimmedOldValue.isNotEmpty)
        'oldValue': trimmedOldValue,
      if (trimmedNewValue != null && trimmedNewValue.isNotEmpty)
        'newValue': trimmedNewValue,
    });
    return ContributionPointAwardResult.fromCallableData(response);
  }

  static Future<ContributionPointAwardResult> reconcileReviewMilestones({
    required String userId,
    required int validPublicReviewCount,
  }) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return const ContributionPointAwardResult();
    }

    final earnedMilestones = reviewMilestonesForCount(
      validPublicReviewCount,
    ).toSet();
    final awardResults = <ContributionPointAwardResult>[];
    for (final milestone in earnedMilestones) {
      awardResults.add(
        await awardPoints(
          ContributionPointAwardDraft(
            userId: trimmedUserId,
            points: 1,
            actionType: ContributionPointAction.reviewMilestone,
            sourceKey: reviewMilestoneSourceKey(
              userId: trimmedUserId,
              milestone: milestone,
            ),
            description: 'Reached $milestone valid public reviews',
          ),
        ),
      );
    }

    final snapshot = await ledgerCollection()
        .where('userId', isEqualTo: trimmedUserId)
        .where('actionType', isEqualTo: ContributionPointAction.reviewMilestone)
        .get();

    for (final doc in snapshot.docs) {
      final entry = ContributionPointLedgerEntry.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (entry == null ||
          entry.status != ContributionPointLedgerEntry.statusActive ||
          entry.pointsDelta <= 0) {
        continue;
      }
      final milestone = _milestoneFromSourceKey(entry.sourceKey);
      if (milestone != null && !earnedMilestones.contains(milestone)) {
        await reverseLedgerEntry(
          entry,
          reason: 'Valid public review count dropped below $milestone',
        );
      }
    }

    return ContributionPointAwardResult.combine(
      awardResults,
      actionGroupId: 'review_milestones:$trimmedUserId:$validPublicReviewCount',
    );
  }

  static Future<ContributionPointAwardResult> awardPoints(
    ContributionPointAwardDraft draft,
  ) async {
    if (draft.userId.trim().isEmpty || draft.points <= 0) {
      return const ContributionPointAwardResult();
    }

    final sourceKey = draft.sourceKey.trim();
    if (sourceKey.isEmpty) {
      return const ContributionPointAwardResult();
    }

    final documentId = ledgerDocumentIdForSourceKey(sourceKey);
    final entryRef = ledgerCollection().doc(documentId);
    final userRef = userProfileDocument(draft.userId);

    final createdEntryId = await _firestore.runTransaction<String?>((
      transaction,
    ) async {
      final existingSnapshot = await transaction.get(entryRef);
      if (existingSnapshot.exists) {
        final existing = ContributionPointLedgerEntry.tryFromFirestore(
          existingSnapshot.data(),
          fallbackId: existingSnapshot.id,
        );
        if (existing == null ||
            existing.status == ContributionPointLedgerEntry.statusActive) {
          return null;
        }

        final restoreRef = ledgerCollection().doc('restore:$documentId');
        final restoreSnapshot = await transaction.get(restoreRef);
        if (restoreSnapshot.exists) {
          return null;
        }
        transaction.set(restoreRef, {
          ..._entryMap(
            id: restoreRef.id,
            draft: draft,
            description: '${draft.description} restored',
          ),
          'originalLedgerEntryId': existing.id,
        });
        _incrementCachedTotal(transaction, userRef, draft.points);
        return restoreRef.id;
      }

      transaction.set(entryRef, _entryMap(id: entryRef.id, draft: draft));
      _incrementCachedTotal(transaction, userRef, draft.points);
      return entryRef.id;
    });

    if (createdEntryId == null) {
      return ContributionPointAwardResult(
        entries: <ContributionPointAwardEntryResult>[
          ContributionPointAwardEntryResult(
            ledgerEntryId: documentId,
            points: draft.points,
            wasCreated: false,
          ),
        ],
        actionGroupId: sourceKey,
      );
    }

    return ContributionPointAwardResult(
      entries: <ContributionPointAwardEntryResult>[
        ContributionPointAwardEntryResult(
          ledgerEntryId: createdEntryId,
          points: draft.points,
          wasCreated: true,
        ),
      ],
      actionGroupId: sourceKey,
    );
  }

  static Future<Object?> _awardReviewMilestoneCallable(
    Map<String, dynamic> payload,
  ) async {
    return _callContributionPointAwardFunction(
      'awardReviewMilestoneContributionPoints',
      payload,
    );
  }

  static Future<Object?> _awardDishImageCallable(
    Map<String, dynamic> payload,
  ) async {
    return _callContributionPointAwardFunction(
      'awardDishImageContributionPoints',
      payload,
    );
  }

  static Future<Object?> _awardCreatedDishCallable(
    Map<String, dynamic> payload,
  ) async {
    return _callContributionPointAwardFunction(
      'awardCreatedDishContributionPoints',
      payload,
    );
  }

  static Future<Object?> _awardApprovedDishProposalCallable(
    Map<String, dynamic> payload,
  ) async {
    return _callContributionPointAwardFunction(
      'awardApprovedDishProposalContributionPoints',
      payload,
    );
  }

  static Future<Object?> _markCelebratedLedgerEntriesCallable(
    Map<String, dynamic> payload,
  ) async {
    return _callContributionPointAwardFunction(
      'markContributionPointLedgerEntriesCelebrated',
      payload,
    );
  }

  static Future<Object?> _callContributionPointAwardFunction(
    String functionName,
    Map<String, dynamic> payload,
  ) async {
    final result = await _functions.httpsCallable(functionName).call(payload);
    return result.data;
  }

  static Future<void> reverseBySourceKey({
    required String sourceKey,
    required String reason,
  }) async {
    final entrySnapshot = await ledgerCollection()
        .doc(ledgerDocumentIdForSourceKey(sourceKey))
        .get();
    final entry = ContributionPointLedgerEntry.tryFromFirestore(
      entrySnapshot.data(),
      fallbackId: entrySnapshot.id,
    );
    if (entry != null) {
      await reverseLedgerEntry(entry, reason: reason);
    }
  }

  static Future<List<ContributionPointLedgerEntry>>
  loadUncelebratedPositiveLedgerEntries(String userId, {int limit = 30}) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return const <ContributionPointLedgerEntry>[];
    }

    final snapshot = await ledgerCollection()
        .where('userId', isEqualTo: trimmedUserId)
        .where('status', isEqualTo: ContributionPointLedgerEntry.statusActive)
        .where(
          'celebrationStatus',
          isEqualTo: ContributionPointLedgerEntry.celebrationStatusPending,
        )
        .get();
    final entries = snapshot.docs
        .map(
          (doc) => ContributionPointLedgerEntry.tryFromFirestore(
            doc.data(),
            fallbackId: doc.id,
          ),
        )
        .whereType<ContributionPointLedgerEntry>()
        .where((entry) => entry.pointsDelta > 0 && !entry.isReversal)
        .toList();
    entries.sort((a, b) {
      final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return aDate.compareTo(bDate);
    });
    return entries.take(limit).toList(growable: false);
  }

  static Future<ContributionPointCelebrationMarkResult>
  markCelebratedLedgerEntries({
    required String userId,
    required Iterable<String> ledgerEntryIds,
    ContributionPointCallable? callable,
  }) async {
    final trimmedUserId = userId.trim();
    final ids = ledgerEntryIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet();
    if (trimmedUserId.isEmpty || ids.isEmpty) {
      return ContributionPointCelebrationMarkResult(attemptedEntryIds: ids);
    }

    final response = await (callable ?? _markCelebratedLedgerEntriesCallable)({
      'ledgerEntryIds': ids.toList(growable: false),
    });
    return ContributionPointCelebrationMarkResult.fromCallableData(response);
  }

  static Future<void> reverseActiveEntriesForDish({
    required String dishId,
    required String reason,
  }) async {
    final snapshot = await ledgerCollection()
        .where('dishId', isEqualTo: dishId.trim())
        .where('status', isEqualTo: ContributionPointLedgerEntry.statusActive)
        .get();
    for (final doc in snapshot.docs) {
      final entry = ContributionPointLedgerEntry.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (entry != null && entry.pointsDelta > 0) {
        await reverseLedgerEntry(entry, reason: reason);
      }
    }
  }

  static Future<void> reverseLedgerEntry(
    ContributionPointLedgerEntry entry, {
    required String reason,
  }) async {
    if (entry.pointsDelta <= 0 ||
        entry.status != ContributionPointLedgerEntry.statusActive) {
      return;
    }

    final entryRef = ledgerCollection().doc(entry.id);
    final reversalRef = ledgerCollection().doc(reversalDocumentId(entry.id));
    final userRef = userProfileDocument(entry.userId);

    await _firestore.runTransaction((transaction) async {
      final freshEntrySnapshot = await transaction.get(entryRef);
      final freshEntry = ContributionPointLedgerEntry.tryFromFirestore(
        freshEntrySnapshot.data(),
        fallbackId: freshEntrySnapshot.id,
      );
      final reversalSnapshot = await transaction.get(reversalRef);
      if (freshEntry == null ||
          freshEntry.status != ContributionPointLedgerEntry.statusActive ||
          reversalSnapshot.exists) {
        return;
      }

      transaction.set(entryRef, {
        'status': ContributionPointLedgerEntry.statusReversed,
        'reversalLedgerEntryId': reversalRef.id,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      transaction.set(reversalRef, {
        'id': reversalRef.id,
        'userId': freshEntry.userId,
        'pointsDelta': -freshEntry.pointsDelta,
        'actionType': ContributionPointAction.contributionReversed,
        'sourceKey': 'reversal:${freshEntry.sourceKey}',
        'description': 'Points removed: ${freshEntry.description}',
        'status': ContributionPointLedgerEntry.statusReversal,
        'originalLedgerEntryId': freshEntry.id,
        'dishId': freshEntry.dishId,
        'dishName': freshEntry.dishName,
        'restaurantId': freshEntry.restaurantId,
        'restaurantName': freshEntry.restaurantName,
        'restaurantCity': freshEntry.restaurantCity,
        'restaurantState': freshEntry.restaurantState,
        'restaurantAddress': freshEntry.restaurantAddress,
        'restaurantPhone': freshEntry.restaurantPhone,
        'reviewId': freshEntry.reviewId,
        'requestId': freshEntry.requestId,
        'imageId': freshEntry.imageId,
        'oldValue': freshEntry.oldValue,
        'newValue': freshEntry.newValue,
        'mergeSourceDishId': freshEntry.mergeSourceDishId,
        'mergeSourceDishName': freshEntry.mergeSourceDishName,
        'mergeTargetDishId': freshEntry.mergeTargetDishId,
        'mergeTargetDishName': freshEntry.mergeTargetDishName,
        'reason': reason.trim(),
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
      _incrementCachedTotal(transaction, userRef, -freshEntry.pointsDelta);
    });
  }

  static Future<List<ContributionPointUserSummary>> loadUserPointSummaries({
    ContributionPointSort sort = ContributionPointSort.mostPoints,
  }) async {
    _requireSignedInAdminUser(operation: 'load_user_points_for_admin');

    final userProfilesSnapshot = await _firestore
        .collection('user_profiles')
        .get();
    final publicProfilesSnapshot = await publicReviewerProfilesCollection()
        .get();
    final displayNamesByUserId = <String, String>{};
    for (final doc in publicProfilesSnapshot.docs) {
      final data = doc.data();
      final userId = _readString(data['userId']) ?? doc.id;
      final displayName =
          _readString(data['publicDisplayName']) ??
          _readString(data['chosenUsername']) ??
          _readString(data['fallbackUsername']);
      if (displayName != null) {
        displayNamesByUserId[userId] = displayName;
      }
    }

    final summaries = <ContributionPointUserSummary>[];
    for (final doc in userProfilesSnapshot.docs) {
      final data = doc.data();
      final total = _readInt(data['contributionPoints']) ?? 0;
      if (total == 0 && data['lastContributionAt'] == null) {
        continue;
      }
      final userId = _readString(data['userId']) ?? doc.id;
      final displayName =
          displayNamesByUserId[userId] ??
          _readString(data['displayName']) ??
          userId;
      summaries.add(
        ContributionPointUserSummary(
          userId: userId,
          displayName: displayName,
          totalPoints: total,
          lastActivityAt: _readDateTime(data['lastContributionAt']),
        ),
      );
    }

    return sortUserPointSummaries(summaries, sort);
  }

  static Future<List<ContributionPointLedgerEntry>> loadLedgerForAdmin(
    String userId, {
    int limit = 50,
  }) async {
    _requireSignedInAdminUser(operation: 'load_user_point_ledger_for_admin');

    final snapshot = await ledgerCollection()
        .where('userId', isEqualTo: userId.trim())
        .get();
    final entries = snapshot.docs
        .map(
          (doc) => ContributionPointLedgerEntry.tryFromFirestore(
            doc.data(),
            fallbackId: doc.id,
          ),
        )
        .whereType<ContributionPointLedgerEntry>()
        .toList();
    entries.sort((a, b) {
      final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return bDate.compareTo(aDate);
    });
    return entries.take(limit).toList();
  }

  static Map<String, dynamic> _entryMap({
    required String id,
    required ContributionPointAwardDraft draft,
    String? description,
  }) {
    return {
      'id': id.trim(),
      'userId': draft.userId.trim(),
      'pointsDelta': draft.points,
      'actionType': draft.actionType.trim(),
      'sourceKey': draft.sourceKey.trim(),
      'description': (description ?? draft.description).trim(),
      'status': ContributionPointLedgerEntry.statusActive,
      if (draft.points > 0)
        'celebrationStatus':
            ContributionPointLedgerEntry.celebrationStatusPending,
      'dishId': draft.dishId?.trim(),
      'dishName': draft.dishName?.trim(),
      'restaurantId': draft.restaurantId?.trim(),
      'restaurantName': draft.restaurantName?.trim(),
      'restaurantCity': draft.restaurantCity?.trim(),
      'restaurantState': draft.restaurantState?.trim(),
      'restaurantAddress': draft.restaurantAddress?.trim(),
      'restaurantPhone': draft.restaurantPhone?.trim(),
      'reviewId': draft.reviewId?.trim(),
      'requestId': draft.requestId?.trim(),
      'imageId': draft.imageId?.trim(),
      'oldValue': draft.oldValue?.trim(),
      'newValue': draft.newValue?.trim(),
      'mergeSourceDishId': draft.mergeSourceDishId?.trim(),
      'mergeSourceDishName': draft.mergeSourceDishName?.trim(),
      'mergeTargetDishId': draft.mergeTargetDishId?.trim(),
      'mergeTargetDishName': draft.mergeTargetDishName?.trim(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  static void _incrementCachedTotal(
    Transaction transaction,
    DocumentReference<Map<String, dynamic>> userRef,
    int delta,
  ) {
    transaction.set(userRef, {
      'userId': userRef.id,
      'contributionPoints': FieldValue.increment(delta),
      'lastContributionAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static User _requireSignedInAdminUser({required String operation}) {
    assert(operation.isNotEmpty);
    final user = FirebaseAuth.instance.currentUser;
    if (user == null ||
        user.isAnonymous ||
        !AdminAccessService.isAdminUser(user)) {
      throw ArgumentError('You do not have permission to do that.');
    }
    return user;
  }

  static int? _milestoneFromSourceKey(String sourceKey) {
    final parts = sourceKey.split(':');
    if (parts.length < 3 ||
        parts.first != ContributionPointAction.reviewMilestone) {
      return null;
    }
    return int.tryParse(parts.last);
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    return null;
  }

  static int? _readInt(dynamic value) {
    if (value is num) {
      return value.toInt();
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
