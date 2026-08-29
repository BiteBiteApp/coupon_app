import 'dart:convert';

import '../services/firestore_document_id.dart';
import 'pagination/paged_models.dart';

const int adminRestaurantMaterializedOrderNameMaximumLength = 200;
const String adminRestaurantPageCursorPrefix = 'bsp1.';
const int adminRestaurantPageCursorMaximumLength = 8192;
const int _adminRestaurantPageCursorEnvelopeOverheadBytes = 28;

bool isValidAdminRestaurantPageCursor(String value) {
  if (!value.startsWith(adminRestaurantPageCursorPrefix) ||
      value.length > adminRestaurantPageCursorMaximumLength) {
    return false;
  }
  final encoded = value.substring(adminRestaurantPageCursorPrefix.length);
  if (encoded.length < 39 ||
      encoded.length % 4 == 1 ||
      !RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(encoded)) {
    return false;
  }
  try {
    final paddingLength = (4 - encoded.length % 4) % 4;
    final padded = '$encoded${List.filled(paddingLength, '=').join()}';
    final packed = base64Url.decode(padded);
    final canonical = base64Url.encode(packed).replaceAll('=', '');
    return packed.length > _adminRestaurantPageCursorEnvelopeOverheadBytes &&
        canonical == encoded;
  } on FormatException {
    return false;
  }
}

enum AdminRestaurantLinkSource {
  biteScore('biteScore', 'BiteScore'),
  biteSaver('biteSaver', 'BiteSaver');

  final String callableValue;
  final String label;

  const AdminRestaurantLinkSource(this.callableValue, this.label);

  static AdminRestaurantLinkSource? fromCallableValue(Object? value) {
    for (final source in values) {
      if (source.callableValue == value) {
        return source;
      }
    }
    return null;
  }
}

class AdminRestaurantMaterializedOrder
    implements Comparable<AdminRestaurantMaterializedOrder> {
  static const int _maximumSafeJsonInteger = 9007199254740991;

  final int distanceMillimeters;
  final String normalizedName;
  final String sourceDocumentId;
  final AdminRestaurantLinkSource source;

  const AdminRestaurantMaterializedOrder({
    required this.distanceMillimeters,
    required this.normalizedName,
    required this.sourceDocumentId,
    required this.source,
  });

  static AdminRestaurantMaterializedOrder? tryFromCallableData(Object? value) {
    final data = _stringKeyedMap(value);
    const keys = <String>{
      'distanceMillimeters',
      'normalizedName',
      'sourceDocumentId',
      'source',
    };
    if (data == null ||
        data.keys.length != keys.length ||
        !data.keys.toSet().containsAll(keys)) {
      return null;
    }
    final distanceMillimeters = data['distanceMillimeters'];
    final normalizedName = data['normalizedName'];
    final sourceDocumentId = exactFirestoreDocumentId(data['sourceDocumentId']);
    final source = AdminRestaurantLinkSource.fromCallableValue(data['source']);
    if (distanceMillimeters is! int ||
        distanceMillimeters < 0 ||
        distanceMillimeters > _maximumSafeJsonInteger ||
        normalizedName is! String ||
        normalizedName.isEmpty ||
        normalizedName.length >
            adminRestaurantMaterializedOrderNameMaximumLength ||
        sourceDocumentId == null ||
        source == null) {
      return null;
    }
    return AdminRestaurantMaterializedOrder(
      distanceMillimeters: distanceMillimeters,
      normalizedName: normalizedName,
      sourceDocumentId: sourceDocumentId,
      source: source,
    );
  }

  bool matchesRecord(AdminRestaurantLinkRecord record) {
    return source == record.source && sourceDocumentId == record.documentId;
  }

  @override
  int compareTo(AdminRestaurantMaterializedOrder other) {
    var comparison = distanceMillimeters.compareTo(other.distanceMillimeters);
    if (comparison != 0) {
      return comparison;
    }
    comparison = _compareUtf8(normalizedName, other.normalizedName);
    if (comparison != 0) {
      return comparison;
    }
    comparison = _compareUtf8(sourceDocumentId, other.sourceDocumentId);
    if (comparison != 0) {
      return comparison;
    }
    return source.callableValue.compareTo(other.source.callableValue);
  }
}

enum AdminBiteScoreStatus {
  active('active', 'Active'),
  inactive('inactive', 'Hidden'),
  all('all', 'All');

  final String callableValue;
  final String label;

  const AdminBiteScoreStatus(this.callableValue, this.label);
}

