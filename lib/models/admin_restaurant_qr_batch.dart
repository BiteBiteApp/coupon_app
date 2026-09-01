import 'package:flutter/foundation.dart';

import '../services/firestore_document_id.dart';

const int adminRestaurantQrBatchSchemaVersion = 1;
const int adminRestaurantQrBatchMaximumRestaurants = 25;
const int adminRestaurantQrBatchMaximumLabels = 100;
const int adminRestaurantQrLabelsPerPage = 48;
const int adminRestaurantQrMaximumPayloadUrlLength = 8192;

class AdminRestaurantQrProtocolException extends FormatException {
  const AdminRestaurantQrProtocolException()
    : super('The batch QR response is invalid.');
}

enum AdminRestaurantQrLabelType {
  ownerInvite('I', 0),
  claimInvite('C', 1),
  biteSaverCustomer('SA', 2),
  biteScoreCustomer('SR', 3);

  const AdminRestaurantQrLabelType(this.wireName, this.sortIndex);

  final String wireName;
  final int sortIndex;

  bool get requiresInvitation => this == ownerInvite || this == claimInvite;

  static AdminRestaurantQrLabelType parse(Object? value) {
    for (final type in values) {
      if (type.wireName == value) return type;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

enum AdminRestaurantQrPreparationOutcome {
  complete('complete'),
  partialFailure('partialFailure');

  const AdminRestaurantQrPreparationOutcome(this.wireName);

  final String wireName;

  static AdminRestaurantQrPreparationOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

enum AdminRestaurantQrProblemOutcome {
  unavailable('unavailable'),
  failed('failed');

  const AdminRestaurantQrProblemOutcome(this.wireName);

  final String wireName;

  static AdminRestaurantQrProblemOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

enum AdminRestaurantQrPreparationStatus {
  prepared('prepared'),
  unprepared('unprepared'),
  notRequired('notRequired'),
  unavailable('unavailable');

  const AdminRestaurantQrPreparationStatus(this.wireName);

  final String wireName;

  static AdminRestaurantQrPreparationStatus parse(Object? value) {
    for (final status in values) {
      if (status.wireName == value) return status;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

enum AdminRestaurantQrMarkingOutcome {
  complete('complete'),
  partialFailure('partialFailure');

  const AdminRestaurantQrMarkingOutcome(this.wireName);

  final String wireName;

  static AdminRestaurantQrMarkingOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

enum AdminRestaurantQrRestaurantMarkingOutcome {
  processed('processed'),
  partialFailure('partialFailure'),
  failed('failed');

  const AdminRestaurantQrRestaurantMarkingOutcome(this.wireName);

  final String wireName;

  static AdminRestaurantQrRestaurantMarkingOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

enum AdminRestaurantQrLabelMarkingStatus {
  saved('saved'),
  notRequired('notRequired'),
  failed('failed');

  const AdminRestaurantQrLabelMarkingStatus(this.wireName);

  final String wireName;

  static AdminRestaurantQrLabelMarkingStatus parse(Object? value) {
    for (final status in values) {
      if (status.wireName == value) return status;
    }
    throw const AdminRestaurantQrProtocolException();
  }
}

@immutable
class AdminRestaurantQrPreparationRequest {
  factory AdminRestaurantQrPreparationRequest(
    Iterable<String> catalogRestaurantIds,
  ) {
    final ids = _validatedUniqueIdentities(
      catalogRestaurantIds,
      allowEmpty: false,
    );
    if (ids.length > adminRestaurantQrBatchMaximumRestaurants) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrPreparationRequest._(ids);
  }

  const AdminRestaurantQrPreparationRequest._(this.catalogRestaurantIds);

  final List<String> catalogRestaurantIds;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': adminRestaurantQrBatchSchemaVersion,
    'catalogRestaurantIds': List<String>.of(catalogRestaurantIds),
  };
}

@immutable
class AdminRestaurantQrLabelEntry {
  factory AdminRestaurantQrLabelEntry({
    required AdminRestaurantQrLabelType type,
    required String payloadUrl,
    String? invitationId,
    int? invitationExpiresAtMillis,
  }) {
    _validatePayloadUrl(type: type, value: payloadUrl);
    if (type.requiresInvitation) {
      if (_exactIdentity(invitationId) == null ||
          !_isPositiveSafeInteger(invitationExpiresAtMillis)) {
        throw const AdminRestaurantQrProtocolException();
      }
    } else if (invitationId != null || invitationExpiresAtMillis != null) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrLabelEntry._(
      type: type,
      payloadUrl: payloadUrl,
      invitationId: invitationId,
      invitationExpiresAtMillis: invitationExpiresAtMillis,
    );
  }

  const AdminRestaurantQrLabelEntry._({
    required this.type,
    required this.payloadUrl,
    required this.invitationId,
    required this.invitationExpiresAtMillis,
  });

  factory AdminRestaurantQrLabelEntry.fromCallableData(
    Object? value, {
    required String expectedCatalogRestaurantId,
  }) {
    final data = _strictMap(value);
    final type = AdminRestaurantQrLabelType.parse(data['type']);
    if (type.requiresInvitation) {
      _requireExactKeys(data, const <String>{
        'type',
        'payloadUrl',
        'invitationId',
        'invitationExpiresAtMillis',
      });
    } else {
      _requireExactKeys(data, const <String>{'type', 'payloadUrl'});
    }
    final payloadUrl = _requiredString(
      data['payloadUrl'],
      maximumLength: adminRestaurantQrMaximumPayloadUrlLength,
    );
    _validatePayloadUrl(
      type: type,
      value: payloadUrl,
      expectedCatalogRestaurantId: expectedCatalogRestaurantId,
    );
    return AdminRestaurantQrLabelEntry(
      type: type,
      payloadUrl: payloadUrl,
      invitationId: type.requiresInvitation
          ? _requiredIdentity(data['invitationId'])
          : null,
      invitationExpiresAtMillis: type.requiresInvitation
          ? _requiredPositiveSafeInteger(data['invitationExpiresAtMillis'])
          : null,
    );
  }

  final AdminRestaurantQrLabelType type;
  final String payloadUrl;
  final String? invitationId;
  final int? invitationExpiresAtMillis;

  AdminRestaurantQrMarkingLabelRequest toMarkingRequest() =>
      AdminRestaurantQrMarkingLabelRequest(
        type: type,
        invitationId: invitationId,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AdminRestaurantQrLabelEntry &&
          type == other.type &&
          payloadUrl == other.payloadUrl &&
          invitationId == other.invitationId &&
          invitationExpiresAtMillis == other.invitationExpiresAtMillis;

  @override
  int get hashCode =>
      Object.hash(type, payloadUrl, invitationId, invitationExpiresAtMillis);
}

sealed class AdminRestaurantQrRestaurantResult {
  const AdminRestaurantQrRestaurantResult(this.catalogRestaurantId);

  final String catalogRestaurantId;
}

@immutable
final class AdminRestaurantQrReadyRestaurant
    extends AdminRestaurantQrRestaurantResult {
  factory AdminRestaurantQrReadyRestaurant({
    required String catalogRestaurantId,
    required String restaurantName,
    required Iterable<AdminRestaurantQrLabelEntry> labels,
  }) {
    final exactId = _requiredIdentity(catalogRestaurantId);
    final exactName = _requiredDisplayText(restaurantName, maximumLength: 300);
    final immutableLabels = _validatedLabels(
      labels,
      catalogRestaurantId: exactId,
      requireCustomerPair: true,
    );
    return AdminRestaurantQrReadyRestaurant._(
      catalogRestaurantId: exactId,
      restaurantName: exactName,
      labels: immutableLabels,
    );
  }

  const AdminRestaurantQrReadyRestaurant._({
    required String catalogRestaurantId,
    required this.restaurantName,
    required this.labels,
  }) : super(catalogRestaurantId);

  factory AdminRestaurantQrReadyRestaurant.fromCallableData(Object? value) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'catalogRestaurantId',
      'outcome',
      'restaurantName',
      'labels',
    });
    if (data['outcome'] != 'ready') {
      throw const AdminRestaurantQrProtocolException();
    }
    final catalogRestaurantId = _requiredIdentity(data['catalogRestaurantId']);
    final rawLabels = _strictList(data['labels']);
    return AdminRestaurantQrReadyRestaurant(
      catalogRestaurantId: catalogRestaurantId,
      restaurantName: _requiredDisplayText(
        data['restaurantName'],
        maximumLength: 300,
      ),
      labels: rawLabels.map(
        (label) => AdminRestaurantQrLabelEntry.fromCallableData(
          label,
          expectedCatalogRestaurantId: catalogRestaurantId,
        ),
      ),
    );
  }

  final String restaurantName;
  final List<AdminRestaurantQrLabelEntry> labels;

  AdminRestaurantQrArtifactRestaurant toArtifactRestaurant({
    Iterable<AdminRestaurantQrLabelEntry>? includedLabels,
  }) => AdminRestaurantQrArtifactRestaurant(
    catalogRestaurantId: catalogRestaurantId,
    restaurantName: restaurantName,
    labels: includedLabels ?? labels,
  );
}

@immutable
final class AdminRestaurantQrProblemRestaurant
    extends AdminRestaurantQrRestaurantResult {
  factory AdminRestaurantQrProblemRestaurant({
    required String catalogRestaurantId,
    required AdminRestaurantQrProblemOutcome outcome,
    required String code,
    required String message,
  }) => AdminRestaurantQrProblemRestaurant._(
    catalogRestaurantId: _requiredIdentity(catalogRestaurantId),
    outcome: outcome,
    code: _requiredCode(code),
    message: _requiredSafeMessage(message),
  );

  const AdminRestaurantQrProblemRestaurant._({
    required String catalogRestaurantId,
    required this.outcome,
    required this.code,
    required this.message,
  }) : super(catalogRestaurantId);

  factory AdminRestaurantQrProblemRestaurant.fromCallableData(Object? value) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'catalogRestaurantId',
      'outcome',
      'code',
      'message',
    });
    return AdminRestaurantQrProblemRestaurant(
      catalogRestaurantId: _requiredIdentity(data['catalogRestaurantId']),
      outcome: AdminRestaurantQrProblemOutcome.parse(data['outcome']),
      code: _requiredCode(data['code']),
      message: _requiredSafeMessage(data['message']),
    );
  }

  final AdminRestaurantQrProblemOutcome outcome;
  final String code;
  final String message;

  AdminRestaurantQrProblemItem toProblemItem() => AdminRestaurantQrProblemItem(
    catalogRestaurantId: catalogRestaurantId,
    outcome: outcome,
    code: code,
    message: message,
  );
}

@immutable
class AdminRestaurantQrProblemItem {
  factory AdminRestaurantQrProblemItem({
    required String catalogRestaurantId,
    required AdminRestaurantQrProblemOutcome outcome,
    required String code,
    required String message,
  }) => AdminRestaurantQrProblemItem._(
    catalogRestaurantId: _requiredIdentity(catalogRestaurantId),
    outcome: outcome,
    code: _requiredCode(code),
    message: _requiredSafeMessage(message),
  );

  const AdminRestaurantQrProblemItem._({
    required this.catalogRestaurantId,
    required this.outcome,
    required this.code,
    required this.message,
  });

  final String catalogRestaurantId;
  final AdminRestaurantQrProblemOutcome outcome;
  final String code;
  final String message;
}

@immutable
class AdminRestaurantQrPreparationChunkResult {
  const AdminRestaurantQrPreparationChunkResult._({
    required this.outcome,
    required this.results,
  });

  factory AdminRestaurantQrPreparationChunkResult.fromCallableData(
    Object? value, {
    required List<String> expectedCatalogRestaurantIds,
  }) {
    final expected = AdminRestaurantQrPreparationRequest(
      expectedCatalogRestaurantIds,
    ).catalogRestaurantIds;
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'schemaVersion',
      'outcome',
      'results',
    });
    if (data['schemaVersion'] is! int ||
        data['schemaVersion'] != adminRestaurantQrBatchSchemaVersion) {
      throw const AdminRestaurantQrProtocolException();
    }
    final outcome = AdminRestaurantQrPreparationOutcome.parse(data['outcome']);
    final rawResults = _strictList(data['results']);
    if (rawResults.length != expected.length) {
      throw const AdminRestaurantQrProtocolException();
    }
    final results = <AdminRestaurantQrRestaurantResult>[];
    final seenIds = <String>{};
    for (var index = 0; index < rawResults.length; index += 1) {
      final rawResult = _strictMap(rawResults[index]);
      final result = switch (rawResult['outcome']) {
        'ready' => AdminRestaurantQrReadyRestaurant.fromCallableData(rawResult),
        'unavailable' || 'failed' =>
          AdminRestaurantQrProblemRestaurant.fromCallableData(rawResult),
        _ => throw const AdminRestaurantQrProtocolException(),
      };
      if (result.catalogRestaurantId != expected[index] ||
          !seenIds.add(result.catalogRestaurantId)) {
        throw const AdminRestaurantQrProtocolException();
      }
      results.add(result);
    }
    final allReady = results.every(
      (result) => result is AdminRestaurantQrReadyRestaurant,
    );
    if ((outcome == AdminRestaurantQrPreparationOutcome.complete) != allReady) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrPreparationChunkResult._(
      outcome: outcome,
      results: List<AdminRestaurantQrRestaurantResult>.unmodifiable(results),
    );
  }

  final AdminRestaurantQrPreparationOutcome outcome;
  final List<AdminRestaurantQrRestaurantResult> results;
}

@immutable
class AdminRestaurantQrPreparationRunResult {
  factory AdminRestaurantQrPreparationRunResult({
    required Iterable<String> requestedCatalogRestaurantIds,
    required Iterable<AdminRestaurantQrRestaurantResult> results,
    AdminRestaurantQrPreparationInterruption? interruption,
  }) {
    final requested = _validatedUniqueIdentities(
      requestedCatalogRestaurantIds,
      allowEmpty: false,
    );
    final immutableResults =
        List<AdminRestaurantQrRestaurantResult>.unmodifiable(results);
    if (immutableResults.length != requested.length) {
      throw const AdminRestaurantQrProtocolException();
    }
    for (var index = 0; index < requested.length; index += 1) {
      if (immutableResults[index].catalogRestaurantId != requested[index]) {
        throw const AdminRestaurantQrProtocolException();
      }
    }
    if (interruption != null) {
      final retryIds = interruption.catalogRestaurantIds;
      final firstRetryIndex = requested.length - retryIds.length;
      if (firstRetryIndex < 0 ||
          !listEquals(requested.sublist(firstRetryIndex), retryIds) ||
          immutableResults
              .skip(firstRetryIndex)
              .any(
                (result) =>
                    result is! AdminRestaurantQrProblemRestaurant ||
                    result.code != interruption.code ||
                    result.message != interruption.message,
              )) {
        throw const AdminRestaurantQrProtocolException();
      }
    }
    return AdminRestaurantQrPreparationRunResult._(
      requestedCatalogRestaurantIds: requested,
      results: immutableResults,
      interruption: interruption,
    );
  }

  const AdminRestaurantQrPreparationRunResult._({
    required this.requestedCatalogRestaurantIds,
    required this.results,
    required this.interruption,
  });

  final List<String> requestedCatalogRestaurantIds;
  final List<AdminRestaurantQrRestaurantResult> results;
  final AdminRestaurantQrPreparationInterruption? interruption;

  bool get wasInterrupted => interruption != null;
  bool get canRetryPreparation => interruption != null;

  List<String> get retryCatalogRestaurantIds =>
      interruption?.catalogRestaurantIds ?? const <String>[];

  bool get isComplete =>
      results.every((result) => result is AdminRestaurantQrReadyRestaurant);

  List<AdminRestaurantQrReadyRestaurant> get readyRestaurants =>
      List<AdminRestaurantQrReadyRestaurant>.unmodifiable(
        results.whereType<AdminRestaurantQrReadyRestaurant>(),
      );

  List<AdminRestaurantQrProblemItem> get problems =>
      List<AdminRestaurantQrProblemItem>.unmodifiable(
        results.whereType<AdminRestaurantQrProblemRestaurant>().map(
          (result) => result.toProblemItem(),
        ),
      );

  AdminRestaurantQrArtifactManifest toArtifactManifest() =>
      AdminRestaurantQrArtifactManifest(
        selectedRestaurantCount: requestedCatalogRestaurantIds.length,
        restaurants: readyRestaurants.map(
          (restaurant) => restaurant.toArtifactRestaurant(),
        ),
      );

  AdminRestaurantQrPreparationRunResult mergeExplicitRetry(
    AdminRestaurantQrPreparationRunResult retry,
  ) {
    final expectedRetryIds = retryCatalogRestaurantIds;
    if (!listEquals(expectedRetryIds, retry.requestedCatalogRestaurantIds)) {
      throw const AdminRestaurantQrProtocolException();
    }
    final retryById = <String, AdminRestaurantQrRestaurantResult>{
      for (final result in retry.results) result.catalogRestaurantId: result,
    };
    return AdminRestaurantQrPreparationRunResult(
      requestedCatalogRestaurantIds: requestedCatalogRestaurantIds,
      results: results.map(
        (result) => retryById[result.catalogRestaurantId] ?? result,
      ),
      interruption: retry.interruption,
    );
  }
}

@immutable
class AdminRestaurantQrPreparationInterruption {
  factory AdminRestaurantQrPreparationInterruption({
    required String code,
    required String message,
    required Iterable<String> catalogRestaurantIds,
  }) => AdminRestaurantQrPreparationInterruption._(
    code: _requiredCode(code),
    message: _requiredSafeMessage(message),
    catalogRestaurantIds: _validatedUniqueIdentities(
      catalogRestaurantIds,
      allowEmpty: false,
    ),
  );

  const AdminRestaurantQrPreparationInterruption._({
    required this.code,
    required this.message,
    required this.catalogRestaurantIds,
  });

  final String code;
  final String message;
  final List<String> catalogRestaurantIds;
}

@immutable
class AdminRestaurantQrArtifactRestaurant {
  factory AdminRestaurantQrArtifactRestaurant({
    required String catalogRestaurantId,
    required String restaurantName,
    required Iterable<AdminRestaurantQrLabelEntry> labels,
  }) {
    final exactId = _requiredIdentity(catalogRestaurantId);
    return AdminRestaurantQrArtifactRestaurant._(
      catalogRestaurantId: exactId,
      restaurantName: _requiredDisplayText(restaurantName, maximumLength: 300),
      labels: _validatedLabels(
        labels,
        catalogRestaurantId: exactId,
        requireCustomerPair: false,
      ),
    );
  }

  const AdminRestaurantQrArtifactRestaurant._({
    required this.catalogRestaurantId,
    required this.restaurantName,
    required this.labels,
  });

  final String catalogRestaurantId;
  final String restaurantName;
  final List<AdminRestaurantQrLabelEntry> labels;

  AdminRestaurantQrArtifactRestaurant withLabels(
    Iterable<AdminRestaurantQrLabelEntry> includedLabels,
  ) => AdminRestaurantQrArtifactRestaurant(
    catalogRestaurantId: catalogRestaurantId,
    restaurantName: restaurantName,
    labels: includedLabels,
  );
}

@immutable
class AdminRestaurantQrArtifactManifest {
  factory AdminRestaurantQrArtifactManifest({
    required int selectedRestaurantCount,
    required Iterable<AdminRestaurantQrArtifactRestaurant> restaurants,
  }) {
    final immutableRestaurants =
        List<AdminRestaurantQrArtifactRestaurant>.unmodifiable(restaurants);
    final seenIds = <String>{};
    if (selectedRestaurantCount < immutableRestaurants.length ||
        selectedRestaurantCount < 0 ||
        immutableRestaurants.any(
          (restaurant) => !seenIds.add(restaurant.catalogRestaurantId),
        )) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrArtifactManifest._(
      selectedRestaurantCount: selectedRestaurantCount,
      restaurants: immutableRestaurants,
    );
  }

  const AdminRestaurantQrArtifactManifest._({
    required this.selectedRestaurantCount,
    required this.restaurants,
  });

  final int selectedRestaurantCount;
  final List<AdminRestaurantQrArtifactRestaurant> restaurants;

  int get restaurantCount => restaurants.length;
  int get labelCount => restaurants.fold<int>(
    0,
    (count, restaurant) => count + restaurant.labels.length,
  );

  List<AdminRestaurantQrLabelEntry> get labels =>
      List<AdminRestaurantQrLabelEntry>.unmodifiable(
        restaurants.expand((restaurant) => restaurant.labels),
      );

  bool get isEmpty => labelCount == 0;
  bool get isNotEmpty => !isEmpty;

  AdminRestaurantQrArtifactManifest withRestaurants(
    Iterable<AdminRestaurantQrArtifactRestaurant> includedRestaurants,
  ) => AdminRestaurantQrArtifactManifest(
    selectedRestaurantCount: selectedRestaurantCount,
    restaurants: includedRestaurants,
  );
}

@immutable
class AdminRestaurantQrMarkingLabelRequest {
  factory AdminRestaurantQrMarkingLabelRequest({
    required AdminRestaurantQrLabelType type,
    String? invitationId,
  }) {
    final exactInvitationId = invitationId == null
        ? null
        : _requiredIdentity(invitationId);
    if (type.requiresInvitation != (exactInvitationId != null)) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrMarkingLabelRequest._(
      type: type,
      invitationId: exactInvitationId,
    );
  }

  const AdminRestaurantQrMarkingLabelRequest._({
    required this.type,
    required this.invitationId,
  });

  final AdminRestaurantQrLabelType type;
  final String? invitationId;

  Map<String, Object?> toJson() => <String, Object?>{
    'type': type.wireName,
    if (invitationId != null) 'invitationId': invitationId,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AdminRestaurantQrMarkingLabelRequest &&
          type == other.type &&
          invitationId == other.invitationId;

  @override
  int get hashCode => Object.hash(type, invitationId);
}

@immutable
class AdminRestaurantQrMarkingRestaurantRequest {
  factory AdminRestaurantQrMarkingRestaurantRequest({
    required String catalogRestaurantId,
    required Iterable<AdminRestaurantQrMarkingLabelRequest> labels,
  }) {
    final immutableLabels =
        List<AdminRestaurantQrMarkingLabelRequest>.unmodifiable(labels);
    _validateOrderedUniqueTypes(immutableLabels.map((label) => label.type));
    if (immutableLabels.isEmpty || immutableLabels.length > 4) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrMarkingRestaurantRequest._(
      catalogRestaurantId: _requiredIdentity(catalogRestaurantId),
      labels: immutableLabels,
    );
  }

  const AdminRestaurantQrMarkingRestaurantRequest._({
    required this.catalogRestaurantId,
    required this.labels,
  });

  final String catalogRestaurantId;
  final List<AdminRestaurantQrMarkingLabelRequest> labels;

  Map<String, Object?> toJson() => <String, Object?>{
    'catalogRestaurantId': catalogRestaurantId,
    'labels': labels.map((label) => label.toJson()).toList(growable: false),
  };
}

@immutable
class AdminRestaurantQrMarkingWorklist {
  factory AdminRestaurantQrMarkingWorklist(
    Iterable<AdminRestaurantQrMarkingRestaurantRequest> restaurants,
  ) {
    final immutableRestaurants =
        List<AdminRestaurantQrMarkingRestaurantRequest>.unmodifiable(
          restaurants,
        );
    final seenIds = <String>{};
    if (immutableRestaurants.any(
      (restaurant) => !seenIds.add(restaurant.catalogRestaurantId),
    )) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrMarkingWorklist._(immutableRestaurants);
  }

  factory AdminRestaurantQrMarkingWorklist.fromManifest(
    AdminRestaurantQrArtifactManifest manifest,
  ) => AdminRestaurantQrMarkingWorklist(
    manifest.restaurants.map(
      (restaurant) => AdminRestaurantQrMarkingRestaurantRequest(
        catalogRestaurantId: restaurant.catalogRestaurantId,
        labels: restaurant.labels.map((label) => label.toMarkingRequest()),
      ),
    ),
  );

  const AdminRestaurantQrMarkingWorklist._(this.restaurants);

  final List<AdminRestaurantQrMarkingRestaurantRequest> restaurants;

  int get restaurantCount => restaurants.length;
  int get labelCount => restaurants.fold<int>(
    0,
    (count, restaurant) => count + restaurant.labels.length,
  );
  bool get isEmpty => restaurants.isEmpty;
  bool get isNotEmpty => restaurants.isNotEmpty;
}

@immutable
class AdminRestaurantQrMarkingRequest {
  factory AdminRestaurantQrMarkingRequest(
    Iterable<AdminRestaurantQrMarkingRestaurantRequest> restaurants,
  ) {
    final worklist = AdminRestaurantQrMarkingWorklist(restaurants);
    if (worklist.isEmpty ||
        worklist.restaurantCount > adminRestaurantQrBatchMaximumRestaurants ||
        worklist.labelCount > adminRestaurantQrBatchMaximumLabels) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrMarkingRequest._(worklist.restaurants);
  }

  const AdminRestaurantQrMarkingRequest._(this.restaurants);

  final List<AdminRestaurantQrMarkingRestaurantRequest> restaurants;

  int get labelCount => restaurants.fold<int>(
    0,
    (count, restaurant) => count + restaurant.labels.length,
  );

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': adminRestaurantQrBatchSchemaVersion,
    'restaurants': restaurants
        .map((restaurant) => restaurant.toJson())
        .toList(growable: false),
  };
}

@immutable
class AdminRestaurantQrPreparationProjection {
  factory AdminRestaurantQrPreparationProjection({
    required String canonicalCatalogRestaurantId,
    required AdminRestaurantQrPreparationStatus ownerInvite,
    required AdminRestaurantQrPreparationStatus claimInvite,
    required AdminRestaurantQrPreparationStatus biteSaverCustomer,
    required AdminRestaurantQrPreparationStatus biteScoreCustomer,
  }) => AdminRestaurantQrPreparationProjection._(
    canonicalCatalogRestaurantId: _requiredIdentity(
      canonicalCatalogRestaurantId,
    ),
    ownerInvite: ownerInvite,
    claimInvite: claimInvite,
    biteSaverCustomer: biteSaverCustomer,
    biteScoreCustomer: biteScoreCustomer,
  );

  const AdminRestaurantQrPreparationProjection._({
    required this.canonicalCatalogRestaurantId,
    required this.ownerInvite,
    required this.claimInvite,
    required this.biteSaverCustomer,
    required this.biteScoreCustomer,
  });

  factory AdminRestaurantQrPreparationProjection.fromCallableData(
    Object? value, {
    required String expectedCatalogRestaurantId,
  }) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'canonicalCatalogRestaurantId',
      'i',
      'c',
      'sa',
      'sr',
    });
    final canonicalCatalogRestaurantId = _requiredIdentity(
      data['canonicalCatalogRestaurantId'],
    );
    if (canonicalCatalogRestaurantId != expectedCatalogRestaurantId) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrPreparationProjection(
      canonicalCatalogRestaurantId: canonicalCatalogRestaurantId,
      ownerInvite: AdminRestaurantQrPreparationStatus.parse(data['i']),
      claimInvite: AdminRestaurantQrPreparationStatus.parse(data['c']),
      biteSaverCustomer: AdminRestaurantQrPreparationStatus.parse(data['sa']),
      biteScoreCustomer: AdminRestaurantQrPreparationStatus.parse(data['sr']),
    );
  }

  final String canonicalCatalogRestaurantId;
  final AdminRestaurantQrPreparationStatus ownerInvite;
  final AdminRestaurantQrPreparationStatus claimInvite;
  final AdminRestaurantQrPreparationStatus biteSaverCustomer;
  final AdminRestaurantQrPreparationStatus biteScoreCustomer;

  AdminRestaurantQrPreparationStatus statusFor(
    AdminRestaurantQrLabelType type,
  ) => switch (type) {
    AdminRestaurantQrLabelType.ownerInvite => ownerInvite,
    AdminRestaurantQrLabelType.claimInvite => claimInvite,
    AdminRestaurantQrLabelType.biteSaverCustomer => biteSaverCustomer,
    AdminRestaurantQrLabelType.biteScoreCustomer => biteScoreCustomer,
  };

  bool get isUnavailable =>
      ownerInvite == AdminRestaurantQrPreparationStatus.unavailable ||
      claimInvite == AdminRestaurantQrPreparationStatus.unavailable ||
      biteSaverCustomer == AdminRestaurantQrPreparationStatus.unavailable ||
      biteScoreCustomer == AdminRestaurantQrPreparationStatus.unavailable;

  bool get needsPreparation =>
      !isUnavailable &&
      AdminRestaurantQrLabelType.values.any(
        (type) =>
            statusFor(type) == AdminRestaurantQrPreparationStatus.unprepared,
      );

  bool get isComplete => !isUnavailable && !needsPreparation;
}

