import 'dart:convert';
import 'dart:math';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

import '../models/restaurant.dart';

typedef BiteSaverCallableInvoker =
    Future<Object?> Function(String callableName, Map<String, dynamic> payload);
typedef BiteSaverRequestIdGenerator = String Function();

enum BiteSaverProfileIntent {
  submitApplication('submitApplication'),
  ownerUpdate('ownerUpdate'),
  adminUpdate('adminUpdate');

  final String wireName;

  const BiteSaverProfileIntent(this.wireName);
}

enum BiteSaverApplicationDecision {
  approve('approve'),
  reject('reject');

  final String wireName;

  const BiteSaverApplicationDecision(this.wireName);
}

enum BiteSaverLifecycleFailureKind {
  invalidProfile,
  addressNotFound,
  addressAmbiguous,
  geocoderUnavailable,
  unauthenticated,
  permissionDenied,
  missingAccount,
  staleProfile,
  invalidLifecycleState,
  requestIdCollision,
  duplicateInFlight,
  invalidResponse,
  internal,
}

@immutable
class BiteSaverOptionalField<T> {
  final bool isIncluded;
  final T? value;

  const BiteSaverOptionalField.omitted() : isIncluded = false, value = null;

  const BiteSaverOptionalField.included(this.value) : isIncluded = true;
}

@immutable
class BiteSaverRestaurantProfileInput {
  static final RegExp _unsupportedSingleLineCharacterPattern = RegExp(
    r'[\p{Cc}\p{Cf}]',
    unicode: true,
  );

  final String restaurantName;
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;
  final String phone;
  final BiteSaverOptionalField<String> website;
  final BiteSaverOptionalField<String> bio;
  final BiteSaverOptionalField<String> mainImageUrl;
  final BiteSaverOptionalField<List<RestaurantBusinessHours>> businessHours;

  const BiteSaverRestaurantProfileInput({
    required this.restaurantName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.phone,
    this.website = const BiteSaverOptionalField<String>.omitted(),
    this.bio = const BiteSaverOptionalField<String>.omitted(),
    this.mainImageUrl = const BiteSaverOptionalField<String>.omitted(),
    this.businessHours =
        const BiteSaverOptionalField<List<RestaurantBusinessHours>>.omitted(),
  });

  Map<String, dynamic> toCallableProfile() {
    final profile = <String, dynamic>{
      'restaurantName': _normalizeSingleLine(restaurantName),
      'streetAddress': _normalizeSingleLine(streetAddress),
      'city': _normalizeSingleLine(city),
      'state': _normalizeSingleLine(state).toUpperCase(),
      'zipCode': _normalizeSingleLine(zipCode),
      'phone': _normalizeSingleLine(phone),
      // B1 treats an omitted website and a blank website identically: both
      // clear the stored value. Use one accepted wire representation so the
      // callable payload and request-ID binding share those semantics.
      'website': _normalizeOptionalSingleLine(
        website.isIncluded ? website.value : null,
      ),
    };
    if (bio.isIncluded) {
      profile['bio'] = _normalizeOptionalMultiline(bio.value);
    }
    if (mainImageUrl.isIncluded) {
      profile['mainImageUrl'] = _normalizeOptionalSingleLine(
        mainImageUrl.value,
      );
    }
    if (businessHours.isIncluded) {
      profile['businessHours'] = _normalizedBusinessHours(
        businessHours.value ?? const <RestaurantBusinessHours>[],
      );
    }
    return profile;
  }

  static List<Map<String, dynamic>> _normalizedBusinessHours(
    List<RestaurantBusinessHours> hours,
  ) {
    if (hours.isEmpty) {
      return const <Map<String, dynamic>>[];
    }

    if (hours.length != Restaurant.businessDayNames.length) {
      _throwInvalidBusinessHours();
    }

    final seenDays = <String>{};
    final normalizedHours = <Map<String, dynamic>>[];
    for (final entry in hours) {
      if (_unsupportedSingleLineCharacterPattern.hasMatch(entry.day) ||
          _unsupportedSingleLineCharacterPattern.hasMatch(entry.opensAt) ||
          _unsupportedSingleLineCharacterPattern.hasMatch(entry.closesAt)) {
        _throwInvalidBusinessHours();
      }
      final day = _normalizeSingleLine(entry.day);
      final opensAt = _normalizeSingleLine(entry.opensAt);
      final closesAt = _normalizeSingleLine(entry.closesAt);
      if (!Restaurant.businessDayNames.contains(day) ||
          !seenDays.add(day) ||
          opensAt.isEmpty ||
          closesAt.isEmpty ||
          opensAt.length > 40 ||
          closesAt.length > 40) {
        _throwInvalidBusinessHours();
      }
      normalizedHours.add(<String, dynamic>{
        'day': day,
        'opensAt': opensAt,
        'closesAt': closesAt,
        'closed': entry.closed,
      });
    }

    if (seenDays.length != Restaurant.businessDayNames.length) {
      _throwInvalidBusinessHours();
    }

    return normalizedHours;
  }

