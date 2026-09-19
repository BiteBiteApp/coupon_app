import 'dart:convert';

import 'customer_bitesaver_favorite.dart';
import '../services/bitesaver_location_search.dart';

const int _maximumSafeJsonInteger = 9007199254740991;

final class CustomerBiteSaverProtocolException extends FormatException {
  const CustomerBiteSaverProtocolException()
    : super('The BiteSaver customer request or response is invalid.');
}

abstract final class CustomerBiteSaverSearchContract {
  static const int schemaVersion = 1;
  static const String protocolVersion = 'bitestar.customer-bitesaver-search.v1';
  static const String restaurantProjectionVersion =
      'bitestar.bitesaver-public-restaurant.v1';
  static const String offerProjectionVersion =
      'bitestar.bitesaver-customer-offer.v2';
  static const int pageSize = 25;
  static const int maximumPageScan = 100;
  static const int maximumGuestCandidates = 75;
  static const int maximumFavoriteRestaurantIds = 25;
  static const int maximumFavoriteOfferIds = 50;
  static const int maximumFavoriteIds = 75;
  static const int maximumOpaquePayloadLength = 32768;
  static const int maximumSearchScalars = 200;
  static const int maximumSearchUtf8Bytes = 800;
  static const int guestCheckLifetimeMilliseconds = 5 * 60 * 1000;
  static const int redemptionTimerMilliseconds = 5 * 60 * 1000;
  static const int redemptionValidationMaximumMilliseconds = 60 * 1000;
  static const int usageEvaluationMaximumLifetimeMilliseconds = 60 * 60 * 1000;
  static const int usageEvaluationMaximumWindowMilliseconds =
      52 * 60 * 60 * 1000 + 60 * 1000 + 1;
  static const int freshLocationMaximumAgeMilliseconds = 2 * 60 * 1000;
  static const Set<int> supportedRadiiMiles = <int>{1, 3, 5, 10, 15, 20, 30};
}

Map<String, Object?> _record(Object? value) {
  if (value is! Map) {
    throw const CustomerBiteSaverProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const CustomerBiteSaverProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _exactKeys(Map<String, Object?> value, Set<String> expected) {
  if (value.length != expected.length ||
      value.keys.any((key) => !expected.contains(key))) {
    throw const CustomerBiteSaverProtocolException();
  }
}

int _safeInteger(
  Object? value, {
  int minimum = 0,
  int maximum = _maximumSafeJsonInteger,
}) {
  if (value is! int || value < minimum || value > maximum) {
    throw const CustomerBiteSaverProtocolException();
  }
  return value;
}

double _finiteNumber(Object? value, {double? minimum, double? maximum}) {
  if (value is! num || !value.isFinite) {
    throw const CustomerBiteSaverProtocolException();
  }
  final parsed = value.toDouble();
  if ((minimum != null && parsed < minimum) ||
      (maximum != null && parsed > maximum)) {
    throw const CustomerBiteSaverProtocolException();
  }
  return parsed;
}

bool _boolean(Object? value) {
  if (value is! bool) {
    throw const CustomerBiteSaverProtocolException();
  }
  return value;
}

bool _wellFormedUtf16(String value) {
  final units = value.codeUnits;
  for (var index = 0; index < units.length; index += 1) {
    final unit = units[index];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= units.length) return false;
      final trailing = units[index + 1];
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

String _string(
  Object? value, {
  required int maximumLength,
  bool allowEmpty = false,
  RegExp? pattern,
}) {
  if (value is! String ||
      !_wellFormedUtf16(value) ||
      (!allowEmpty && value.isEmpty) ||
      value.length > maximumLength ||
      (pattern != null && !pattern.hasMatch(value))) {
    throw const CustomerBiteSaverProtocolException();
  }
  return value;
}

String? _nullableString(
  Object? value, {
  required int maximumLength,
  bool allowEmpty = true,
}) {
  if (value == null) return null;
  return _string(value, maximumLength: maximumLength, allowEmpty: allowEmpty);
}

String _boundedScalarText(
  Object? value, {
  required int maximumScalars,
  bool allowEmpty = true,
}) {
  if (value is! String ||
      !_wellFormedUtf16(value) ||
      (!allowEmpty && value.isEmpty) ||
      value.runes.length > maximumScalars ||
      utf8.encode(value).length > maximumScalars * 4) {
    throw const CustomerBiteSaverProtocolException();
  }
  return value;
}

String? _nullableBoundedScalarText(
  Object? value, {
  required int maximumScalars,
}) {
  if (value == null) return null;
  return _boundedScalarText(value, maximumScalars: maximumScalars);
}

List<Object?> _list(Object? value, {int? maximumLength}) {
  if (value is! List ||
      (maximumLength != null && value.length > maximumLength)) {
    throw const CustomerBiteSaverProtocolException();
  }
  return List<Object?>.unmodifiable(value);
}

final RegExp _requestIdPattern = RegExp(r'^[A-Za-z0-9_-]{16,128}$');
final RegExp _fingerprintPattern = RegExp(r'^[0-9a-f]{64}$');
final RegExp _sessionIdPattern = RegExp(r'^bss_[A-Za-z0-9_-]{43}$');
final RegExp _capabilityPattern = RegExp(r'^[A-Za-z0-9_-]{43}$');
final RegExp _validationIdPattern = RegExp(r'^bsv_[A-Za-z0-9_-]{43}$');
final RegExp _redemptionIdPattern = RegExp(r'^bsrd_[A-Za-z0-9_-]{43}$');
final RegExp _operationRefPattern = RegExp(r'^bsgc_[A-Za-z0-9_-]{43}$');
final RegExp _cursorPattern = RegExp(r'^bsc1\.[A-Za-z0-9_-]+$');
final RegExp _occurrencePattern = RegExp(r'^bsoc1\.[A-Za-z0-9_-]+$');
final RegExp _checkTokenPattern = RegExp(r'^bsgc1\.[A-Za-z0-9_-]+$');
final RegExp _menuEntryKeyPattern = RegExp(r'^bsme_[A-Za-z0-9_-]{43}$');

String _requestId(Object? value) =>
    _string(value, maximumLength: 128, pattern: _requestIdPattern);

String _fingerprint(Object? value) =>
    _string(value, maximumLength: 64, pattern: _fingerprintPattern);

String _sessionId(Object? value) =>
    _string(value, maximumLength: 47, pattern: _sessionIdPattern);

String _capability(Object? value) {
  final parsed = _string(value, maximumLength: 43, pattern: _capabilityPattern);
  try {
    final bytes = base64Url.decode('$parsed=');
    if (bytes.length != 32 ||
        base64Url.encode(bytes).replaceAll('=', '') != parsed) {
      throw const CustomerBiteSaverProtocolException();
    }
  } on FormatException {
    throw const CustomerBiteSaverProtocolException();
  }
  return parsed;
}

String? _cursor(Object? value) {
  if (value == null) return null;
  return _string(
    value,
    maximumLength: CustomerBiteSaverSearchContract.maximumOpaquePayloadLength,
    pattern: _cursorPattern,
  );
}

String _occurrence(Object? value) => _string(
  value,
  maximumLength: CustomerBiteSaverSearchContract.maximumOpaquePayloadLength,
  pattern: _occurrencePattern,
);

T _enumValue<T>(Object? value, Map<String, T> values) {
  final result = values[value];
  if (result == null) {
    throw const CustomerBiteSaverProtocolException();
  }
  return result;
}

enum CustomerBiteSaverLocationMode { current, typed }

enum CustomerBiteSaverSearchState { preparing, ready, failed, expired }

enum CustomerBiteSaverPreparationPhase {
  restaurantRanges,
  offerRanges,
  finalizeCandidates,
  verifyCatalogGeneration,
  ready,
}

enum CustomerBiteSaverFailureCode {
  catalogChangedRepeatedly('catalog_changed_repeatedly'),
  invalidPrivateState('invalid_private_state'),
  preparationFailed('preparation_failed');

  const CustomerBiteSaverFailureCode(this.wireName);
  final String wireName;
}

enum CustomerBiteSaverOfferType { coupon, dailySpecial }

enum CustomerBiteSaverUsageState { available, unavailable, unknown }

enum CustomerBiteSaverOfferCountState { current, unknown }

enum CustomerBiteSaverFavoriteState { favorite, notFavorite, unknown }

enum CustomerBiteSaverGuestOperation {
  restaurantPage,
  offerPage,
  redemptionStart,
}

enum CustomerBiteSaverGuestUsagePolicy { oncePerCustomer, oncePerDay }

enum CustomerBiteSaverUsagePolicy {
  oncePerCustomer,
  oncePerDay,
  unlimited,
  reusableAfterTimer,
}

enum CustomerBiteSaverGuestRetryReason {
  guestStateChanged,
  sourceChanged,
  sessionChanged,
  checkExpired,
  workBudget,
}

enum CustomerBiteSaverGuestRestartFrom { originalOperation, search }

enum CustomerBiteSaverRedemptionStatus { started, active, unlimited }

sealed class CustomerBiteSaverTypedLocation {
  const CustomerBiteSaverTypedLocation();

  Map<String, Object?> toJson();
}

final class CustomerBiteSaverZipLocation
    extends CustomerBiteSaverTypedLocation {
  factory CustomerBiteSaverZipLocation(String zip) {
    if (!RegExp(r'^\d{5}(?:-\d{4})?$').hasMatch(zip)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverZipLocation._(zip);
  }

  const CustomerBiteSaverZipLocation._(this.zip);

  final String zip;

  @override
  Map<String, Object?> toJson() => <String, Object?>{'kind': 'zip', 'zip': zip};
}

String _singleLine(String value) =>
    value.trim().replaceAll(RegExp(r'\s+'), ' ');

final class CustomerBiteSaverCityLocation
    extends CustomerBiteSaverTypedLocation {
  factory CustomerBiteSaverCityLocation({required String city, String? state}) {
    if (!_wellFormedUtf16(city)) {
      throw const CustomerBiteSaverProtocolException();
    }
    final normalizedCity = _singleLine(city).toLowerCase();
    if (normalizedCity.isEmpty ||
        normalizedCity.runes.length > 100 ||
        utf8.encode(normalizedCity).length > 400) {
      throw const CustomerBiteSaverProtocolException();
    }
    final normalizedState = state == null
        ? null
        : BiteSaverLocationSearch.canonicalUsStateCode(state);
    if (state != null && normalizedState == null) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverCityLocation._(
      city: normalizedCity,
      state: normalizedState,
    );
  }

  const CustomerBiteSaverCityLocation._({required this.city, this.state});

  final String city;
  final String? state;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': 'city',
    'city': city,
    'state': state,
  };
}

final class CustomerBiteSaverSearchCriteria {
  factory CustomerBiteSaverSearchCriteria({
    required double latitude,
    required double longitude,
    required int radiusMiles,
    required CustomerBiteSaverLocationMode locationMode,
    required CustomerBiteSaverTypedLocation? typedLocation,
    required String searchText,
    required String timeZone,
    required int utcOffsetMinutes,
  }) {
    if (!BiteSaverLocationSearch.hasValidCoordinates(latitude, longitude) ||
        !CustomerBiteSaverSearchContract.supportedRadiiMiles.contains(
          radiusMiles,
        ) ||
        (locationMode == CustomerBiteSaverLocationMode.current) !=
            (typedLocation == null) ||
        !BiteSaverLocationSearch.isValidCompatibilitySearchText(searchText) ||
        !_wellFormedUtf16(timeZone) ||
        timeZone.isEmpty ||
        timeZone.length > 100 ||
        timeZone.trim() != timeZone ||
        utcOffsetMinutes < -840 ||
        utcOffsetMinutes > 840) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverSearchCriteria._(
      latitude: latitude,
      longitude: longitude,
      radiusMiles: radiusMiles,
      locationMode: locationMode,
      typedLocation: typedLocation,
      searchText: searchText,
      timeZone: timeZone,
      utcOffsetMinutes: utcOffsetMinutes,
    );
  }

  const CustomerBiteSaverSearchCriteria._({
    required this.latitude,
    required this.longitude,
    required this.radiusMiles,
    required this.locationMode,
    required this.typedLocation,
    required this.searchText,
    required this.timeZone,
    required this.utcOffsetMinutes,
  });

  final double latitude;
  final double longitude;
  final int radiusMiles;
  final CustomerBiteSaverLocationMode locationMode;
  final CustomerBiteSaverTypedLocation? typedLocation;
  final String searchText;
  final String timeZone;
  final int utcOffsetMinutes;

  Map<String, Object?> toJson() => <String, Object?>{
    'latitude': latitude,
    'longitude': longitude,
    'radiusMiles': radiusMiles,
    'locationMode': locationMode.name,
    'typedLocation': typedLocation?.toJson(),
    'searchText': searchText,
    'timeZone': timeZone,
    'utcOffsetMinutes': utcOffsetMinutes,
  };
}

final class CustomerBiteSaverSessionBinding {
  factory CustomerBiteSaverSessionBinding({
    required String clientInstanceId,
    required String sessionId,
    required String capability,
    required String criteriaFingerprint,
    int? attemptGeneration,
    String? queryFingerprint,
  }) => CustomerBiteSaverSessionBinding._(
    clientInstanceId: _requestId(clientInstanceId),
    sessionId: _sessionId(sessionId),
    capability: _capability(capability),
    criteriaFingerprint: _fingerprint(criteriaFingerprint),
    attemptGeneration: attemptGeneration == null
        ? null
        : _safeInteger(attemptGeneration),
    queryFingerprint: queryFingerprint == null
        ? null
        : _fingerprint(queryFingerprint),
  );

  factory CustomerBiteSaverSessionBinding.fromStart({
    required String clientInstanceId,
    required CustomerBiteSaverStartResponse response,
  }) => CustomerBiteSaverSessionBinding(
    clientInstanceId: clientInstanceId,
    sessionId: response.sessionId,
    capability: response.capability,
    criteriaFingerprint: response.criteriaFingerprint,
    attemptGeneration: response.attemptGeneration,
    queryFingerprint: response.queryFingerprint,
  );

  const CustomerBiteSaverSessionBinding._({
    required this.clientInstanceId,
    required this.sessionId,
    required this.capability,
    required this.criteriaFingerprint,
    required this.attemptGeneration,
    required this.queryFingerprint,
  });

  final String clientInstanceId;
  final String sessionId;
  final String capability;
  final String criteriaFingerprint;
  final int? attemptGeneration;
  final String? queryFingerprint;

  Map<String, Object?> boundFields(String clientRequestId) => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'clientRequestId': _requestId(clientRequestId),
    'clientInstanceId': clientInstanceId,
    'sessionId': sessionId,
    'capability': capability,
    'criteriaFingerprint': criteriaFingerprint,
  };
}

final class CustomerBiteSaverStartRequest {
  factory CustomerBiteSaverStartRequest({
    required String clientRequestId,
    required String clientInstanceId,
    required CustomerBiteSaverSearchCriteria criteria,
    required bool freshSearch,
  }) => CustomerBiteSaverStartRequest._(
    clientRequestId: _requestId(clientRequestId),
    clientInstanceId: _requestId(clientInstanceId),
    criteria: criteria,
    freshSearch: freshSearch,
  );

  const CustomerBiteSaverStartRequest._({
    required this.clientRequestId,
    required this.clientInstanceId,
    required this.criteria,
    required this.freshSearch,
  });

  final String clientRequestId;
  final String clientInstanceId;
  final CustomerBiteSaverSearchCriteria criteria;
  final bool freshSearch;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'clientRequestId': clientRequestId,
    'clientInstanceId': clientInstanceId,
    ...criteria.toJson(),
    'freshSearch': freshSearch,
  };
}

abstract base class CustomerBiteSaverBoundRequest {
  CustomerBiteSaverBoundRequest({
    required String clientRequestId,
    required this.binding,
  }) : clientRequestId = _requestId(clientRequestId);

  final String clientRequestId;
  final CustomerBiteSaverSessionBinding binding;

  Map<String, Object?> boundJson() => binding.boundFields(clientRequestId);

  Map<String, Object?> toJson();
}

final class CustomerBiteSaverStatusRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverStatusRequest({
    required super.clientRequestId,
    required super.binding,
  });

  @override
  Map<String, Object?> toJson() => boundJson();
}

final class CustomerBiteSaverRestaurantPageRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverRestaurantPageRequest({
    required super.clientRequestId,
    required super.binding,
    required String? cursor,
    required int? guestStateRevision,
  }) : cursor = _cursor(cursor),
       guestStateRevision = guestStateRevision == null
           ? null
           : _safeInteger(guestStateRevision);

  final String? cursor;
  final int? guestStateRevision;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    ...boundJson(),
    'cursor': cursor,
    'guestStateRevision': guestStateRevision,
  };
}

final class CustomerBiteSaverOfferPageRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverOfferPageRequest({
    required super.clientRequestId,
    required super.binding,
    required this.restaurantId,
    required String? cursor,
    required int? guestStateRevision,
  }) : cursor = _cursor(cursor),
       guestStateRevision = guestStateRevision == null
           ? null
           : _safeInteger(guestStateRevision);

  final CustomerBiteSaverRestaurantId restaurantId;
  final String? cursor;
  final int? guestStateRevision;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    ...boundJson(),
    'cursor': cursor,
    'guestStateRevision': guestStateRevision,
    'restaurantId': restaurantId.value,
  };
}

final class CustomerBiteSaverMenuPageRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverMenuPageRequest({
    required super.clientRequestId,
    required super.binding,
    required this.restaurantId,
    required String? cursor,
  }) : cursor = _cursor(cursor);

  final CustomerBiteSaverRestaurantId restaurantId;
  final String? cursor;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    ...boundJson(),
    'restaurantId': restaurantId.value,
    'cursor': cursor,
  };
}

final class CustomerBiteSaverGuestContinuationRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverGuestContinuationRequest({
    required super.clientRequestId,
    required super.binding,
    required String operationRef,
    required String checkToken,
    required int batchSequence,
    required int guestStateRevision,
    required List<CustomerBiteSaverOfferId> unavailableOfferIds,
  }) : operationRef = _string(
         operationRef,
         maximumLength: 48,
         pattern: _operationRefPattern,
       ),
       checkToken = _string(
         checkToken,
         maximumLength:
             CustomerBiteSaverSearchContract.maximumOpaquePayloadLength,
         pattern: _checkTokenPattern,
       ),
       batchSequence = _safeInteger(batchSequence),
       guestStateRevision = _safeInteger(guestStateRevision),
       unavailableOfferIds = List<CustomerBiteSaverOfferId>.unmodifiable(
         unavailableOfferIds,
       ) {
    if (unavailableOfferIds.length >
            CustomerBiteSaverSearchContract.maximumGuestCandidates ||
        unavailableOfferIds.map((id) => id.value).toSet().length !=
            unavailableOfferIds.length) {
      throw const CustomerBiteSaverProtocolException();
    }
  }

  final String operationRef;
  final String checkToken;
  final int batchSequence;
  final int guestStateRevision;
  final List<CustomerBiteSaverOfferId> unavailableOfferIds;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    ...boundJson(),
    'operationRef': operationRef,
    'checkToken': checkToken,
    'batchSequence': batchSequence,
    'guestStateRevision': guestStateRevision,
    'entireBatchEvaluated': true,
    'unavailableOfferIds': unavailableOfferIds
        .map((id) => id.value)
        .toList(growable: false),
  };
}

final class CustomerBiteSaverFavoriteStatesRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverFavoriteStatesRequest({
    required super.clientRequestId,
    required super.binding,
    required List<CustomerBiteSaverRestaurantId> restaurantIds,
    required List<CustomerBiteSaverOfferId> offerIds,
  }) : restaurantIds = List<CustomerBiteSaverRestaurantId>.unmodifiable(
         restaurantIds,
       ),
       offerIds = List<CustomerBiteSaverOfferId>.unmodifiable(offerIds) {
    if (restaurantIds.length >
            CustomerBiteSaverSearchContract.maximumFavoriteRestaurantIds ||
        offerIds.length >
            CustomerBiteSaverSearchContract.maximumFavoriteOfferIds ||
        restaurantIds.length + offerIds.length >
            CustomerBiteSaverSearchContract.maximumFavoriteIds ||
        restaurantIds.map((id) => id.value).toSet().length !=
            restaurantIds.length ||
        offerIds.map((id) => id.value).toSet().length != offerIds.length) {
      throw const CustomerBiteSaverProtocolException();
    }
  }

  final List<CustomerBiteSaverRestaurantId> restaurantIds;
  final List<CustomerBiteSaverOfferId> offerIds;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    ...boundJson(),
    'restaurantIds': restaurantIds
        .map((id) => id.value)
        .toList(growable: false),
    'offerIds': offerIds.map((id) => id.value).toList(growable: false),
  };
}

