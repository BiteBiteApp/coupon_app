import 'package:flutter/foundation.dart';

import '../services/firestore_document_id.dart';

const int adminRestaurantMailingBatchSchemaVersion = 1;
const int adminRestaurantMailingBatchMaximumRestaurants = 25;

const Set<String> _supportedUsStateCodes = <String>{
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
};

class AdminRestaurantMailingProtocolException extends FormatException {
  const AdminRestaurantMailingProtocolException()
    : super('The restaurant mailing batch response is invalid.');
}

enum AdminRestaurantMailingBatchOutcome {
  complete('complete'),
  partialFailure('partialFailure');

  const AdminRestaurantMailingBatchOutcome(this.wireName);

  final String wireName;

  static AdminRestaurantMailingBatchOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const AdminRestaurantMailingProtocolException();
  }
}

enum AdminRestaurantMailingProblemOutcome {
  unavailable('unavailable'),
  failed('failed');

  const AdminRestaurantMailingProblemOutcome(this.wireName);

  final String wireName;

  static AdminRestaurantMailingProblemOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const AdminRestaurantMailingProtocolException();
  }
}

enum AdminRestaurantMailingProblemCode {
  restaurantNotFound('restaurant_not_found'),
  restaurantIneligible('restaurant_ineligible'),
  missingMailingComponent('missing_mailing_component'),
  invalidState('invalid_state'),
  invalidZip('invalid_zip'),
  invalidOneLineText('invalid_one_line_text'),
  unsupportedAddressShape('unsupported_address_shape'),
  boundedReadFailed('bounded_read_failed');

  const AdminRestaurantMailingProblemCode(this.wireName);

  final String wireName;

  static AdminRestaurantMailingProblemCode parse(Object? value) {
    for (final code in values) {
      if (code.wireName == value) return code;
    }
    throw const AdminRestaurantMailingProtocolException();
  }
}

enum AdminRestaurantMailingInterruptionKind { invalidResponse, unavailable }

@immutable
class AdminRestaurantMailingSelection {
  factory AdminRestaurantMailingSelection(
    Iterable<String> catalogRestaurantIds,
  ) => AdminRestaurantMailingSelection._(
    _validatedUniqueIdentities(catalogRestaurantIds, allowEmpty: false),
  );

  const AdminRestaurantMailingSelection._(this.catalogRestaurantIds);

  final List<String> catalogRestaurantIds;
}

@immutable
class AdminRestaurantMailingChunkRequest {
  factory AdminRestaurantMailingChunkRequest(
    Iterable<String> catalogRestaurantIds,
  ) {
    final ids = _validatedUniqueIdentities(
      catalogRestaurantIds,
      allowEmpty: false,
    );
    if (ids.length > adminRestaurantMailingBatchMaximumRestaurants) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingChunkRequest._(ids);
  }

  const AdminRestaurantMailingChunkRequest._(this.catalogRestaurantIds);

  final List<String> catalogRestaurantIds;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': adminRestaurantMailingBatchSchemaVersion,
    'catalogRestaurantIds': List<String>.of(catalogRestaurantIds),
  };
}

sealed class AdminRestaurantMailingResult {
  const AdminRestaurantMailingResult(this.catalogRestaurantId);

  final String catalogRestaurantId;
}

@immutable
final class AdminRestaurantMailingReady extends AdminRestaurantMailingResult {
  factory AdminRestaurantMailingReady({
    required String catalogRestaurantId,
    required String restaurantName,
    required String streetAddress,
    required String city,
    required String state,
    required String zipCode,
  }) {
    final exactState = _requiredCanonicalText(state);
    final exactZipCode = _requiredCanonicalText(zipCode);
    if (!_supportedUsStateCodes.contains(exactState) ||
        !RegExp(r'^\d{5}(?:-\d{4})?$').hasMatch(exactZipCode)) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingReady._(
      catalogRestaurantId: _requiredIdentity(catalogRestaurantId),
      restaurantName: _requiredCanonicalText(restaurantName),
      streetAddress: _requiredCanonicalText(streetAddress),
      city: _requiredCanonicalText(city),
      state: exactState,
      zipCode: exactZipCode,
    );
  }

