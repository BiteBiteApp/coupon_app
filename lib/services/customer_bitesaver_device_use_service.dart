import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../models/customer_bitesaver_device_usage.dart';
import 'customer_bitesaver_device_proof_service.dart';

typedef CustomerBiteSaverDeviceUseTransport =
    Future<Object?> Function(String callableName, Map<String, Object?> request);

typedef CustomerBiteSaverDeviceUseExpiryTimerFactory =
    Timer Function(Duration duration, void Function() callback);

enum CustomerBiteSaverDeviceUseFailureKind {
  unsupported,
  proof,
  rejected,
  temporaryCooldown,
  ambiguous,
  invalidResponse,
  stale,
  disposed,
}

final class CustomerBiteSaverDeviceUseTransportException implements Exception {
  const CustomerBiteSaverDeviceUseTransportException({
    required this.code,
    required this.ambiguous,
    this.retryAfterMillis,
  });

  final String code;
  final bool ambiguous;
  final int? retryAfterMillis;

  factory CustomerBiteSaverDeviceUseTransportException.fromFirebase(
    FirebaseFunctionsException error,
  ) => CustomerBiteSaverDeviceUseTransportException(
    code: CustomerBiteSaverDeviceUseService._sanitizeTransportCode(error.code),
    ambiguous: CustomerBiteSaverDeviceUseService._ambiguousFirebaseCodes
        .contains(error.code),
    retryAfterMillis: error.code == 'resource-exhausted'
        ? CustomerBiteSaverDeviceUseService._retryAfterMillis(error.details)
        : null,
  );

  @override
  String toString() => 'CustomerBiteSaverDeviceUseTransportException($code)';
}

final class CustomerBiteSaverDeviceUseException implements Exception {
  const CustomerBiteSaverDeviceUseException({
    required this.kind,
    required this.code,
    this.cause,
    this.retryAfterMillis,
  });

  final CustomerBiteSaverDeviceUseFailureKind kind;
  final String code;
  final Object? cause;
  final int? retryAfterMillis;

  @override
  String toString() => 'CustomerBiteSaverDeviceUseException($code)';
}

final class CustomerBiteSaverDeviceUseService {
  CustomerBiteSaverDeviceUseService({
    required CustomerBiteSaverDeviceProofService proofService,
    CustomerBiteSaverDeviceUseTransport? transport,
    CustomerBiteSaverDeviceElapsedClock? elapsedClock,
    CustomerBiteSaverDeviceUseExpiryTimerFactory? expiryTimerFactory,
  }) : _proofService = proofService,
       _transport = transport ?? _firebaseTransport,
       _elapsedClock =
           elapsedClock ??
           CustomerBiteSaverDeviceProofContract.monotonicElapsed,
       _expiryTimerFactory = expiryTimerFactory ?? _defaultExpiryTimerFactory;

  static const String region = 'us-central1';
  static const Set<String> _ambiguousFirebaseCodes = <String>{
    'cancelled',
    'deadline-exceeded',
    'internal',
    'unknown',
    'unavailable',
  };

  final CustomerBiteSaverDeviceProofService _proofService;
  final CustomerBiteSaverDeviceUseTransport _transport;
  final CustomerBiteSaverDeviceElapsedClock _elapsedClock;
  final CustomerBiteSaverDeviceUseExpiryTimerFactory _expiryTimerFactory;

  _PendingDeviceUse? _pending;
  Timer? _pendingExpiryTimer;
  _InFlightDeviceUse? _inFlight;
  int _generation = 0;
  bool _disposed = false;

  static Timer _defaultExpiryTimerFactory(
    Duration duration,
    void Function() callback,
  ) => Timer(duration, callback);

  static Future<Object?> _firebaseTransport(
    String callableName,
    Map<String, Object?> request,
  ) async {
    try {
      final callable = FirebaseFunctions.instanceFor(
        region: region,
      ).httpsCallable(callableName);
      return (await callable.call<Object?>(request)).data;
    } on FirebaseFunctionsException catch (error) {
      throw CustomerBiteSaverDeviceUseTransportException.fromFirebase(error);
    } catch (_) {
      throw const CustomerBiteSaverDeviceUseTransportException(
        code: 'transport-failure',
        ambiguous: true,
      );
    }
  }