enum AdminRestaurantClaimState {
  claimed('Claimed'),
  available('Unclaimed'),
  unavailable('Claim unavailable');

  final String label;

  const AdminRestaurantClaimState(this.label);
}

enum AdminRestaurantPreparationType {
  ownerInvite('I'),
  claimInvite('C'),
  biteSaverCustomer('SA'),
  biteScoreCustomer('SR');

  final String marker;

  const AdminRestaurantPreparationType(this.marker);
}

enum AdminRestaurantPreparationStatus {
  prepared('Prepared'),
  unprepared('Unprepared'),
  notRequired('N/R'),
  unavailable('Unavailable');

  final String label;

  const AdminRestaurantPreparationStatus(this.label);

  static AdminRestaurantPreparationStatus? fromCallableValue(Object? value) {
    return switch (value) {
      'prepared' => prepared,
      'unprepared' => unprepared,
      'notRequired' => notRequired,
      'unavailable' => unavailable,
      _ => null,
    };
  }
}

class AdminRestaurantPreparationState {
  final String? canonicalCatalogRestaurantId;
  final AdminRestaurantPreparationStatus ownerInvite;
  final AdminRestaurantPreparationStatus claimInvite;
  final AdminRestaurantPreparationStatus biteSaverCustomer;
  final AdminRestaurantPreparationStatus biteScoreCustomer;

  const AdminRestaurantPreparationState({
    required this.canonicalCatalogRestaurantId,
    required this.ownerInvite,
    required this.claimInvite,
    required this.biteSaverCustomer,
    required this.biteScoreCustomer,
  });

  const AdminRestaurantPreparationState.unavailable()
    : canonicalCatalogRestaurantId = null,
      ownerInvite = AdminRestaurantPreparationStatus.unavailable,
      claimInvite = AdminRestaurantPreparationStatus.unavailable,
      biteSaverCustomer = AdminRestaurantPreparationStatus.unavailable,
      biteScoreCustomer = AdminRestaurantPreparationStatus.unavailable;

  AdminRestaurantPreparationStatus statusFor(
    AdminRestaurantPreparationType type,
  ) {
    return switch (type) {
      AdminRestaurantPreparationType.ownerInvite => ownerInvite,
      AdminRestaurantPreparationType.claimInvite => claimInvite,
      AdminRestaurantPreparationType.biteSaverCustomer => biteSaverCustomer,
      AdminRestaurantPreparationType.biteScoreCustomer => biteScoreCustomer,
    };
  }

  bool isValidForParticipation({
    required AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState,
    required AdminRestaurantClaimState claimState,
  }) {
    final invitationStatuses = {
      AdminRestaurantPreparationStatus.prepared,
      AdminRestaurantPreparationStatus.unprepared,
    };
    final ownerInviteIsValid = switch (biteSaverCatalogBindingState) {
      AdminBiteSaverCatalogBindingState.unbound => invitationStatuses.contains(
        ownerInvite,
      ),
      AdminBiteSaverCatalogBindingState.bound =>
        ownerInvite == AdminRestaurantPreparationStatus.notRequired,
      AdminBiteSaverCatalogBindingState.unavailable =>
        ownerInvite == AdminRestaurantPreparationStatus.unavailable,
    };
    final claimInviteIsValid = switch (claimState) {
      AdminRestaurantClaimState.available => invitationStatuses.contains(
        claimInvite,
      ),
      AdminRestaurantClaimState.claimed =>
        claimInvite == AdminRestaurantPreparationStatus.notRequired,
      AdminRestaurantClaimState.unavailable =>
        claimInvite == AdminRestaurantPreparationStatus.unavailable,
    };
    return ownerInviteIsValid &&
        claimInviteIsValid &&
        invitationStatuses.contains(biteSaverCustomer) &&
        invitationStatuses.contains(biteScoreCustomer);
  }

  bool get isUnavailable =>
      canonicalCatalogRestaurantId == null ||
      ownerInvite == AdminRestaurantPreparationStatus.unavailable ||
      claimInvite == AdminRestaurantPreparationStatus.unavailable ||
      biteSaverCustomer == AdminRestaurantPreparationStatus.unavailable ||
      biteScoreCustomer == AdminRestaurantPreparationStatus.unavailable;

  bool get needsPreparation =>
      !isUnavailable &&
      (ownerInvite == AdminRestaurantPreparationStatus.unprepared ||
          claimInvite == AdminRestaurantPreparationStatus.unprepared ||
          biteSaverCustomer == AdminRestaurantPreparationStatus.unprepared ||
          biteScoreCustomer == AdminRestaurantPreparationStatus.unprepared);