  const AdminRestaurantMailingReady._({
    required String catalogRestaurantId,
    required this.restaurantName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
  }) : super(catalogRestaurantId);

  factory AdminRestaurantMailingReady.fromCallableData(Object? value) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'catalogRestaurantId',
      'outcome',
      'restaurantName',
      'streetAddress',
      'city',
      'state',
      'zipCode',
    });
    if (data['outcome'] != 'ready') {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingReady(
      catalogRestaurantId: _requiredString(data['catalogRestaurantId']),
      restaurantName: _requiredString(data['restaurantName']),
      streetAddress: _requiredString(data['streetAddress']),
      city: _requiredString(data['city']),
      state: _requiredString(data['state']),
      zipCode: _requiredString(data['zipCode']),
    );
  }

  final String restaurantName;
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;
}

@immutable
final class AdminRestaurantMailingProblem extends AdminRestaurantMailingResult {
  factory AdminRestaurantMailingProblem({
    required String catalogRestaurantId,
    required AdminRestaurantMailingProblemOutcome outcome,
    required String? restaurantName,
    required AdminRestaurantMailingProblemCode code,
    required String message,
  }) {
    final boundedFailure =
        code == AdminRestaurantMailingProblemCode.boundedReadFailed;
    if (boundedFailure !=
        (outcome == AdminRestaurantMailingProblemOutcome.failed)) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingProblem._(
      catalogRestaurantId: _requiredIdentity(catalogRestaurantId),
      outcome: outcome,
      restaurantName: restaurantName == null
          ? null
          : _requiredCanonicalText(restaurantName),
      code: code,
      message: _requiredSafeMessage(message),
    );
  }

  const AdminRestaurantMailingProblem._({
    required String catalogRestaurantId,
    required this.outcome,
    required this.restaurantName,
    required this.code,
    required this.message,
  }) : super(catalogRestaurantId);

  factory AdminRestaurantMailingProblem.fromCallableData(Object? value) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'catalogRestaurantId',
      'outcome',
      'restaurantName',
      'code',
      'message',
    });
    final restaurantName = data['restaurantName'];
    if (restaurantName != null && restaurantName is! String) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingProblem(
      catalogRestaurantId: _requiredString(data['catalogRestaurantId']),
      outcome: AdminRestaurantMailingProblemOutcome.parse(data['outcome']),
      restaurantName: restaurantName as String?,
      code: AdminRestaurantMailingProblemCode.parse(data['code']),
      message: _requiredString(data['message']),
    );
  }

  final AdminRestaurantMailingProblemOutcome outcome;
  final String? restaurantName;
  final AdminRestaurantMailingProblemCode code;
  final String message;
}

@immutable
class AdminRestaurantMailingChunkResult {
  const AdminRestaurantMailingChunkResult._({
    required this.outcome,
    required this.results,
  });

  factory AdminRestaurantMailingChunkResult.fromCallableData(
    Object? value, {
    required List<String> expectedCatalogRestaurantIds,
  }) {
    final expected = AdminRestaurantMailingChunkRequest(
      expectedCatalogRestaurantIds,
    ).catalogRestaurantIds;
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'schemaVersion',
      'outcome',
      'results',
    });
    if (data['schemaVersion'] is! int ||
        data['schemaVersion'] != adminRestaurantMailingBatchSchemaVersion) {
      throw const AdminRestaurantMailingProtocolException();
    }
    final outcome = AdminRestaurantMailingBatchOutcome.parse(data['outcome']);
    final rawResults = _strictList(data['results']);
    if (rawResults.length != expected.length) {
      throw const AdminRestaurantMailingProtocolException();
    }

    final results = <AdminRestaurantMailingResult>[];
    final seenIds = <String>{};
    for (var index = 0; index < rawResults.length; index += 1) {
      final rawResult = _strictMap(rawResults[index]);
      final result = switch (rawResult['outcome']) {
        'ready' => AdminRestaurantMailingReady.fromCallableData(rawResult),
        'unavailable' ||
        'failed' => AdminRestaurantMailingProblem.fromCallableData(rawResult),
        _ => throw const AdminRestaurantMailingProtocolException(),
      };
      if (result.catalogRestaurantId != expected[index] ||
          !seenIds.add(result.catalogRestaurantId)) {
        throw const AdminRestaurantMailingProtocolException();
      }
      results.add(result);
    }
    final allReady = results.every(
      (result) => result is AdminRestaurantMailingReady,
    );
    if ((outcome == AdminRestaurantMailingBatchOutcome.complete) != allReady) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingChunkResult._(
      outcome: outcome,
      results: List<AdminRestaurantMailingResult>.unmodifiable(results),
    );
  }

  final AdminRestaurantMailingBatchOutcome outcome;
  final List<AdminRestaurantMailingResult> results;
}

