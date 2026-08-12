import 'package:flutter/foundation.dart';

const String ratingDestructiveCallableContractVersion =
    'bitestar.rating-destructive-callable.v1';
const String ratingDestructiveSummaryContractVersion =
    'bitestar.rating-destructive-summary.v1';
const int ratingDestructiveAdminPageSize = 25;

class RatingDestructiveProtocolException extends FormatException {
  const RatingDestructiveProtocolException()
    : super('The Rating destructive-operation response is invalid.');
}

enum RatingDestructiveOperation {
  restaurantMerge('restaurantMerge', 'Restaurant merge'),
  restaurantDelete('restaurantDelete', 'Restaurant delete'),
  dishMerge('dishMerge', 'Dish merge'),
  dishDelete('dishDelete', 'Dish delete');

  const RatingDestructiveOperation(this.wireName, this.label);

  final String wireName;
  final String label;

  static RatingDestructiveOperation parse(Object? value) {
    for (final operation in values) {
      if (operation.wireName == value) return operation;
    }
    throw const RatingDestructiveProtocolException();
  }
}

enum RatingDestructiveStatus {
  active('active', 'Processing'),
  retryable('retryable', 'Temporarily delayed'),
  manualReviewRequired('manual_review_required', 'Needs attention'),
  complete('complete', 'Complete');

  const RatingDestructiveStatus(this.wireName, this.label);

  final String wireName;
  final String label;

  static RatingDestructiveStatus parse(Object? value) {
    for (final status in values) {
      if (status.wireName == value) return status;
    }
    throw const RatingDestructiveProtocolException();
  }
}

enum RatingDestructiveProgressCategory {
  starting('starting', 'Preparing the operation'),
  movingData('moving_data', 'Moving related data'),
  rebuilding('rebuilding', 'Rebuilding totals'),
  cleaningUp('cleaning_up', 'Cleaning up related data'),
  finalizing('finalizing', 'Finalizing changes'),
  waitingRetry('waiting_retry', 'Waiting for automatic retry'),
  needsAttention('needs_attention', 'Paused and protected'),
  complete('complete', 'Finished');

  const RatingDestructiveProgressCategory(this.wireName, this.label);

  final String wireName;
  final String label;

  static RatingDestructiveProgressCategory parse(Object? value) {
    for (final category in values) {
      if (category.wireName == value) return category;
    }
    throw const RatingDestructiveProtocolException();
  }
}

enum RatingDestructiveMessageCategory {
  acceptedProcessing('accepted_processing'),
  alreadyProcessing('already_processing'),
  acceptedComplete('accepted_complete'),
  retryableProcessing('retryable_processing'),
  manualReviewRequired('manual_review_required'),
  currentStatus('current_status');

  const RatingDestructiveMessageCategory(this.wireName);

  final String wireName;

  static RatingDestructiveMessageCategory parse(Object? value) {
    for (final category in values) {
      if (category.wireName == value) return category;
    }
    throw const RatingDestructiveProtocolException();
  }
}