  /// Performs work only when explicitly called by a confirmed coupon-use path.
  /// An ambiguous retry of the identical frozen request reuses the exact proof.
  Future<CustomerBiteSaverDeviceUseResult> useCoupon({
    required CustomerBiteSaverCombinedUseRequest request,
    required String? authenticatedUserId,
    bool forceEnrollmentOrRecovery = false,
  }) {
    if (_disposed) {
      return Future<CustomerBiteSaverDeviceUseResult>.error(
        const CustomerBiteSaverDeviceUseException(
          kind: CustomerBiteSaverDeviceUseFailureKind.disposed,
          code: 'device-use-service-disposed',
        ),
      );
    }
    final normalizedUid = _validateAuthenticatedUserId(authenticatedUserId);
    final operationKey = _operationKey(
      request,
      normalizedUid,
      forceEnrollmentOrRecovery,
    );
    final existing = _inFlight;
    if (existing != null && existing.key == operationKey) {
      return existing.future;
    }
    if (existing != null ||
        (_pending != null && _pending!.operationKey != operationKey)) {
      _invalidateCurrentWork();
    }
    final generation = _generation;
    late final Future<CustomerBiteSaverDeviceUseResult> future;
    future =
        _run(
          request: request,
          authenticatedUserId: normalizedUid,
          operationKey: operationKey,
          generation: generation,
          forceEnrollmentOrRecovery: forceEnrollmentOrRecovery,
        ).whenComplete(() {
          final current = _inFlight;
          if (current != null && identical(current.future, future)) {
            _inFlight = null;
          }
        });
    _inFlight = _InFlightDeviceUse(operationKey, future);
    return future;
  }

  void cancel() => _invalidateCurrentWork();

  void discardForAuthChange() => _invalidateCurrentWork();

  void discardForRequestIdentityChange() => _invalidateCurrentWork();

  void discardForTargetChange() => _invalidateCurrentWork();

  void discardForBrowseContextChange() => _invalidateCurrentWork();

  void discardForSavedGenerationChange() => _invalidateCurrentWork();