final class CustomerBiteSaverCoordinates {
  factory CustomerBiteSaverCoordinates({
    required double latitude,
    required double longitude,
    required int capturedAtMillis,
  }) {
    if (!BiteSaverLocationSearch.hasValidCoordinates(latitude, longitude)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverCoordinates._(
      latitude: latitude,
      longitude: longitude,
      capturedAtMillis: _safeInteger(capturedAtMillis),
    );
  }

  const CustomerBiteSaverCoordinates._({
    required this.latitude,
    required this.longitude,
    required this.capturedAtMillis,
  });

  factory CustomerBiteSaverCoordinates.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{'latitude', 'longitude', 'capturedAtMillis'});
    return CustomerBiteSaverCoordinates(
      latitude: _finiteNumber(data['latitude']),
      longitude: _finiteNumber(data['longitude']),
      capturedAtMillis: _safeInteger(data['capturedAtMillis']),
    );
  }

  final double latitude;
  final double longitude;
  final int capturedAtMillis;

  Map<String, Object?> toJson() => <String, Object?>{
    'latitude': latitude,
    'longitude': longitude,
    'capturedAtMillis': capturedAtMillis,
  };
}

abstract base class CustomerBiteSaverRedemptionRequest
    extends CustomerBiteSaverBoundRequest {
  CustomerBiteSaverRedemptionRequest({
    required super.clientRequestId,
    required super.binding,
    required this.restaurantId,
    required this.offerId,
    required String offerOccurrence,
    required String redemptionRequestId,
    required this.currentCoordinates,
    required int? guestStateRevision,
  }) : offerOccurrence = _occurrence(offerOccurrence),
       redemptionRequestId = _requestId(redemptionRequestId),
       guestStateRevision = guestStateRevision == null
           ? null
           : _safeInteger(guestStateRevision);

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final String offerOccurrence;
  final String redemptionRequestId;
  final CustomerBiteSaverCoordinates? currentCoordinates;
  final int? guestStateRevision;

  Map<String, Object?> redemptionJson() => <String, Object?>{
    ...boundJson(),
    'restaurantId': restaurantId.value,
    'offerId': offerId.value,
    'offerOccurrence': offerOccurrence,
    'redemptionRequestId': redemptionRequestId,
    'currentCoordinates': currentCoordinates?.toJson(),
    'guestStateRevision': guestStateRevision,
  };
}

final class CustomerBiteSaverRedemptionValidationRequest
    extends CustomerBiteSaverRedemptionRequest {
  CustomerBiteSaverRedemptionValidationRequest({
    required super.clientRequestId,
    required super.binding,
    required super.restaurantId,
    required super.offerId,
    required super.offerOccurrence,
    required super.redemptionRequestId,
    required super.currentCoordinates,
    required super.guestStateRevision,
  });

  @override
  Map<String, Object?> toJson() => redemptionJson();
}

final class CustomerBiteSaverRedemptionStartRequest
    extends CustomerBiteSaverRedemptionRequest {
  CustomerBiteSaverRedemptionStartRequest({
    required super.clientRequestId,
    required super.binding,
    required super.restaurantId,
    required super.offerId,
    required super.offerOccurrence,
    required super.redemptionRequestId,
    required super.currentCoordinates,
    required super.guestStateRevision,
    required String validationId,
  }) : validationId = _string(
         validationId,
         maximumLength: 47,
         pattern: _validationIdPattern,
       );

  factory CustomerBiteSaverRedemptionStartRequest.fromValidation({
    required CustomerBiteSaverRedemptionValidationRequest request,
    required String clientRequestId,
    required String validationId,
  }) => CustomerBiteSaverRedemptionStartRequest(
    clientRequestId: clientRequestId,
    binding: request.binding,
    restaurantId: request.restaurantId,
    offerId: request.offerId,
    offerOccurrence: request.offerOccurrence,
    redemptionRequestId: request.redemptionRequestId,
    currentCoordinates: request.currentCoordinates,
    guestStateRevision: request.guestStateRevision,
    validationId: validationId,
  );

  final String validationId;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    ...redemptionJson(),
    'validationId': validationId,
  };
}

final class CustomerBiteSaverStartResponse {
  const CustomerBiteSaverStartResponse._({
    required this.sessionId,
    required this.capability,
    required this.state,
    required this.attemptGeneration,
    required this.criteriaFingerprint,
    required this.queryFingerprint,
    required this.logicalExpiresAtMillis,
  });

  factory CustomerBiteSaverStartResponse.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'sessionId',
      'capability',
      'state',
      'attemptGeneration',
      'criteriaFingerprint',
      'queryFingerprint',
      'logicalExpiresAtMillis',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverStartResponse._(
      sessionId: _sessionId(data['sessionId']),
      capability: _capability(data['capability']),
      state: _enumValue(data['state'], <String, CustomerBiteSaverSearchState>{
        'preparing': CustomerBiteSaverSearchState.preparing,
        'ready': CustomerBiteSaverSearchState.ready,
      }),
      attemptGeneration: _safeInteger(data['attemptGeneration']),
      criteriaFingerprint: _fingerprint(data['criteriaFingerprint']),
      queryFingerprint: _fingerprint(data['queryFingerprint']),
      logicalExpiresAtMillis: _safeInteger(data['logicalExpiresAtMillis']),
    );
  }

  final String sessionId;
  final String capability;
  final CustomerBiteSaverSearchState state;
  final int attemptGeneration;
  final String criteriaFingerprint;
  final String queryFingerprint;
  final int logicalExpiresAtMillis;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'sessionId': sessionId,
    'capability': capability,
    'state': state.name,
    'attemptGeneration': attemptGeneration,
    'criteriaFingerprint': criteriaFingerprint,
    'queryFingerprint': queryFingerprint,
    'logicalExpiresAtMillis': logicalExpiresAtMillis,
  };
}

final class CustomerBiteSaverSearchProgress {
  const CustomerBiteSaverSearchProgress._({
    required this.phase,
    required this.completedRanges,
    required this.totalRanges,
  });

  factory CustomerBiteSaverSearchProgress.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{'phase', 'completedRanges', 'totalRanges'});
    final completed = _safeInteger(data['completedRanges']);
    final total = _safeInteger(data['totalRanges']);
    if (completed > total) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverSearchProgress._(
      phase:
          _enumValue(data['phase'], <String, CustomerBiteSaverPreparationPhase>{
            for (final phase in CustomerBiteSaverPreparationPhase.values)
              phase.name: phase,
          }),
      completedRanges: completed,
      totalRanges: total,
    );
  }

  final CustomerBiteSaverPreparationPhase phase;
  final int completedRanges;
  final int totalRanges;

  Map<String, Object?> toJson() => <String, Object?>{
    'phase': phase.name,
    'completedRanges': completedRanges,
    'totalRanges': totalRanges,
  };
}

final class CustomerBiteSaverStatusResponse {
  const CustomerBiteSaverStatusResponse._({
    required this.state,
    required this.progress,
    required this.failureCode,
    required this.retriable,
    required this.attemptGeneration,
    required this.queryFingerprint,
    required this.logicalExpiresAtMillis,
  });

  factory CustomerBiteSaverStatusResponse.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'state',
      'progress',
      'failureCode',
      'retriable',
      'attemptGeneration',
      'queryFingerprint',
      'logicalExpiresAtMillis',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final state = _enumValue(
      data['state'],
      <String, CustomerBiteSaverSearchState>{
        for (final state in CustomerBiteSaverSearchState.values)
          state.name: state,
      },
    );
    final failureCode = data['failureCode'] == null
        ? null
        : _enumValue(
            data['failureCode'],
            <String, CustomerBiteSaverFailureCode>{
              for (final code in CustomerBiteSaverFailureCode.values)
                code.wireName: code,
            },
          );
    final retriable = _boolean(data['retriable']);
    final progress = CustomerBiteSaverSearchProgress.fromJson(data['progress']);
    final expectedRetriable =
        failureCode == CustomerBiteSaverFailureCode.catalogChangedRepeatedly ||
        failureCode == CustomerBiteSaverFailureCode.preparationFailed;
    if (retriable != expectedRetriable ||
        (state == CustomerBiteSaverSearchState.failed && failureCode == null) ||
        ((state == CustomerBiteSaverSearchState.preparing ||
                state == CustomerBiteSaverSearchState.ready) &&
            failureCode != null) ||
        (state == CustomerBiteSaverSearchState.ready &&
            (progress.phase != CustomerBiteSaverPreparationPhase.ready ||
                progress.completedRanges != progress.totalRanges)) ||
        (state == CustomerBiteSaverSearchState.preparing &&
            progress.phase == CustomerBiteSaverPreparationPhase.ready) ||
        (progress.phase == CustomerBiteSaverPreparationPhase.ready &&
            state != CustomerBiteSaverSearchState.ready &&
            state != CustomerBiteSaverSearchState.expired)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverStatusResponse._(
      state: state,
      progress: progress,
      failureCode: failureCode,
      retriable: retriable,
      attemptGeneration: _safeInteger(data['attemptGeneration']),
      queryFingerprint: _fingerprint(data['queryFingerprint']),
      logicalExpiresAtMillis: _safeInteger(data['logicalExpiresAtMillis']),
    );
  }

  final CustomerBiteSaverSearchState state;
  final CustomerBiteSaverSearchProgress progress;
  final CustomerBiteSaverFailureCode? failureCode;
  final bool retriable;
  final int attemptGeneration;
  final String queryFingerprint;
  final int logicalExpiresAtMillis;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'state': state.name,
    'progress': progress.toJson(),
    'failureCode': failureCode?.wireName,
    'retriable': retriable,
    'attemptGeneration': attemptGeneration,
    'queryFingerprint': queryFingerprint,
    'logicalExpiresAtMillis': logicalExpiresAtMillis,
  };
}

final class CustomerBiteSaverBusinessHours {
  const CustomerBiteSaverBusinessHours._({
    required this.day,
    required this.opensAt,
    required this.closesAt,
    required this.closed,
  });

  factory CustomerBiteSaverBusinessHours.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{'day', 'opensAt', 'closesAt', 'closed'});
    final day = _boundedScalarText(data['day'], maximumScalars: 9);
    if (!const <String>{
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    }.contains(day)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverBusinessHours._(
      day: day,
      opensAt: _boundedScalarText(
        data['opensAt'],
        maximumScalars: 40,
        allowEmpty: false,
      ),
      closesAt: _boundedScalarText(
        data['closesAt'],
        maximumScalars: 40,
        allowEmpty: false,
      ),
      closed: _boolean(data['closed']),
    );
  }

  final String day;
  final String opensAt;
  final String closesAt;
  final bool closed;

  Map<String, Object?> toJson() => <String, Object?>{
    'day': day,
    'opensAt': opensAt,
    'closesAt': closesAt,
    'closed': closed,
  };
}

