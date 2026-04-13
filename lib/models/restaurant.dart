import 'coupon.dart';

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
  static const String fieldZipCode = 'zipCode';
  static const String legacyFieldZipCode = 'zip';
  static const String fieldEmail = 'email';
  static const String fieldPhone = 'phone';
  static const String fieldStreetAddress = 'streetAddress';
  static const String legacyFieldStreetAddress = 'address';
  static const String fieldWebsite = 'website';
  static const String fieldBio = 'bio';
  static const String fieldBusinessHours = 'businessHours';
  static const String fieldLatitude = 'latitude';
  static const String fieldLongitude = 'longitude';
  static const String fieldApprovalStatus = 'approvalStatus';
  static const String fieldCreatedAt = 'createdAt';
  static const String fieldUpdatedAt = 'updatedAt';
  static const String defaultDistanceLabel = 'Distance calculated from location';

  final String name;
  final String distance;
  final String city;
  final String zipCode;
  final List<Coupon> coupons;
  final String? uid;
  final String? phone;
  final String? streetAddress;
  final String? website;
  final String? bio;
  final List<RestaurantBusinessHours> businessHours;
  final double? latitude;
  final double? longitude;

  const Restaurant({
    required this.name,
    required this.distance,
    required this.city,
    required this.zipCode,
    required this.coupons,
    this.uid,
    this.phone,
    this.streetAddress,
    this.website,
    this.bio,
    this.businessHours = const [],
    this.latitude,
    this.longitude,
  });

  String? validateRequiredFields() {
    if (name.trim().isEmpty) {
      return 'Restaurant name is required.';
    }

    if (city.trim().isEmpty) {
      return 'Restaurant city is required.';
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
    required List<RestaurantBusinessHours> businessHours,
    required double? latitude,
    required double? longitude,
  }) {
    return {
      fieldName: name.trim(),
      fieldCity: city.trim(),
      fieldZipCode: zipCode.trim(),
      fieldEmail: email.trim(),
      fieldPhone: phone.trim(),
      fieldStreetAddress: streetAddress.trim(),
      fieldWebsite: website.trim(),
      fieldBio: bio.trim(),
      fieldBusinessHours:
          RestaurantBusinessHours.toFirestoreList(businessHours),
      fieldLatitude: latitude,
      fieldLongitude: longitude,
    };
  }

  factory Restaurant.fromFirestore(
    Map<String, dynamic> data, {
    required List<Coupon> coupons,
  }) {
    return Restaurant(
      uid: _readString(data[fieldUid]),
      name: _readString(data[fieldName]) ?? _readString(data[legacyFieldName]) ?? '',
      distance: defaultDistanceLabel,
      city: _readString(data[fieldCity]) ?? '',
      zipCode: _readString(data[fieldZipCode]) ?? _readString(data[legacyFieldZipCode]) ?? '',
      phone: _readString(data[fieldPhone]),
      streetAddress:
          _readString(data[fieldStreetAddress]) ??
          _readString(data[legacyFieldStreetAddress]),
      website: _readString(data[fieldWebsite]),
      bio: _readString(data[fieldBio]),
      businessHours:
          RestaurantBusinessHours.listFromFirestore(data[fieldBusinessHours]),
      coupons: coupons,
      latitude: _readDouble(data[fieldLatitude]),
      longitude: _readDouble(data[fieldLongitude]),
    );
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
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
      fieldDay: day,
      fieldOpensAt: opensAt,
      fieldClosesAt: closesAt,
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

    final entriesByDay = {
      for (final entry in hours) entry.day: entry,
    };

    return Restaurant.businessDayNames
        .map((day) => entriesByDay[day] ?? defaultDay(day))
        .toList();
  }

  static List<RestaurantBusinessHours> defaultWeek() {
    return Restaurant.businessDayNames
        .map((day) => defaultDay(day))
        .toList();
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