  bool get isComplete => !isUnavailable && !needsPreparation;

  static AdminRestaurantPreparationState tryFromCallableData(
    Object? value, {
    required AdminRestaurantLinkSource source,
    required String documentId,
    required AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState,
    required AdminRestaurantClaimState claimState,
  }) {
    final data = _stringKeyedMap(value);
    const keys = <String>{'canonicalCatalogRestaurantId', 'i', 'c', 'sa', 'sr'};
    if (data == null ||
        data.keys.length != keys.length ||
        !data.keys.toSet().containsAll(keys)) {
      return const AdminRestaurantPreparationState.unavailable();
    }
    final canonicalId = exactFirestoreDocumentId(
      data['canonicalCatalogRestaurantId'],
    );
    final ownerInvite = AdminRestaurantPreparationStatus.fromCallableValue(
      data['i'],
    );
    final claimInvite = AdminRestaurantPreparationStatus.fromCallableValue(
      data['c'],
    );
    final biteSaverCustomer =
        AdminRestaurantPreparationStatus.fromCallableValue(data['sa']);
    final biteScoreCustomer =
        AdminRestaurantPreparationStatus.fromCallableValue(data['sr']);
    final allUnavailable =
        ownerInvite == AdminRestaurantPreparationStatus.unavailable &&
        claimInvite == AdminRestaurantPreparationStatus.unavailable &&
        biteSaverCustomer == AdminRestaurantPreparationStatus.unavailable &&
        biteScoreCustomer == AdminRestaurantPreparationStatus.unavailable;
    final identityIsValid = source == AdminRestaurantLinkSource.biteScore
        ? canonicalId == documentId
        : canonicalId == null && allUnavailable;
    if (!identityIsValid ||
        ownerInvite == null ||
        claimInvite == null ||
        biteSaverCustomer == null ||
        biteScoreCustomer == null) {
      return const AdminRestaurantPreparationState.unavailable();
    }
    if (allUnavailable) {
      return const AdminRestaurantPreparationState.unavailable();
    }
    final state = AdminRestaurantPreparationState(
      canonicalCatalogRestaurantId: canonicalId,
      ownerInvite: ownerInvite,
      claimInvite: claimInvite,
      biteSaverCustomer: biteSaverCustomer,
      biteScoreCustomer: biteScoreCustomer,
    );
    return state.isValidForParticipation(
          biteSaverCatalogBindingState: biteSaverCatalogBindingState,
          claimState: claimState,
        )
        ? state
        : const AdminRestaurantPreparationState.unavailable();
  }
}

enum AdminBiteSaverCatalogBindingState {
  unbound('unbound', 'Unbound'),
  bound('bound', 'Bound'),
  unavailable('unavailable', 'Unavailable');

  final String callableValue;
  final String label;

  const AdminBiteSaverCatalogBindingState(this.callableValue, this.label);

  static AdminBiteSaverCatalogBindingState? fromCallableValue(Object? value) {
    for (final state in values) {
      if (state.callableValue == value) {
        return state;
      }
    }
    return null;
  }
}

AdminRestaurantClaimState adminRestaurantClaimStateFromProjection({
  required bool? isActive,
  required bool? isClaimed,
  required bool? claimAvailable,
  required bool? claimStateValid,
}) {
  if (isActive != true || claimStateValid != true) {
    return AdminRestaurantClaimState.unavailable;
  }
  if (isClaimed == true && claimAvailable == false) {
    return AdminRestaurantClaimState.claimed;
  }
  if (isClaimed == false && claimAvailable == true) {
    return AdminRestaurantClaimState.available;
  }
  return AdminRestaurantClaimState.unavailable;
}

class AdminRestaurantSearchCenter {
  final double latitude;
  final double longitude;
  final String displayName;

  const AdminRestaurantSearchCenter({
    required this.latitude,
    required this.longitude,
    required this.displayName,
  });

  static AdminRestaurantSearchCenter? tryFromCallableData(Object? value) {
    final data = _stringKeyedMap(value);
    if (data == null) {
      return null;
    }
    final latitude = _finiteDouble(data['latitude']);
    final longitude = _finiteDouble(data['longitude']);
    final displayName = _requiredString(data['displayName']);
    if (latitude == null ||
        longitude == null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        displayName == null) {
      return null;
    }
    return AdminRestaurantSearchCenter(
      latitude: latitude,
      longitude: longitude,
      displayName: displayName,
    );
  }
}

