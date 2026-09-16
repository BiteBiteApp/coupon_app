import 'package:cloud_functions/cloud_functions.dart';

import '../models/customer_bitesaver_search.dart';
import '../models/customer_bitesaver_saved.dart';

typedef CustomerBiteSaverCallableTransport =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

enum CustomerBiteSaverServiceFailureKind {
  callable,
  transport,
  invalidResponse,
}

final class CustomerBiteSaverCallableTransportException implements Exception {
  const CustomerBiteSaverCallableTransportException({
    required this.code,
    required this.message,
    this.cause,
  });

  final String code;
  final String message;
  final Object? cause;

  @override
  String toString() =>
      'CustomerBiteSaverCallableTransportException($code): $message';
}

final class CustomerBiteSaverServiceException implements Exception {
  const CustomerBiteSaverServiceException({
    required this.kind,
    required this.code,
    required this.message,
    this.cause,
  });

  final CustomerBiteSaverServiceFailureKind kind;
  final String code;
  final String message;
  final Object? cause;

  @override
  String toString() => 'CustomerBiteSaverServiceException($code): $message';
}

abstract interface class CustomerBiteSaverApi {
  Future<CustomerBiteSaverStartResponse> startCustomerBiteSaverSearch(
    CustomerBiteSaverStartRequest request,
  );

  Future<CustomerBiteSaverStatusResponse> getCustomerBiteSaverSearchStatus(
    CustomerBiteSaverStatusRequest request,
  );

  Future<
    CustomerBiteSaverEndpointResponse<CustomerBiteSaverRestaurantPageResult>
  >
  getCustomerBiteSaverSearchPage(
    CustomerBiteSaverRestaurantPageRequest request,
  );

  Future<CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>>
  getCustomerBiteSaverOfferPage(CustomerBiteSaverOfferPageRequest request);

  Future<
    CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
  >
  continueCustomerBiteSaverGuestOfferCheck(
    CustomerBiteSaverGuestContinuationRequest request,
  );

  Future<CustomerBiteSaverFavoriteStatesResponse>
  getCustomerBiteSaverFavoriteStates(
    CustomerBiteSaverFavoriteStatesRequest request,
  );

  Future<
    CustomerBiteSaverEndpointResponse<
      CustomerBiteSaverRedemptionValidationResult
    >
  >
  validateCustomerBiteSaverOfferRedemptionStart(
    CustomerBiteSaverRedemptionValidationRequest request,
  );

  Future<CustomerBiteSaverRedemptionStartResult>
  startCustomerBiteSaverOfferRedemption(
    CustomerBiteSaverRedemptionStartRequest request,
  );
}

abstract interface class CustomerBiteSaverMenuApi {
  Future<CustomerBiteSaverMenuPageResult> getCustomerBiteSaverMenuPage(
    CustomerBiteSaverMenuPageRequest request,
  );
}

abstract interface class CustomerBiteSaverSavedApi {
  Future<CustomerBiteSaverSavedPageResult> getCustomerBiteSaverSavedPage(
    CustomerBiteSaverSavedPageRequest request,
  );

  Future<CustomerBiteSaverMenuPageResult> getCustomerBiteSaverSavedMenuPage(
    CustomerBiteSaverSavedMenuPageRequest request,
  );
}

