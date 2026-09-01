import 'package:cloud_functions/cloud_functions.dart';

import '../models/admin_restaurant_qr_batch.dart';
import 'firestore_document_id.dart';

typedef AdminRestaurantQrBatchFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

typedef AdminRestaurantQrPreparationProgressCallback =
    void Function(AdminRestaurantQrPreparationProgress progress);
typedef AdminRestaurantQrMarkingProgressCallback =
    void Function(AdminRestaurantQrMarkingProgress progress);

enum AdminRestaurantQrBatchFailureKind {
  invalidRequest,
  invalidResponse,
  unavailable,
}

class AdminRestaurantQrBatchServiceException implements Exception {
  const AdminRestaurantQrBatchServiceException(this.kind, this.message);

  final AdminRestaurantQrBatchFailureKind kind;
  final String message;

  @override
  String toString() => message;
}

class AdminRestaurantQrPreparationProgress {
  const AdminRestaurantQrPreparationProgress({
    required this.confirmedRestaurantCount,
    required this.totalRestaurantCount,
  });

  final int confirmedRestaurantCount;
  final int totalRestaurantCount;
}

class AdminRestaurantQrMarkingProgress {
  const AdminRestaurantQrMarkingProgress({
    required this.processedRestaurantCount,
    required this.totalRestaurantCount,
    required this.processedLabelCount,
    required this.totalLabelCount,
  });

  final int processedRestaurantCount;
  final int totalRestaurantCount;
  final int processedLabelCount;
  final int totalLabelCount;
}

class AdminRestaurantQrBatchService {
  AdminRestaurantQrBatchService({
    AdminRestaurantQrBatchFunctionsBoundary? functionsBoundary,
  }) : _functionsBoundary = functionsBoundary ?? _callFirebase;

  static const String preparationCallableName = 'prepareAdminRestaurantQrBatch';
  static const String markingCallableName =
      'markAdminRestaurantQrBatchPrepared';

  final AdminRestaurantQrBatchFunctionsBoundary _functionsBoundary;

  Future<AdminRestaurantQrPreparationRunResult> prepareRestaurants(
    Iterable<String> catalogRestaurantIds, {
    AdminRestaurantQrPreparationProgressCallback? onProgress,
  }) async {
    final requestedIds = _validateAllRestaurantIds(catalogRestaurantIds);
    final results = <AdminRestaurantQrRestaurantResult>[];
    AdminRestaurantQrPreparationInterruption? interruption;
    for (
      var offset = 0;
      offset < requestedIds.length;
      offset += adminRestaurantQrBatchMaximumRestaurants
    ) {
      final end = (offset + adminRestaurantQrBatchMaximumRestaurants).clamp(
        0,
        requestedIds.length,
      );
      final chunkIds = requestedIds.sublist(offset, end);
      try {
        final chunk = await prepareChunk(
          AdminRestaurantQrPreparationRequest(chunkIds),
        );
        results.addAll(chunk.results);
      } on AdminRestaurantQrBatchServiceException catch (error) {
        final code =
            error.kind == AdminRestaurantQrBatchFailureKind.invalidResponse
            ? 'preparation_response_invalid'
            : 'preparation_unavailable';
        final message =
            error.kind == AdminRestaurantQrBatchFailureKind.invalidResponse
            ? 'Label preparation returned an invalid response. Retry this restaurant explicitly.'
            : 'Label preparation could not be confirmed. Retry this restaurant explicitly.';
        for (final unresolvedId in requestedIds.skip(offset)) {
          results.add(
            AdminRestaurantQrProblemRestaurant(
              catalogRestaurantId: unresolvedId,
              outcome: AdminRestaurantQrProblemOutcome.failed,
              code: code,
              message: message,
            ),
          );
        }
        interruption = AdminRestaurantQrPreparationInterruption(
          code: code,
          message: message,
          catalogRestaurantIds: requestedIds.skip(offset),
        );
        break;
      }
      onProgress?.call(
        AdminRestaurantQrPreparationProgress(
          confirmedRestaurantCount: results.length,
          totalRestaurantCount: requestedIds.length,
        ),
      );
    }
    return AdminRestaurantQrPreparationRunResult(
      requestedCatalogRestaurantIds: requestedIds,
      results: results,
      interruption: interruption,
    );
  }

  Future<AdminRestaurantQrPreparationRunResult> retryPreparation(
    AdminRestaurantQrPreparationRunResult previousAttempt, {
    AdminRestaurantQrPreparationProgressCallback? onProgress,
  }) async {
    if (!previousAttempt.canRetryPreparation) return previousAttempt;
    final retry = await prepareRestaurants(
      previousAttempt.retryCatalogRestaurantIds,
      onProgress: onProgress,
    );
    return previousAttempt.mergeExplicitRetry(retry);
  }

