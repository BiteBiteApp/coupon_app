import 'package:cloud_firestore/cloud_firestore.dart';

import 'restaurant.dart';

class BitescoreRestaurant {
  static const String collectionName = 'bitescore_restaurants';

  final String id;
  final String name;
  final String normalizedName;
  final String address;
  final String city;
  final String state;
  final String zipCode;
  final GeoPoint location;
  final String? phone;
  final String? website;
  final String? bio;
  final String? ownerUserId;
  final List<RestaurantBusinessHours> businessHours;
  final List<String> cuisineTags;
  final bool isClaimed;
  final bool isActive;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const BitescoreRestaurant({
    required this.id,
    required this.name,
    required this.normalizedName,
    required this.address,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.location,
    this.phone,
    this.website,
    this.bio,
    this.ownerUserId,
    this.businessHours = const <RestaurantBusinessHours>[],
    this.cuisineTags = const <String>[],
    this.isClaimed = false,
    this.isActive = true,
    this.createdAt,
    this.updatedAt,
  });

  String get streetAddress => address;
  double? get latitude => location.latitude;
  double? get longitude => location.longitude;

  Map<String, dynamic> toFirestoreMap() {
    final normalizedState = _normalizeState(state) ?? state.trim();
    final normalizedZip = _normalizeZipCode(zipCode) ?? zipCode.trim();
    final normalizedCity = city.trim();
    final normalizedAddress = address.trim();
    final formattedAddress = _composeFormattedAddress(
      address: normalizedAddress,
      city: normalizedCity,
      state: normalizedState,
      zipCode: normalizedZip,
    );

    return {
      'id': id.trim(),
      'name': name.trim(),
      'restaurantName': name.trim(),
      'normalizedName': normalizedName.trim(),
      'address': normalizedAddress,
      'streetAddress': normalizedAddress,
      'formattedAddress': formattedAddress,
      'fullAddress': formattedAddress,
      'city': normalizedCity,
      'state': normalizedState,
      'stateCode': normalizedState,
      'zip': normalizedZip,
      'zipCode': normalizedZip,
      'postalCode': normalizedZip,
      'location': location,
      'geoPoint': location,
      'latitude': location.latitude,
      'longitude': location.longitude,
      'phone': phone?.trim(),
      'website': website?.trim(),
      'bio': bio?.trim(),
      Restaurant.fieldBusinessHours:
          RestaurantBusinessHours.toFirestoreList(businessHours),
      'ownerUserId': ownerUserId?.trim(),
      'cuisineTags': cuisineTags,
      'isClaimed': isClaimed,
      'isActive': isActive,
      'active': isActive,
      'createdAt': createdAt == null ? null : Timestamp.fromDate(createdAt!),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
    };
  }

