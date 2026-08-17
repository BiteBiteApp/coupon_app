import '../services/firestore_document_id.dart';

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

  static AdminRestaurantPreparationState tryFromCallableData(
    Object? value, {
    required AdminRestaurantLinkSource source,
    required String documentId,
    required AdminBiteSaverCatalogBindingState biteSaverCatalogBindingState,
    required AdminRestaurantClaimState claimState,
  }) {
    final data = _stringKeyedMap(value);
    if (data == null) {
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
