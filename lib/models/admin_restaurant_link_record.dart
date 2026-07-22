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
  final String? ownerUserId;
  final String? linkedBiteSaverUid;

  final String? approvalStatus;
  final bool? couponApplicationSubmitted;
  final String? uid;
  final String? linkedBiteScoreRestaurantId;

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
    this.ownerUserId,
    this.linkedBiteSaverUid,
    this.approvalStatus,
    this.couponApplicationSubmitted,
    this.uid,
    this.linkedBiteScoreRestaurantId,
  });

  bool get isBiteScore => source == AdminRestaurantLinkSource.biteScore;
  bool get isBiteSaver => source == AdminRestaurantLinkSource.biteSaver;

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
    final documentId = _requiredString(data['documentId']);
    final actionId = _requiredString(data['actionId']);
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
    final approvalStatus = data['approvalStatus'];
    final couponApplicationSubmitted = data['couponApplicationSubmitted'];
    if (source == AdminRestaurantLinkSource.biteScore &&
        (isActive is! bool || isClaimed is! bool)) {
      return null;
    }
    if (source == AdminRestaurantLinkSource.biteSaver &&
        (approvalStatus is! String || couponApplicationSubmitted is! bool)) {
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
      ownerUserId: source == AdminRestaurantLinkSource.biteScore
          ? _optionalString(data['ownerUserId'])
          : null,
      linkedBiteSaverUid: source == AdminRestaurantLinkSource.biteScore
          ? _optionalString(data['linkedBiteSaverUid'])
          : null,
      approvalStatus: source == AdminRestaurantLinkSource.biteSaver
          ? _optionalString(approvalStatus)
          : null,
      couponApplicationSubmitted:
          source == AdminRestaurantLinkSource.biteSaver &&
              couponApplicationSubmitted is bool
          ? couponApplicationSubmitted
          : null,
      uid: source == AdminRestaurantLinkSource.biteSaver
          ? _optionalString(data['uid'])
          : null,
      linkedBiteScoreRestaurantId: source == AdminRestaurantLinkSource.biteSaver
          ? _optionalString(data['linkedBiteScoreRestaurantId'])
          : null,
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

double? _finiteDouble(Object? value) {
  if (value is! num) {
    return null;
  }
  final number = value.toDouble();
  return number.isFinite ? number : null;
}