class AdminRestaurantLinkRecord {
  final AdminRestaurantLinkSource source;
  final String documentId;
  final String actionId;
  final String restaurantName;
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;
  final String phone;
  final String website;
  final double latitude;
  final double longitude;
  final double distanceMiles;

  final bool? isActive;
  final bool? isClaimed;
  final bool? claimAvailable;
  final bool? claimStateValid;
  final String? ownerUserId;
  final String? linkedBiteSaverUid;
  final AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState;

  final String? approvalStatus;
  final bool? couponApplicationSubmitted;
  final String? uid;
  final String? linkedBiteScoreRestaurantId;
  final AdminRestaurantPreparationState preparation;
  final AdminRestaurantMaterializedOrder? materializedOrder;

  const AdminRestaurantLinkRecord({
    required this.source,
    required this.documentId,
    required this.actionId,
    required this.restaurantName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.phone,
    required this.website,
    required this.latitude,
    required this.longitude,
    required this.distanceMiles,
    this.isActive,
    this.isClaimed,
    this.claimAvailable,
    this.claimStateValid,
    this.ownerUserId,
    this.linkedBiteSaverUid,
    this.biteSaverCatalogBindingState =
        AdminBiteSaverCatalogBindingState.unavailable,
    this.approvalStatus,
    this.couponApplicationSubmitted,
    this.uid,
    this.linkedBiteScoreRestaurantId,
    this.preparation = const AdminRestaurantPreparationState.unavailable(),
    this.materializedOrder,
  });

  bool get isBiteScore => source == AdminRestaurantLinkSource.biteScore;
  bool get isBiteSaver => source == AdminRestaurantLinkSource.biteSaver;

  AdminRestaurantClaimState get claimState =>
      adminRestaurantClaimStateFromProjection(
        isActive: isActive,
        isClaimed: isClaimed,
        claimAvailable: claimAvailable,
        claimStateValid: claimStateValid,
      );

  bool get canCreateBiteScoreClaimInvite =>
      isBiteScore && claimState == AdminRestaurantClaimState.available;

  bool get canCreateBiteSaverOwnerInvite =>
      isBiteScore &&
      isActive == true &&
      biteSaverCatalogBindingState == AdminBiteSaverCatalogBindingState.unbound;

  bool get canCopyCatalogBiteSaverCustomerLink =>
      isBiteScore &&
      isActive == true &&
      (biteSaverCatalogBindingState ==
              AdminBiteSaverCatalogBindingState.bound ||
          (biteSaverCatalogBindingState ==
              AdminBiteSaverCatalogBindingState.unbound));

  bool get canCopyCouponCustomerLink =>
      isBiteSaver &&
      actionId.isNotEmpty &&
      approvalStatus?.trim().toLowerCase() == 'approved';

  String get recordKey => '${source.callableValue}:$documentId';