  void discardForLocationOrTimeChange() => _invalidateCurrentWork();

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _invalidateCurrentWork();
  }

  Future<CustomerBiteSaverDeviceUseResult> _run({
    required CustomerBiteSaverCombinedUseRequest request,
    required String? authenticatedUserId,
    required String operationKey,
    required int generation,
    required bool forceEnrollmentOrRecovery,
  }) async {
    final retry = _pending;
    if (retry != null && retry.operationKey == operationKey) {
      if (retry.challenge.isLocallyUsable) {
        _assertCurrent(generation);
        return _submit(retry, generation);
      }
      _clearPending();
    }

    late final CustomerBiteSaverDevicePlatform platform;
    try {
      platform = _proofService.platform;
    } on CustomerBiteSaverDeviceProofException catch (error) {
      throw _translateProofFailure(error);
    }
    late final CustomerBiteSaverDeviceCapability capability;
    try {
      capability = await _proofService.getCapability();
    } on CustomerBiteSaverDeviceProofException catch (error) {
      throw _translateProofFailure(error);
    }
    _assertCurrent(generation);
    _requireCapability(capability);

    late final bool enroll;
    try {
      enroll =
          forceEnrollmentOrRecovery ||
          capability.credentialState ==
              CustomerBiteSaverDeviceCredentialState.missing;
      if (!enroll &&
          capability.credentialState !=
              CustomerBiteSaverDeviceCredentialState.available) {
        final code = switch (capability.credentialState) {
          CustomerBiteSaverDeviceCredentialState.corrupt =>
            'device-proof-credential-corrupt',
          CustomerBiteSaverDeviceCredentialState.unavailable =>
            'device-proof-credential-unavailable',
          _ => 'device-proof-credential-error',
        };
        throw CustomerBiteSaverDeviceProofException(
          kind: CustomerBiteSaverDeviceProofFailureKind.corruptCredential,
          code: code,
        );
      }
      if (enroll && !capability.providerAvailable) {
        throw const CustomerBiteSaverDeviceProofException(
          kind: CustomerBiteSaverDeviceProofFailureKind.unavailable,
          code: 'device-proof-provider-unavailable',
        );
      }
    } on CustomerBiteSaverDeviceProofException catch (error) {
      throw _translateProofFailure(error);
    }

    final admissionValue = await _invokeCurrent(
      CustomerBiteSaverDeviceProofContract.useCouponCallableName,
      <String, Object?>{
        'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
        'operation': 'admitChallenge',
        'platform': platform.name,
        'request': request.toJson(),
      },
      generation,
    );
    late final CustomerBiteSaverDeviceChallengeAdmission admission;
    try {
      admission = CustomerBiteSaverDeviceChallengeAdmission.fromJson(
        admissionValue,
      );
    } on FormatException catch (error) {
      throw CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.invalidResponse,
        code: 'device-use-invalid-admission',
        cause: error,
      );
    }

    // This clock starts at challenge issuance, not at the earlier admission.
    // Consumption checks permit expiry before returning a fresh challenge.
    final requestStartedAtElapsed = _elapsedClock();
    final challengeValue = await _invokeCurrent(
      CustomerBiteSaverDeviceProofContract.issueChallengeCallableName,
      <String, Object?>{
        'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
        'platform': platform.name,
        'request': request.toJson(),
        'admissionHandle': admission.admissionHandle,
        'permit': admission.permit,
      },
      generation,
    );
    _assertCurrent(generation);

    late final CustomerBiteSaverDeviceChallenge challenge;
    try {
      challenge = CustomerBiteSaverDeviceChallenge.fromJson(
        challengeValue,
        requestStartedAtElapsed: requestStartedAtElapsed,
        elapsedClock: _elapsedClock,
      );
      _corroborateChallenge(
        challenge: challenge,
        request: request,
        authenticatedUserId: authenticatedUserId,
        platform: platform,
      );
      if (!challenge.isLocallyUsable) {
        throw const CustomerBiteSaverDeviceProtocolException();
      }
    } catch (error) {
      throw CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.invalidResponse,
        code: 'device-use-invalid-challenge',
        cause: error,
      );
    }

    late final CustomerBiteSaverDeviceProof proof;
    try {
      proof = enroll
          ? await _proofService.createEnrollmentProof(challenge)
          : await _proofService.createUseProof(challenge);
    } on CustomerBiteSaverDeviceProofException catch (error) {
      throw _translateProofFailure(error);
    }
    _assertCurrent(generation);
    if (!challenge.isLocallyUsable) {
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.stale,
        code: 'device-use-challenge-expired',
      );
    }

    final pending = _PendingDeviceUse(
      operationKey: operationKey,
      request: Map<String, Object?>.unmodifiable(request.toJson()),
      challenge: challenge,
      proof: proof,
    );
    _retainPendingUntilExpiry(pending);
    return _submit(pending, generation);
  }

  Future<CustomerBiteSaverDeviceUseResult> _submit(
    _PendingDeviceUse pending,
    int generation,
  ) async {
    _assertCurrent(generation);
    // Recheck immediately at every send, including an exact ambiguous retry.
    // Timer callbacks can be delayed, so they are not the eligibility guard.
    if (!pending.challenge.isLocallyUsable) {
      _clearPendingIfIdentical(pending);
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.stale,
        code: 'device-use-challenge-expired',
      );
    }
    Object? value;
    try {
      value = await _invoke(
        CustomerBiteSaverDeviceProofContract.useCouponCallableName,
        <String, Object?>{
          'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
          'challengeId': pending.challenge.challengeId,
          'request': pending.request,
          'proof': pending.proof.toJson(),
        },
      );
    } on CustomerBiteSaverDeviceUseException catch (error) {
      _assertCurrent(generation);
      if (error.kind != CustomerBiteSaverDeviceUseFailureKind.ambiguous) {
        _clearPendingIfIdentical(pending);
      }
      rethrow;
    }
    _assertCurrent(generation);
    try {
      final result = CustomerBiteSaverDeviceUseResult.fromJson(value);
      final request = pending.request;
      if (result.restaurantId.value != request['restaurantId'] ||
          result.offerId.value != request['offerId']) {
        throw const CustomerBiteSaverDeviceProtocolException();
      }
      _clearPendingIfIdentical(pending);
      return result;
    } catch (error) {
      // The server might have committed before returning a malformed/truncated
      // response. Retain only this exact proof until its local elapsed deadline.
      throw CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.invalidResponse,
        code: 'device-use-invalid-result',
        cause: error,
      );
    }
  }

  Future<Object?> _invoke(
    String callableName,
    Map<String, Object?> request,
  ) async {
    try {
      return await _transport(callableName, request);
    } on CustomerBiteSaverDeviceUseTransportException catch (error) {
      throw CustomerBiteSaverDeviceUseException(
        kind: error.code == 'resource-exhausted'
            ? CustomerBiteSaverDeviceUseFailureKind.temporaryCooldown
            : error.ambiguous
            ? CustomerBiteSaverDeviceUseFailureKind.ambiguous
            : CustomerBiteSaverDeviceUseFailureKind.rejected,
        code: error.code,
        cause: error,
        retryAfterMillis: error.code == 'resource-exhausted'
            ? _retryAfterMillis(<String, Object?>{
                'retryAfterMillis': error.retryAfterMillis,
              })
            : null,
      );
    } catch (error) {
      throw CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.ambiguous,
        code: 'transport-failure',
        cause: error,
      );
    }
  }

  Future<Object?> _invokeCurrent(
    String callableName,
    Map<String, Object?> request,
    int generation,
  ) async {
    try {
      return await _invoke(callableName, request);
    } finally {
      _assertCurrent(generation);
    }
  }

  void _corroborateChallenge({
    required CustomerBiteSaverDeviceChallenge challenge,
    required CustomerBiteSaverCombinedUseRequest request,
    required String? authenticatedUserId,
    required CustomerBiteSaverDevicePlatform platform,
  }) {
    if (challenge.platform != platform ||
        challenge.logicalRequestId != request.logicalRequestId ||
        challenge.origin.name != request.origin.kind.name ||
        challenge.authenticatedUserId != authenticatedUserId) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
  }

  static void _requireCapability(CustomerBiteSaverDeviceCapability capability) {
    if (!capability.supported ||
        (capability.platform == CustomerBiteSaverDevicePlatform.ios &&
            !capability.providerAvailable)) {
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.unsupported,
        code: 'device-proof-unsupported',
      );
    }
  }

  static CustomerBiteSaverDeviceUseException _translateProofFailure(
    CustomerBiteSaverDeviceProofException error,
  ) => CustomerBiteSaverDeviceUseException(
    kind: error.kind == CustomerBiteSaverDeviceProofFailureKind.unsupported
        ? CustomerBiteSaverDeviceUseFailureKind.unsupported
        : CustomerBiteSaverDeviceUseFailureKind.proof,
    code: error.code,
    cause: error,
  );

  void _assertCurrent(int generation) {
    if (_disposed) {
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.disposed,
        code: 'device-use-service-disposed',
      );
    }
    if (generation != _generation) {
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.stale,
        code: 'device-use-stale-operation',
      );
    }
  }

  void _invalidateCurrentWork() {
    _generation += 1;
    _clearPending();
    _inFlight = null;
  }

  void _retainPendingUntilExpiry(_PendingDeviceUse pending) {
    _clearPending();
    final remaining = pending.challenge.remainingLocalLifetime;
    if (remaining <= Duration.zero) {
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.stale,
        code: 'device-use-challenge-expired',
      );
    }
    _pending = pending;
    _pendingExpiryTimer = _expiryTimerFactory(remaining, () {
      if (identical(_pending, pending)) {
        _pending = null;
        _pendingExpiryTimer = null;
        _generation += 1;
        _inFlight = null;
      }
    });
  }

  void _clearPending() {
    _pendingExpiryTimer?.cancel();
    _pendingExpiryTimer = null;
    _pending = null;
  }

  void _clearPendingIfIdentical(_PendingDeviceUse pending) {
    if (!identical(_pending, pending)) return;
    _clearPending();
  }

  static String? _validateAuthenticatedUserId(String? value) {
    if (value == null) return null;
    if (!CustomerBiteSaverDeviceProofContract.isValidAuthenticatedUserId(
      value,
    )) {
      throw const CustomerBiteSaverDeviceUseException(
        kind: CustomerBiteSaverDeviceUseFailureKind.invalidResponse,
        code: 'device-use-invalid-auth-binding',
      );
    }
    return value;
  }

  static String _operationKey(
    CustomerBiteSaverCombinedUseRequest request,
    String? authenticatedUserId,
    bool forceEnrollmentOrRecovery,
  ) =>
      '${authenticatedUserId == null ? '0:' : '1:$authenticatedUserId'}\u0000'
      '${forceEnrollmentOrRecovery ? 'enroll' : 'auto'}\u0000'
      '${request.localFenceKey}';

  static String _sanitizeTransportCode(String value) {
    if (RegExp(r'^[a-z0-9-]{1,64}$').hasMatch(value)) return value;
    return 'transport-failure';
  }

  static int? _retryAfterMillis(Object? details) {
    final value = details is Map ? details['retryAfterMillis'] : null;
    return value is int &&
            value > 0 &&
            value <=
                CustomerBiteSaverDeviceProofContract
                    .challengeLifetimeMilliseconds
        ? value
        : null;
  }
}

final class _PendingDeviceUse {
  const _PendingDeviceUse({
    required this.operationKey,
    required this.request,
    required this.challenge,
    required this.proof,
  });

  final String operationKey;
  final Map<String, Object?> request;
  final CustomerBiteSaverDeviceChallenge challenge;
  final CustomerBiteSaverDeviceProof proof;
}

final class _InFlightDeviceUse {
  const _InFlightDeviceUse(this.key, this.future);

  final String key;
  final Future<CustomerBiteSaverDeviceUseResult> future;
}