Map<String, Object?> _strictMap(Object? value) {
  if (value is! Map) {
    throw const RatingDestructiveProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const RatingDestructiveProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _requireExactKeys(Map<String, Object?> value, Set<String> keys) {
  if (!setEquals(value.keys.toSet(), keys)) {
    throw const RatingDestructiveProtocolException();
  }
}

String _requiredString(Object? value, {int maximumLength = 1500}) {
  if (value is! String ||
      value.isEmpty ||
      value.length > maximumLength ||
      value == '.' ||
      value == '..' ||
      value.contains('/')) {
    throw const RatingDestructiveProtocolException();
  }
  return value;
}

String? _nullableString(Object? value, {int maximumLength = 1500}) {
  if (value == null) return null;
  return _requiredString(value, maximumLength: maximumLength);
}

String? _nullableDisplayName(Object? value) {
  if (value == null) return null;
  if (value is! String ||
      value.isEmpty ||
      value.length > 300 ||
      value.trim() != value) {
    throw const RatingDestructiveProtocolException();
  }
  return value;
}

String _requiredOperationId(Object? value) {
  final parsed = _requiredString(value, maximumLength: 64);
  if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(parsed)) {
    throw const RatingDestructiveProtocolException();
  }
  return parsed;
}

bool _requiredBool(Object? value) {
  if (value is! bool) {
    throw const RatingDestructiveProtocolException();
  }
  return value;
}

int _requiredSafeInteger(Object? value) {
  if (value is! int || value < 0 || value > 9007199254740991) {
    throw const RatingDestructiveProtocolException();
  }
  return value;
}

@immutable
class RatingDestructiveOperationSummary {
  const RatingDestructiveOperationSummary._({
    required this.accepted,
    required this.operationId,
    required this.operation,
    required this.status,
    required this.progressCategory,
    required this.processing,
    required this.complete,
    required this.retryable,
    required this.manualReviewRequired,
    required this.messageCategory,
    required this.processedCount,
    required this.phaseProcessedCount,
    required this.createdAtMs,
    required this.updatedAtMs,
  });

  factory RatingDestructiveOperationSummary.fromJson(Object? value) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'contractVersion',
      'accepted',
      'operationId',
      'operation',
      'status',
      'progressCategory',
      'processing',
      'complete',
      'retryable',
      'manualReviewRequired',
      'messageCategory',
      'processedCount',
      'phaseProcessedCount',
      'createdAtMs',
      'updatedAtMs',
    });
    if (data['contractVersion'] != ratingDestructiveSummaryContractVersion) {
      throw const RatingDestructiveProtocolException();
    }
    final status = RatingDestructiveStatus.parse(data['status']);
    final progress = RatingDestructiveProgressCategory.parse(
      data['progressCategory'],
    );
    final accepted = _requiredBool(data['accepted']);
    final processing = _requiredBool(data['processing']);
    final complete = _requiredBool(data['complete']);
    final retryable = _requiredBool(data['retryable']);
    final manualReviewRequired = _requiredBool(data['manualReviewRequired']);
    final messageCategory = RatingDestructiveMessageCategory.parse(
      data['messageCategory'],
    );
    final createdAtMs = _requiredSafeInteger(data['createdAtMs']);
    final updatedAtMs = _requiredSafeInteger(data['updatedAtMs']);
    final validFlags =
        complete == (status == RatingDestructiveStatus.complete) &&
        retryable == (status == RatingDestructiveStatus.retryable) &&
        manualReviewRequired ==
            (status == RatingDestructiveStatus.manualReviewRequired) &&
        processing ==
            (status == RatingDestructiveStatus.active ||
                status == RatingDestructiveStatus.retryable) &&
        updatedAtMs >= createdAtMs &&
        (status == RatingDestructiveStatus.complete
            ? progress == RatingDestructiveProgressCategory.complete
            : true) &&
        (status == RatingDestructiveStatus.retryable
            ? progress == RatingDestructiveProgressCategory.waitingRetry
            : true) &&
        (status == RatingDestructiveStatus.manualReviewRequired
            ? progress == RatingDestructiveProgressCategory.needsAttention
            : true) &&
        switch (messageCategory) {
          RatingDestructiveMessageCategory.acceptedProcessing =>
            accepted && status == RatingDestructiveStatus.active,
          RatingDestructiveMessageCategory.alreadyProcessing =>
            !accepted && status == RatingDestructiveStatus.active,
          RatingDestructiveMessageCategory.acceptedComplete => complete,
          RatingDestructiveMessageCategory.retryableProcessing => retryable,
          RatingDestructiveMessageCategory.manualReviewRequired =>
            manualReviewRequired,
          RatingDestructiveMessageCategory.currentStatus => !accepted,
        };
    if (!validFlags) {
      throw const RatingDestructiveProtocolException();
    }
    return RatingDestructiveOperationSummary._(
      accepted: accepted,
      operationId: _requiredOperationId(data['operationId']),
      operation: RatingDestructiveOperation.parse(data['operation']),
      status: status,
      progressCategory: progress,
      processing: processing,
      complete: complete,
      retryable: retryable,
      manualReviewRequired: manualReviewRequired,
      messageCategory: messageCategory,
      processedCount: _requiredSafeInteger(data['processedCount']),
      phaseProcessedCount: _requiredSafeInteger(data['phaseProcessedCount']),
      createdAtMs: createdAtMs,
      updatedAtMs: updatedAtMs,
    );
  }

  final bool accepted;
  final String operationId;
  final RatingDestructiveOperation operation;
  final RatingDestructiveStatus status;
  final RatingDestructiveProgressCategory progressCategory;
  final bool processing;
  final bool complete;
  final bool retryable;
  final bool manualReviewRequired;
  final RatingDestructiveMessageCategory messageCategory;
  final int processedCount;
  final int phaseProcessedCount;
  final int createdAtMs;
  final int updatedAtMs;

  DateTime get createdAt =>
      DateTime.fromMillisecondsSinceEpoch(createdAtMs).toLocal();
  DateTime get updatedAt =>
      DateTime.fromMillisecondsSinceEpoch(updatedAtMs).toLocal();

  String get feedbackMessage {
    if (complete) return '${operation.label} completed.';
    if (manualReviewRequired) {
      return '${operation.label} needs attention and remains paused.';
    }
    if (retryable) {
      return '${operation.label} is temporarily delayed. BiteStar will retry automatically.';
    }
    if (!accepted) return '${operation.label} is already processing.';
    return '${operation.label} started. BiteStar will continue processing.';
  }
}