@immutable
class AdminRestaurantQrMarkingLabelResult {
  const AdminRestaurantQrMarkingLabelResult._({
    required this.type,
    required this.invitationId,
    required this.status,
    required this.alreadySaved,
    required this.code,
    required this.message,
  });

  factory AdminRestaurantQrMarkingLabelResult.fromCallableData(
    Object? value, {
    required AdminRestaurantQrMarkingLabelRequest expectedRequest,
  }) {
    final data = _strictMap(value);
    final type = AdminRestaurantQrLabelType.parse(data['type']);
    final status = AdminRestaurantQrLabelMarkingStatus.parse(data['status']);
    if (type != expectedRequest.type) {
      throw const AdminRestaurantQrProtocolException();
    }
    return switch (status) {
      AdminRestaurantQrLabelMarkingStatus.saved => () {
        _requireExactKeys(data, const <String>{
          'type',
          'status',
          'alreadySaved',
        });
        if (data['alreadySaved'] is! bool) {
          throw const AdminRestaurantQrProtocolException();
        }
        return AdminRestaurantQrMarkingLabelResult._(
          type: type,
          invitationId: expectedRequest.invitationId,
          status: status,
          alreadySaved: data['alreadySaved'] as bool,
          code: null,
          message: null,
        );
      }(),
      AdminRestaurantQrLabelMarkingStatus.notRequired => () {
        _requireExactKeys(data, const <String>{'type', 'status'});
        if (!type.requiresInvitation) {
          throw const AdminRestaurantQrProtocolException();
        }
        return AdminRestaurantQrMarkingLabelResult._(
          type: type,
          invitationId: expectedRequest.invitationId,
          status: status,
          alreadySaved: null,
          code: null,
          message: null,
        );
      }(),
      AdminRestaurantQrLabelMarkingStatus.failed => () {
        _requireExactKeys(data, const <String>{
          'type',
          'status',
          'code',
          'message',
        });
        return AdminRestaurantQrMarkingLabelResult._(
          type: type,
          invitationId: expectedRequest.invitationId,
          status: status,
          alreadySaved: null,
          code: _requiredCode(data['code']),
          message: _requiredSafeMessage(data['message']),
        );
      }(),
    };
  }