  static Never _throwInvalidBusinessHours() {
    throw const BiteSaverLifecycleException(
      kind: BiteSaverLifecycleFailureKind.invalidProfile,
      code: 'invalid-argument',
      message: 'Business hours must be empty or contain each day exactly once.',
    );
  }
}

@immutable
class BiteSaverProfileSaveRequest {
  final BiteSaverProfileIntent intent;
  final BiteSaverRestaurantProfileInput profile;
  final String? documentId;
  final int? expectedProfileVersion;

  const BiteSaverProfileSaveRequest({
    required this.intent,
    required this.profile,
    this.documentId,
    this.expectedProfileVersion,
  });

  factory BiteSaverProfileSaveRequest.submitApplication({
    required BiteSaverRestaurantProfileInput profile,
  }) {
    return BiteSaverProfileSaveRequest(
      intent: BiteSaverProfileIntent.submitApplication,
      profile: profile,
    );
  }

  factory BiteSaverProfileSaveRequest.ownerUpdate({
    required BiteSaverRestaurantProfileInput profile,
    required int expectedProfileVersion,
  }) {
    return BiteSaverProfileSaveRequest(
      intent: BiteSaverProfileIntent.ownerUpdate,
      profile: profile,
      expectedProfileVersion: expectedProfileVersion,
    );
  }

  factory BiteSaverProfileSaveRequest.adminUpdate({
    required String documentId,
    required BiteSaverRestaurantProfileInput profile,
    required int expectedProfileVersion,
  }) {
    return BiteSaverProfileSaveRequest(
      intent: BiteSaverProfileIntent.adminUpdate,
      documentId: documentId,
      profile: profile,
      expectedProfileVersion: expectedProfileVersion,
    );
  }

  Map<String, dynamic> logicalPayload() {
    final payload = <String, dynamic>{
      'intent': intent.wireName,
      if (intent == BiteSaverProfileIntent.adminUpdate)
        'documentId': _normalizeSingleLine(documentId ?? ''),
      if (intent != BiteSaverProfileIntent.submitApplication)
        'expectedProfileVersion': expectedProfileVersion,
      'profile': profile.toCallableProfile(),
    };
    return payload;
  }

  Map<String, dynamic> callablePayload(String requestId) {
    return <String, dynamic>{
      ...logicalPayload(),
      'requestId': _normalizeSingleLine(requestId),
    };
  }

  String canonicalRepresentation() => jsonEncode(logicalPayload());
}

@immutable
class BiteSaverProfileSaveResult {
  final String documentId;
  final String? approvalStatus;
  final int profileVersion;

  const BiteSaverProfileSaveResult({
    required this.documentId,
    required this.approvalStatus,
    required this.profileVersion,
  });
}

@immutable
class BiteSaverApplicationReviewResult {
  final String documentId;
  final String approvalStatus;
  final int profileVersion;

  const BiteSaverApplicationReviewResult({
    required this.documentId,
    required this.approvalStatus,
    required this.profileVersion,
  });
}

class BiteSaverLifecycleException implements Exception {
  final BiteSaverLifecycleFailureKind kind;
  final String code;
  final String message;

  const BiteSaverLifecycleException({
    required this.kind,
    required this.code,
    required this.message,
  });

  bool get isStaleProfile => kind == BiteSaverLifecycleFailureKind.staleProfile;

  @override
  String toString() => message;
}

/// Injection-friendly callable failure used by tests and alternate transports.
@immutable
class BiteSaverCallableFailure implements Exception {
  final String code;
  final String? message;

  const BiteSaverCallableFailure(this.code, [this.message]);
}

class BiteSaverProfileOperationState {
  final BiteSaverRequestIdGenerator _requestIdGenerator;

  String? _canonicalRequest;
  String? _requestId;
  bool _isInFlight = false;

  BiteSaverProfileOperationState({
    BiteSaverRequestIdGenerator requestIdGenerator = generateBiteSaverRequestId,
  }) : _requestIdGenerator = requestIdGenerator;