final class CustomerBiteSaverOffer {
  const CustomerBiteSaverOffer._({
    required this.offerId,
    required this.offerOccurrence,
    required this.offerType,
    required this.title,
    required this.details,
    required this.couponCode,
    required this.couponNumber,
    required this.usageRule,
    required this.usagePolicy,
    required this.availabilityMode,
    required this.daysOfWeek,
    required this.allDay,
    required this.startTime,
    required this.endTime,
    required this.startAtMillis,
    required this.endAtMillis,
    required this.expiresAtMillis,
    required this.expiresText,
    required this.isProximityOnly,
    required this.proximityRadiusMiles,
    required this.imageUrl,
    required this.sourceCreatedAtMillis,
    required this.available,
    required this.availabilityReason,
    required this.redemptionPolicyLabel,
    required this.activeTimerExpiresAtMillis,
    required this.nextAvailableAtMillis,
    required this.usageState,
  });

  factory CustomerBiteSaverOffer.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'offerId',
      'offerOccurrence',
      'offerType',
      'title',
      'details',
      'couponCode',
      'couponNumber',
      'usageRule',
      'usagePolicy',
      'availabilityMode',
      'daysOfWeek',
      'allDay',
      'startTime',
      'endTime',
      'startAtMillis',
      'endAtMillis',
      'expiresAtMillis',
      'expiresText',
      'isProximityOnly',
      'proximityRadiusMiles',
      'imageUrl',
      'sourceCreatedAtMillis',
      'available',
      'availabilityReason',
      'redemptionPolicyLabel',
      'activeTimerExpiresAtMillis',
      'nextAvailableAtMillis',
      'usageState',
    });
    final days = _list(data['daysOfWeek'], maximumLength: 7)
        .map((day) => _safeInteger(day, minimum: 1, maximum: 7))
        .toList(growable: false);
    final offerType = _enumValue(
      data['offerType'],
      <String, CustomerBiteSaverOfferType>{
        for (final type in CustomerBiteSaverOfferType.values) type.name: type,
      },
    );
    final usagePolicy = data['usagePolicy'] == null
        ? null
        : _enumValue(
            data['usagePolicy'],
            <String, CustomerBiteSaverUsagePolicy>{
              for (final policy in CustomerBiteSaverUsagePolicy.values)
                policy.name: policy,
            },
          );
    final available = _boolean(data['available']);
    final usageState = _enumValue(
      data['usageState'],
      <String, CustomerBiteSaverUsageState>{
        for (final state in CustomerBiteSaverUsageState.values)
          state.name: state,
      },
    );
    if ((available && usageState != CustomerBiteSaverUsageState.available) ||
        (offerType == CustomerBiteSaverOfferType.dailySpecial &&
            (usageState != CustomerBiteSaverUsageState.available ||
                usagePolicy != null)) ||
        (offerType == CustomerBiteSaverOfferType.coupon &&
            usagePolicy == null)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverOffer._(
      offerId: CustomerBiteSaverOfferId(
        _string(data['offerId'], maximumLength: 47),
      ),
      offerOccurrence: _occurrence(data['offerOccurrence']),
      offerType: offerType,
      title: _string(data['title'], maximumLength: 200, allowEmpty: true),
      details: _nullableString(data['details'], maximumLength: 4000),
      couponCode: _nullableString(data['couponCode'], maximumLength: 500),
      couponNumber: _nullableString(data['couponNumber'], maximumLength: 500),
      usageRule: _nullableString(data['usageRule'], maximumLength: 200),
      usagePolicy: usagePolicy,
      availabilityMode: _nullableString(
        data['availabilityMode'],
        maximumLength: 50,
      ),
      daysOfWeek: List<int>.unmodifiable(days),
      allDay: data['allDay'] == null ? null : _boolean(data['allDay']),
      startTime: _nullableString(data['startTime'], maximumLength: 50),
      endTime: _nullableString(data['endTime'], maximumLength: 50),
      startAtMillis: data['startAtMillis'] == null
          ? null
          : _safeInteger(data['startAtMillis']),
      endAtMillis: data['endAtMillis'] == null
          ? null
          : _safeInteger(data['endAtMillis']),
      expiresAtMillis: data['expiresAtMillis'] == null
          ? null
          : _safeInteger(data['expiresAtMillis']),
      expiresText: _nullableString(data['expiresText'], maximumLength: 500),
      isProximityOnly: _boolean(data['isProximityOnly']),
      proximityRadiusMiles: data['proximityRadiusMiles'] == null
          ? null
          : _finiteNumber(data['proximityRadiusMiles']),
      imageUrl: _nullableString(data['imageUrl'], maximumLength: 2000),
      sourceCreatedAtMillis: _safeInteger(data['sourceCreatedAtMillis']),
      available: available,
      availabilityReason: _string(
        data['availabilityReason'],
        maximumLength: 100,
      ),
      redemptionPolicyLabel: _nullableString(
        data['redemptionPolicyLabel'],
        maximumLength: 200,
      ),
      activeTimerExpiresAtMillis: data['activeTimerExpiresAtMillis'] == null
          ? null
          : _safeInteger(data['activeTimerExpiresAtMillis']),
      nextAvailableAtMillis: data['nextAvailableAtMillis'] == null
          ? null
          : _safeInteger(data['nextAvailableAtMillis']),
      usageState: usageState,
    );
  }

  final CustomerBiteSaverOfferId offerId;
  final String offerOccurrence;
  final CustomerBiteSaverOfferType offerType;
  final String title;
  final String? details;
  final String? couponCode;
  final String? couponNumber;
  final String? usageRule;
  final CustomerBiteSaverUsagePolicy? usagePolicy;
  final String? availabilityMode;
  final List<int> daysOfWeek;
  final bool? allDay;
  final String? startTime;
  final String? endTime;
  final int? startAtMillis;
  final int? endAtMillis;
  final int? expiresAtMillis;
  final String? expiresText;
  final bool isProximityOnly;
  final double? proximityRadiusMiles;
  final String? imageUrl;
  final int sourceCreatedAtMillis;
  final bool available;
  final String availabilityReason;
  final String? redemptionPolicyLabel;
  final int? activeTimerExpiresAtMillis;
  final int? nextAvailableAtMillis;
  final CustomerBiteSaverUsageState usageState;

  Map<String, Object?> toJson() => <String, Object?>{
    'offerId': offerId.value,
    'offerOccurrence': offerOccurrence,
    'offerType': offerType.name,
    'title': title,
    'details': details,
    'couponCode': couponCode,
    'couponNumber': couponNumber,
    'usageRule': usageRule,
    'usagePolicy': usagePolicy?.name,
    'availabilityMode': availabilityMode,
    'daysOfWeek': daysOfWeek,
    'allDay': allDay,
    'startTime': startTime,
    'endTime': endTime,
    'startAtMillis': startAtMillis,
    'endAtMillis': endAtMillis,
    'expiresAtMillis': expiresAtMillis,
    'expiresText': expiresText,
    'isProximityOnly': isProximityOnly,
    'proximityRadiusMiles': proximityRadiusMiles,
    'imageUrl': imageUrl,
    'sourceCreatedAtMillis': sourceCreatedAtMillis,
    'available': available,
    'availabilityReason': availabilityReason,
    'redemptionPolicyLabel': redemptionPolicyLabel,
    'activeTimerExpiresAtMillis': activeTimerExpiresAtMillis,
    'nextAvailableAtMillis': nextAvailableAtMillis,
    'usageState': usageState.name,
  };
}

final class CustomerBiteSaverRestaurant {
  const CustomerBiteSaverRestaurant._({
    required this.restaurantId,
    required this.displayName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.formattedAddress,
    required this.imageUrl,
    required this.phone,
    required this.website,
    required this.businessHours,
    required this.bio,
    required this.distanceMiles,
    required this.isLocal,
    required this.catalogBindingAvailable,
    required this.offers,
    required this.hasMoreOffers,
    required this.usableOfferCount,
    required this.offerCountState,
    required this.favoriteState,
  });

  factory CustomerBiteSaverRestaurant.fromJson(
    Object? value, {
    bool publicProfile = false,
  }) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'restaurantId',
      'displayName',
      'streetAddress',
      'city',
      'state',
      'zipCode',
      'formattedAddress',
      'imageUrl',
      'phone',
      'website',
      'businessHours',
      'bio',
      'distanceMiles',
      'isLocal',
      'catalogBindingAvailable',
      'offers',
      'hasMoreOffers',
      'usableOfferCount',
      'offerCountState',
      'favoriteState',
    });
    final hours = _list(
      data['businessHours'],
      maximumLength: 7,
    ).map(CustomerBiteSaverBusinessHours.fromJson).toList(growable: false);
    if (hours.isNotEmpty &&
        (hours.length != 7 ||
            hours.map((entry) => entry.day).toSet().length != 7)) {
      throw const CustomerBiteSaverProtocolException();
    }
    final offers = _list(
      data['offers'],
      maximumLength: publicProfile ? 25 : 2,
    ).map(CustomerBiteSaverOffer.fromJson).toList(growable: false);
    if (offers.map((entry) => entry.offerId.value).toSet().length !=
        offers.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    final hasMoreOffers = _boolean(data['hasMoreOffers']);
    final usableOfferCount = data['usableOfferCount'] == null
        ? null
        : _safeInteger(data['usableOfferCount']);
    final offerCountState = _enumValue(
      data['offerCountState'],
      <String, CustomerBiteSaverOfferCountState>{
        for (final state in CustomerBiteSaverOfferCountState.values)
          state.name: state,
      },
    );
    if ((offerCountState == CustomerBiteSaverOfferCountState.unknown &&
            usableOfferCount != null) ||
        (offerCountState == CustomerBiteSaverOfferCountState.current &&
            (usableOfferCount == null ||
                usableOfferCount < offers.length ||
                hasMoreOffers != (usableOfferCount > offers.length)))) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverRestaurant._(
      restaurantId: CustomerBiteSaverRestaurantId(
        _string(data['restaurantId'], maximumLength: 47),
      ),
      displayName: _boundedScalarText(
        data['displayName'],
        maximumScalars: 200,
        allowEmpty: false,
      ),
      streetAddress: _nullableBoundedScalarText(
        data['streetAddress'],
        maximumScalars: 200,
      ),
      city: _boundedScalarText(data['city'], maximumScalars: 100),
      state: _boundedScalarText(data['state'], maximumScalars: 100),
      zipCode: _boundedScalarText(data['zipCode'], maximumScalars: 20),
      formattedAddress: _nullableBoundedScalarText(
        data['formattedAddress'],
        maximumScalars: 500,
      ),
      imageUrl: _nullableBoundedScalarText(
        data['imageUrl'],
        maximumScalars: 2000,
      ),
      phone: _nullableBoundedScalarText(data['phone'], maximumScalars: 50),
      website: _nullableBoundedScalarText(data['website'], maximumScalars: 500),
      businessHours: List<CustomerBiteSaverBusinessHours>.unmodifiable(hours),
      bio: _nullableBoundedScalarText(data['bio'], maximumScalars: 2000),
      distanceMiles: _finiteNumber(data['distanceMiles'], minimum: 0),
      isLocal: _boolean(data['isLocal']),
      catalogBindingAvailable: _boolean(data['catalogBindingAvailable']),
      offers: List<CustomerBiteSaverOffer>.unmodifiable(offers),
      hasMoreOffers: hasMoreOffers,
      usableOfferCount: usableOfferCount,
      offerCountState: offerCountState,
      favoriteState: _enumValue(
        data['favoriteState'],
        const <String, CustomerBiteSaverFavoriteState>{
          'unknown': CustomerBiteSaverFavoriteState.unknown,
        },
      ),
    );
  }

  final CustomerBiteSaverRestaurantId restaurantId;
  final String displayName;
  final String? streetAddress;
  final String city;
  final String state;
  final String zipCode;
  final String? formattedAddress;
  final String? imageUrl;
  final String? phone;
  final String? website;
  final List<CustomerBiteSaverBusinessHours> businessHours;
  final String? bio;
  final double distanceMiles;
  final bool isLocal;
  final bool catalogBindingAvailable;
  final List<CustomerBiteSaverOffer> offers;
  final bool hasMoreOffers;
  final int? usableOfferCount;
  final CustomerBiteSaverOfferCountState offerCountState;
  final CustomerBiteSaverFavoriteState favoriteState;

  Map<String, Object?> toJson() => <String, Object?>{
    'restaurantId': restaurantId.value,
    'displayName': displayName,
    'streetAddress': streetAddress,
    'city': city,
    'state': state,
    'zipCode': zipCode,
    'formattedAddress': formattedAddress,
    'imageUrl': imageUrl,
    'phone': phone,
    'website': website,
    'businessHours': businessHours.map((entry) => entry.toJson()).toList(),
    'bio': bio,
    'distanceMiles': distanceMiles,
    'isLocal': isLocal,
    'catalogBindingAvailable': catalogBindingAvailable,
    'offers': offers.map((entry) => entry.toJson()).toList(),
    'hasMoreOffers': hasMoreOffers,
    'usableOfferCount': usableOfferCount,
    'offerCountState': offerCountState.name,
    'favoriteState': favoriteState.name,
  };
}