  factory AdminRestaurantQrMarkingLabelResult.unresolved({
    required AdminRestaurantQrMarkingLabelRequest request,
    required String code,
    required String message,
  }) => AdminRestaurantQrMarkingLabelResult._(
    type: request.type,
    invitationId: request.invitationId,
    status: AdminRestaurantQrLabelMarkingStatus.failed,
    alreadySaved: null,
    code: _requiredCode(code),
    message: _requiredSafeMessage(message),
  );

  final AdminRestaurantQrLabelType type;
  final String? invitationId;
  final AdminRestaurantQrLabelMarkingStatus status;
  final bool? alreadySaved;
  final String? code;
  final String? message;

  bool get isResolved => status != AdminRestaurantQrLabelMarkingStatus.failed;
  bool get isUnresolved => !isResolved;

  AdminRestaurantQrMarkingLabelRequest toRetryRequest() {
    if (isResolved) {
      throw StateError('Only unresolved labels can be retried.');
    }
    return AdminRestaurantQrMarkingLabelRequest(
      type: type,
      invitationId: invitationId,
    );
  }
}

@immutable
class AdminRestaurantQrMarkingRestaurantResult {
  const AdminRestaurantQrMarkingRestaurantResult._({
    required this.catalogRestaurantId,
    required this.outcome,
    required this.labels,
    required this.preparation,
  });

