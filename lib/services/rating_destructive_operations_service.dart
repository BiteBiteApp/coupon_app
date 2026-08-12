import 'dart:math';

import 'package:cloud_functions/cloud_functions.dart';

import '../models/pagination/paged_models.dart';
import '../models/rating_destructive_operation_models.dart';

typedef RatingDestructiveFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);
typedef RatingDestructiveRequestIdGenerator = String Function();

enum RatingDestructiveFailureKind {
  staleData,
  alreadyProcessing,
  notFound,
  permissionDenied,
  invalidRequest,
  unavailable,
}

class RatingDestructiveOperationsException implements Exception {
  const RatingDestructiveOperationsException(this.kind, this.message);

  final RatingDestructiveFailureKind kind;
  final String message;

  @override
  String toString() => message;
}

class RatingDestructiveOperationsService {
  RatingDestructiveOperationsService({
    RatingDestructiveFunctionsBoundary? functionsBoundary,
    RatingDestructiveRequestIdGenerator? requestIdGenerator,
  }) : _functionsBoundary = functionsBoundary ?? _callFirebase,
       _requestIdGenerator =
           requestIdGenerator ?? _generateRatingDestructiveRequestId;

  final RatingDestructiveFunctionsBoundary _functionsBoundary;
  final RatingDestructiveRequestIdGenerator _requestIdGenerator;

  static const Map<String, Object?> adminOperationsCriteria = <String, Object?>{
    'scope': 'all',
  };