  bool get isInFlight => _isInFlight;

  @visibleForTesting
  String? get retainedRequestId => _requestId;

  Future<T> execute<T>({
    required BiteSaverProfileSaveRequest request,
    required String logicalTarget,
    required Future<T> Function(String requestId) invoke,
  }) async {
    if (_isInFlight) {
      throw const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.duplicateInFlight,
        code: 'already-in-progress',
        message: 'This restaurant profile request is already in progress.',
      );
    }

    final normalizedTarget = _normalizeSingleLine(logicalTarget);
    if (normalizedTarget.isEmpty) {
      throw const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.internal,
        code: 'invalid-request-target',
        message: 'Could not prepare the restaurant profile request.',
      );
    }
    final canonicalRequest = jsonEncode(<String, dynamic>{
      'logicalTarget': normalizedTarget,
      'request': request.logicalPayload(),
    });
    if (_canonicalRequest != canonicalRequest || _requestId == null) {
      final generated = _requestIdGenerator().trim();
      if (generated.isEmpty) {
        throw const BiteSaverLifecycleException(
          kind: BiteSaverLifecycleFailureKind.internal,
          code: 'invalid-request-id',
          message: 'Could not prepare the restaurant profile request.',
        );
      }
      _canonicalRequest = canonicalRequest;
      _requestId = generated;
    }

    _isInFlight = true;
    try {
      final result = await invoke(_requestId!);
      _canonicalRequest = null;
      _requestId = null;
      return result;
    } on BiteSaverLifecycleException catch (error) {
      if (error.kind == BiteSaverLifecycleFailureKind.requestIdCollision) {
        // The backend has confirmed that this ID belongs to another logical
        // request, so retrying it can never succeed.
        _canonicalRequest = null;
        _requestId = null;
      }
      rethrow;
    } finally {
      _isInFlight = false;
    }
  }
}

class BiteSaverRestaurantLifecycleService {
  static const String region = 'us-central1';
  static const String saveCallableName = 'saveBiteSaverRestaurantProfile';
  static const String reviewCallableName = 'reviewBiteSaverApplication';

  final BiteSaverCallableInvoker _invokeCallable;
  final BiteSaverRequestIdGenerator _requestIdGenerator;

  BiteSaverRestaurantLifecycleService({
    BiteSaverCallableInvoker invokeCallable = _invokeProductionCallable,
    BiteSaverRequestIdGenerator requestIdGenerator = generateBiteSaverRequestId,
  }) : _invokeCallable = invokeCallable,
       _requestIdGenerator = requestIdGenerator;

  BiteSaverProfileOperationState createOperationState() {
    return BiteSaverProfileOperationState(
      requestIdGenerator: _requestIdGenerator,
    );
  }

  Future<BiteSaverProfileSaveResult> saveProfile({
    required BiteSaverProfileIntent intent,
    required String requestId,
    required BiteSaverRestaurantProfileInput profile,
    String? documentId,
    int? expectedProfileVersion,
  }) {
    return save(
      BiteSaverProfileSaveRequest(
        intent: intent,
        profile: profile,
        documentId: documentId,
        expectedProfileVersion: expectedProfileVersion,
      ),
      requestId: requestId,
    );
  }

  Future<BiteSaverProfileSaveResult> save(
    BiteSaverProfileSaveRequest request, {
    required String requestId,
  }) async {
    _validateSaveRequest(request, requestId);
    try {
      final raw = await _invokeCallable(
        saveCallableName,
        request.callablePayload(requestId),
      );
      return _parseSaveResult(raw, expectedDocumentId: request.documentId);
    } catch (error) {
      throw _controlledException(error);
    }
  }