  factory AdminRestaurantQrMarkingRestaurantResult.fromCallableData(
    Object? value, {
    required AdminRestaurantQrMarkingRestaurantRequest expectedRequest,
  }) {
    final data = _strictMap(value);
    final outcome = AdminRestaurantQrRestaurantMarkingOutcome.parse(
      data['outcome'],
    );
    final hasPreparation = data.containsKey('preparation');
    if (outcome == AdminRestaurantQrRestaurantMarkingOutcome.failed) {
      _requireExactKeys(data, const <String>{
        'catalogRestaurantId',
        'outcome',
        'labels',
      });
    } else if (hasPreparation) {
      _requireExactKeys(data, const <String>{
        'catalogRestaurantId',
        'outcome',
        'labels',
        'preparation',
      });
    } else {
      _requireExactKeys(data, const <String>{
        'catalogRestaurantId',
        'outcome',
        'labels',
      });
    }
    final catalogRestaurantId = _requiredIdentity(data['catalogRestaurantId']);
    if (catalogRestaurantId != expectedRequest.catalogRestaurantId) {
      throw const AdminRestaurantQrProtocolException();
    }
    final rawLabels = _strictList(data['labels']);
    if (rawLabels.length != expectedRequest.labels.length) {
      throw const AdminRestaurantQrProtocolException();
    }
    final labels = <AdminRestaurantQrMarkingLabelResult>[];
    for (var index = 0; index < rawLabels.length; index += 1) {
      labels.add(
        AdminRestaurantQrMarkingLabelResult.fromCallableData(
          rawLabels[index],
          expectedRequest: expectedRequest.labels[index],
        ),
      );
    }
    final hasFailure = labels.any((label) => label.isUnresolved);
    final allFailed = labels.every((label) => label.isUnresolved);
    if ((outcome == AdminRestaurantQrRestaurantMarkingOutcome.processed &&
            hasFailure) ||
        (outcome == AdminRestaurantQrRestaurantMarkingOutcome.partialFailure &&
            !hasFailure) ||
        (outcome == AdminRestaurantQrRestaurantMarkingOutcome.failed &&
            !allFailed)) {
      throw const AdminRestaurantQrProtocolException();
    }
    final preparation = !hasPreparation
        ? null
        : AdminRestaurantQrPreparationProjection.fromCallableData(
            data['preparation'],
            expectedCatalogRestaurantId: catalogRestaurantId,
          );
    return AdminRestaurantQrMarkingRestaurantResult._(
      catalogRestaurantId: catalogRestaurantId,
      outcome: outcome,
      labels: List<AdminRestaurantQrMarkingLabelResult>.unmodifiable(labels),
      preparation: preparation,
    );
  }

