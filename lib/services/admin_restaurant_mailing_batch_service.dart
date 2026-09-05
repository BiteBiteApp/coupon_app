import 'package:cloud_functions/cloud_functions.dart';

import '../models/admin_restaurant_mailing_batch.dart';

typedef AdminRestaurantMailingFunctionsBoundary =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

enum AdminRestaurantMailingServiceFailureKind {
  invalidRequest,
  invalidResponse,
  unavailable,
}

class AdminRestaurantMailingServiceException implements Exception {
  const AdminRestaurantMailingServiceException(this.kind, this.message);

  final AdminRestaurantMailingServiceFailureKind kind;
  final String message;

  @override
  String toString() => message;
}

class AdminRestaurantMailingBatchService {
  AdminRestaurantMailingBatchService({
    AdminRestaurantMailingFunctionsBoundary? functionsBoundary,
  }) : _functionsBoundary = functionsBoundary ?? _callFirebase;

  static const String callableName = 'prepareAdminRestaurantMailingLabelBatch';

  final AdminRestaurantMailingFunctionsBoundary _functionsBoundary;

  Future<AdminRestaurantMailingBatchRunResult> prepareRestaurants(
    Iterable<String> catalogRestaurantIds,
  ) async {
    final List<String> requested;
    try {
      requested = AdminRestaurantMailingSelection(
        catalogRestaurantIds,
      ).catalogRestaurantIds;
    } on AdminRestaurantMailingProtocolException {
      throw const AdminRestaurantMailingServiceException(
        AdminRestaurantMailingServiceFailureKind.invalidRequest,
        'The selected restaurant identities are invalid.',
      );
    }

    final confirmed = <AdminRestaurantMailingResult>[];
    for (
      var offset = 0;
      offset < requested.length;
      offset += adminRestaurantMailingBatchMaximumRestaurants
    ) {
      final end = (offset + adminRestaurantMailingBatchMaximumRestaurants)
          .clamp(0, requested.length);
      final chunkIds = requested.sublist(offset, end);
      try {
        final chunk = await prepareChunk(
          AdminRestaurantMailingChunkRequest(chunkIds),
        );
        confirmed.addAll(chunk.results);
      } on AdminRestaurantMailingServiceException catch (error) {
        final kind =
            error.kind ==
                AdminRestaurantMailingServiceFailureKind.invalidResponse
            ? AdminRestaurantMailingInterruptionKind.invalidResponse
            : AdminRestaurantMailingInterruptionKind.unavailable;
        final message =
            kind == AdminRestaurantMailingInterruptionKind.invalidResponse
            ? 'Restaurant mailing data returned an invalid response. Retry the unconfirmed restaurants explicitly.'
            : 'Restaurant mailing data could not be confirmed. Retry the unconfirmed restaurants explicitly.';
        return AdminRestaurantMailingBatchRunResult(
          requestedCatalogRestaurantIds: requested,
          confirmedResults: confirmed,
          interruption: AdminRestaurantMailingInterruption(
            kind: kind,
            message: message,
            catalogRestaurantIds: requested.skip(offset),
          ),
        );
      }
    }
    return AdminRestaurantMailingBatchRunResult(
      requestedCatalogRestaurantIds: requested,
      confirmedResults: confirmed,
    );
  }

  Future<AdminRestaurantMailingBatchRunResult> retryUnconfirmed(
    AdminRestaurantMailingBatchRunResult previousAttempt,
  ) async {
    if (!previousAttempt.canRetry) return previousAttempt;
    final retry = await prepareRestaurants(
      previousAttempt.unconfirmedCatalogRestaurantIds,
    );
    return previousAttempt.mergeExplicitRetry(retry);
  }

  Future<AdminRestaurantMailingChunkResult> prepareChunk(
    AdminRestaurantMailingChunkRequest request,
  ) async {
    try {
      final rawResponse = await _functionsBoundary(
        callableName,
        request.toJson(),
      );
      return AdminRestaurantMailingChunkResult.fromCallableData(
        rawResponse,
        expectedCatalogRestaurantIds: request.catalogRestaurantIds,
      );
    } on AdminRestaurantMailingServiceException {
      rethrow;
    } on AdminRestaurantMailingProtocolException {
      throw const AdminRestaurantMailingServiceException(
        AdminRestaurantMailingServiceFailureKind.invalidResponse,
        'BiteStar returned an invalid restaurant mailing response.',
      );
    } on FirebaseFunctionsException {
      throw const AdminRestaurantMailingServiceException(
        AdminRestaurantMailingServiceFailureKind.unavailable,
        'Restaurant mailing data could not be confirmed. Try again explicitly.',
      );
    } catch (_) {
      throw const AdminRestaurantMailingServiceException(
        AdminRestaurantMailingServiceFailureKind.unavailable,
        'Restaurant mailing data could not be confirmed. Try again explicitly.',
      );
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