  Future<BiteSaverApplicationReviewResult> reviewApplication({
    required String documentId,
    required BiteSaverApplicationDecision decision,
    required int expectedProfileVersion,
  }) async {
    final normalizedDocumentId = documentId.trim();
    if (normalizedDocumentId.isEmpty || expectedProfileVersion < 0) {
      throw const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.invalidProfile,
        code: 'invalid-argument',
        message: 'The restaurant review request is incomplete.',
      );
    }
    try {
      final raw = await _invokeCallable(reviewCallableName, <String, dynamic>{
        'documentId': normalizedDocumentId,
        'decision': decision.wireName,
        'expectedProfileVersion': expectedProfileVersion,
      });
      return _parseReviewResult(
        raw,
        expectedDocumentId: normalizedDocumentId,
        expectedDecision: decision,
      );
    } catch (error) {
      throw _controlledException(error);
    }
  }

  static void _validateSaveRequest(
    BiteSaverProfileSaveRequest request,
    String requestId,
  ) {
    if (requestId.trim().isEmpty) {
      throw const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.invalidProfile,
        code: 'invalid-argument',
        message: 'Could not prepare the restaurant profile request.',
      );
    }
    switch (request.intent) {
      case BiteSaverProfileIntent.submitApplication:
        if (request.documentId != null ||
            request.expectedProfileVersion != null) {
          throw const BiteSaverLifecycleException(
            kind: BiteSaverLifecycleFailureKind.invalidProfile,
            code: 'invalid-argument',
            message: 'The restaurant application request is invalid.',
          );
        }
        return;
      case BiteSaverProfileIntent.ownerUpdate:
        if (request.documentId != null ||
            request.expectedProfileVersion == null ||
            request.expectedProfileVersion! < 0) {
          throw const BiteSaverLifecycleException(
            kind: BiteSaverLifecycleFailureKind.invalidProfile,
            code: 'invalid-argument',
            message: 'The restaurant profile update is incomplete.',
          );
        }
        return;
      case BiteSaverProfileIntent.adminUpdate:
        if ((request.documentId ?? '').trim().isEmpty ||
            request.expectedProfileVersion == null ||
            request.expectedProfileVersion! < 0) {
          throw const BiteSaverLifecycleException(
            kind: BiteSaverLifecycleFailureKind.invalidProfile,
            code: 'invalid-argument',
            message: 'The administrator profile update is incomplete.',
          );
        }
        return;
    }
  }

  static BiteSaverProfileSaveResult _parseSaveResult(
    Object? raw, {
    String? expectedDocumentId,
  }) {
    final data = _responseMap(raw);
    final documentId = _requiredResponseString(data, 'documentId');
    if (expectedDocumentId != null && documentId != expectedDocumentId.trim()) {
      throw _invalidResponse();
    }
    return BiteSaverProfileSaveResult(
      documentId: documentId,
      approvalStatus: _optionalApprovalStatus(data['approvalStatus']),
      profileVersion: _requiredVersion(data, 'profileVersion', minimumValue: 1),
    );
  }

  static BiteSaverApplicationReviewResult _parseReviewResult(
    Object? raw, {
    required String expectedDocumentId,
    required BiteSaverApplicationDecision expectedDecision,
  }) {
    final data = _responseMap(raw);
    final documentId = _requiredResponseString(data, 'documentId');
    final approvalStatus = _optionalApprovalStatus(data['approvalStatus']);
    final expectedApprovalStatus =
        expectedDecision == BiteSaverApplicationDecision.approve
        ? 'approved'
        : 'rejected';
    if (documentId != expectedDocumentId ||
        approvalStatus != expectedApprovalStatus) {
      throw _invalidResponse();
    }
    return BiteSaverApplicationReviewResult(
      documentId: documentId,
      approvalStatus: approvalStatus!,
      profileVersion: _requiredVersion(data, 'profileVersion'),
    );
  }
}

Future<Object?> _invokeProductionCallable(
  String callableName,
  Map<String, dynamic> payload,
) async {
  final functions = FirebaseFunctions.instanceFor(
    region: BiteSaverRestaurantLifecycleService.region,
  );
  final result = await functions.httpsCallable(callableName).call(payload);
  return result.data;
}

BiteSaverLifecycleException _controlledException(Object error) {
  if (error is BiteSaverLifecycleException) {
    return error;
  }
  if (error is FirebaseFunctionsException) {
    return _mapCallableFailure(error.code, error.message);
  }
  if (error is BiteSaverCallableFailure) {
    return _mapCallableFailure(error.code, error.message);
  }
  return const BiteSaverLifecycleException(
    kind: BiteSaverLifecycleFailureKind.internal,
    code: 'internal',
    message: 'Could not complete the restaurant request right now.',
  );
}

