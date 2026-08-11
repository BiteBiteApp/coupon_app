import 'package:flutter/foundation.dart';

const String dishProposalActionContractVersion =
    'bitestar.dish-proposal-action.v1';
const String dishProposalActionResultContractVersion =
    'bitestar.dish-proposal-action-result.v1';

const int _maximumSafeJsonInteger = 9007199254740991;
const int _maximumDateTimeMilliseconds = 8640000000000000;
const int _dishSuggestionAutomaticDelayMilliseconds = 3 * 24 * 60 * 60 * 1000;

enum RatingAdminDishSuggestionType {
  rename('rename'),
  merge('merge');

  const RatingAdminDishSuggestionType(this.wireName);

  final String wireName;

  static RatingAdminDishSuggestionType parse(Object? value) {
    return switch (value) {
      'rename' => RatingAdminDishSuggestionType.rename,
      'merge' => RatingAdminDishSuggestionType.merge,
      _ => throw const FormatException('Invalid Rating Admin dish suggestion.'),
    };
  }
}

enum RatingAdminDishSuggestionResolutionState {
  idle('idle'),
  applying('applying'),
  rejecting('rejecting'),
  retryable('retryable'),
  manualReviewRequired('manual_review_required'),
  complete('complete');

  const RatingAdminDishSuggestionResolutionState(this.wireName);

  final String wireName;

  static RatingAdminDishSuggestionResolutionState parse(Object? value) {
    return RatingAdminDishSuggestionResolutionState.values.firstWhere(
      (state) => state.wireName == value,
      orElse: () =>
          throw const FormatException('Invalid Rating Admin dish suggestion.'),
    );
  }
}

enum RatingAdminDishSuggestionResolutionType {
  apply('apply'),
  reject('reject');

  const RatingAdminDishSuggestionResolutionType(this.wireName);

  final String wireName;

  static RatingAdminDishSuggestionResolutionType? parseNullable(Object? value) {
    if (value == null) {
      return null;
    }
    return switch (value) {
      'apply' => RatingAdminDishSuggestionResolutionType.apply,
      'reject' => RatingAdminDishSuggestionResolutionType.reject,
      _ => throw const FormatException(
        'Invalid Rating Admin dish suggestion action result.',
      ),
    };
  }
}

enum RatingAdminDishSuggestionActionStatus {
  idle('idle'),
  applying('applying'),
  rejecting('rejecting'),
  retryable('retryable'),
  manualReviewRequired('manual_review_required'),
  complete('complete'),
  stale('stale'),
  notActionable('not_actionable');

  const RatingAdminDishSuggestionActionStatus(this.wireName);

  final String wireName;

  static RatingAdminDishSuggestionActionStatus parse(Object? value) {
    return RatingAdminDishSuggestionActionStatus.values.firstWhere(
      (status) => status.wireName == value,
      orElse: () => throw const FormatException(
        'Invalid Rating Admin dish suggestion action result.',
      ),
    );
  }
}

enum RatingAdminDishSuggestionMessageCategory {
  acceptedProcessing('accepted_processing'),
  acceptedComplete('accepted_complete'),
  alreadyProcessing('already_processing'),
  staleGroup('stale_group'),
  notActionable('not_actionable'),
  manualReviewRequired('manual_review_required'),
  retryableProcessing('retryable_processing');

  const RatingAdminDishSuggestionMessageCategory(this.wireName);

  final String wireName;

  static RatingAdminDishSuggestionMessageCategory parse(Object? value) {
    return RatingAdminDishSuggestionMessageCategory.values.firstWhere(
      (category) => category.wireName == value,
      orElse: () => throw const FormatException(
        'Invalid Rating Admin dish suggestion action result.',
      ),
    );
  }
}