final class CustomerBiteSaverService
    implements
        CustomerBiteSaverApi,
        CustomerBiteSaverMenuApi,
        CustomerBiteSaverSavedApi {
  CustomerBiteSaverService({CustomerBiteSaverCallableTransport? transport})
    : _transport = transport ?? _firebaseTransport;

  static const String region = 'us-central1';
  static const String startCallableName = 'startCustomerBiteSaverSearch';
  static const String statusCallableName = 'getCustomerBiteSaverSearchStatus';
  static const String restaurantPageCallableName =
      'getCustomerBiteSaverSearchPage';
  static const String offerPageCallableName = 'getCustomerBiteSaverOfferPage';
  static const String menuPageCallableName = 'getCustomerBiteSaverMenuPage';
  static const String guestContinuationCallableName =
      'continueCustomerBiteSaverGuestOfferCheck';
  static const String favoriteStatesCallableName =
      'getCustomerBiteSaverFavoriteStates';
  static const String savedPageCallableName = 'getCustomerBiteSaverSavedPage';
  static const String savedMenuPageCallableName =
      'getCustomerBiteSaverSavedMenuPage';
  static const String redemptionValidationCallableName =
      'validateCustomerBiteSaverOfferRedemptionStart';
  static const String redemptionStartCallableName =
      'startCustomerBiteSaverOfferRedemption';
  static const Set<String> _firebaseTransportFailureCodes = <String>{
    'cancelled',
    'deadline-exceeded',
    'unavailable',
  };

  final CustomerBiteSaverCallableTransport _transport;

  @override
  Future<CustomerBiteSaverStartResponse> startCustomerBiteSaverSearch(
    CustomerBiteSaverStartRequest request,
  ) => _invoke(
    startCallableName,
    request.toJson(),
    CustomerBiteSaverStartResponse.fromJson,
  );

  @override
  Future<CustomerBiteSaverStatusResponse> getCustomerBiteSaverSearchStatus(
    CustomerBiteSaverStatusRequest request,
  ) => _invoke(
    statusCallableName,
    request.toJson(),
    CustomerBiteSaverStatusResponse.fromJson,
  );

  @override
  Future<
    CustomerBiteSaverEndpointResponse<CustomerBiteSaverRestaurantPageResult>
  >
  getCustomerBiteSaverSearchPage(
    CustomerBiteSaverRestaurantPageRequest request,
  ) async {
    final response = await _invoke(
      restaurantPageCallableName,
      request.toJson(),
      (value) => parseCustomerBiteSaverEndpointResponse(
        value,
        expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      ),
    );
    _corroborateResponseContext(response, request.binding);
    final result = _completedResult(response);
    if (result != null) {
      _corroborateRestaurantPage(
        result,
        _completedEvaluationContext(response)!,
      );
    }
    return response;
  }

  @override
  Future<CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>>
  getCustomerBiteSaverOfferPage(
    CustomerBiteSaverOfferPageRequest request,
  ) async {
    final response = await _invoke(
      offerPageCallableName,
      request.toJson(),
      (value) => parseCustomerBiteSaverEndpointResponse(
        value,
        expectedOperation: CustomerBiteSaverGuestOperation.offerPage,
        resultParser: CustomerBiteSaverOfferPageResult.fromJson,
      ),
    );
    _corroborateResponseContext(response, request.binding);
    final result = _completedResult(response);
    if (result != null && result.restaurantId != request.restaurantId) {
      _invalidResponse();
    }
    return response;
  }

  @override
  Future<CustomerBiteSaverMenuPageResult> getCustomerBiteSaverMenuPage(
    CustomerBiteSaverMenuPageRequest request,
  ) async {
    final result = await _invoke(
      menuPageCallableName,
      request.toJson(),
      CustomerBiteSaverMenuPageResult.fromJson,
    );
    if (result.restaurantId != request.restaurantId ||
        (request.binding.attemptGeneration != null &&
            result.attemptGeneration != request.binding.attemptGeneration) ||
        (request.binding.queryFingerprint != null &&
            result.queryFingerprint != request.binding.queryFingerprint) ||
        (request.cursor != null && result.nextCursor == request.cursor)) {
      _invalidResponse();
    }
    return result;
  }

  @override
  Future<
    CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
  >
  continueCustomerBiteSaverGuestOfferCheck(
    CustomerBiteSaverGuestContinuationRequest request,
  ) async {
    final response = await _invoke(
      guestContinuationCallableName,
      request.toJson(),
      parseCustomerBiteSaverGuestContinuationResponse,
    );
    _corroborateResponseContext(response, request.binding);
    if (response
        case CustomerBiteSaverGuestComplete<CustomerBiteSaverOperationResult>
            complete) {
      final result = complete.result;
      if (result is CustomerBiteSaverRestaurantPageResult &&
          (result.attemptGeneration !=
                  complete.evaluationContext.attemptGeneration ||
              result.queryFingerprint !=
                  complete.evaluationContext.queryFingerprint)) {
        _invalidResponse();
      }
      if (result is CustomerBiteSaverRedemptionValidationResult &&
          result.evaluatedAtMillis !=
              complete.evaluationContext.evaluationAtMillis) {
        _invalidResponse();
      }
    }
    return response;
  }

  @override
  Future<CustomerBiteSaverFavoriteStatesResponse>
  getCustomerBiteSaverFavoriteStates(
    CustomerBiteSaverFavoriteStatesRequest request,
  ) async {
    final response = await _invoke(
      favoriteStatesCallableName,
      request.toJson(),
      CustomerBiteSaverFavoriteStatesResponse.fromJson,
    );
    final expectedIds = <String>[
      ...request.restaurantIds.map((id) => id.value),
      ...request.offerIds.map((id) => id.value),
    ];
    if (response.states.length != expectedIds.length) {
      _invalidResponse();
    }
    for (var index = 0; index < expectedIds.length; index += 1) {
      if (response.states[index].idValue != expectedIds[index]) {
        _invalidResponse();
      }
    }
    return response;
  }

  @override
  Future<CustomerBiteSaverSavedPageResult> getCustomerBiteSaverSavedPage(
    CustomerBiteSaverSavedPageRequest request,
  ) async {
    final response = await _invoke(
      savedPageCallableName,
      request.toJson(),
      CustomerBiteSaverSavedPageResult.fromJson,
    );
    if (response.section != request.section ||
        (request.cursor != null && response.nextCursor == request.cursor)) {
      _invalidResponse();
    }
    return response;
  }

  @override
  Future<CustomerBiteSaverMenuPageResult> getCustomerBiteSaverSavedMenuPage(
    CustomerBiteSaverSavedMenuPageRequest request,
  ) async {
    final response = await _invoke(
      savedMenuPageCallableName,
      request.toJson(),
      CustomerBiteSaverMenuPageResult.fromJson,
    );
    if (request.cursor != null && response.nextCursor == request.cursor) {
      _invalidResponse();
    }
    return response;
  }

  @override
  Future<
    CustomerBiteSaverEndpointResponse<
      CustomerBiteSaverRedemptionValidationResult
    >
  >
  validateCustomerBiteSaverOfferRedemptionStart(
    CustomerBiteSaverRedemptionValidationRequest request,
  ) async {
    final response = await _invoke(
      redemptionValidationCallableName,
      request.toJson(),
      (value) => parseCustomerBiteSaverEndpointResponse(
        value,
        expectedOperation: CustomerBiteSaverGuestOperation.redemptionStart,
        resultParser: CustomerBiteSaverRedemptionValidationResult.fromJson,
      ),
    );
    _corroborateResponseContext(response, request.binding);
    final result = _completedResult(response);
    if (result != null &&
        (result.restaurantId != request.restaurantId ||
            result.offerId != request.offerId)) {
      _invalidResponse();
    }
    final context = _completedEvaluationContext(response);
    if (result != null &&
        result.evaluatedAtMillis != context!.evaluationAtMillis) {
      _invalidResponse();
    }
    return response;
  }

  @override
  Future<CustomerBiteSaverRedemptionStartResult>
  startCustomerBiteSaverOfferRedemption(
    CustomerBiteSaverRedemptionStartRequest request,
  ) async {
    final result = await _invoke(
      redemptionStartCallableName,
      request.toJson(),
      CustomerBiteSaverRedemptionStartResult.fromJson,
    );
    if (result.restaurantId != request.restaurantId ||
        result.offerId != request.offerId) {
      _invalidResponse();
    }
    return result;
  }

  Future<T> _invoke<T>(
    String callableName,
    Map<String, Object?> request,
    T Function(Object? value) parser,
  ) async {
    final Object? raw;
    try {
      raw = await _transport(
        callableName,
        Map<String, Object?>.unmodifiable(request),
      );
    } on CustomerBiteSaverServiceException {
      rethrow;
    } on CustomerBiteSaverCallableTransportException catch (error) {
      throw CustomerBiteSaverServiceException(
        kind: CustomerBiteSaverServiceFailureKind.callable,
        code: error.code,
        message: error.message,
        cause: error.cause ?? error,
      );
    } on FirebaseFunctionsException catch (error) {
      final normalizedCode = error.code.startsWith('functions/')
          ? error.code.substring('functions/'.length)
          : error.code;
      throw CustomerBiteSaverServiceException(
        kind: _firebaseTransportFailureCodes.contains(normalizedCode)
            ? CustomerBiteSaverServiceFailureKind.transport
            : CustomerBiteSaverServiceFailureKind.callable,
        code: error.code,
        message: error.message ?? 'The BiteSaver service rejected the request.',
        cause: error,
      );
    } catch (error) {
      throw CustomerBiteSaverServiceException(
        kind: CustomerBiteSaverServiceFailureKind.transport,
        code: 'transport-error',
        message: 'The BiteSaver service could not be reached.',
        cause: error,
      );
    }

    try {
      return parser(raw);
    } on FormatException catch (error) {
      throw CustomerBiteSaverServiceException(
        kind: CustomerBiteSaverServiceFailureKind.invalidResponse,
        code: 'invalid-response',
        message: 'BiteSaver returned an invalid response.',
        cause: error,
      );
    }
  }

  static T? _completedResult<T extends CustomerBiteSaverOperationResult>(
    CustomerBiteSaverEndpointResponse<T> response,
  ) {
    if (response is CustomerBiteSaverDirectResponse<T>) {
      return response.result;
    }
    if (response is CustomerBiteSaverGuestComplete<T>) {
      return response.result;
    }
    return null;
  }

  static CustomerBiteSaverEvaluationContext? _completedEvaluationContext<
    T extends CustomerBiteSaverOperationResult
  >(CustomerBiteSaverEndpointResponse<T> response) {
    if (response is CustomerBiteSaverDirectResponse<T>) {
      return response.evaluationContext;
    }
    if (response is CustomerBiteSaverGuestComplete<T>) {
      return response.evaluationContext;
    }
    return null;
  }

  static CustomerBiteSaverEvaluationContext? _responseEvaluationContext<
    T extends CustomerBiteSaverOperationResult
  >(CustomerBiteSaverEndpointResponse<T> response) {
    if (response is CustomerBiteSaverDirectResponse<T>) {
      return response.evaluationContext;
    }
    if (response is CustomerBiteSaverGuestCheckRequired<T>) {
      return response.evaluationContext;
    }
    if (response is CustomerBiteSaverGuestComplete<T>) {
      return response.evaluationContext;
    }
    return null;
  }

  static void
  _corroborateResponseContext<T extends CustomerBiteSaverOperationResult>(
    CustomerBiteSaverEndpointResponse<T> response,
    CustomerBiteSaverSessionBinding binding,
  ) {
    final context = _responseEvaluationContext(response);
    if (context != null) {
      if (context.sessionId != binding.sessionId) {
        _invalidResponse();
      }
      _corroborateGeneration(
        attemptGeneration: context.attemptGeneration,
        queryFingerprint: context.queryFingerprint,
        binding: binding,
      );
    }
    if (response is CustomerBiteSaverGuestComplete<T>) {
      if (context == null ||
          response.attemptGeneration != context.attemptGeneration ||
          response.queryFingerprint != context.queryFingerprint) {
        _invalidResponse();
      }
      _corroborateGeneration(
        attemptGeneration: response.attemptGeneration,
        queryFingerprint: response.queryFingerprint,
        binding: binding,
      );
    }
  }

  static void _corroborateRestaurantPage(
    CustomerBiteSaverRestaurantPageResult result,
    CustomerBiteSaverEvaluationContext context,
  ) {
    if (result.attemptGeneration != context.attemptGeneration ||
        result.queryFingerprint != context.queryFingerprint) {
      _invalidResponse();
    }
  }

  static void _corroborateGeneration({
    required int attemptGeneration,
    required String queryFingerprint,
    required CustomerBiteSaverSessionBinding binding,
  }) {
    if ((binding.attemptGeneration != null &&
            binding.attemptGeneration != attemptGeneration) ||
        (binding.queryFingerprint != null &&
            binding.queryFingerprint != queryFingerprint)) {
      _invalidResponse();
    }
  }

  static Never _invalidResponse() {
    throw const CustomerBiteSaverServiceException(
      kind: CustomerBiteSaverServiceFailureKind.invalidResponse,
      code: 'invalid-response',
      message: 'BiteSaver returned an invalid response.',
    );
  }

  static Future<Object?> _firebaseTransport(
    String callableName,
    Map<String, Object?> request,
  ) async {
    final functions = FirebaseFunctions.instanceFor(region: region);
    final response = await functions
        .httpsCallable(callableName)
        .call<Object?>(request);
    return response.data;
  }
}