  static AdminRestaurantLinkRecord? tryFromCallableData(Object? value) {
    final data = _stringKeyedMap(value);
    if (data == null) {
      return null;
    }

    final source = AdminRestaurantLinkSource.fromCallableValue(data['source']);
    final documentId = exactFirestoreDocumentId(data['documentId']);
    final actionId = exactFirestoreDocumentId(data['actionId']);
    final restaurantName = _requiredString(data['restaurantName']);
    final latitude = _finiteDouble(data['latitude']);
    final longitude = _finiteDouble(data['longitude']);
    final distanceMiles = _finiteDouble(data['distanceMiles']);
    if (source == null ||
        documentId == null ||
        actionId == null ||
        restaurantName == null ||
        latitude == null ||
        longitude == null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180 ||
        distanceMiles == null ||
        distanceMiles < 0) {
      return null;
    }

    final isActive = data['isActive'];
    final isClaimed = data['isClaimed'];
    final claimAvailable = data['claimAvailable'];
    final claimStateValid = data['claimStateValid'];
    final biteSaverCatalogBindingState =
        AdminBiteSaverCatalogBindingState.fromCallableValue(
          data['biteSaverCatalogBindingState'],
        );
    final approvalStatus = data['approvalStatus'];
    final couponApplicationSubmitted = data['couponApplicationSubmitted'];
    if (source == AdminRestaurantLinkSource.biteScore &&
        (isActive is! bool ||
            isClaimed is! bool ||
            claimAvailable is! bool ||
            claimStateValid is! bool ||
            biteSaverCatalogBindingState == null)) {
      return null;
    }
    if (source == AdminRestaurantLinkSource.biteSaver &&
        (approvalStatus is! String || couponApplicationSubmitted is! bool)) {
      return null;
    }

    final ownerUserId = source == AdminRestaurantLinkSource.biteScore
        ? _optionalExactFirestorePathSegment(data, 'ownerUserId')
        : null;
    final linkedBiteSaverUid = source == AdminRestaurantLinkSource.biteScore
        ? _optionalExactFirestorePathSegment(data, 'linkedBiteSaverUid')
        : null;
    final uid = source == AdminRestaurantLinkSource.biteSaver
        ? _optionalExactFirestorePathSegment(data, 'uid')
        : null;
    final linkedBiteScoreRestaurantId =
        source == AdminRestaurantLinkSource.biteSaver
        ? _optionalExactFirestorePathSegment(
            data,
            'linkedBiteScoreRestaurantId',
          )
        : null;
    if ((source == AdminRestaurantLinkSource.biteScore &&
            ((_hasInvalidOptionalIdentity(data, 'ownerUserId')) ||
                _hasInvalidOptionalIdentity(data, 'linkedBiteSaverUid'))) ||
        (source == AdminRestaurantLinkSource.biteSaver &&
            (_hasInvalidOptionalIdentity(data, 'uid') ||
                _hasInvalidOptionalIdentity(
                  data,
                  'linkedBiteScoreRestaurantId',
                )))) {
      return null;
    }
    final claimState = adminRestaurantClaimStateFromProjection(
      isActive: isActive is bool ? isActive : null,
      isClaimed: isClaimed is bool ? isClaimed : null,
      claimAvailable: claimAvailable is bool ? claimAvailable : null,
      claimStateValid: claimStateValid is bool ? claimStateValid : null,
    );
    final materializedOrder = data.containsKey('materializedOrder')
        ? AdminRestaurantMaterializedOrder.tryFromCallableData(
            data['materializedOrder'],
          )
        : null;
    if (data.containsKey('materializedOrder') &&
        (materializedOrder == null ||
            materializedOrder.source != source ||
            materializedOrder.sourceDocumentId != documentId)) {
      return null;
    }
    return AdminRestaurantLinkRecord(
      source: source,
      documentId: documentId,
      actionId: actionId,
      restaurantName: restaurantName,
      streetAddress: _optionalString(data['streetAddress']) ?? '',
      city: _optionalString(data['city']) ?? '',
      state: _optionalString(data['state']) ?? '',
      zipCode: _optionalString(data['zipCode']) ?? '',
      phone: _optionalString(data['phone']) ?? '',
      website: _optionalString(data['website']) ?? '',
      latitude: latitude,
      longitude: longitude,
      distanceMiles: distanceMiles,
      isActive:
          source == AdminRestaurantLinkSource.biteScore && isActive is bool
          ? isActive
          : null,
      isClaimed:
          source == AdminRestaurantLinkSource.biteScore && isClaimed is bool
          ? isClaimed
          : null,
      claimAvailable:
          source == AdminRestaurantLinkSource.biteScore &&
              claimAvailable is bool
          ? claimAvailable
          : null,
      claimStateValid:
          source == AdminRestaurantLinkSource.biteScore &&
              claimStateValid is bool
          ? claimStateValid
          : null,
      ownerUserId: ownerUserId,
      linkedBiteSaverUid: linkedBiteSaverUid,
      biteSaverCatalogBindingState:
          source == AdminRestaurantLinkSource.biteScore
          ? biteSaverCatalogBindingState!
          : AdminBiteSaverCatalogBindingState.unavailable,
      approvalStatus: source == AdminRestaurantLinkSource.biteSaver
          ? _optionalString(approvalStatus)
          : null,
      couponApplicationSubmitted:
          source == AdminRestaurantLinkSource.biteSaver &&
              couponApplicationSubmitted is bool
          ? couponApplicationSubmitted
          : null,
      uid: uid,
      linkedBiteScoreRestaurantId: linkedBiteScoreRestaurantId,
      preparation: AdminRestaurantPreparationState.tryFromCallableData(
        data['preparation'],
        source: source,
        documentId: documentId,
        biteSaverCatalogBindingState:
            source == AdminRestaurantLinkSource.biteScore
            ? biteSaverCatalogBindingState!
            : AdminBiteSaverCatalogBindingState.unavailable,
        claimState: source == AdminRestaurantLinkSource.biteScore
            ? claimState
            : AdminRestaurantClaimState.unavailable,
      ),
      materializedOrder: materializedOrder,
    );
  }
}