sealed class CustomerBiteSaverOperationResult {
  const CustomerBiteSaverOperationResult();
  Map<String, Object?> toJson();
}

final class CustomerBiteSaverRestaurantPageResult
    extends CustomerBiteSaverOperationResult {
  const CustomerBiteSaverRestaurantPageResult._({
    required this.attemptGeneration,
    required this.queryFingerprint,
    required this.restaurants,
    required this.nextCursor,
    required this.hasMore,
    required this.partial,
  });

  factory CustomerBiteSaverRestaurantPageResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'state',
      'attemptGeneration',
      'queryFingerprint',
      'restaurants',
      'nextCursor',
      'hasMore',
      'partial',
    });
    if (data['schemaVersion'] !=
            CustomerBiteSaverSearchContract.schemaVersion ||
        data['state'] != 'ready') {
      throw const CustomerBiteSaverProtocolException();
    }
    final restaurants = _list(
      data['restaurants'],
      maximumLength: CustomerBiteSaverSearchContract.pageSize,
    ).map(CustomerBiteSaverRestaurant.fromJson).toList(growable: false);
    if (restaurants.map((entry) => entry.restaurantId.value).toSet().length !=
        restaurants.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    final offerIds = restaurants
        .expand((restaurant) => restaurant.offers)
        .map((offer) => offer.offerId.value)
        .toList(growable: false);
    if (offerIds.toSet().length != offerIds.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    final nextCursor = _cursor(data['nextCursor']);
    final hasMore = _boolean(data['hasMore']);
    final partial = _boolean(data['partial']);
    if (hasMore != (nextCursor != null) || (partial && !hasMore)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverRestaurantPageResult._(
      attemptGeneration: _safeInteger(data['attemptGeneration']),
      queryFingerprint: _fingerprint(data['queryFingerprint']),
      restaurants: List<CustomerBiteSaverRestaurant>.unmodifiable(restaurants),
      nextCursor: nextCursor,
      hasMore: hasMore,
      partial: partial,
    );
  }

  final int attemptGeneration;
  final String queryFingerprint;
  final List<CustomerBiteSaverRestaurant> restaurants;
  final String? nextCursor;
  final bool hasMore;
  final bool partial;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'state': 'ready',
    'attemptGeneration': attemptGeneration,
    'queryFingerprint': queryFingerprint,
    'restaurants': restaurants.map((entry) => entry.toJson()).toList(),
    'nextCursor': nextCursor,
    'hasMore': hasMore,
    'partial': partial,
  };
}

final class CustomerBiteSaverOfferPageResult
    extends CustomerBiteSaverOperationResult {
  const CustomerBiteSaverOfferPageResult._({
    required this.restaurantId,
    required this.offers,
    required this.nextCursor,
    required this.hasMore,
    required this.partial,
  });

  factory CustomerBiteSaverOfferPageResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'restaurantId',
      'offers',
      'nextCursor',
      'hasMore',
      'partial',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final offers = _list(
      data['offers'],
      maximumLength: CustomerBiteSaverSearchContract.pageSize,
    ).map(CustomerBiteSaverOffer.fromJson).toList(growable: false);
    if (offers.map((entry) => entry.offerId.value).toSet().length !=
        offers.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    final nextCursor = _cursor(data['nextCursor']);
    final hasMore = _boolean(data['hasMore']);
    final partial = _boolean(data['partial']);
    if (hasMore != (nextCursor != null) || (partial && !hasMore)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverOfferPageResult._(
      restaurantId: CustomerBiteSaverRestaurantId(
        _string(data['restaurantId'], maximumLength: 47),
      ),
      offers: List<CustomerBiteSaverOffer>.unmodifiable(offers),
      nextCursor: nextCursor,
      hasMore: hasMore,
      partial: partial,
    );
  }

  final CustomerBiteSaverRestaurantId restaurantId;
  final List<CustomerBiteSaverOffer> offers;
  final String? nextCursor;
  final bool hasMore;
  final bool partial;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'restaurantId': restaurantId.value,
    'offers': offers.map((entry) => entry.toJson()).toList(),
    'nextCursor': nextCursor,
    'hasMore': hasMore,
    'partial': partial,
  };
}

enum CustomerBiteSaverMenuAvailability { available, absent }

enum CustomerBiteSaverMenuStyle { biteSaver, biteScore }

sealed class CustomerBiteSaverMenuEntry {
  const CustomerBiteSaverMenuEntry({
    required this.key,
    required this.sortOrder,
  });

  factory CustomerBiteSaverMenuEntry.fromJson(Object? value) {
    final data = _record(value);
    final kind = _string(data['kind'], maximumLength: 20);
    final key = _string(
      data['key'],
      maximumLength: 48,
      pattern: _menuEntryKeyPattern,
    );
    final sortOrder = _safeInteger(
      data['sortOrder'],
      minimum: -_maximumSafeJsonInteger,
    );
    switch (kind) {
      case 'image':
        _exactKeys(data, const <String>{
          'kind',
          'key',
          'imageUrl',
          'sortOrder',
        });
        return CustomerBiteSaverMenuImageEntry(
          key: key,
          imageUrl: _boundedScalarText(
            data['imageUrl'],
            maximumScalars: 2000,
            allowEmpty: false,
          ),
          sortOrder: sortOrder,
        );
      case 'item':
        _exactKeys(data, const <String>{
          'kind',
          'key',
          'name',
          'description',
          'price',
          'category',
          'sortOrder',
        });
        return CustomerBiteSaverMenuItemEntry(
          key: key,
          name: _boundedScalarText(
            data['name'],
            maximumScalars: 500,
            allowEmpty: false,
          ),
          description: _boundedScalarText(
            data['description'],
            maximumScalars: 8000,
          ),
          price: _boundedScalarText(data['price'], maximumScalars: 200),
          category: _boundedScalarText(
            data['category'],
            maximumScalars: 200,
            allowEmpty: false,
          ),
          sortOrder: sortOrder,
        );
      case 'section':
        _exactKeys(data, const <String>{
          'kind',
          'key',
          'title',
          'body',
          'sortOrder',
        });
        return CustomerBiteSaverMenuSectionEntry(
          key: key,
          title: _boundedScalarText(
            data['title'],
            maximumScalars: 500,
            allowEmpty: false,
          ),
          body: _boundedScalarText(
            data['body'],
            maximumScalars: 20000,
            allowEmpty: false,
          ),
          sortOrder: sortOrder,
        );
      default:
        throw const CustomerBiteSaverProtocolException();
    }
  }

  final String key;
  final int sortOrder;

  Map<String, Object?> toJson();
}

final class CustomerBiteSaverMenuImageEntry extends CustomerBiteSaverMenuEntry {
  const CustomerBiteSaverMenuImageEntry({
    required super.key,
    required this.imageUrl,
    required super.sortOrder,
  });

  final String imageUrl;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': 'image',
    'key': key,
    'imageUrl': imageUrl,
    'sortOrder': sortOrder,
  };
}

final class CustomerBiteSaverMenuItemEntry extends CustomerBiteSaverMenuEntry {
  const CustomerBiteSaverMenuItemEntry({
    required super.key,
    required this.name,
    required this.description,
    required this.price,
    required this.category,
    required super.sortOrder,
  });

  final String name;
  final String description;
  final String price;
  final String category;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': 'item',
    'key': key,
    'name': name,
    'description': description,
    'price': price,
    'category': category,
    'sortOrder': sortOrder,
  };
}

final class CustomerBiteSaverMenuSectionEntry
    extends CustomerBiteSaverMenuEntry {
  const CustomerBiteSaverMenuSectionEntry({
    required super.key,
    required this.title,
    required this.body,
    required super.sortOrder,
  });

  final String title;
  final String body;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': 'section',
    'key': key,
    'title': title,
    'body': body,
    'sortOrder': sortOrder,
  };
}

final class CustomerBiteSaverMenuPageResult {
  const CustomerBiteSaverMenuPageResult._({
    required this.availability,
    required this.attemptGeneration,
    required this.queryFingerprint,
    required this.restaurantId,
    required this.menuStyle,
    required this.entries,
    required this.nextCursor,
    required this.hasMore,
  });

  factory CustomerBiteSaverMenuPageResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, const <String>{
      'schemaVersion',
      'state',
      'attemptGeneration',
      'queryFingerprint',
      'restaurantId',
      'menuStyle',
      'entries',
      'nextCursor',
      'hasMore',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final availability = _enumValue(
      data['state'],
      const <String, CustomerBiteSaverMenuAvailability>{
        'available': CustomerBiteSaverMenuAvailability.available,
        'absent': CustomerBiteSaverMenuAvailability.absent,
      },
    );
    final entries = _list(
      data['entries'],
      maximumLength: CustomerBiteSaverSearchContract.pageSize,
    ).map(CustomerBiteSaverMenuEntry.fromJson).toList(growable: false);
    if (entries.map((entry) => entry.key).toSet().length != entries.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    final nextCursor = _cursor(data['nextCursor']);
    final hasMore = _boolean(data['hasMore']);
    if (hasMore != (nextCursor != null) ||
        (availability == CustomerBiteSaverMenuAvailability.absent &&
            (entries.isNotEmpty || hasMore))) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverMenuPageResult._(
      availability: availability,
      attemptGeneration: _safeInteger(data['attemptGeneration']),
      queryFingerprint: _fingerprint(data['queryFingerprint']),
      restaurantId: CustomerBiteSaverRestaurantId(
        _string(data['restaurantId'], maximumLength: 47),
      ),
      menuStyle: _enumValue(
        data['menuStyle'],
        const <String, CustomerBiteSaverMenuStyle>{
          'biteSaver': CustomerBiteSaverMenuStyle.biteSaver,
          'biteScore': CustomerBiteSaverMenuStyle.biteScore,
        },
      ),
      entries: List<CustomerBiteSaverMenuEntry>.unmodifiable(entries),
      nextCursor: nextCursor,
      hasMore: hasMore,
    );
  }

  final CustomerBiteSaverMenuAvailability availability;
  final int attemptGeneration;
  final String queryFingerprint;
  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverMenuStyle menuStyle;
  final List<CustomerBiteSaverMenuEntry> entries;
  final String? nextCursor;
  final bool hasMore;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'state': availability.name,
    'attemptGeneration': attemptGeneration,
    'queryFingerprint': queryFingerprint,
    'restaurantId': restaurantId.value,
    'menuStyle': menuStyle.name,
    'entries': entries.map((entry) => entry.toJson()).toList(growable: false),
    'nextCursor': nextCursor,
    'hasMore': hasMore,
  };
}

final class CustomerBiteSaverOncePerDayUnavailableWindow {
  factory CustomerBiteSaverOncePerDayUnavailableWindow({
    required int startAtMillisInclusive,
    required int endAtMillisExclusive,
  }) => CustomerBiteSaverOncePerDayUnavailableWindow.fromJson(<String, Object?>{
    'startAtMillisInclusive': startAtMillisInclusive,
    'endAtMillisExclusive': endAtMillisExclusive,
  });

  const CustomerBiteSaverOncePerDayUnavailableWindow._({
    required this.startAtMillisInclusive,
    required this.endAtMillisExclusive,
  });

  factory CustomerBiteSaverOncePerDayUnavailableWindow.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'startAtMillisInclusive',
      'endAtMillisExclusive',
    });
    final startAtMillisInclusive = _safeInteger(data['startAtMillisInclusive']);
    final endAtMillisExclusive = _safeInteger(data['endAtMillisExclusive']);
    if (startAtMillisInclusive >= endAtMillisExclusive) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverOncePerDayUnavailableWindow._(
      startAtMillisInclusive: startAtMillisInclusive,
      endAtMillisExclusive: endAtMillisExclusive,
    );
  }

  final int startAtMillisInclusive;
  final int endAtMillisExclusive;

  bool contains(int timestampMillis) =>
      timestampMillis >= startAtMillisInclusive &&
      timestampMillis < endAtMillisExclusive;

  Map<String, Object?> toJson() => <String, Object?>{
    'startAtMillisInclusive': startAtMillisInclusive,
    'endAtMillisExclusive': endAtMillisExclusive,
  };
}

final class CustomerBiteSaverEvaluationContext {
  factory CustomerBiteSaverEvaluationContext({
    required String sessionId,
    required int attemptGeneration,
    required String queryFingerprint,
    required int evaluationAtMillis,
    required String timeZone,
    required int utcOffsetMinutes,
    required String availabilityGeneration,
    required int validUntilExclusiveMillis,
    required List<CustomerBiteSaverOncePerDayUnavailableWindow>
    oncePerDayUnavailableWindows,
  }) => CustomerBiteSaverEvaluationContext.fromJson(<String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'sessionId': sessionId,
    'attemptGeneration': attemptGeneration,
    'queryFingerprint': queryFingerprint,
    'evaluationAtMillis': evaluationAtMillis,
    'timeZone': timeZone,
    'utcOffsetMinutes': utcOffsetMinutes,
    'availabilityGeneration': availabilityGeneration,
    'validUntilExclusiveMillis': validUntilExclusiveMillis,
    'oncePerDayUnavailableWindows': oncePerDayUnavailableWindows
        .map((window) => window.toJson())
        .toList(growable: false),
  });

  const CustomerBiteSaverEvaluationContext._({
    required this.sessionId,
    required this.attemptGeneration,
    required this.queryFingerprint,
    required this.evaluationAtMillis,
    required this.timeZone,
    required this.utcOffsetMinutes,
    required this.availabilityGeneration,
    required this.validUntilExclusiveMillis,
    required this.oncePerDayUnavailableWindows,
  });

  factory CustomerBiteSaverEvaluationContext.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'sessionId',
      'attemptGeneration',
      'queryFingerprint',
      'evaluationAtMillis',
      'timeZone',
      'utcOffsetMinutes',
      'availabilityGeneration',
      'validUntilExclusiveMillis',
      'oncePerDayUnavailableWindows',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final evaluationAtMillis = _safeInteger(data['evaluationAtMillis']);
    final validUntilExclusiveMillis = _safeInteger(
      data['validUntilExclusiveMillis'],
    );
    final timeZone = _string(data['timeZone'], maximumLength: 100);
    final windows =
        _list(data['oncePerDayUnavailableWindows'], maximumLength: 2)
            .map(CustomerBiteSaverOncePerDayUnavailableWindow.fromJson)
            .toList(growable: false);
    if (windows.isEmpty ||
        evaluationAtMillis >= _maximumSafeJsonInteger ||
        validUntilExclusiveMillis <= evaluationAtMillis ||
        validUntilExclusiveMillis - evaluationAtMillis >
            CustomerBiteSaverSearchContract
                .usageEvaluationMaximumLifetimeMilliseconds ||
        timeZone.trim() != timeZone ||
        evaluationAtMillis + 1 - windows.first.startAtMillisInclusive >
            CustomerBiteSaverSearchContract
                .usageEvaluationMaximumWindowMilliseconds ||
        windows.last.endAtMillisExclusive != evaluationAtMillis + 1 ||
        windows.where((window) => window.contains(evaluationAtMillis)).length !=
            1) {
      throw const CustomerBiteSaverProtocolException();
    }
    for (var index = 1; index < windows.length; index += 1) {
      if (windows[index - 1].endAtMillisExclusive >=
          windows[index].startAtMillisInclusive) {
        throw const CustomerBiteSaverProtocolException();
      }
    }
    return CustomerBiteSaverEvaluationContext._(
      sessionId: _sessionId(data['sessionId']),
      attemptGeneration: _safeInteger(data['attemptGeneration']),
      queryFingerprint: _fingerprint(data['queryFingerprint']),
      evaluationAtMillis: evaluationAtMillis,
      timeZone: timeZone,
      utcOffsetMinutes: _safeInteger(
        data['utcOffsetMinutes'],
        minimum: -840,
        maximum: 840,
      ),
      availabilityGeneration: _fingerprint(data['availabilityGeneration']),
      validUntilExclusiveMillis: validUntilExclusiveMillis,
      oncePerDayUnavailableWindows:
          List<CustomerBiteSaverOncePerDayUnavailableWindow>.unmodifiable(
            windows,
          ),
    );
  }

  final String sessionId;
  final int attemptGeneration;
  final String queryFingerprint;
  final int evaluationAtMillis;
  final String timeZone;
  final int utcOffsetMinutes;
  final String availabilityGeneration;
  final int validUntilExclusiveMillis;
  final List<CustomerBiteSaverOncePerDayUnavailableWindow>
  oncePerDayUnavailableWindows;

  bool oncePerDayUnavailableAt(int completionMillis) =>
      oncePerDayUnavailableWindows.any(
        (window) => window.contains(completionMillis),
      );

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'sessionId': sessionId,
    'attemptGeneration': attemptGeneration,
    'queryFingerprint': queryFingerprint,
    'evaluationAtMillis': evaluationAtMillis,
    'timeZone': timeZone,
    'utcOffsetMinutes': utcOffsetMinutes,
    'availabilityGeneration': availabilityGeneration,
    'validUntilExclusiveMillis': validUntilExclusiveMillis,
    'oncePerDayUnavailableWindows': oncePerDayUnavailableWindows
        .map((window) => window.toJson())
        .toList(growable: false),
  };
}

final class CustomerBiteSaverGuestCheckCandidate {
  factory CustomerBiteSaverGuestCheckCandidate({
    required CustomerBiteSaverOfferId offerId,
    required CustomerBiteSaverGuestUsagePolicy usagePolicy,
  }) => CustomerBiteSaverGuestCheckCandidate.fromJson(<String, Object?>{
    'offerId': offerId.value,
    'usagePolicy': usagePolicy.name,
  });

  const CustomerBiteSaverGuestCheckCandidate._({
    required this.offerId,
    required this.usagePolicy,
  });

  factory CustomerBiteSaverGuestCheckCandidate.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{'offerId', 'usagePolicy'});
    return CustomerBiteSaverGuestCheckCandidate._(
      offerId: CustomerBiteSaverOfferId(
        _string(data['offerId'], maximumLength: 47),
      ),
      usagePolicy: _enumValue(
        data['usagePolicy'],
        <String, CustomerBiteSaverGuestUsagePolicy>{
          for (final policy in CustomerBiteSaverGuestUsagePolicy.values)
            policy.name: policy,
        },
      ),
    );
  }

  final CustomerBiteSaverOfferId offerId;
  final CustomerBiteSaverGuestUsagePolicy usagePolicy;

  Map<String, Object?> toJson() => <String, Object?>{
    'offerId': offerId.value,
    'usagePolicy': usagePolicy.name,
  };
}