@immutable
class RatingAdminDestructiveOperationRecord {
  const RatingAdminDestructiveOperationRecord._({
    required this.operationId,
    required this.operation,
    required this.status,
    required this.progressCategory,
    required this.phaseCategory,
    required this.processedCount,
    required this.phaseProcessedCount,
    required this.createdAtMs,
    required this.updatedAtMs,
    required this.sourceRestaurantId,
    required this.sourceRestaurantName,
    required this.targetRestaurantId,
    required this.targetRestaurantName,
    required this.sourceDishId,
    required this.sourceDishName,
    required this.targetDishId,
    required this.targetDishName,
    required this.complete,
    required this.retryable,
    required this.manualReviewRequired,
    required this.messageCategory,
  });

  factory RatingAdminDestructiveOperationRecord.fromJson(Object? value) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'operationId',
      'operation',
      'status',
      'progressCategory',
      'phaseCategory',
      'processedCount',
      'phaseProcessedCount',
      'createdAtMs',
      'updatedAtMs',
      'sourceRestaurantId',
      'sourceRestaurantName',
      'targetRestaurantId',
      'targetRestaurantName',
      'sourceDishId',
      'sourceDishName',
      'targetDishId',
      'targetDishName',
      'complete',
      'retryable',
      'manualReviewRequired',
      'messageCategory',
    });
    final operation = RatingDestructiveOperation.parse(data['operation']);
    final status = RatingDestructiveStatus.parse(data['status']);
    final complete = _requiredBool(data['complete']);
    final retryable = _requiredBool(data['retryable']);
    final manualReviewRequired = _requiredBool(data['manualReviewRequired']);
    final createdAtMs = _requiredSafeInteger(data['createdAtMs']);
    final updatedAtMs = _requiredSafeInteger(data['updatedAtMs']);
    final progressCategory = RatingDestructiveProgressCategory.parse(
      data['progressCategory'],
    );
    if (complete != (status == RatingDestructiveStatus.complete) ||
        retryable != (status == RatingDestructiveStatus.retryable) ||
        manualReviewRequired !=
            (status == RatingDestructiveStatus.manualReviewRequired) ||
        updatedAtMs < createdAtMs ||
        (status == RatingDestructiveStatus.complete &&
            progressCategory != RatingDestructiveProgressCategory.complete) ||
        (status == RatingDestructiveStatus.retryable &&
            progressCategory !=
                RatingDestructiveProgressCategory.waitingRetry) ||
        (status == RatingDestructiveStatus.manualReviewRequired &&
            progressCategory !=
                RatingDestructiveProgressCategory.needsAttention) ||
        RatingDestructiveMessageCategory.parse(data['messageCategory']) !=
            RatingDestructiveMessageCategory.currentStatus) {
      throw const RatingDestructiveProtocolException();
    }
    final sourceRestaurantId = _nullableString(data['sourceRestaurantId']);
    final targetRestaurantId = _nullableString(data['targetRestaurantId']);
    final sourceDishId = _nullableString(data['sourceDishId']);
    final targetDishId = _nullableString(data['targetDishId']);
    final sourceRestaurantName = _nullableDisplayName(
      data['sourceRestaurantName'],
    );
    final targetRestaurantName = _nullableDisplayName(
      data['targetRestaurantName'],
    );
    final sourceDishName = _nullableDisplayName(data['sourceDishName']);
    final targetDishName = _nullableDisplayName(data['targetDishName']);
    final namesMatchIdentities =
        (sourceRestaurantId != null || sourceRestaurantName == null) &&
        (targetRestaurantId != null || targetRestaurantName == null) &&
        (sourceDishId != null || sourceDishName == null) &&
        (targetDishId != null || targetDishName == null);
    final identityValid = switch (operation) {
      RatingDestructiveOperation.restaurantMerge =>
        sourceRestaurantId != null &&
            targetRestaurantId != null &&
            sourceRestaurantId != targetRestaurantId &&
            sourceDishId == null &&
            targetDishId == null,
      RatingDestructiveOperation.restaurantDelete =>
        sourceRestaurantId != null &&
            targetRestaurantId == null &&
            sourceDishId == null &&
            targetDishId == null,
      RatingDestructiveOperation.dishMerge =>
        sourceRestaurantId == null &&
            targetRestaurantId == null &&
            sourceDishId != null &&
            targetDishId != null &&
            sourceDishId != targetDishId,
      RatingDestructiveOperation.dishDelete =>
        sourceRestaurantId == null &&
            targetRestaurantId == null &&
            sourceDishId != null &&
            targetDishId == null,
    };
    if (!identityValid || !namesMatchIdentities) {
      throw const RatingDestructiveProtocolException();
    }
    return RatingAdminDestructiveOperationRecord._(
      operationId: _requiredOperationId(data['operationId']),
      operation: operation,
      status: status,
      progressCategory: progressCategory,
      phaseCategory: RatingDestructiveProgressCategory.parse(
        data['phaseCategory'],
      ),
      processedCount: _requiredSafeInteger(data['processedCount']),
      phaseProcessedCount: _requiredSafeInteger(data['phaseProcessedCount']),
      createdAtMs: createdAtMs,
      updatedAtMs: updatedAtMs,
      sourceRestaurantId: sourceRestaurantId,
      sourceRestaurantName: sourceRestaurantName,
      targetRestaurantId: targetRestaurantId,
      targetRestaurantName: targetRestaurantName,
      sourceDishId: sourceDishId,
      sourceDishName: sourceDishName,
      targetDishId: targetDishId,
      targetDishName: targetDishName,
      complete: complete,
      retryable: retryable,
      manualReviewRequired: manualReviewRequired,
      messageCategory: RatingDestructiveMessageCategory.currentStatus,
    );
  }

  final String operationId;
  final RatingDestructiveOperation operation;
  final RatingDestructiveStatus status;
  final RatingDestructiveProgressCategory progressCategory;
  final RatingDestructiveProgressCategory phaseCategory;
  final int processedCount;
  final int phaseProcessedCount;
  final int createdAtMs;
  final int updatedAtMs;
  final String? sourceRestaurantId;
  final String? sourceRestaurantName;
  final String? targetRestaurantId;
  final String? targetRestaurantName;
  final String? sourceDishId;
  final String? sourceDishName;
  final String? targetDishId;
  final String? targetDishName;
  final bool complete;
  final bool retryable;
  final bool manualReviewRequired;
  final RatingDestructiveMessageCategory messageCategory;

  DateTime get createdAt =>
      DateTime.fromMillisecondsSinceEpoch(createdAtMs).toLocal();
  DateTime get updatedAt =>
      DateTime.fromMillisecondsSinceEpoch(updatedAtMs).toLocal();

  String entityLabel(String? name, String id) {
    final display = name?.trim();
    return display == null || display.isEmpty
        ? 'Unavailable or deleted ($id)'
        : '$display ($id)';
  }

  List<String> get identityLabels => switch (operation) {
    RatingDestructiveOperation.restaurantMerge => <String>[
      'Source: ${entityLabel(sourceRestaurantName, sourceRestaurantId!)}',
      'Target: ${entityLabel(targetRestaurantName, targetRestaurantId!)}',
    ],
    RatingDestructiveOperation.restaurantDelete => <String>[
      'Restaurant: ${entityLabel(sourceRestaurantName, sourceRestaurantId!)}',
    ],
    RatingDestructiveOperation.dishMerge => <String>[
      'Source: ${entityLabel(sourceDishName, sourceDishId!)}',
      'Target: ${entityLabel(targetDishName, targetDishId!)}',
    ],
    RatingDestructiveOperation.dishDelete => <String>[
      'Dish: ${entityLabel(sourceDishName, sourceDishId!)}',
    ],
  };
}