  factory AdminRestaurantQrMarkingRestaurantResult.unresolved({
    required AdminRestaurantQrMarkingRestaurantRequest request,
    required String code,
    required String message,
  }) => AdminRestaurantQrMarkingRestaurantResult._(
    catalogRestaurantId: request.catalogRestaurantId,
    outcome: AdminRestaurantQrRestaurantMarkingOutcome.failed,
    labels: List<AdminRestaurantQrMarkingLabelResult>.unmodifiable(
      request.labels.map(
        (label) => AdminRestaurantQrMarkingLabelResult.unresolved(
          request: label,
          code: code,
          message: message,
        ),
      ),
    ),
    preparation: null,
  );

  final String catalogRestaurantId;
  final AdminRestaurantQrRestaurantMarkingOutcome outcome;
  final List<AdminRestaurantQrMarkingLabelResult> labels;
  final AdminRestaurantQrPreparationProjection? preparation;

  bool get isResolved => labels.every((label) => label.isResolved);

  AdminRestaurantQrMarkingRestaurantRequest? get unresolvedRequest {
    final unresolved = labels.where((label) => label.isUnresolved).toList();
    if (unresolved.isEmpty) return null;
    return AdminRestaurantQrMarkingRestaurantRequest(
      catalogRestaurantId: catalogRestaurantId,
      labels: unresolved.map((label) => label.toRetryRequest()),
    );
  }
}