class AdminRestaurantLinkSearchResult {
  final AdminRestaurantSearchCenter searchCenter;
  final double radiusMiles;
  final List<AdminRestaurantLinkRecord> results;
  final bool resultsMayBeTruncated;
  final int returnedCount;
  final List<AdminRestaurantLinkSource> queriedSources;

  const AdminRestaurantLinkSearchResult({
    required this.searchCenter,
    required this.radiusMiles,
    required this.results,
    required this.resultsMayBeTruncated,
    required this.returnedCount,
    required this.queriedSources,
  });

  factory AdminRestaurantLinkSearchResult.fromCallableData(Object? value) {
    final data = _stringKeyedMap(value);
    final searchCenter = AdminRestaurantSearchCenter.tryFromCallableData(
      data?['searchCenter'],
    );
    final radiusMiles = _finiteDouble(data?['radiusMiles']);
    final rawResults = data?['results'];
    final truncated = data?['resultsMayBeTruncated'];
    final returnedCount = data?['returnedCount'];
    final rawSources = data?['queriedSources'];
    if (data == null ||
        searchCenter == null ||
        radiusMiles == null ||
        radiusMiles <= 0 ||
        radiusMiles > 50 ||
        rawResults is! List ||
        truncated is! bool ||
        returnedCount is! int ||
        returnedCount < 0 ||
        rawSources is! List) {
      throw const FormatException('Invalid restaurant search response.');
    }

    final records = rawResults
        .map(AdminRestaurantLinkRecord.tryFromCallableData)
        .whereType<AdminRestaurantLinkRecord>()
        .toList(growable: false);
    final sources = <AdminRestaurantLinkSource>[];
    for (final rawSource in rawSources) {
      final source = AdminRestaurantLinkSource.fromCallableValue(rawSource);
      if (source != null && !sources.contains(source)) {
        sources.add(source);
      }
    }

    return AdminRestaurantLinkSearchResult(
      searchCenter: searchCenter,
      radiusMiles: radiusMiles,
      results: records,
      resultsMayBeTruncated: truncated,
      returnedCount: returnedCount,
      queriedSources: List.unmodifiable(sources),
    );
  }
}

class AdminRestaurantLinkPagedResult {
  final PagedResponse<AdminRestaurantLinkRecord> page;
  final AdminRestaurantSearchCenter searchCenter;
  final double radiusMiles;
  final List<AdminRestaurantLinkSource> queriedSources;
  final AdminRestaurantMaterializedOrder? consumedBoundary;
  final bool? needsQrPreparation;
  final bool preparationUnavailableEncountered;

  const AdminRestaurantLinkPagedResult({
    required this.page,
    required this.searchCenter,
    required this.radiusMiles,
    required this.queriedSources,
    this.consumedBoundary,
    this.needsQrPreparation,
    this.preparationUnavailableEncountered = false,
  });

  bool get isPreparing =>
      page.preparation?.state == PagePreparationState.preparing;
  bool get isReady => page.preparation?.state == PagePreparationState.ready;
  bool get isFailed => page.preparation?.state == PagePreparationState.failed;
  bool get hasNext => page.hasNext;
  String? get nextCursor => page.cursors.next;
  String? get preparationMessage => page.preparation?.message;
  bool get usesFilterContract => needsQrPreparation != null;