Map<String, Object?> _requireMap(Object? value, String message) {
  if (value is! Map) {
    throw FormatException(message);
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw FormatException(message);
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _requireExactKeys(
  Map<String, Object?> value,
  Set<String> required,
  String message,
) {
  if (value.length != required.length ||
      !value.keys.toSet().containsAll(required)) {
    throw FormatException(message);
  }
}

String _requireString(
  Object? value,
  String message, {
  int? maximumLength = 1500,
}) {
  if (value is! String ||
      value.isEmpty ||
      (maximumLength != null && value.length > maximumLength) ||
      value.trim() != value) {
    throw FormatException(message);
  }
  return value;
}

String? _nullableString(
  Object? value,
  String message, {
  int? maximumLength = 1500,
}) {
  return value == null
      ? null
      : _requireString(value, message, maximumLength: maximumLength);
}

bool _requireBool(Object? value, String message) {
  if (value is! bool) {
    throw FormatException(message);
  }
  return value;
}

int _requireSafeInteger(
  Object? value,
  String message, {
  int maximum = _maximumSafeJsonInteger,
}) {
  if (value is! int || value < 0 || value > maximum) {
    throw FormatException(message);
  }
  return value;
}

int? _nullableTimestamp(Object? value, String message) {
  return value == null
      ? null
      : _requireSafeInteger(
          value,
          message,
          maximum: _maximumDateTimeMilliseconds,
        );
}

@immutable
class RatingAdminDishSummary {
  const RatingAdminDishSummary({
    required this.id,
    required this.restaurantId,
    required this.restaurantName,
    required this.name,
    required this.isActive,
    required this.mergedIntoDishId,
  });

  factory RatingAdminDishSummary.fromJson(Object? value) {
    const message = 'Invalid Rating Admin dish summary.';
    final data = _requireMap(value, message);
    _requireExactKeys(data, <String>{
      'id',
      'restaurantId',
      'restaurantName',
      'name',
      'isActive',
      'mergedIntoDishId',
    }, message);
    return RatingAdminDishSummary(
      id: _requireString(data['id'], message),
      restaurantId: _requireString(data['restaurantId'], message),
      restaurantName: _requireString(
        data['restaurantName'],
        message,
        maximumLength: 500,
      ),
      name: _requireString(data['name'], message, maximumLength: 500),
      isActive: _requireBool(data['isActive'], message),
      mergedIntoDishId: _nullableString(data['mergedIntoDishId'], message),
    );
  }

  final String id;
  final String restaurantId;
  final String restaurantName;
  final String name;
  final bool isActive;
  final String? mergedIntoDishId;

  bool get isMerged => mergedIntoDishId != null;
}

@immutable
class RatingAdminDishSuggestionRestaurantSummary {
  const RatingAdminDishSuggestionRestaurantSummary({
    required this.id,
    required this.name,
  });

  factory RatingAdminDishSuggestionRestaurantSummary.fromJson(Object? value) {
    const message = 'Invalid Rating Admin dish suggestion restaurant.';
    final data = _requireMap(value, message);
    _requireExactKeys(data, <String>{'id', 'name'}, message);
    return RatingAdminDishSuggestionRestaurantSummary(
      id: _requireString(data['id'], message),
      name: _requireString(data['name'], message, maximumLength: 500),
    );
  }

  final String id;
  final String name;
}

@immutable
class RatingAdminDishSuggestionRecord {
  const RatingAdminDishSuggestionRecord({
    required this.groupId,
    required this.fingerprint,
    required this.membershipGeneration,
    required this.resolutionSequence,
    required this.proposalType,
    required this.restaurantId,
    required this.sourceDishId,
    required this.mergeTargetDishId,
    required this.proposedDisplayName,
    required this.hasPendingMembers,
    required this.oldestTrustedProposalTimeMillis,
    required this.dueAtMillis,
    required this.dueNow,
    required this.enoughSupporters,
    required this.autoEligible,
    required this.resolutionState,
    required this.supporterCount,
    required this.sourceDish,
    required this.mergeTargetDish,
    required this.restaurant,
  });

  factory RatingAdminDishSuggestionRecord.fromJson(Object? value) {
    const message = 'Invalid Rating Admin dish suggestion.';
    final data = _requireMap(value, message);
    _requireExactKeys(data, <String>{
      'groupId',
      'fingerprint',
      'membershipGeneration',
      'resolutionSequence',
      'proposalType',
      'restaurantId',
      'sourceDishId',
      'mergeTargetDishId',
      'proposedDisplayName',
      'hasPendingMembers',
      'oldestTrustedProposalTimeMillis',
      'dueAtMillis',
      'dueNow',
      'enoughSupporters',
      'autoEligible',
      'resolutionState',
      'supporterCount',
      'sourceDish',
      'mergeTargetDish',
      'restaurant',
    }, message);

    final proposalType = RatingAdminDishSuggestionType.parse(
      data['proposalType'],
    );
    final groupId = _requireString(data['groupId'], message, maximumLength: 64);
    final fingerprint = _requireString(
      data['fingerprint'],
      message,
      maximumLength: 64,
    );
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(groupId) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint)) {
      throw const FormatException(message);
    }
    final restaurantId = _requireString(data['restaurantId'], message);
    final sourceDishId = _requireString(data['sourceDishId'], message);
    final mergeTargetDishId = _nullableString(
      data['mergeTargetDishId'],
      message,
    );
    final proposedDisplayName = _nullableString(
      data['proposedDisplayName'],
      message,
      maximumLength: null,
    );
    if ((proposalType == RatingAdminDishSuggestionType.rename &&
            mergeTargetDishId != null) ||
        (proposalType == RatingAdminDishSuggestionType.merge &&
            proposedDisplayName != null)) {
      throw const FormatException(message);
    }

    final sourceDish = data['sourceDish'] == null
        ? null
        : RatingAdminDishSummary.fromJson(data['sourceDish']);
    final mergeTargetDish = data['mergeTargetDish'] == null
        ? null
        : RatingAdminDishSummary.fromJson(data['mergeTargetDish']);
    final restaurant = data['restaurant'] == null
        ? null
        : RatingAdminDishSuggestionRestaurantSummary.fromJson(
            data['restaurant'],
          );
    if ((sourceDish != null && sourceDish.id != sourceDishId) ||
        (mergeTargetDish != null && mergeTargetDish.id != mergeTargetDishId) ||
        (restaurant != null && restaurant.id != restaurantId)) {
      throw const FormatException(message);
    }

    final hasPendingMembers = _requireBool(data['hasPendingMembers'], message);
    final oldestTrustedProposalTimeMillis = _nullableTimestamp(
      data['oldestTrustedProposalTimeMillis'],
      message,
    );
    final dueAtMillis = _nullableTimestamp(data['dueAtMillis'], message);
    final dueNow = _requireBool(data['dueNow'], message);
    final enoughSupporters = _requireBool(data['enoughSupporters'], message);
    final autoEligible = _requireBool(data['autoEligible'], message);
    final resolutionState = RatingAdminDishSuggestionResolutionState.parse(
      data['resolutionState'],
    );
    if (hasPendingMembers != (oldestTrustedProposalTimeMillis != null) ||
        hasPendingMembers != (dueAtMillis != null) ||
        (oldestTrustedProposalTimeMillis != null &&
            dueAtMillis !=
                oldestTrustedProposalTimeMillis +
                    _dishSuggestionAutomaticDelayMilliseconds) ||
        (dueNow && dueAtMillis == null) ||
        autoEligible !=
            (enoughSupporters &&
                resolutionState ==
                    RatingAdminDishSuggestionResolutionState.idle) ||
        (resolutionState == RatingAdminDishSuggestionResolutionState.idle &&
            !hasPendingMembers)) {
      throw const FormatException(message);
    }

    return RatingAdminDishSuggestionRecord(
      groupId: groupId,
      fingerprint: fingerprint,
      membershipGeneration: _requireSafeInteger(
        data['membershipGeneration'],
        message,
      ),
      resolutionSequence: _requireSafeInteger(
        data['resolutionSequence'],
        message,
      ),
      proposalType: proposalType,
      restaurantId: restaurantId,
      sourceDishId: sourceDishId,
      mergeTargetDishId: mergeTargetDishId,
      proposedDisplayName: proposedDisplayName,
      hasPendingMembers: hasPendingMembers,
      oldestTrustedProposalTimeMillis: oldestTrustedProposalTimeMillis,
      dueAtMillis: dueAtMillis,
      dueNow: dueNow,
      enoughSupporters: enoughSupporters,
      autoEligible: autoEligible,
      resolutionState: resolutionState,
      supporterCount: _requireSafeInteger(data['supporterCount'], message),
      sourceDish: sourceDish,
      mergeTargetDish: mergeTargetDish,
      restaurant: restaurant,
    );
  }

  final String groupId;
  final String fingerprint;
  final int membershipGeneration;
  final int resolutionSequence;
  final RatingAdminDishSuggestionType proposalType;
  final String restaurantId;
  final String sourceDishId;
  final String? mergeTargetDishId;
  final String? proposedDisplayName;
  final bool hasPendingMembers;
  final int? oldestTrustedProposalTimeMillis;
  final int? dueAtMillis;
  final bool dueNow;
  final bool enoughSupporters;
  final bool autoEligible;
  final RatingAdminDishSuggestionResolutionState resolutionState;
  final int supporterCount;
  final RatingAdminDishSummary? sourceDish;
  final RatingAdminDishSummary? mergeTargetDish;
  final RatingAdminDishSuggestionRestaurantSummary? restaurant;

  bool get isRename => proposalType == RatingAdminDishSuggestionType.rename;
  bool get isMerge => proposalType == RatingAdminDishSuggestionType.merge;
  bool get isActionable =>
      hasPendingMembers &&
      resolutionState == RatingAdminDishSuggestionResolutionState.idle;
  DateTime? get oldestTrustedProposalTime =>
      oldestTrustedProposalTimeMillis == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(oldestTrustedProposalTimeMillis!);
  DateTime? get dueAt => dueAtMillis == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(dueAtMillis!);

  String get actionIdentity =>
      '$groupId:$fingerprint:$membershipGeneration:$resolutionSequence';
}