@immutable
class AdminRestaurantQrMarkingChunkResult {
  const AdminRestaurantQrMarkingChunkResult._({
    required this.outcome,
    required this.results,
  });

  factory AdminRestaurantQrMarkingChunkResult.fromCallableData(
    Object? value, {
    required AdminRestaurantQrMarkingRequest expectedRequest,
  }) {
    final data = _strictMap(value);
    _requireExactKeys(data, const <String>{
      'schemaVersion',
      'outcome',
      'results',
    });
    if (data['schemaVersion'] is! int ||
        data['schemaVersion'] != adminRestaurantQrBatchSchemaVersion) {
      throw const AdminRestaurantQrProtocolException();
    }
    final outcome = AdminRestaurantQrMarkingOutcome.parse(data['outcome']);
    final rawResults = _strictList(data['results']);
    if (rawResults.length != expectedRequest.restaurants.length) {
      throw const AdminRestaurantQrProtocolException();
    }
    final results = <AdminRestaurantQrMarkingRestaurantResult>[];
    final seenIds = <String>{};
    for (var index = 0; index < rawResults.length; index += 1) {
      final result = AdminRestaurantQrMarkingRestaurantResult.fromCallableData(
        rawResults[index],
        expectedRequest: expectedRequest.restaurants[index],
      );
      if (!seenIds.add(result.catalogRestaurantId)) {
        throw const AdminRestaurantQrProtocolException();
      }
      results.add(result);
    }
    final allProcessed = results.every(
      (result) =>
          result.outcome == AdminRestaurantQrRestaurantMarkingOutcome.processed,
    );
    if ((outcome == AdminRestaurantQrMarkingOutcome.complete) != allProcessed) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrMarkingChunkResult._(
      outcome: outcome,
      results: List<AdminRestaurantQrMarkingRestaurantResult>.unmodifiable(
        results,
      ),
    );
  }