  BitescoreRestaurant copyWith({
    String? id,
    String? name,
    String? normalizedName,
    String? address,
    String? city,
    String? state,
    String? zipCode,
    GeoPoint? location,
    String? phone,
    String? website,
    String? bio,
    String? ownerUserId,
    List<RestaurantBusinessHours>? businessHours,
    List<String>? cuisineTags,
    bool? isClaimed,
    bool? isActive,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return BitescoreRestaurant(
      id: id ?? this.id,
      name: name ?? this.name,
      normalizedName: normalizedName ?? this.normalizedName,
      address: address ?? this.address,
      city: city ?? this.city,
      state: state ?? this.state,
      zipCode: zipCode ?? this.zipCode,
      location: location ?? this.location,
      phone: phone ?? this.phone,
      website: website ?? this.website,
      bio: bio ?? this.bio,
      ownerUserId: ownerUserId ?? this.ownerUserId,
      businessHours: businessHours ?? this.businessHours,
      cuisineTags: cuisineTags ?? this.cuisineTags,
      isClaimed: isClaimed ?? this.isClaimed,
      isActive: isActive ?? this.isActive,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  static BitescoreRestaurant? tryFromFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final name = _readString(data['name']);
    final normalizedName =
        _readString(data['normalizedName']) ?? name?.toLowerCase();
    final address =
        _readString(data['address']) ?? _readString(data['streetAddress']);
    final city = _readString(data['city']);
    final state = _readString(data['state']) ?? '';
    final zipCode = _readString(data['zip']) ?? _readString(data['zipCode']);
    final location = _readGeoPoint(data['location']) ??
        _readGeoPointFromCoordinates(
          latitude: data['latitude'],
          longitude: data['longitude'],
        );

    if (name == null ||
        normalizedName == null ||
        address == null ||
        city == null ||
        zipCode == null ||
        location == null) {
      return null;
    }

    return BitescoreRestaurant(
      id: _readString(data['id']) ?? fallbackId,
      name: name,
      normalizedName: normalizedName,
      address: address,
      city: city,
      state: state,
      zipCode: zipCode,
      location: location,
      phone: _readString(data['phone']),
      website: _readString(data['website']) ?? _readString(data['websiteUrl']),
      bio: _readString(data['bio']),
      ownerUserId: _readString(data['ownerUserId']),
      businessHours: RestaurantBusinessHours.listFromFirestore(
        data[Restaurant.fieldBusinessHours],
      ),
      cuisineTags: _readStringList(data['cuisineTags']),
      isClaimed: _readBool(data['isClaimed']) ?? false,
      isActive: _readBool(data['isActive']) ?? true,
      createdAt: _readDateTime(data['createdAt']),
      updatedAt: _readDateTime(data['updatedAt']),
    );
  }

  static BitescoreRestaurant? tryFromFinderFirestore(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    if (data == null) {
      return null;
    }

    final address = _readString(data['address']) ??
        _readString(data['streetAddress']) ??
        _readString(data['formattedAddress']) ??
        _readString(data['fullAddress']) ??
        '';
    final inferredAddress = _parseUsAddress(address);
    final name = _readString(data['name']) ??
        _readString(data['restaurantName']) ??
        _readString(data['restaurant_name']);
    final normalizedName =
        _readString(data['normalizedName']) ?? name?.toLowerCase();
    final explicitCity = _readString(data['city']) ??
        _readString(data['locality']) ??
        _readString(data['municipality']) ??
        _readString(data['town']);
    final explicitState = _readString(data['state']) ??
        _readString(data['stateCode']) ??
        _readString(data['state_name']) ??
        _readString(data['region']) ??
        _readString(data['province']);
    final explicitZip = _readString(data['zip']) ??
        _readString(data['zipCode']) ??
        _readString(data['zip_code']) ??
        _readString(data['postalCode']) ??
        _readString(data['postcode']);
    final state = _normalizeState(explicitState ?? inferredAddress.state);
    final zipCode = _normalizeZipCode(explicitZip ?? inferredAddress.zipCode) ?? '';
    final city = _normalizeCity(
      explicitCity,
      fallbackCity: inferredAddress.city,
      state: state,
      zipCode: zipCode,
    );
    final location = _readGeoPoint(data['location']) ??
        _readGeoPoint(data['geoPoint']) ??
        _readGeoPointFromCoordinates(
          latitude: data['latitude'] ?? data['lat'],
          longitude: data['longitude'] ?? data['lng'],
        ) ??
        const GeoPoint(0, 0);

    if (name == null || normalizedName == null || city == null) {
      return null;
    }

    return BitescoreRestaurant(
      id: _readString(data['id']) ?? fallbackId,
      name: name,
      normalizedName: normalizedName,
      address: address,
      city: city,
      state: state ?? '',
      zipCode: zipCode,
      location: location,
      phone: _readString(data['phone']) ?? _readString(data['phoneNumber']),
      website: _readString(data['website']) ??
          _readString(data['websiteUrl']) ??
          _readString(data['url']),
      bio: _readString(data['bio']),
      ownerUserId: _readString(data['ownerUserId']),
      businessHours: RestaurantBusinessHours.listFromFirestore(
        data[Restaurant.fieldBusinessHours],
      ),
      cuisineTags: _readStringList(data['cuisineTags']),
      isClaimed: _readBool(data['isClaimed']) ?? false,
      isActive: _readBool(data['isActive']) ?? _readBool(data['active']) ?? true,
      createdAt: _readDateTime(data['createdAt']),
      updatedAt: _readDateTime(data['updatedAt']),
    );
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static bool? _readBool(dynamic value) {
    if (value is bool) {
      return value;
    }

    return null;
  }

  static GeoPoint? _readGeoPoint(dynamic value) {
    if (value is GeoPoint) {
      return value;
    }

    return null;
  }

  static GeoPoint? _readGeoPointFromCoordinates({
    required dynamic latitude,
    required dynamic longitude,
  }) {
    final parsedLatitude = _readDouble(latitude);
    final parsedLongitude = _readDouble(longitude);
    if (parsedLatitude == null || parsedLongitude == null) {
      return null;
    }

    return GeoPoint(parsedLatitude, parsedLongitude);
  }

  static double? _readDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    if (value is String) {
      return double.tryParse(value.trim());
    }

    return null;
  }

  static String? _normalizeState(String? value) {
    if (value == null) {
      return null;
    }

    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return null;
    }

    final upper = trimmed.toUpperCase();
    if (_stateNameToCode.containsKey(upper)) {
      return _stateNameToCode[upper];
    }

    if (upper.length == 2) {
      return upper;
    }

    return trimmed;
  }

  static String? _normalizeZipCode(String? value) {
    if (value == null) {
      return null;
    }

    final match = RegExp(r'(\d{5}(?:-\d{4})?)').firstMatch(value);
    return match?.group(1);
  }

  static String? _normalizeCity(
    String? value, {
    required String? fallbackCity,
    required String? state,
    required String zipCode,
  }) {
    var candidate = value?.trim();

    if (candidate != null && candidate.contains(',')) {
      candidate = _parseUsAddress(candidate).city ?? candidate;
    }

    if (_isInvalidCityCandidate(candidate, state: state, zipCode: zipCode)) {
      candidate = fallbackCity?.trim();
    }

    if (_isInvalidCityCandidate(candidate, state: state, zipCode: zipCode)) {
      return null;
    }

    return candidate;
  }

  static bool _isInvalidCityCandidate(
    String? value, {
    required String? state,
    required String zipCode,
  }) {
    if (value == null || value.isEmpty) {
      return true;
    }

    final trimmed = value.trim();
    final upper = trimmed.toUpperCase();
    if (upper == 'USA' ||
        upper == 'US' ||
        upper == 'UNITED STATES' ||
        upper == 'UNITED STATES OF AMERICA') {
      return true;
    }

    if (RegExp(r'^\d{5}(?:-\d{4})?$').hasMatch(trimmed)) {
      return true;
    }

    if (RegExp(r'^[A-Z]{2}\s+\d{5}(?:-\d{4})?$').hasMatch(upper)) {
      return true;
    }

    if (state != null && upper == state.toUpperCase()) {
      return true;
    }

    if (zipCode.isNotEmpty && trimmed == zipCode) {
      return true;
    }

    return false;
  }

  static String _composeFormattedAddress({
    required String address,
    required String city,
    required String state,
    required String zipCode,
  }) {
    final parts = <String>[
      if (address.isNotEmpty) address,
      if (city.isNotEmpty) city,
      [state, zipCode].where((part) => part.isNotEmpty).join(' '),
      'USA',
    ].where((part) => part.isNotEmpty).toList();

    return parts.join(', ');
  }

  static List<String> _readStringList(dynamic value) {
    if (value is Iterable) {
      return value
          .whereType<String>()
          .map((item) => item.trim())
          .where((item) => item.isNotEmpty)
          .toList();
    }

    return const <String>[];
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate().toLocal();
    }

    if (value is DateTime) {
      return value.toLocal();
    }

    return null;
  }