BiteSaverLifecycleException _mapCallableFailure(
  String code,
  String? rawMessage,
) {
  final normalizedCode = code.trim().toLowerCase();
  final message = rawMessage?.toLowerCase() ?? '';

  switch (normalizedCode) {
    case 'invalid-argument':
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.invalidProfile,
        code: 'invalid-argument',
        message:
            'Check the restaurant profile and enter a complete United States address.',
      );
    case 'unauthenticated':
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.unauthenticated,
        code: 'unauthenticated',
        message: 'Please sign in again before saving this restaurant.',
      );
    case 'permission-denied':
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.permissionDenied,
        code: 'permission-denied',
        message: 'You do not have permission to change this restaurant.',
      );
    case 'not-found':
      if (message.contains('address')) {
        return const BiteSaverLifecycleException(
          kind: BiteSaverLifecycleFailureKind.addressNotFound,
          code: 'not-found',
          message:
              'No matching restaurant address was found. Check it and try again.',
        );
      }
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.missingAccount,
        code: 'not-found',
        message: 'This restaurant account no longer exists. Refresh and retry.',
      );
    case 'failed-precondition':
      if (message.contains('request id')) {
        return const BiteSaverLifecycleException(
          kind: BiteSaverLifecycleFailureKind.requestIdCollision,
          code: 'failed-precondition',
          message:
              'This profile request conflicts with an earlier request. Review the form and retry.',
        );
      }
      if (message.contains('address lookup') &&
          message.contains('not configured')) {
        return const BiteSaverLifecycleException(
          kind: BiteSaverLifecycleFailureKind.geocoderUnavailable,
          code: 'failed-precondition',
          message:
              'Restaurant address validation is temporarily unavailable. Try again.',
        );
      }
      if (message.contains('multiple matching') ||
          message.contains('more specific') ||
          message.contains('precise united states street address')) {
        return const BiteSaverLifecycleException(
          kind: BiteSaverLifecycleFailureKind.addressAmbiguous,
          code: 'failed-precondition',
          message:
              'The address could not be verified. Enter a more specific street address.',
        );
      }
      if (message.contains('trusted location')) {
        return const BiteSaverLifecycleException(
          kind: BiteSaverLifecycleFailureKind.invalidLifecycleState,
          code: 'failed-precondition',
          message:
              'This application needs a validated address. Edit and save the restaurant profile first.',
        );
      }
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.invalidLifecycleState,
        code: 'failed-precondition',
        message:
            'This restaurant is not in the required state for that action. Refresh and retry.',
      );
    case 'aborted':
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.staleProfile,
        code: 'aborted',
        message:
            'The restaurant profile changed. Reload the latest version and try again.',
      );
    case 'deadline-exceeded':
    case 'unavailable':
      return BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.geocoderUnavailable,
        code: normalizedCode,
        message:
            'Restaurant address validation is temporarily unavailable. Try again.',
      );
    case 'internal':
    default:
      return const BiteSaverLifecycleException(
        kind: BiteSaverLifecycleFailureKind.internal,
        code: 'internal',
        message: 'Could not complete the restaurant request right now.',
      );
  }
}

Map<String, dynamic> _responseMap(Object? raw) {
  if (raw is! Map) {
    throw _invalidResponse();
  }
  try {
    return Map<String, dynamic>.from(raw);
  } catch (_) {
    throw _invalidResponse();
  }
}

String _requiredResponseString(Map<String, dynamic> data, String key) {
  final value = data[key];
  if (value is! String || value.trim().isEmpty) {
    throw _invalidResponse();
  }
  return value.trim();
}

String? _optionalApprovalStatus(Object? value) {
  if (value == null) {
    return null;
  }
  if (value is! String) {
    throw _invalidResponse();
  }
  final normalized = value.trim().toLowerCase();
  if (normalized != 'pending' &&
      normalized != 'approved' &&
      normalized != 'rejected') {
    throw _invalidResponse();
  }
  return normalized;
}

int _requiredVersion(
  Map<String, dynamic> data,
  String key, {
  int minimumValue = 0,
}) {
  final value = data[key];
  if (value is int && value >= minimumValue) {
    return value;
  }
  throw _invalidResponse();
}

BiteSaverLifecycleException _invalidResponse() {
  return const BiteSaverLifecycleException(
    kind: BiteSaverLifecycleFailureKind.invalidResponse,
    code: 'internal',
    message: 'The restaurant service returned an invalid response.',
  );
}

String _normalizeSingleLine(String value) {
  return value.trim().replaceAll(RegExp(r'\s+'), ' ');
}

String _normalizeOptionalSingleLine(String? value) {
  return _normalizeSingleLine(value ?? '');
}

String _normalizeOptionalMultiline(String? value) {
  return (value ?? '')
      .replaceAll(RegExp(r'\r\n?'), '\n')
      .split('\n')
      .map((line) => line.trim().replaceAll(RegExp(r'\s+'), ' '))
      .join('\n')
      .trim();
}

String generateBiteSaverRequestId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-'
      '${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-'
      '${hex.substring(20)}';
}