@immutable
class AdminRestaurantMailingInterruption {
  factory AdminRestaurantMailingInterruption({
    required AdminRestaurantMailingInterruptionKind kind,
    required String message,
    required Iterable<String> catalogRestaurantIds,
  }) => AdminRestaurantMailingInterruption._(
    kind: kind,
    message: _requiredSafeMessage(message),
    catalogRestaurantIds: _validatedUniqueIdentities(
      catalogRestaurantIds,
      allowEmpty: false,
    ),
  );

  const AdminRestaurantMailingInterruption._({
    required this.kind,
    required this.message,
    required this.catalogRestaurantIds,
  });

  final AdminRestaurantMailingInterruptionKind kind;
  final String message;
  final List<String> catalogRestaurantIds;
}

@immutable
class AdminRestaurantMailingBatchRunResult {
  factory AdminRestaurantMailingBatchRunResult({
    required Iterable<String> requestedCatalogRestaurantIds,
    required Iterable<AdminRestaurantMailingResult> confirmedResults,
    AdminRestaurantMailingInterruption? interruption,
  }) {
    final requested = _validatedUniqueIdentities(
      requestedCatalogRestaurantIds,
      allowEmpty: false,
    );
    final confirmed = List<AdminRestaurantMailingResult>.unmodifiable(
      confirmedResults,
    );
    if (confirmed.length > requested.length) {
      throw const AdminRestaurantMailingProtocolException();
    }
    for (var index = 0; index < confirmed.length; index += 1) {
      if (confirmed[index].catalogRestaurantId != requested[index]) {
        throw const AdminRestaurantMailingProtocolException();
      }
    }
    if (interruption == null) {
      if (confirmed.length != requested.length) {
        throw const AdminRestaurantMailingProtocolException();
      }
    } else if (confirmed.length == requested.length ||
        !listEquals(
          interruption.catalogRestaurantIds,
          requested.sublist(confirmed.length),
        )) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingBatchRunResult._(
      requestedCatalogRestaurantIds: requested,
      confirmedResults: confirmed,
      interruption: interruption,
    );
  }

  const AdminRestaurantMailingBatchRunResult._({
    required this.requestedCatalogRestaurantIds,
    required this.confirmedResults,
    required this.interruption,
  });

  final List<String> requestedCatalogRestaurantIds;
  final List<AdminRestaurantMailingResult> confirmedResults;
  final AdminRestaurantMailingInterruption? interruption;

  bool get wasInterrupted => interruption != null;
  bool get canRetry => interruption != null;
  bool get isFullyConfirmed => interruption == null;
  bool get allRestaurantsReady =>
      isFullyConfirmed &&
      confirmedResults.every((result) => result is AdminRestaurantMailingReady);

  List<String> get unconfirmedCatalogRestaurantIds =>
      interruption?.catalogRestaurantIds ?? const <String>[];

  List<AdminRestaurantMailingReady> get readyRestaurants =>
      List<AdminRestaurantMailingReady>.unmodifiable(
        confirmedResults.whereType<AdminRestaurantMailingReady>(),
      );

  List<AdminRestaurantMailingProblem> get problems =>
      List<AdminRestaurantMailingProblem>.unmodifiable(
        confirmedResults.whereType<AdminRestaurantMailingProblem>(),
      );

