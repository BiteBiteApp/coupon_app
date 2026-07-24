import 'package:cloud_firestore/cloud_firestore.dart';

import 'coupon.dart';
import 'daily_special.dart';

class Restaurant {
  static const List<String> businessDayNames = <String>[
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  static const String fieldUid = 'uid';
  static const String fieldName = 'restaurantName';
  static const String legacyFieldName = 'name';
  static const String fieldDistance = 'distance';
  static const String fieldCity = 'city';
  static const String fieldState = 'state';
  static const String fieldZipCode = 'zipCode';
  static const String legacyFieldZipCode = 'zip';
  static const String fieldEmail = 'email';
  static const String fieldPhone = 'phone';
  static const String fieldStreetAddress = 'streetAddress';
  static const String legacyFieldStreetAddress = 'address';
  static const String fieldWebsite = 'website';
  static const String fieldBio = 'bio';
  static const String fieldMainImageUrl = 'mainImageUrl';
  static const String legacyFieldImageUrl = 'imageUrl';
  static const String fieldBusinessHours = 'businessHours';
  static const String fieldLatitude = 'latitude';
  static const String fieldLongitude = 'longitude';
  static const String fieldProfileVersion = 'profileVersion';
  static const String fieldLocationVersion = 'locationVersion';
  static const String fieldFormattedAddress = 'formattedAddress';
  static const String fieldAddressFingerprint = 'addressFingerprint';
  static const String fieldLocationValidatedAt = 'locationValidatedAt';
  static const String fieldLocationSource = 'locationSource';
  static const String fieldApprovalStatus = 'approvalStatus';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';
  static const String defaultDistanceLabel =
      'Distance calculated from location';

  final String name;
  final String distance;
  final String city;
  final String state;
  final String zipCode;
  final List<Coupon> coupons;
  final List<DailySpecial> dailySpecials;
  final String? documentId;
  final String? uid;
  final String? phone;
  final String? streetAddress;
  final String? website;
  final String? bio;
  final String? mainImageUrl;
  final List<RestaurantBusinessHours> businessHours;
  final double? latitude;
  final double? longitude;
  final int profileVersion;
  final int locationVersion;
  final String? formattedAddress;
  final String? addressFingerprint;
  final DateTime? locationValidatedAt;
  final String? locationSource;

  const Restaurant({
    required this.name,
    required this.distance,
    required this.city,
    this.state = '',
    required this.zipCode,
    required this.coupons,
    this.dailySpecials = const [],
    this.documentId,
    this.uid,
    this.phone,
    this.streetAddress,
    this.website,
    this.bio,
    this.mainImageUrl,
    this.businessHours = const [],
    this.latitude,
    this.longitude,
    this.profileVersion = 0,
    this.locationVersion = 0,
    this.formattedAddress,
    this.addressFingerprint,
    this.locationValidatedAt,
    this.locationSource,
  });

  String? get accountDocumentId {
    final firestoreDocumentId = documentId?.trim();
    if (firestoreDocumentId != null && firestoreDocumentId.isNotEmpty) {
      return firestoreDocumentId;
    }

    final storedUid = uid?.trim();
    return storedUid == null || storedUid.isEmpty ? null : storedUid;
  }

  bool get hasTrustedSearchableLocation {
    final lat = latitude;
    final lng = longitude;
    if (lat == null ||
        lng == null ||
        !lat.isFinite ||
        !lng.isFinite ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        (lat == 0 && lng == 0)) {
      return false;
    }

    final fingerprint = addressFingerprint?.trim() ?? '';
    return RegExp(r'^[0-9a-f]{64}$').hasMatch(fingerprint) &&
        locationSource == 'google_geocoding' &&
        locationVersion > 0 &&
        locationValidatedAt != null;
  }

  bool matchesStructuredAddress({
    required String streetAddress,
    required String city,
    required String state,
    required String zipCode,
  }) {
    return _normalizeAddressText(this.streetAddress ?? '') ==
            _normalizeAddressText(streetAddress) &&
        _normalizeAddressText(this.city) == _normalizeAddressText(city) &&
        _normalizeAddressText(this.state, uppercase: true) ==
            _normalizeAddressText(state, uppercase: true) &&
        _normalizeAddressText(this.zipCode) == _normalizeAddressText(zipCode);
  }

  String? validateRequiredFields() {
    if (name.trim().isEmpty) {
      return 'Restaurant name is required.';
    }

    if (streetAddress?.trim().isEmpty ?? true) {
      return 'Restaurant street address is required.';
    }

    if (city.trim().isEmpty) {
      return 'Restaurant city is required.';
    }

    if (state.trim().isEmpty) {
      return 'Restaurant state is required.';
    }

    if (zipCode.trim().isEmpty) {
      return 'Restaurant ZIP code is required.';
    }

    return null;
  }

  bool get hasValidRequiredFields => validateRequiredFields() == null;

  Map<String, dynamic> toProfileFirestoreMap({
    required String email,
    required String phone,
    required String streetAddress,
    required String website,
    required String bio,
    required String mainImageUrl,
    required List<RestaurantBusinessHours> businessHours,
    required double? latitude,
    required double? longitude,
  }) {
    final trimmedEmail = email.trim();
    final trimmedPhone = phone.trim();
    final trimmedStreetAddress = streetAddress.trim();
    final trimmedWebsite = website.trim();
    final trimmedBio = bio.trim();
    final trimmedMainImageUrl = mainImageUrl.trim();

    return {
      fieldName: name.trim(),
      fieldCity: city.trim(),
      fieldState: state.trim(),
      fieldZipCode: zipCode.trim(),
      fieldEmail: trimmedEmail,
      fieldPhone: trimmedPhone.isEmpty ? null : trimmedPhone,
      fieldStreetAddress: trimmedStreetAddress.isEmpty
          ? null
          : trimmedStreetAddress,
      fieldWebsite: trimmedWebsite.isEmpty ? null : trimmedWebsite,
      fieldBio: trimmedBio.isEmpty ? null : trimmedBio,
      fieldMainImageUrl: trimmedMainImageUrl.isEmpty
          ? null
          : trimmedMainImageUrl,
      fieldBusinessHours: RestaurantBusinessHours.toFirestoreList(
        businessHours,
      ),
      fieldLatitude: latitude,
      fieldLongitude: longitude,
    };
  }

  factory Restaurant.fromFirestore(
    Map<String, dynamic> data, {
    String? documentId,
    required List<Coupon> coupons,
    List<DailySpecial> dailySpecials = const [],
  }) {
    return Restaurant(
      documentId: _readDocumentId(documentId),
      uid: _readString(data[fieldUid]),
      name:
          _readString(data[fieldName]) ??
          _readString(data[legacyFieldName]) ??
          '',
      distance: _readString(data[fieldDistance]) ?? '',
      city: _readString(data[fieldCity]) ?? '',
      state: _readString(data[fieldState]) ?? '',
      zipCode:
          _readString(data[fieldZipCode]) ??
          _readString(data[legacyFieldZipCode]) ??
          '',
      phone: _readString(data[fieldPhone]),
      streetAddress:
          _readString(data[fieldStreetAddress]) ??
          _readString(data[legacyFieldStreetAddress]),
      website: _readString(data[fieldWebsite]),
      bio: _readString(data[fieldBio]),
      mainImageUrl:
          _readString(data[fieldMainImageUrl]) ??
          _readString(data[legacyFieldImageUrl]),
      businessHours: RestaurantBusinessHours.listFromFirestore(
        data[fieldBusinessHours],
      ),
      coupons: coupons,
      dailySpecials: dailySpecials,
      latitude: _readDouble(data[fieldLatitude]),
      longitude: _readDouble(data[fieldLongitude]),
      profileVersion: _readVersion(data[fieldProfileVersion]),
      locationVersion: _readVersion(data[fieldLocationVersion]),
      formattedAddress: _readString(data[fieldFormattedAddress]),
      addressFingerprint: _readString(data[fieldAddressFingerprint]),
      locationValidatedAt: _readDateTime(data[fieldLocationValidatedAt]),
      locationSource: _readString(data[fieldLocationSource]),
    );
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static String? _readDocumentId(String? value) {
    return value == null || value.isEmpty ? null : value;
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

  static int _readVersion(dynamic value) {
    return value is int && value >= 0 ? value : 0;
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate();
    }
    if (value is DateTime) {
      return value;
    }
    return null;
  }

  static String _normalizeAddressText(String value, {bool uppercase = false}) {
    final normalized = value.trim().replaceAll(RegExp(r'\s+'), ' ');
    return uppercase ? normalized.toUpperCase() : normalized;
  }
}

class RestaurantBusinessHours {
  static const String fieldDay = 'day';
  static const String fieldOpensAt = 'opensAt';
  static const String fieldClosesAt = 'closesAt';
  static const String fieldClosed = 'closed';

  final String day;
  final String opensAt;
  final String closesAt;
  final bool closed;

  const RestaurantBusinessHours({
    required this.day,
    required this.opensAt,
    required this.closesAt,
    required this.closed,
  });

  RestaurantBusinessHours copyWith({
    String? day,
    String? opensAt,
    String? closesAt,
    bool? closed,
  }) {
    return RestaurantBusinessHours(
      day: day ?? this.day,
      opensAt: opensAt ?? this.opensAt,
      closesAt: closesAt ?? this.closesAt,
      closed: closed ?? this.closed,
    );
  }

  String get summaryLabel {
    if (closed) {
      return 'Closed';
    }

    return '$opensAt - $closesAt';
  }

  Map<String, dynamic> toFirestoreMap() {
    return {
      fieldDay: day.trim(),
      fieldOpensAt: opensAt.trim(),
      fieldClosesAt: closesAt.trim(),
      fieldClosed: closed,
    };
  }

  static List<Map<String, dynamic>> toFirestoreList(
    List<RestaurantBusinessHours> hours,
  ) {
    if (hours.isEmpty) {
      return const [];
    }

    final normalized = normalizedWeek(hours);
    return normalized.map((entry) => entry.toFirestoreMap()).toList();
  }

  static List<RestaurantBusinessHours> listFromFirestore(dynamic value) {
    if (value is! List) {
      return const [];
    }

    final parsedEntries = <String, RestaurantBusinessHours>{};
    for (final item in value) {
      if (item is! Map) {
        continue;
      }

      final data = Map<String, dynamic>.from(item);
      final day = _readString(data[fieldDay]);
      if (day == null || !Restaurant.businessDayNames.contains(day)) {
        continue;
      }

      parsedEntries[day] = RestaurantBusinessHours(
        day: day,
        opensAt: _readString(data[fieldOpensAt]) ?? '9:00 AM',
        closesAt: _readString(data[fieldClosesAt]) ?? '5:00 PM',
        closed: data[fieldClosed] == true,
      );
    }

    if (parsedEntries.isEmpty) {
      return const [];
    }

    return Restaurant.businessDayNames
        .map((day) => parsedEntries[day] ?? defaultDay(day))
        .toList();
  }

  static List<RestaurantBusinessHours> normalizedWeek(
    List<RestaurantBusinessHours> hours,
  ) {
    if (hours.isEmpty) {
      return defaultWeek();
    }

    final entriesByDay = {for (final entry in hours) entry.day: entry};

    return Restaurant.businessDayNames
        .map((day) => entriesByDay[day] ?? defaultDay(day))
        .toList();
  }

  static List<RestaurantBusinessHours> defaultWeek() {
    return Restaurant.businessDayNames.map((day) => defaultDay(day)).toList();
  }

  static RestaurantBusinessHours defaultDay(String day) {
    return RestaurantBusinessHours(
      day: day,
      opensAt: '9:00 AM',
      closesAt: '5:00 PM',
      closed: true,
    );
  }

  static String? _readString(dynamic value) {
    if (value is! String) {
      return null;
    }

    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