@immutable
class RatingAdminDishSuggestionActionRequest {
  factory RatingAdminDishSuggestionActionRequest({
    required String groupId,
    required String expectedFingerprint,
    required int expectedMembershipGeneration,
    required int expectedResolutionSequence,
    required String clientRequestId,
  }) {
    const message = 'Invalid Rating Admin dish suggestion action.';
    final validatedGroupId = _requireString(
      groupId,
      message,
      maximumLength: 64,
    );
    final validatedFingerprint = _requireString(
      expectedFingerprint,
      message,
      maximumLength: 64,
    );
    final validatedRequestId = _requireString(
      clientRequestId,
      message,
      maximumLength: 128,
    );
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(validatedGroupId) ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(validatedFingerprint) ||
        !RegExp(
          r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
        ).hasMatch(validatedRequestId)) {
      throw const FormatException(message);
    }
    return RatingAdminDishSuggestionActionRequest._(
      groupId: validatedGroupId,
      expectedFingerprint: validatedFingerprint,
      expectedMembershipGeneration: _requireSafeInteger(
        expectedMembershipGeneration,
        message,
      ),
      expectedResolutionSequence: _requireSafeInteger(
        expectedResolutionSequence,
        message,
      ),
      clientRequestId: validatedRequestId,
    );
  }

  const RatingAdminDishSuggestionActionRequest._({
    required this.groupId,
    required this.expectedFingerprint,
    required this.expectedMembershipGeneration,
    required this.expectedResolutionSequence,
    required this.clientRequestId,
  });

  factory RatingAdminDishSuggestionActionRequest.forRecord({
    required RatingAdminDishSuggestionRecord record,
    required String clientRequestId,
  }) {
    const message = 'Invalid Rating Admin dish suggestion action.';
    return RatingAdminDishSuggestionActionRequest(
      groupId: _requireString(record.groupId, message),
      expectedFingerprint: _requireString(
        record.fingerprint,
        message,
        maximumLength: 64,
      ),
      expectedMembershipGeneration: _requireSafeInteger(
        record.membershipGeneration,
        message,
      ),
      expectedResolutionSequence: _requireSafeInteger(
        record.resolutionSequence,
        message,
      ),
      clientRequestId: _requireString(
        clientRequestId,
        message,
        maximumLength: 128,
      ),
    );
  }

  final String groupId;
  final String expectedFingerprint;
  final int expectedMembershipGeneration;
  final int expectedResolutionSequence;
  final String clientRequestId;

  Map<String, Object?> toJson() => <String, Object?>{
    'contractVersion': dishProposalActionContractVersion,
    'groupId': groupId,
    'expectedFingerprint': expectedFingerprint,
    'expectedMembershipGeneration': expectedMembershipGeneration,
    'expectedResolutionSequence': expectedResolutionSequence,
    'clientRequestId': clientRequestId,
  };
}