  Future<AdminRestaurantQrPreparationChunkResult> prepareChunk(
    AdminRestaurantQrPreparationRequest request,
  ) async {
    try {
      final rawResponse = await _functionsBoundary(
        preparationCallableName,
        request.toJson(),
      );
      return AdminRestaurantQrPreparationChunkResult.fromCallableData(
        rawResponse,
        expectedCatalogRestaurantIds: request.catalogRestaurantIds,
      );
    } on AdminRestaurantQrBatchServiceException {
      rethrow;
    } on AdminRestaurantQrProtocolException {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.invalidResponse,
        'BiteStar returned an invalid label preparation response.',
      );
    } on FirebaseFunctionsException {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.unavailable,
        'Label preparation could not be confirmed. Try again explicitly.',
      );
    } catch (_) {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.unavailable,
        'Label preparation could not be confirmed. Try again explicitly.',
      );
    }
  }

  Future<AdminRestaurantQrMarkingRunResult> markPrepared(
    AdminRestaurantQrMarkingWorklist worklist, {
    AdminRestaurantQrMarkingProgressCallback? onProgress,
  }) async {
    final results = <AdminRestaurantQrMarkingRestaurantResult>[];
    var processedLabels = 0;
    for (final request in _markingChunks(worklist)) {
      try {
        final chunk = await markChunk(request);
        results.addAll(chunk.results);
      } on AdminRestaurantQrBatchServiceException catch (error) {
        final code =
            error.kind == AdminRestaurantQrBatchFailureKind.invalidResponse
            ? 'marking_response_invalid'
            : 'marking_unavailable';
        final message =
            error.kind == AdminRestaurantQrBatchFailureKind.invalidResponse
            ? 'Preparation status returned an invalid response. Retry these labels.'
            : 'Preparation status could not be confirmed. Retry these labels.';
        results.addAll(
          request.restaurants.map(
            (restaurant) => AdminRestaurantQrMarkingRestaurantResult.unresolved(
              request: restaurant,
              code: code,
              message: message,
            ),
          ),
        );
      }
      processedLabels += request.labelCount;
      onProgress?.call(
        AdminRestaurantQrMarkingProgress(
          processedRestaurantCount: results.length,
          totalRestaurantCount: worklist.restaurantCount,
          processedLabelCount: processedLabels,
          totalLabelCount: worklist.labelCount,
        ),
      );
    }
    return AdminRestaurantQrMarkingRunResult(
      requestedWorklist: worklist,
      results: results,
    );
  }

  Future<AdminRestaurantQrMarkingRunResult> retryUnresolved(
    AdminRestaurantQrMarkingRunResult previousAttempt, {
    AdminRestaurantQrMarkingProgressCallback? onProgress,
  }) =>
      markPrepared(previousAttempt.unresolvedWorklist, onProgress: onProgress);

  Future<AdminRestaurantQrMarkingChunkResult> markChunk(
    AdminRestaurantQrMarkingRequest request,
  ) async {
    try {
      final rawResponse = await _functionsBoundary(
        markingCallableName,
        request.toJson(),
      );
      return AdminRestaurantQrMarkingChunkResult.fromCallableData(
        rawResponse,
        expectedRequest: request,
      );
    } on AdminRestaurantQrBatchServiceException {
      rethrow;
    } on AdminRestaurantQrProtocolException {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.invalidResponse,
        'BiteStar returned an invalid preparation status response.',
      );
    } on FirebaseFunctionsException {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.unavailable,
        'Preparation status could not be confirmed. Try again.',
      );
    } catch (_) {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.unavailable,
        'Preparation status could not be confirmed. Try again.',
      );
    }
  }

  static List<String> _validateAllRestaurantIds(Iterable<String> values) {
    final result = <String>[];
    final seen = <String>{};
    for (final value in values) {
      final exact = exactFirestoreDocumentId(value);
      if (exact == null || !seen.add(exact)) {
        throw const AdminRestaurantQrBatchServiceException(
          AdminRestaurantQrBatchFailureKind.invalidRequest,
          'The selected restaurant identities are invalid.',
        );
      }
      result.add(exact);
    }
    if (result.isEmpty) {
      throw const AdminRestaurantQrBatchServiceException(
        AdminRestaurantQrBatchFailureKind.invalidRequest,
        'Select at least one canonical restaurant.',
      );
    }
    return List<String>.unmodifiable(result);
  }

  static Iterable<AdminRestaurantQrMarkingRequest> _markingChunks(
    AdminRestaurantQrMarkingWorklist worklist,
  ) sync* {
    var restaurants = <AdminRestaurantQrMarkingRestaurantRequest>[];
    var labelCount = 0;
    for (final restaurant in worklist.restaurants) {
      final wouldExceedRestaurants =
          restaurants.length == adminRestaurantQrBatchMaximumRestaurants;
      final wouldExceedLabels =
          labelCount + restaurant.labels.length >
          adminRestaurantQrBatchMaximumLabels;
      if (restaurants.isNotEmpty &&
          (wouldExceedRestaurants || wouldExceedLabels)) {
        yield AdminRestaurantQrMarkingRequest(restaurants);
        restaurants = <AdminRestaurantQrMarkingRestaurantRequest>[];
        labelCount = 0;
      }
      restaurants.add(restaurant);
      labelCount += restaurant.labels.length;
    }
    if (restaurants.isNotEmpty) {
      yield AdminRestaurantQrMarkingRequest(restaurants);
    }
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