sealed class CustomerBiteSaverEndpointResponse<
  T extends CustomerBiteSaverOperationResult
> {
  const CustomerBiteSaverEndpointResponse();
}

final class CustomerBiteSaverDirectResponse<
  T extends CustomerBiteSaverOperationResult
>
    extends CustomerBiteSaverEndpointResponse<T> {
  const CustomerBiteSaverDirectResponse(
    this.result, {
    required this.evaluationContext,
  });

  final T result;
  final CustomerBiteSaverEvaluationContext evaluationContext;
}

sealed class CustomerBiteSaverGuestOperationResponse<
  T extends CustomerBiteSaverOperationResult
>
    extends CustomerBiteSaverEndpointResponse<T> {
  const CustomerBiteSaverGuestOperationResponse({required this.operation});
  final CustomerBiteSaverGuestOperation operation;
  Map<String, Object?> toJson();
}

final class CustomerBiteSaverGuestCheckRequired<
  T extends CustomerBiteSaverOperationResult
>
    extends CustomerBiteSaverGuestOperationResponse<T> {
  const CustomerBiteSaverGuestCheckRequired._({
    required super.operation,
    required this.operationRef,
    required this.checkToken,
    required this.batchSequence,
    required this.guestStateRevision,
    required this.evaluationContext,
    required this.logicalExpiresAtMillis,
    required this.candidates,
  });

  final String operationRef;
  final String checkToken;
  final int batchSequence;
  final int guestStateRevision;
  final CustomerBiteSaverEvaluationContext evaluationContext;
  final int logicalExpiresAtMillis;
  final List<CustomerBiteSaverGuestCheckCandidate> candidates;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'protocolVersion': CustomerBiteSaverSearchContract.protocolVersion,
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'outcome': 'guestCheckRequired',
    'operation': operation.name,
    'operationRef': operationRef,
    'checkToken': checkToken,
    'batchSequence': batchSequence,
    'guestStateRevision': guestStateRevision,
    'evaluationContext': evaluationContext.toJson(),
    'logicalExpiresAtMillis': logicalExpiresAtMillis,
    'candidates': candidates.map((entry) => entry.toJson()).toList(),
  };
}

final class CustomerBiteSaverGuestRetryRequired<
  T extends CustomerBiteSaverOperationResult
>
    extends CustomerBiteSaverGuestOperationResponse<T> {
  const CustomerBiteSaverGuestRetryRequired._({
    required super.operation,
    required this.guestStateRevision,
    required this.reason,
    required this.restartFrom,
    required this.logicalExpiresAtMillis,
  });

  final int guestStateRevision;
  final CustomerBiteSaverGuestRetryReason reason;
  final CustomerBiteSaverGuestRestartFrom restartFrom;
  final int logicalExpiresAtMillis;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'protocolVersion': CustomerBiteSaverSearchContract.protocolVersion,
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'outcome': 'retryRequired',
    'operation': operation.name,
    'guestStateRevision': guestStateRevision,
    'reason': reason.name,
    'restartFrom': restartFrom.name,
    'logicalExpiresAtMillis': logicalExpiresAtMillis,
  };
}

final class CustomerBiteSaverGuestComplete<
  T extends CustomerBiteSaverOperationResult
>
    extends CustomerBiteSaverGuestOperationResponse<T> {
  const CustomerBiteSaverGuestComplete._({
    required super.operation,
    required this.guestStateRevision,
    required this.attemptGeneration,
    required this.queryFingerprint,
    required this.evaluationContext,
    required this.result,
  });

  final int? guestStateRevision;
  final int attemptGeneration;
  final String queryFingerprint;
  final CustomerBiteSaverEvaluationContext evaluationContext;
  final T result;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'protocolVersion': CustomerBiteSaverSearchContract.protocolVersion,
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'outcome': 'complete',
    'operation': operation.name,
    'guestStateRevision': guestStateRevision,
    'attemptGeneration': attemptGeneration,
    'queryFingerprint': queryFingerprint,
    'evaluationContext': evaluationContext.toJson(),
    'result': result.toJson(),
  };
}

CustomerBiteSaverEndpointResponse<T> parseCustomerBiteSaverEndpointResponse<
  T extends CustomerBiteSaverOperationResult
>(
  Object? value, {
  required CustomerBiteSaverGuestOperation expectedOperation,
  required T Function(Object? value) resultParser,
}) {
  final data = _record(value);
  if (!data.containsKey('outcome')) {
    final evaluationContext = CustomerBiteSaverEvaluationContext.fromJson(
      data['evaluationContext'],
    );
    final resultData = Map<String, Object?>.of(data)
      ..remove('evaluationContext');
    return CustomerBiteSaverDirectResponse<T>(
      resultParser(resultData),
      evaluationContext: evaluationContext,
    );
  }
  return _parseGuestResponse<T>(
    data,
    expectedOperation: expectedOperation,
    resultParser: resultParser,
  );
}

CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
parseCustomerBiteSaverGuestContinuationResponse(Object? value) {
  final data = _record(value);
  final operation = _parseGuestOperation(data['operation']);
  return switch (operation) {
    CustomerBiteSaverGuestOperation.restaurantPage =>
      _parseGuestResponse<CustomerBiteSaverRestaurantPageResult>(
        data,
        expectedOperation: operation,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      ),
    CustomerBiteSaverGuestOperation.offerPage =>
      _parseGuestResponse<CustomerBiteSaverOfferPageResult>(
        data,
        expectedOperation: operation,
        resultParser: CustomerBiteSaverOfferPageResult.fromJson,
      ),
    CustomerBiteSaverGuestOperation.redemptionStart =>
      _parseGuestResponse<CustomerBiteSaverRedemptionValidationResult>(
        data,
        expectedOperation: operation,
        resultParser: CustomerBiteSaverRedemptionValidationResult.fromJson,
      ),
  };
}

CustomerBiteSaverGuestOperation _parseGuestOperation(Object? value) =>
    _enumValue(value, <String, CustomerBiteSaverGuestOperation>{
      for (final operation in CustomerBiteSaverGuestOperation.values)
        operation.name: operation,
    });

CustomerBiteSaverGuestOperationResponse<T>
_parseGuestResponse<T extends CustomerBiteSaverOperationResult>(
  Map<String, Object?> data, {
  required CustomerBiteSaverGuestOperation expectedOperation,
  required T Function(Object? value) resultParser,
}) {
  if (data['protocolVersion'] !=
          CustomerBiteSaverSearchContract.protocolVersion ||
      data['schemaVersion'] != CustomerBiteSaverSearchContract.schemaVersion ||
      _parseGuestOperation(data['operation']) != expectedOperation) {
    throw const CustomerBiteSaverProtocolException();
  }
  switch (data['outcome']) {
    case 'guestCheckRequired':
      _exactKeys(data, <String>{
        'protocolVersion',
        'schemaVersion',
        'outcome',
        'operation',
        'operationRef',
        'checkToken',
        'batchSequence',
        'guestStateRevision',
        'evaluationContext',
        'logicalExpiresAtMillis',
        'candidates',
      });
      final candidates =
          _list(
                data['candidates'],
                maximumLength:
                    CustomerBiteSaverSearchContract.maximumGuestCandidates,
              )
              .map(CustomerBiteSaverGuestCheckCandidate.fromJson)
              .toList(growable: false);
      if (candidates.isEmpty ||
          candidates.map((entry) => entry.offerId.value).toSet().length !=
              candidates.length) {
        throw const CustomerBiteSaverProtocolException();
      }
      final evaluationContext = CustomerBiteSaverEvaluationContext.fromJson(
        data['evaluationContext'],
      );
      final logicalExpiresAtMillis = _safeInteger(
        data['logicalExpiresAtMillis'],
      );
      if (logicalExpiresAtMillis <= evaluationContext.evaluationAtMillis ||
          logicalExpiresAtMillis !=
              evaluationContext.validUntilExclusiveMillis) {
        throw const CustomerBiteSaverProtocolException();
      }
      return CustomerBiteSaverGuestCheckRequired<T>._(
        operation: expectedOperation,
        operationRef: _string(
          data['operationRef'],
          maximumLength: 48,
          pattern: _operationRefPattern,
        ),
        checkToken: _string(
          data['checkToken'],
          maximumLength:
              CustomerBiteSaverSearchContract.maximumOpaquePayloadLength,
          pattern: _checkTokenPattern,
        ),
        batchSequence: _safeInteger(data['batchSequence']),
        guestStateRevision: _safeInteger(data['guestStateRevision']),
        evaluationContext: evaluationContext,
        logicalExpiresAtMillis: logicalExpiresAtMillis,
        candidates: List<CustomerBiteSaverGuestCheckCandidate>.unmodifiable(
          candidates,
        ),
      );
    case 'retryRequired':
      _exactKeys(data, <String>{
        'protocolVersion',
        'schemaVersion',
        'outcome',
        'operation',
        'guestStateRevision',
        'reason',
        'restartFrom',
        'logicalExpiresAtMillis',
      });
      return CustomerBiteSaverGuestRetryRequired<T>._(
        operation: expectedOperation,
        guestStateRevision: _safeInteger(data['guestStateRevision']),
        reason: _enumValue(
          data['reason'],
          <String, CustomerBiteSaverGuestRetryReason>{
            for (final reason in CustomerBiteSaverGuestRetryReason.values)
              reason.name: reason,
          },
        ),
        restartFrom: _enumValue(
          data['restartFrom'],
          <String, CustomerBiteSaverGuestRestartFrom>{
            for (final restart in CustomerBiteSaverGuestRestartFrom.values)
              restart.name: restart,
          },
        ),
        logicalExpiresAtMillis: _safeInteger(data['logicalExpiresAtMillis']),
      );
    case 'complete':
      _exactKeys(data, <String>{
        'protocolVersion',
        'schemaVersion',
        'outcome',
        'operation',
        'guestStateRevision',
        'attemptGeneration',
        'queryFingerprint',
        'evaluationContext',
        'result',
      });
      return CustomerBiteSaverGuestComplete<T>._(
        operation: expectedOperation,
        guestStateRevision: data['guestStateRevision'] == null
            ? null
            : _safeInteger(data['guestStateRevision']),
        attemptGeneration: _safeInteger(data['attemptGeneration']),
        queryFingerprint: _fingerprint(data['queryFingerprint']),
        evaluationContext: CustomerBiteSaverEvaluationContext.fromJson(
          data['evaluationContext'],
        ),
        result: resultParser(data['result']),
      );
    default:
      throw const CustomerBiteSaverProtocolException();
  }
}