@immutable
class RatingAdminDishSuggestionActionResult {
  const RatingAdminDishSuggestionActionResult({
    required this.accepted,
    required this.status,
    required this.resolutionType,
    required this.processing,
    required this.complete,
    required this.manualReviewRequired,
    required this.messageCategory,
  });

  factory RatingAdminDishSuggestionActionResult.fromJson(Object? value) {
    const message = 'Invalid Rating Admin dish suggestion action result.';
    final data = _requireMap(value, message);
    _requireExactKeys(data, <String>{
      'contractVersion',
      'accepted',
      'status',
      'resolutionType',
      'processing',
      'complete',
      'manualReviewRequired',
      'messageCategory',
    }, message);
    if (data['contractVersion'] != dishProposalActionResultContractVersion) {
      throw const FormatException(message);
    }
    final accepted = _requireBool(data['accepted'], message);
    final status = RatingAdminDishSuggestionActionStatus.parse(data['status']);
    final resolutionType =
        RatingAdminDishSuggestionResolutionType.parseNullable(
          data['resolutionType'],
        );
    final processing = _requireBool(data['processing'], message);
    final complete = _requireBool(data['complete'], message);
    final manualReviewRequired = _requireBool(
      data['manualReviewRequired'],
      message,
    );
    final messageCategory = RatingAdminDishSuggestionMessageCategory.parse(
      data['messageCategory'],
    );
    final expectedProcessing =
        status == RatingAdminDishSuggestionActionStatus.applying ||
        status == RatingAdminDishSuggestionActionStatus.rejecting ||
        status == RatingAdminDishSuggestionActionStatus.retryable;
    final resolutionTypeMatches = switch (status) {
      RatingAdminDishSuggestionActionStatus.applying =>
        resolutionType == RatingAdminDishSuggestionResolutionType.apply,
      RatingAdminDishSuggestionActionStatus.rejecting =>
        resolutionType == RatingAdminDishSuggestionResolutionType.reject,
      RatingAdminDishSuggestionActionStatus.retryable ||
      RatingAdminDishSuggestionActionStatus.manualReviewRequired ||
      RatingAdminDishSuggestionActionStatus.complete => resolutionType != null,
      RatingAdminDishSuggestionActionStatus.idle ||
      RatingAdminDishSuggestionActionStatus.stale ||
      RatingAdminDishSuggestionActionStatus.notActionable =>
        resolutionType == null,
    };
    if (complete !=
            (status == RatingAdminDishSuggestionActionStatus.complete) ||
        manualReviewRequired !=
            (status ==
                RatingAdminDishSuggestionActionStatus.manualReviewRequired) ||
        processing != expectedProcessing ||
        !resolutionTypeMatches ||
        !_messageCategoryMatches(
          accepted: accepted,
          status: status,
          processing: processing,
          complete: complete,
          messageCategory: messageCategory,
        )) {
      throw const FormatException(message);
    }
    return RatingAdminDishSuggestionActionResult(
      accepted: accepted,
      status: status,
      resolutionType: resolutionType,
      processing: processing,
      complete: complete,
      manualReviewRequired: manualReviewRequired,
      messageCategory: messageCategory,
    );
  }