  Future<RatingDestructiveOperationSummary> startRestaurantMerge({
    required String sourceRestaurantId,
    required String targetRestaurantId,
    required int expectedSourceRestaurantRevision,
    required int expectedTargetRestaurantRevision,
  }) {
    final sourceId = _documentId(sourceRestaurantId);
    final targetId = _documentId(targetRestaurantId);
    if (sourceId == targetId) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'Choose two different restaurants.',
      );
    }
    return _summary(
      'startRatingRestaurantMerge',
      <String, Object?>{
        'contractVersion': ratingDestructiveCallableContractVersion,
        'sourceRestaurantId': sourceId,
        'targetRestaurantId': targetId,
        'expectedSourceRestaurantRevision': _revision(
          expectedSourceRestaurantRevision,
        ),
        'expectedTargetRestaurantRevision': _revision(
          expectedTargetRestaurantRevision,
        ),
        'clientRequestId': _requestId(),
      },
      expectedOperation: RatingDestructiveOperation.restaurantMerge,
    );
  }

  Future<RatingDestructiveOperationSummary> startRestaurantDelete({
    required String restaurantId,
    required int expectedRestaurantRevision,
  }) => _summary(
    'startRatingRestaurantDelete',
    <String, Object?>{
      'contractVersion': ratingDestructiveCallableContractVersion,
      'restaurantId': _documentId(restaurantId),
      'expectedRestaurantRevision': _revision(expectedRestaurantRevision),
      'clientRequestId': _requestId(),
    },
    expectedOperation: RatingDestructiveOperation.restaurantDelete,
  );

  Future<RatingDestructiveOperationSummary> startDishMerge({
    required String sourceDishId,
    required String targetDishId,
  }) {
    final sourceId = _documentId(sourceDishId);
    final targetId = _documentId(targetDishId);
    if (sourceId == targetId) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'Choose two different dishes.',
      );
    }
    return _summary(
      'startRatingDishMerge',
      <String, Object?>{
        'contractVersion': ratingDestructiveCallableContractVersion,
        'sourceDishId': sourceId,
        'targetDishId': targetId,
        'clientRequestId': _requestId(),
      },
      expectedOperation: RatingDestructiveOperation.dishMerge,
    );
  }

  Future<RatingDestructiveOperationSummary> startDishDelete({
    required String dishId,
  }) => _summary(
    'startRatingDishDelete',
    <String, Object?>{
      'contractVersion': ratingDestructiveCallableContractVersion,
      'dishId': _documentId(dishId),
      'clientRequestId': _requestId(),
    },
    expectedOperation: RatingDestructiveOperation.dishDelete,
  );

  Future<RatingDestructiveOperationSummary> getOperationStatus(
    String operationId,
  ) {
    final expectedId = _operationId(operationId);
    return _summary(
      'getRatingDestructiveOperationStatus',
      <String, Object?>{
        'contractVersion': ratingDestructiveCallableContractVersion,
        'operationId': expectedId,
        'clientRequestId': _requestId(),
      },
      expectedOperationId: expectedId,
      expectCurrentStatus: true,
    );
  }

  Future<PagedResponse<RatingAdminDestructiveOperationRecord>>
  loadAdminOperationsPage(PagedRequest request) async {
    if (request.pageSize != ratingDestructiveAdminPageSize ||
        !request.requestExactCount ||
        !_sameCriteria(request.criteria, adminOperationsCriteria)) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'The operations page request is invalid.',
      );
    }
    try {
      final raw = await _functionsBoundary(
        'listRatingAdminDestructiveOperationsPage',
        request.toJson(),
      );
      return PagedResponse<RatingAdminDestructiveOperationRecord>.fromJson(
        raw,
        itemParser: RatingAdminDestructiveOperationRecord.fromJson,
      );
    } on RatingDestructiveOperationsException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      throw _firebaseFailure(error);
    } on FormatException {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.unavailable,
        'Rating Admin returned an invalid operations page.',
      );
    } catch (_) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.unavailable,
        'Operations could not be loaded. Try again.',
      );
    }
  }

  Future<RatingDestructiveOperationSummary> _summary(
    String callableName,
    Map<String, Object?> request, {
    RatingDestructiveOperation? expectedOperation,
    String? expectedOperationId,
    bool expectCurrentStatus = false,
  }) async {
    try {
      final raw = await _functionsBoundary(callableName, request);
      final summary = RatingDestructiveOperationSummary.fromJson(raw);
      if ((expectedOperation != null &&
              summary.operation != expectedOperation) ||
          (expectedOperationId != null &&
              summary.operationId != expectedOperationId) ||
          (expectCurrentStatus &&
              (summary.accepted ||
                  summary.messageCategory !=
                      RatingDestructiveMessageCategory.currentStatus))) {
        throw const RatingDestructiveProtocolException();
      }
      return summary;
    } on RatingDestructiveOperationsException {
      rethrow;
    } on FirebaseFunctionsException catch (error) {
      throw _firebaseFailure(error);
    } on FormatException {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.unavailable,
        'BiteStar returned an invalid operation status.',
      );
    } catch (_) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.unavailable,
        'The operation could not be started. Try again.',
      );
    }
  }

  String _requestId() {
    final value = _requestIdGenerator();
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$').hasMatch(value)) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'A safe operation request could not be created.',
      );
    }
    return value;
  }

  static String _documentId(String value) {
    if (value.isEmpty ||
        value == '.' ||
        value == '..' ||
        value.contains('/') ||
        value.length > 1500) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'The operation identity is invalid.',
      );
    }
    return value;
  }

  static String _operationId(String value) {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(value)) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'The operation identity is invalid.',
      );
    }
    return value;
  }

  static int _revision(int value) {
    if (value < 0 || value > 9007199254740991) {
      throw const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'Refresh the restaurant before trying again.',
      );
    }
    return value;
  }

  static bool _sameCriteria(
    Map<String, Object?> left,
    Map<String, Object?> right,
  ) =>
      left.length == right.length &&
      left.entries.every((entry) => right[entry.key] == entry.value);

  static RatingDestructiveOperationsException _firebaseFailure(
    FirebaseFunctionsException error,
  ) {
    final category = _safeMessageCategory(error.details);
    if (category == 'stale_data' || error.code == 'aborted') {
      return const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.staleData,
        'Stale data—refresh required.',
      );
    }
    if (category == 'already_processing') {
      return const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.alreadyProcessing,
        'This operation is already processing.',
      );
    }
    if (error.code == 'not-found') {
      return const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.notFound,
        'This operation is unavailable.',
      );
    }
    if (error.code == 'permission-denied' || error.code == 'unauthenticated') {
      return const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.permissionDenied,
        'You do not have access to this operation.',
      );
    }
    if (error.code == 'invalid-argument') {
      return const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.invalidRequest,
        'Refresh and check the operation details.',
      );
    }
    if (error.code == 'failed-precondition') {
      return const RatingDestructiveOperationsException(
        RatingDestructiveFailureKind.unavailable,
        'This operation is not currently available. Refresh and try again.',
      );
    }
    return const RatingDestructiveOperationsException(
      RatingDestructiveFailureKind.unavailable,
      'The operation is temporarily unavailable. Try again.',
    );
  }

  static String? _safeMessageCategory(Object? details) {
    if (details is! Map || details.length != 1) return null;
    final value = details['messageCategory'];
    return value is String && value.length <= 64 ? value : null;
  }

  static Future<Object?> _callFirebase(
    String callableName,
    Map<String, Object?> request,
  ) async {
    final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
    final response = await functions
        .httpsCallable(callableName)
        .call<Object?>(request);
    return response.data;
  }
}

String _generateRatingDestructiveRequestId() {
  final random = Random.secure();
  final randomHex = List<int>.generate(
    16,
    (_) => random.nextInt(256),
  ).map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return 'rating-${DateTime.now().microsecondsSinceEpoch}-$randomHex';
}