final class CustomerBiteSaverFavoriteStateEntry {
  const CustomerBiteSaverFavoriteStateEntry._({
    required this.id,
    required this.state,
  });

  factory CustomerBiteSaverFavoriteStateEntry.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{'id', 'state'});
    final id = _string(data['id'], maximumLength: 47);
    final identity = id.startsWith('bsr_')
        ? CustomerBiteSaverRestaurantId(id)
        : CustomerBiteSaverOfferId(id);
    return CustomerBiteSaverFavoriteStateEntry._(
      id: identity,
      state: _enumValue(data['state'], <String, CustomerBiteSaverFavoriteState>{
        for (final state in CustomerBiteSaverFavoriteState.values)
          state.name: state,
      }),
    );
  }

  final Object id;
  final CustomerBiteSaverFavoriteState state;

  String get idValue => switch (id) {
    CustomerBiteSaverRestaurantId value => value.value,
    CustomerBiteSaverOfferId value => value.value,
    _ => throw const CustomerBiteSaverProtocolException(),
  };

  Map<String, Object?> toJson() => <String, Object?>{
    'id': idValue,
    'state': state.name,
  };
}

final class CustomerBiteSaverFavoriteStatesResponse {
  const CustomerBiteSaverFavoriteStatesResponse._(this.states);

  factory CustomerBiteSaverFavoriteStatesResponse.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{'schemaVersion', 'states'});
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final states = _list(
      data['states'],
      maximumLength: CustomerBiteSaverSearchContract.maximumFavoriteIds,
    ).map(CustomerBiteSaverFavoriteStateEntry.fromJson).toList(growable: false);
    if (states.map((entry) => entry.idValue).toSet().length != states.length) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverFavoriteStatesResponse._(
      List<CustomerBiteSaverFavoriteStateEntry>.unmodifiable(states),
    );
  }

  final List<CustomerBiteSaverFavoriteStateEntry> states;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'states': states.map((entry) => entry.toJson()).toList(),
  };
}

final class CustomerBiteSaverRedemptionValidationResult
    extends CustomerBiteSaverOperationResult {
  const CustomerBiteSaverRedemptionValidationResult._({
    required this.restaurantId,
    required this.offerId,
    required this.allowed,
    required this.reason,
    required this.usagePolicy,
    required this.evaluatedAtMillis,
    required this.activeTimerExpiresAtMillis,
    required this.nextAvailableAtMillis,
    required this.validationId,
    required this.validationExpiresAtMillis,
  });

  factory CustomerBiteSaverRedemptionValidationResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'restaurantId',
      'offerId',
      'allowed',
      'reason',
      'usagePolicy',
      'evaluatedAtMillis',
      'activeTimerExpiresAtMillis',
      'nextAvailableAtMillis',
      'validationId',
      'validationExpiresAtMillis',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final allowed = _boolean(data['allowed']);
    final validationId = data['validationId'] == null
        ? null
        : _string(
            data['validationId'],
            maximumLength: 47,
            pattern: _validationIdPattern,
          );
    final validationExpiresAtMillis = data['validationExpiresAtMillis'] == null
        ? null
        : _safeInteger(data['validationExpiresAtMillis']);
    final reason = _string(data['reason'], maximumLength: 100);
    final usagePolicy = data['usagePolicy'] == null
        ? null
        : _enumValue(
            data['usagePolicy'],
            <String, CustomerBiteSaverUsagePolicy>{
              for (final policy in CustomerBiteSaverUsagePolicy.values)
                policy.name: policy,
            },
          );
    final evaluatedAtMillis = _safeInteger(data['evaluatedAtMillis']);
    if ((allowed &&
            (reason != 'available' ||
                usagePolicy == null ||
                validationId == null ||
                validationExpiresAtMillis == null ||
                validationExpiresAtMillis <= evaluatedAtMillis ||
                validationExpiresAtMillis - evaluatedAtMillis >
                    CustomerBiteSaverSearchContract
                        .redemptionValidationMaximumMilliseconds)) ||
        (!allowed &&
            (validationId != null || validationExpiresAtMillis != null))) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverRedemptionValidationResult._(
      restaurantId: CustomerBiteSaverRestaurantId(
        _string(data['restaurantId'], maximumLength: 47),
      ),
      offerId: CustomerBiteSaverOfferId(
        _string(data['offerId'], maximumLength: 47),
      ),
      allowed: allowed,
      reason: reason,
      usagePolicy: usagePolicy,
      evaluatedAtMillis: evaluatedAtMillis,
      activeTimerExpiresAtMillis: data['activeTimerExpiresAtMillis'] == null
          ? null
          : _safeInteger(data['activeTimerExpiresAtMillis']),
      nextAvailableAtMillis: data['nextAvailableAtMillis'] == null
          ? null
          : _safeInteger(data['nextAvailableAtMillis']),
      validationId: validationId,
      validationExpiresAtMillis: validationExpiresAtMillis,
    );
  }

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final bool allowed;
  final String reason;
  final CustomerBiteSaverUsagePolicy? usagePolicy;
  final int evaluatedAtMillis;
  final int? activeTimerExpiresAtMillis;
  final int? nextAvailableAtMillis;
  final String? validationId;
  final int? validationExpiresAtMillis;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'restaurantId': restaurantId.value,
    'offerId': offerId.value,
    'allowed': allowed,
    'reason': reason,
    'usagePolicy': usagePolicy?.name,
    'evaluatedAtMillis': evaluatedAtMillis,
    'activeTimerExpiresAtMillis': activeTimerExpiresAtMillis,
    'nextAvailableAtMillis': nextAvailableAtMillis,
    'validationId': validationId,
    'validationExpiresAtMillis': validationExpiresAtMillis,
  };
}

final class CustomerBiteSaverRedemptionStartResult {
  const CustomerBiteSaverRedemptionStartResult._({
    required this.restaurantId,
    required this.offerId,
    required this.redemptionId,
    required this.status,
    required this.timerStartedAtMillis,
    required this.timerExpiresAtMillis,
  });

  factory CustomerBiteSaverRedemptionStartResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, <String>{
      'schemaVersion',
      'restaurantId',
      'offerId',
      'redemptionId',
      'status',
      'timerStartedAtMillis',
      'timerExpiresAtMillis',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverSearchContract.schemaVersion) {
      throw const CustomerBiteSaverProtocolException();
    }
    final status =
        _enumValue(data['status'], <String, CustomerBiteSaverRedemptionStatus>{
          for (final status in CustomerBiteSaverRedemptionStatus.values)
            status.name: status,
        });
    final redemptionId = data['redemptionId'] == null
        ? null
        : _string(
            data['redemptionId'],
            maximumLength: 48,
            pattern: _redemptionIdPattern,
          );
    final timerStartedAtMillis = data['timerStartedAtMillis'] == null
        ? null
        : _safeInteger(data['timerStartedAtMillis']);
    final timerExpiresAtMillis = data['timerExpiresAtMillis'] == null
        ? null
        : _safeInteger(data['timerExpiresAtMillis']);
    final timed = status != CustomerBiteSaverRedemptionStatus.unlimited;
    if (timed !=
            (redemptionId != null &&
                timerStartedAtMillis != null &&
                timerExpiresAtMillis != null) ||
        (timed &&
            timerExpiresAtMillis! - timerStartedAtMillis! !=
                CustomerBiteSaverSearchContract.redemptionTimerMilliseconds)) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverRedemptionStartResult._(
      restaurantId: CustomerBiteSaverRestaurantId(
        _string(data['restaurantId'], maximumLength: 47),
      ),
      offerId: CustomerBiteSaverOfferId(
        _string(data['offerId'], maximumLength: 47),
      ),
      redemptionId: redemptionId,
      status: status,
      timerStartedAtMillis: timerStartedAtMillis,
      timerExpiresAtMillis: timerExpiresAtMillis,
    );
  }

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final String? redemptionId;
  final CustomerBiteSaverRedemptionStatus status;
  final int? timerStartedAtMillis;
  final int? timerExpiresAtMillis;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverSearchContract.schemaVersion,
    'restaurantId': restaurantId.value,
    'offerId': offerId.value,
    'redemptionId': redemptionId,
    'status': status.name,
    'timerStartedAtMillis': timerStartedAtMillis,
    'timerExpiresAtMillis': timerExpiresAtMillis,
  };
}

/// Presentation-only exact profile result. It contains no use credential.
final class CustomerBiteSaverPublicProfileResult {
  const CustomerBiteSaverPublicProfileResult._(
    this.catalogRestaurantId,
    this.state,
    this.restaurant,
    this.nextCursor,
    this.partial,
    this.favoriteStates,
  );
  factory CustomerBiteSaverPublicProfileResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, {
      'schemaVersion',
      'kind',
      'catalogRestaurantId',
      'state',
      'restaurant',
      'nextCursor',
      'hasMore',
      'partial',
      'favoriteStates',
    });
    if (data['schemaVersion'] != 1 ||
        data['kind'] != 'publicProfile' ||
        !{
          'available',
          'notParticipating',
          'unavailable',
        }.contains(data['state'])) {
      throw const CustomerBiteSaverProtocolException();
    }
    final restaurant = data['restaurant'] == null
        ? null
        : CustomerBiteSaverRestaurant.fromJson(
            data['restaurant'],
            publicProfile: true,
          );
    final cursor = _nullableString(data['nextCursor'], maximumLength: 32768);
    final more = _boolean(data['hasMore']);
    if ((data['state'] == 'available') != (restaurant != null) ||
        more != (cursor != null) ||
        (restaurant == null && more) ||
        (restaurant != null && restaurant.hasMoreOffers != more)) {
      throw const CustomerBiteSaverProtocolException();
    }
    final favorites = CustomerBiteSaverFavoriteStatesResponse.fromJson({
      'schemaVersion': 1,
      'states': data['favoriteStates'],
    }).states;
    final delivered = {
      restaurant?.restaurantId.value,
      ...?restaurant?.offers.map((offer) => offer.offerId.value),
    };
    if (favorites.any((entry) => !delivered.contains(entry.idValue))) {
      throw const CustomerBiteSaverProtocolException();
    }
    return CustomerBiteSaverPublicProfileResult._(
      _string(data['catalogRestaurantId'], maximumLength: 1500),
      data['state'] as String,
      restaurant,
      cursor,
      _boolean(data['partial']),
      favorites,
    );
  }
  final String catalogRestaurantId;
  final String state;
  final CustomerBiteSaverRestaurant? restaurant;
  final String? nextCursor;
  final bool partial;
  final List<CustomerBiteSaverFavoriteStateEntry> favoriteStates;
}