  final bool accepted;
  final RatingAdminDishSuggestionActionStatus status;
  final RatingAdminDishSuggestionResolutionType? resolutionType;
  final bool processing;
  final bool complete;
  final bool manualReviewRequired;
  final RatingAdminDishSuggestionMessageCategory messageCategory;
}

bool _messageCategoryMatches({
  required bool accepted,
  required RatingAdminDishSuggestionActionStatus status,
  required bool processing,
  required bool complete,
  required RatingAdminDishSuggestionMessageCategory messageCategory,
}) {
  return switch (messageCategory) {
    RatingAdminDishSuggestionMessageCategory.acceptedProcessing =>
      accepted &&
          processing &&
          (status == RatingAdminDishSuggestionActionStatus.applying ||
              status == RatingAdminDishSuggestionActionStatus.rejecting),
    RatingAdminDishSuggestionMessageCategory.acceptedComplete =>
      accepted && complete,
    RatingAdminDishSuggestionMessageCategory.alreadyProcessing =>
      !accepted &&
          processing &&
          (status == RatingAdminDishSuggestionActionStatus.applying ||
              status == RatingAdminDishSuggestionActionStatus.rejecting),
    RatingAdminDishSuggestionMessageCategory.staleGroup =>
      !accepted && status == RatingAdminDishSuggestionActionStatus.stale,
    RatingAdminDishSuggestionMessageCategory.notActionable =>
      !accepted &&
          (status == RatingAdminDishSuggestionActionStatus.notActionable ||
              status == RatingAdminDishSuggestionActionStatus.idle),
    RatingAdminDishSuggestionMessageCategory.manualReviewRequired =>
      status == RatingAdminDishSuggestionActionStatus.manualReviewRequired,
    RatingAdminDishSuggestionMessageCategory.retryableProcessing =>
      status == RatingAdminDishSuggestionActionStatus.retryable,
  };
}