  final AdminRestaurantQrMarkingOutcome outcome;
  final List<AdminRestaurantQrMarkingRestaurantResult> results;
}

@immutable
class AdminRestaurantQrMarkingRunResult {
  factory AdminRestaurantQrMarkingRunResult({
    required AdminRestaurantQrMarkingWorklist requestedWorklist,
    required Iterable<AdminRestaurantQrMarkingRestaurantResult> results,
  }) {
    final immutableResults =
        List<AdminRestaurantQrMarkingRestaurantResult>.unmodifiable(results);
    if (immutableResults.length != requestedWorklist.restaurantCount) {
      throw const AdminRestaurantQrProtocolException();
    }
    for (
      var restaurantIndex = 0;
      restaurantIndex < requestedWorklist.restaurantCount;
      restaurantIndex += 1
    ) {
      final request = requestedWorklist.restaurants[restaurantIndex];
      final result = immutableResults[restaurantIndex];
      if (request.catalogRestaurantId != result.catalogRestaurantId ||
          request.labels.length != result.labels.length) {
        throw const AdminRestaurantQrProtocolException();
      }
      for (
        var labelIndex = 0;
        labelIndex < request.labels.length;
        labelIndex += 1
      ) {
        final requestedLabel = request.labels[labelIndex];
        final resultLabel = result.labels[labelIndex];
        if (requestedLabel.type != resultLabel.type ||
            requestedLabel.invitationId != resultLabel.invitationId) {
          throw const AdminRestaurantQrProtocolException();
        }
      }
    }
    return AdminRestaurantQrMarkingRunResult._(
      requestedWorklist: requestedWorklist,
      results: immutableResults,
    );
  }

  const AdminRestaurantQrMarkingRunResult._({
    required this.requestedWorklist,
    required this.results,
  });

  final AdminRestaurantQrMarkingWorklist requestedWorklist;
  final List<AdminRestaurantQrMarkingRestaurantResult> results;

  bool get isComplete => results.every((result) => result.isResolved);

  int get savedCount => results
      .expand((restaurant) => restaurant.labels)
      .where(
        (label) =>
            label.status == AdminRestaurantQrLabelMarkingStatus.saved &&
            label.alreadySaved == false,
      )
      .length;

  int get alreadySavedCount => results
      .expand((restaurant) => restaurant.labels)
      .where(
        (label) =>
            label.status == AdminRestaurantQrLabelMarkingStatus.saved &&
            label.alreadySaved == true,
      )
      .length;

  int get notRequiredCount => results
      .expand((restaurant) => restaurant.labels)
      .where(
        (label) =>
            label.status == AdminRestaurantQrLabelMarkingStatus.notRequired,
      )
      .length;

  int get unresolvedCount => results
      .expand((restaurant) => restaurant.labels)
      .where((label) => label.isUnresolved)
      .length;

  AdminRestaurantQrMarkingWorklist get unresolvedWorklist =>
      AdminRestaurantQrMarkingWorklist(
        results
            .map((restaurant) => restaurant.unresolvedRequest)
            .whereType<AdminRestaurantQrMarkingRestaurantRequest>(),
      );

  List<String> get fullyResolvedRestaurantIds => List<String>.unmodifiable(
    results
        .where((restaurant) => restaurant.isResolved)
        .map((restaurant) => restaurant.catalogRestaurantId),
  );

  Map<String, AdminRestaurantQrPreparationProjection>
  get preparationProjections =>
      Map<String, AdminRestaurantQrPreparationProjection>.unmodifiable(
        <String, AdminRestaurantQrPreparationProjection>{
          for (final result in results)
            if (result.preparation != null)
              result.catalogRestaurantId: result.preparation!,
        },
      );
}

@immutable
class AdminRestaurantQrPdfProblem {
  factory AdminRestaurantQrPdfProblem({
    required String catalogRestaurantId,
    required String restaurantName,
    required AdminRestaurantQrLabelType labelType,
    required String code,
    required String message,
  }) => AdminRestaurantQrPdfProblem._(
    catalogRestaurantId: _requiredIdentity(catalogRestaurantId),
    restaurantName: _requiredDisplayText(restaurantName, maximumLength: 300),
    labelType: labelType,
    code: _requiredCode(code),
    message: _requiredSafeMessage(message),
  );

  const AdminRestaurantQrPdfProblem._({
    required this.catalogRestaurantId,
    required this.restaurantName,
    required this.labelType,
    required this.code,
    required this.message,
  });

  final String catalogRestaurantId;
  final String restaurantName;
  final AdminRestaurantQrLabelType labelType;
  final String code;
  final String message;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AdminRestaurantQrPdfProblem &&
          catalogRestaurantId == other.catalogRestaurantId &&
          restaurantName == other.restaurantName &&
          labelType == other.labelType &&
          code == other.code &&
          message == other.message;

  @override
  int get hashCode => Object.hash(
    catalogRestaurantId,
    restaurantName,
    labelType,
    code,
    message,
  );
}

@immutable
class AdminRestaurantQrPdfArtifactSummary {
  factory AdminRestaurantQrPdfArtifactSummary({
    required String filename,
    required int pageCount,
    required AdminRestaurantQrArtifactManifest includedManifest,
  }) {
    if (!RegExp(r'^bitestar-qr-labels-\d{8}-\d{6}\.pdf$').hasMatch(filename) ||
        includedManifest.isEmpty ||
        pageCount !=
            (includedManifest.labelCount +
                    adminRestaurantQrLabelsPerPage -
                    1) ~/
                adminRestaurantQrLabelsPerPage) {
      throw const AdminRestaurantQrProtocolException();
    }
    return AdminRestaurantQrPdfArtifactSummary._(
      filename: filename,
      pageCount: pageCount,
      includedManifest: includedManifest,
    );
  }