  static _ParsedUsAddress _parseUsAddress(String address) {
    final parts = address
        .split(',')
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList();

    if (parts.isEmpty) {
      return const _ParsedUsAddress();
    }

    final normalizedParts = [...parts];
    final trailingCountry = normalizedParts.last.toUpperCase();
    if (trailingCountry == 'USA' ||
        trailingCountry == 'US' ||
        trailingCountry == 'UNITED STATES' ||
        trailingCountry == 'UNITED STATES OF AMERICA') {
      normalizedParts.removeLast();
    }

    if (normalizedParts.isEmpty) {
      return const _ParsedUsAddress();
    }

    final stateZipMatch = RegExp(
      r'^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$',
    ).firstMatch(normalizedParts.last);
    if (stateZipMatch != null) {
      final city = normalizedParts.length >= 2
          ? normalizedParts[normalizedParts.length - 2]
          : null;
      return _ParsedUsAddress(
        city: city,
        state: stateZipMatch.group(1),
        zipCode: stateZipMatch.group(2),
      );
    }

    if (normalizedParts.length >= 2) {
      final trailingMatch = RegExp(
        r'^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$',
      ).firstMatch(normalizedParts.last);
      if (trailingMatch != null) {
        return _ParsedUsAddress(
          city: trailingMatch.group(1)?.trim(),
          state: trailingMatch.group(2),
          zipCode: trailingMatch.group(3),
        );
      }
    }

    final zipMatch = RegExp(r'(\d{5}(?:-\d{4})?)').firstMatch(address);
    return _ParsedUsAddress(zipCode: zipMatch?.group(1));
  }
}

class _ParsedUsAddress {
  final String? city;
  final String? state;
  final String? zipCode;

  const _ParsedUsAddress({
    this.city,
    this.state,
    this.zipCode,
  });
}

const Map<String, String> _stateNameToCode = {
  'ALABAMA': 'AL',
  'ALASKA': 'AK',
  'ARIZONA': 'AZ',
  'ARKANSAS': 'AR',
  'CALIFORNIA': 'CA',
  'COLORADO': 'CO',
  'CONNECTICUT': 'CT',
  'DELAWARE': 'DE',
  'FLORIDA': 'FL',
  'GEORGIA': 'GA',
  'HAWAII': 'HI',
  'IDAHO': 'ID',
  'ILLINOIS': 'IL',
  'INDIANA': 'IN',
  'IOWA': 'IA',
  'KANSAS': 'KS',
  'KENTUCKY': 'KY',
  'LOUISIANA': 'LA',
  'MAINE': 'ME',
  'MARYLAND': 'MD',
  'MASSACHUSETTS': 'MA',
  'MICHIGAN': 'MI',
  'MINNESOTA': 'MN',
  'MISSISSIPPI': 'MS',
  'MISSOURI': 'MO',
  'MONTANA': 'MT',
  'NEBRASKA': 'NE',
  'NEVADA': 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  'OHIO': 'OH',
  'OKLAHOMA': 'OK',
  'OREGON': 'OR',
  'PENNSYLVANIA': 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  'TENNESSEE': 'TN',
  'TEXAS': 'TX',
  'UTAH': 'UT',
  'VERMONT': 'VT',
  'VIRGINIA': 'VA',
  'WASHINGTON': 'WA',
  'WEST VIRGINIA': 'WV',
  'WISCONSIN': 'WI',
  'WYOMING': 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
};