  AdminRestaurantMailingBatchRunResult mergeExplicitRetry(
    AdminRestaurantMailingBatchRunResult retry,
  ) {
    if (interruption == null ||
        !listEquals(
          interruption!.catalogRestaurantIds,
          retry.requestedCatalogRestaurantIds,
        )) {
      throw const AdminRestaurantMailingProtocolException();
    }
    return AdminRestaurantMailingBatchRunResult(
      requestedCatalogRestaurantIds: requestedCatalogRestaurantIds,
      confirmedResults: <AdminRestaurantMailingResult>[
        ...confirmedResults,
        ...retry.confirmedResults,
      ],
      interruption: retry.interruption,
    );
  }
}

Map<String, Object?> _strictMap(Object? value) {
  if (value is! Map) {
    throw const AdminRestaurantMailingProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String || result.containsKey(entry.key)) {
      throw const AdminRestaurantMailingProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

List<Object?> _strictList(Object? value) {
  if (value is! List) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return List<Object?>.of(value, growable: false);
}

void _requireExactKeys(Map<String, Object?> value, Set<String> expected) {
  if (!setEquals(value.keys.toSet(), expected)) {
    throw const AdminRestaurantMailingProtocolException();
  }
}

String _requiredString(Object? value) {
  if (value is! String) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return value;
}

String _requiredIdentity(Object? value) {
  if (value is! String || !_hasWellFormedUtf16(value)) {
    throw const AdminRestaurantMailingProtocolException();
  }
  final exact = exactFirestoreDocumentId(value);
  if (exact == null) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return exact;
}

List<String> _validatedUniqueIdentities(
  Iterable<String> values, {
  required bool allowEmpty,
}) {
  final result = <String>[];
  final seen = <String>{};
  for (final value in values) {
    final exact = _requiredIdentity(value);
    if (!seen.add(exact)) {
      throw const AdminRestaurantMailingProtocolException();
    }
    result.add(exact);
  }
  if (!allowEmpty && result.isEmpty) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return List<String>.unmodifiable(result);
}

String _requiredCanonicalText(Object? value) {
  final text = _requiredString(value);
  if (text.isEmpty ||
      text.trim() != text ||
      !_hasWellFormedUtf16(text) ||
      text.runes.any(_isUnsupportedOneLineRune)) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return text;
}

String _requiredSafeMessage(Object? value) {
  final message = _requiredCanonicalText(value);
  if (message.length > 500 ||
      RegExp(
        r'(?:https?://|go\.bitestar\.app|/invite/)',
        caseSensitive: false,
      ).hasMatch(message)) {
    throw const AdminRestaurantMailingProtocolException();
  }
  return message;
}

bool _hasWellFormedUtf16(String value) {
  final codeUnits = value.codeUnits;
  for (var index = 0; index < codeUnits.length; index += 1) {
    final codeUnit = codeUnits[index];
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= codeUnits.length) return false;
      final trailing = codeUnits[index + 1];
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

bool _isUnsupportedOneLineRune(int rune) {
  return _isExplicitlyRejectedKhmerFormattingRune(rune) ||
      rune <= 0x1f ||
      (rune >= 0x7f && rune <= 0x9f) ||
      rune == 0xad ||
      (rune >= 0x600 && rune <= 0x605) ||
      rune == 0x61c ||
      rune == 0x6dd ||
      rune == 0x70f ||
      (rune >= 0x890 && rune <= 0x891) ||
      rune == 0x8e2 ||
      rune == 0x180e ||
      (rune >= 0x200b && rune <= 0x200f) ||
      rune == 0x2028 ||
      rune == 0x2029 ||
      (rune >= 0x202a && rune <= 0x202e) ||
      (rune >= 0x2060 && rune <= 0x2064) ||
      (rune >= 0x2066 && rune <= 0x206f) ||
      rune == 0xfeff ||
      (rune >= 0xfff9 && rune <= 0xfffb) ||
      rune == 0x110bd ||
      rune == 0x110cd ||
      (rune >= 0x13430 && rune <= 0x1343f) ||
      (rune >= 0x1bca0 && rune <= 0x1bca3) ||
      (rune >= 0x1d173 && rune <= 0x1d17a) ||
      rune == 0xe0001 ||
      (rune >= 0xe0020 && rune <= 0xe007f);
}

bool _isExplicitlyRejectedKhmerFormattingRune(int rune) =>
    rune == 0x17b4 || rune == 0x17b5;