  factory AdminRestaurantLinkPagedResult.fromCallableData(
    Object? value, {
    bool? expectedNeedsQrPreparation,
  }) {
    final data = _stringKeyedMap(value);
    const protocolKeys = <String>{
      'protocolVersion',
      'items',
      'pageSize',
      'hasNext',
      'hasPrevious',
      'nextCursor',
      'previousCursor',
      'currentPageNumber',
      'total',
      'queryFingerprint',
      'snapshotTimestampMs',
      'capabilities',
      'preparation',
    };
    const requiredMetadataKeys = <String>{
      'searchCenter',
      'radiusMiles',
      'queriedSources',
    };
    const metadataKeys = <String>{
      ...requiredMetadataKeys,
      'consumedBoundary',
      'filterMetadata',
    };
    if (data == null ||
        data.keys.any(
          (key) => !protocolKeys.contains(key) && !metadataKeys.contains(key),
        ) ||
        !data.keys.toSet().containsAll(<String>{
          'protocolVersion',
          'items',
          'pageSize',
          'hasNext',
          'hasPrevious',
          'queryFingerprint',
          'snapshotTimestampMs',
          'capabilities',
          'preparation',
          ...requiredMetadataKeys,
        })) {
      throw const FormatException('Invalid paged restaurant response.');
    }
    final rawFilterMetadata = _stringKeyedMap(data['filterMetadata']);
    bool? needsQrPreparation;
    var preparationUnavailableEncountered = false;
    if (expectedNeedsQrPreparation == null) {
      if (data.containsKey('filterMetadata')) {
        throw const FormatException('Invalid paged restaurant response.');
      }
    } else {
      const filterKeys = <String>{
        'schemaVersion',
        'needsQrPreparation',
        'preparationUnavailableEncountered',
      };
      final schemaVersion = rawFilterMetadata?['schemaVersion'];
      if (rawFilterMetadata == null ||
          rawFilterMetadata.keys.length != filterKeys.length ||
          !rawFilterMetadata.keys.toSet().containsAll(filterKeys) ||
          schemaVersion is! int ||
          schemaVersion != 1 ||
          rawFilterMetadata['needsQrPreparation'] is! bool ||
          rawFilterMetadata['needsQrPreparation'] !=
              expectedNeedsQrPreparation ||
          rawFilterMetadata['preparationUnavailableEncountered'] is! bool ||
          (!expectedNeedsQrPreparation &&
              rawFilterMetadata['preparationUnavailableEncountered'] == true)) {
        throw const FormatException('Invalid paged restaurant response.');
      }
      needsQrPreparation = expectedNeedsQrPreparation;
      preparationUnavailableEncountered =
          rawFilterMetadata['preparationUnavailableEncountered'] as bool;
    }
    final protocolData = <String, Object?>{
      for (final entry in data.entries)
        if (protocolKeys.contains(entry.key)) entry.key: entry.value,
    };
    late final PagedResponse<AdminRestaurantLinkRecord> page;
    try {
      page = PagedResponse<AdminRestaurantLinkRecord>.fromJson(
        protocolData,
        itemParser: (raw) =>
            AdminRestaurantLinkRecord.tryFromCallableData(raw) ??
            (throw const PagedProtocolException()),
      );
    } on PagedProtocolException {
      throw const FormatException('Invalid paged restaurant response.');
    }
    final preparation = page.preparation;
    final nextCursor = page.cursors.next;
    if (page.pageSize != adminDirectoryDefaultPageSize ||
        page.hasPrevious ||
        page.cursors.previous != null ||
        page.pageNumber != null ||
        page.total?.state != PagedTotalState.unknown ||
        preparation == null ||
        preparation.totalUnits == null ||
        preparation.totalUnits! <= 0 ||
        page.capabilities.first ||
        page.capabilities.previous ||
        page.capabilities.numberedVisitedPages ||
        page.capabilities.last ||
        (nextCursor != null && !isValidAdminRestaurantPageCursor(nextCursor))) {
      throw const FormatException('Invalid paged restaurant response.');
    }
    final consumedBoundary = data.containsKey('consumedBoundary')
        ? AdminRestaurantMaterializedOrder.tryFromCallableData(
            data['consumedBoundary'],
          )
        : null;
    if (data.containsKey('consumedBoundary') && consumedBoundary == null) {
      throw const FormatException('Invalid paged restaurant response.');
    }
    switch (preparation.state) {
      case PagePreparationState.preparing:
        if (page.items.isNotEmpty ||
            !page.hasNext ||
            nextCursor == null ||
            consumedBoundary != null ||
            preparation.completedUnits >= preparation.totalUnits!) {
          throw const FormatException('Invalid paged restaurant response.');
        }
      case PagePreparationState.ready:
        if (preparation.completedUnits != preparation.totalUnits! ||
            ((page.items.isNotEmpty || page.hasNext) &&
                consumedBoundary == null)) {
          throw const FormatException('Invalid paged restaurant response.');
        }
      case PagePreparationState.failed:
        if (page.items.isNotEmpty ||
            page.hasNext ||
            nextCursor != null ||
            consumedBoundary != null ||
            preparation.completedUnits >= preparation.totalUnits!) {
          throw const FormatException('Invalid paged restaurant response.');
        }
    }
    final keys = <String>{};
    final canonicalIds = <String>{};
    AdminRestaurantMaterializedOrder? previousOrder;
    for (final record in page.items) {
      final order = record.materializedOrder;
      if (!keys.add(record.recordKey) ||
          order == null ||
          !order.matchesRecord(record) ||
          (previousOrder != null && order.compareTo(previousOrder) <= 0) ||
          (consumedBoundary != null && order.compareTo(consumedBoundary) > 0)) {
        throw const FormatException('Invalid paged restaurant identity.');
      }
      if (needsQrPreparation == true &&
          (record.source != AdminRestaurantLinkSource.biteScore ||
              record.actionId != record.documentId ||
              record.preparation.canonicalCatalogRestaurantId !=
                  record.documentId ||
              !record.preparation.needsPreparation ||
              !canonicalIds.add(record.documentId))) {
        throw const FormatException('Invalid filtered restaurant identity.');
      }
      previousOrder = order;
    }
    final rawSearchCenter = _stringKeyedMap(data['searchCenter']);
    const searchCenterKeys = <String>{'latitude', 'longitude', 'displayName'};
    final rawDisplayName = rawSearchCenter?['displayName'];
    final searchCenter =
        rawSearchCenter == null ||
            rawSearchCenter.keys.length != searchCenterKeys.length ||
            !rawSearchCenter.keys.toSet().containsAll(searchCenterKeys) ||
            rawDisplayName is! String ||
            rawDisplayName.length > 500
        ? null
        : AdminRestaurantSearchCenter.tryFromCallableData(rawSearchCenter);
    final radiusMiles = _finiteDouble(data['radiusMiles']);
    final rawSources = data['queriedSources'];
    if (searchCenter == null ||
        radiusMiles == null ||
        radiusMiles <= 0 ||
        radiusMiles > 50 ||
        rawSources is! List ||
        rawSources.isEmpty ||
        rawSources.length > AdminRestaurantLinkSource.values.length) {
      throw const FormatException('Invalid paged restaurant response.');
    }
    final sources = <AdminRestaurantLinkSource>[];
    for (final rawSource in rawSources) {
      final source = AdminRestaurantLinkSource.fromCallableValue(rawSource);
      if (source == null || sources.contains(source)) {
        throw const FormatException('Invalid paged restaurant response.');
      }
      sources.add(source);
    }
    final canonicalSources = AdminRestaurantLinkSource.values
        .where(sources.contains)
        .toList(growable: false);
    if (!List.generate(
      sources.length,
      (index) => sources[index] == canonicalSources[index],
    ).every((matches) => matches)) {
      throw const FormatException('Invalid paged restaurant response.');
    }
    if (consumedBoundary != null &&
        !sources.contains(consumedBoundary.source)) {
      throw const FormatException('Invalid paged restaurant response.');
    }
    for (final record in page.items) {
      if (!sources.contains(record.source)) {
        throw const FormatException('Invalid paged restaurant response.');
      }
    }
    return AdminRestaurantLinkPagedResult(
      page: page,
      searchCenter: searchCenter,
      radiusMiles: radiusMiles,
      queriedSources: List.unmodifiable(sources),
      consumedBoundary: consumedBoundary,
      needsQrPreparation: needsQrPreparation,
      preparationUnavailableEncountered: preparationUnavailableEncountered,
    );
  }