  const AdminRestaurantQrPdfArtifactSummary._({
    required this.filename,
    required this.pageCount,
    required this.includedManifest,
  });

  final String filename;
  final int pageCount;
  final AdminRestaurantQrArtifactManifest includedManifest;

  int get selectedRestaurantCount => includedManifest.selectedRestaurantCount;
  int get restaurantCount => includedManifest.restaurantCount;
  int get labelCount => includedManifest.labelCount;
}

Map<String, Object?> _strictMap(Object? value) {
  if (value is! Map) {
    throw const AdminRestaurantQrProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const AdminRestaurantQrProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

List<Object?> _strictList(Object? value) {
  if (value is! List) {
    throw const AdminRestaurantQrProtocolException();
  }
  return List<Object?>.of(value, growable: false);
}

void _requireExactKeys(Map<String, Object?> value, Set<String> expected) {
  if (!setEquals(value.keys.toSet(), expected)) {
    throw const AdminRestaurantQrProtocolException();
  }
}

String? _exactIdentity(Object? value) => exactFirestoreDocumentId(value);

String _requiredIdentity(Object? value) {
  final result = _exactIdentity(value);
  if (result == null) {
    throw const AdminRestaurantQrProtocolException();
  }
  return result;
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
      throw const AdminRestaurantQrProtocolException();
    }
    result.add(exact);
  }
  if (!allowEmpty && result.isEmpty) {
    throw const AdminRestaurantQrProtocolException();
  }
  return List<String>.unmodifiable(result);
}

String _requiredString(Object? value, {required int maximumLength}) {
  if (value is! String || value.isEmpty || value.length > maximumLength) {
    throw const AdminRestaurantQrProtocolException();
  }
  return value;
}

String _requiredDisplayText(Object? value, {required int maximumLength}) {
  final result = _requiredString(value, maximumLength: maximumLength);
  if (result.trim() != result || _containsControlCharacter(result)) {
    throw const AdminRestaurantQrProtocolException();
  }
  return result;
}

String _requiredSafeMessage(Object? value) {
  final result = _requiredDisplayText(value, maximumLength: 500);
  if (RegExp(
    r'(?:https?://|go\.bitestar\.app|/invite/)',
    caseSensitive: false,
  ).hasMatch(result)) {
    throw const AdminRestaurantQrProtocolException();
  }
  return result;
}

String _requiredCode(Object? value) {
  final result = _requiredString(value, maximumLength: 100);
  if (!RegExp(r'^[a-z][a-z0-9_]*$').hasMatch(result)) {
    throw const AdminRestaurantQrProtocolException();
  }
  return result;
}

bool _containsControlCharacter(String value) =>
    value.runes.any((rune) => rune <= 0x1f || (rune >= 0x7f && rune <= 0x9f));

bool _isPositiveSafeInteger(Object? value) =>
    value is int && value > 0 && value <= 9007199254740991;

int _requiredPositiveSafeInteger(Object? value) {
  if (!_isPositiveSafeInteger(value)) {
    throw const AdminRestaurantQrProtocolException();
  }
  return value! as int;
}

void _validatePayloadUrl({
  required AdminRestaurantQrLabelType type,
  required String value,
  String? expectedCatalogRestaurantId,
}) {
  final uri = Uri.tryParse(value);
  if (value.length > adminRestaurantQrMaximumPayloadUrlLength ||
      uri == null ||
      uri.toString() != value ||
      uri.scheme != 'https' ||
      uri.host != 'go.bitestar.app' ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw const AdminRestaurantQrProtocolException();
  }
  final segments = uri.pathSegments;
  final expectedMiddle = switch (type) {
    AdminRestaurantQrLabelType.ownerInvite => 'coupon',
    AdminRestaurantQrLabelType.claimInvite => 'bitescore',
    AdminRestaurantQrLabelType.biteSaverCustomer => 'coupons',
    AdminRestaurantQrLabelType.biteScoreCustomer => 'bitescore',
  };
  final expectedFirst = type.requiresInvitation ? 'invite' : 'r';
  if (segments.length != 3 ||
      segments[0] != expectedFirst ||
      segments[1] != expectedMiddle ||
      segments[2].isEmpty ||
      _containsControlCharacter(segments[2])) {
    throw const AdminRestaurantQrProtocolException();
  }
  if (!type.requiresInvitation && expectedCatalogRestaurantId != null) {
    final exactExpected = _requiredIdentity(expectedCatalogRestaurantId);
    if (segments[2] != exactExpected) {
      throw const AdminRestaurantQrProtocolException();
    }
  }
}

List<AdminRestaurantQrLabelEntry> _validatedLabels(
  Iterable<AdminRestaurantQrLabelEntry> values, {
  required String catalogRestaurantId,
  required bool requireCustomerPair,
}) {
  final labels = List<AdminRestaurantQrLabelEntry>.unmodifiable(values);
  if (labels.isEmpty || labels.length > 4) {
    throw const AdminRestaurantQrProtocolException();
  }
  _validateOrderedUniqueTypes(labels.map((label) => label.type));
  for (final label in labels) {
    _validatePayloadUrl(
      type: label.type,
      value: label.payloadUrl,
      expectedCatalogRestaurantId: catalogRestaurantId,
    );
  }
  if (requireCustomerPair &&
      (!labels.any(
            (label) =>
                label.type == AdminRestaurantQrLabelType.biteSaverCustomer,
          ) ||
          !labels.any(
            (label) =>
                label.type == AdminRestaurantQrLabelType.biteScoreCustomer,
          ))) {
    throw const AdminRestaurantQrProtocolException();
  }
  return labels;
}

void _validateOrderedUniqueTypes(Iterable<AdminRestaurantQrLabelType> values) {
  var previousSortIndex = -1;
  final seen = <AdminRestaurantQrLabelType>{};
  for (final type in values) {
    if (!seen.add(type) || type.sortIndex <= previousSortIndex) {
      throw const AdminRestaurantQrProtocolException();
    }
    previousSortIndex = type.sortIndex;
  }
}