  AdminRestaurantLinkSearchResult asAccumulatedResult(
    List<AdminRestaurantLinkRecord> records,
  ) {
    return AdminRestaurantLinkSearchResult(
      searchCenter: searchCenter,
      radiusMiles: radiusMiles,
      results: List.unmodifiable(records),
      resultsMayBeTruncated: false,
      returnedCount: records.length,
      queriedSources: queriedSources,
    );
  }
}

Map<String, dynamic>? _stringKeyedMap(Object? value) {
  if (value is! Map) {
    return null;
  }
  final result = <String, dynamic>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      return null;
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

String? _requiredString(Object? value) {
  final string = _optionalString(value);
  return string == null || string.isEmpty ? null : string;
}

String? _optionalString(Object? value) {
  if (value is! String) {
    return null;
  }
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

String? _optionalExactFirestorePathSegment(
  Map<String, dynamic> data,
  String field,
) {
  final value = data[field];
  return value == null ? null : exactFirestoreDocumentId(value);
}

bool _hasInvalidOptionalIdentity(Map<String, dynamic> data, String field) {
  return data[field] != null && exactFirestoreDocumentId(data[field]) == null;
}

double? _finiteDouble(Object? value) {
  if (value is! num) {
    return null;
  }
  final number = value.toDouble();
  return number.isFinite ? number : null;
}

int _compareUtf8(String first, String second) {
  final firstBytes = utf8.encode(first);
  final secondBytes = utf8.encode(second);
  final commonLength = firstBytes.length < secondBytes.length
      ? firstBytes.length
      : secondBytes.length;
  for (var index = 0; index < commonLength; index += 1) {
    final comparison = firstBytes[index].compareTo(secondBytes[index]);
    if (comparison != 0) {
      return comparison;
    }
  }
  return firstBytes.length.compareTo(secondBytes.length);
}
