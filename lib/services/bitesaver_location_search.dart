import 'dart:convert' as convert;
import 'dart:math' as math;

import '../models/restaurant.dart';

typedef BiteSaverDistanceMilesCalculator =
    double Function(
      double centerLatitude,
      double centerLongitude,
      double restaurantLatitude,
      double restaurantLongitude,
    );

class BiteSaverLocationMatch {
  final double distanceMiles;
  final bool exactLocationPreference;

  const BiteSaverLocationMatch({
    required this.distanceMiles,
    required this.exactLocationPreference,
  });
}

class BiteSaverLocationSearch {
  static const String compatibilityContractVersion =
      'bitestar.customer-bitesaver-search-compatibility.v1';
  static const String searchNormalizerVersion =
      'bitestar.bitesaver-home-search-normalizer.v1';
  static const String searchMatcherVersion =
      'bitestar.bitesaver-home-search-matcher.v1';
  static const int maximumSearchScalars = 200;
  static const int maximumSearchUtf8Bytes = maximumSearchScalars * 4;
  static const double compatibilityEarthRadiusMeters = 6378137;
  static const double metersPerMile = 1609.344;

  static final RegExp _zipPattern = RegExp(r'^\d{5}(?:-\d{4})?$');
  static final RegExp _compatibilityApostrophePattern = RegExp(
    r"[\u2018\u2019\u201B\u2032']",
  );
  static final RegExp _compatibilityUnsupportedTextPattern = RegExp(
    r'[^a-z0-9]+',
  );
  static final RegExp _whitespacePattern = RegExp(r'\s+');

  static const Set<String> supportedUsStateCodes = <String>{
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

  static const Map<String, String> _usStateNameToCode = <String, String>{
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

  static BiteSaverLocationMatch? eligibleRestaurant({
    required Restaurant restaurant,
    required double centerLatitude,
    required double centerLongitude,
    required double radiusMiles,
    required String typedQuery,
    BiteSaverDistanceMilesCalculator? distanceCalculator,
  }) {
    final restaurantLatitude = restaurant.latitude;
    final restaurantLongitude = restaurant.longitude;
    if (!hasValidCoordinates(centerLatitude, centerLongitude) ||
        restaurantLatitude == null ||
        restaurantLongitude == null ||
        !hasValidCoordinates(restaurantLatitude, restaurantLongitude) ||
        !radiusMiles.isFinite ||
        radiusMiles <= 0) {
      return null;
    }

    final distanceMiles =
        distanceCalculator?.call(
          centerLatitude,
          centerLongitude,
          restaurantLatitude,
          restaurantLongitude,
        ) ??
        exactDistanceMiles(
          centerLatitude: centerLatitude,
          centerLongitude: centerLongitude,
          candidateLatitude: restaurantLatitude,
          candidateLongitude: restaurantLongitude,
        );
    if (distanceMiles == null ||
        !distanceMiles.isFinite ||
        distanceMiles < 0 ||
        distanceMiles > radiusMiles) {
      return null;
    }

    return BiteSaverLocationMatch(
      distanceMiles: distanceMiles,
      exactLocationPreference: _isExactLocationPreference(
        restaurant,
        typedQuery,
      ),
    );
  }

  static bool hasValidCoordinates(double latitude, double longitude) {
    return latitude.isFinite &&
        longitude.isFinite &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        !(latitude == 0 && longitude == 0);
  }

  static double? exactDistanceMiles({
    required double centerLatitude,
    required double centerLongitude,
    required double candidateLatitude,
    required double candidateLongitude,
  }) {
    if (!hasValidCoordinates(centerLatitude, centerLongitude) ||
        !hasValidCoordinates(candidateLatitude, candidateLongitude)) {
      return null;
    }

    final centerLatitudeRadians = _degreesToRadians(centerLatitude);
    final candidateLatitudeRadians = _degreesToRadians(candidateLatitude);
    final latitudeDeltaRadians = _degreesToRadians(
      candidateLatitude - centerLatitude,
    );
    final longitudeDeltaRadians = _degreesToRadians(
      candidateLongitude - centerLongitude,
    );
    final latitudeHalfSine = math.sin(latitudeDeltaRadians / 2);
    final longitudeHalfSine = math.sin(longitudeDeltaRadians / 2);
    final haversine =
        latitudeHalfSine * latitudeHalfSine +
        math.cos(centerLatitudeRadians) *
            math.cos(candidateLatitudeRadians) *
            longitudeHalfSine *
            longitudeHalfSine;
    final clampedHaversine = haversine.clamp(0.0, 1.0).toDouble();
    final angularDistance =
        2 *
        math.atan2(
          math.sqrt(clampedHaversine),
          math.sqrt(1 - clampedHaversine),
        );
    return compatibilityEarthRadiusMeters * angularDistance / metersPerMile;
  }

  static String? canonicalUsStateCode(String value) {
    final normalized = value.trim().toUpperCase().replaceAll(
      _whitespacePattern,
      ' ',
    );
    if (supportedUsStateCodes.contains(normalized)) {
      return normalized;
    }
    return _usStateNameToCode[normalized];
  }

  static String normalizeCompatibilitySearchText(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(_compatibilityApostrophePattern, '')
        .replaceAll(_compatibilityUnsupportedTextPattern, ' ')
        .replaceAll(_whitespacePattern, ' ')
        .trim();
  }

  static bool hasWellFormedCompatibilityUtf16(String value) {
    final codeUnits = value.codeUnits;
    for (var index = 0; index < codeUnits.length; index += 1) {
      final codeUnit = codeUnits[index];
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        if (index + 1 >= codeUnits.length) {
          return false;
        }
        final next = codeUnits[index + 1];
        if (next < 0xdc00 || next > 0xdfff) {
          return false;
        }
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        return false;
      }
    }
    return true;
  }

  static bool isValidCompatibilitySearchText(String value) {
    if (!hasWellFormedCompatibilityUtf16(value)) {
      return false;
    }
    var scalarCount = 0;
    for (final _ in value.runes) {
      scalarCount += 1;
      if (scalarCount > maximumSearchScalars) {
        return false;
      }
    }
    return convert.utf8.encode(value).length <= maximumSearchUtf8Bytes;
  }

  static bool matchesCompatibilitySearch({
    required String query,
    required Iterable<String?> searchableFields,
  }) {
    final normalizedQuery = normalizeCompatibilitySearchText(query);
    if (normalizedQuery.isEmpty) {
      return true;
    }
    return searchableFields.any(
      (value) => normalizeCompatibilitySearchText(
        value ?? '',
      ).contains(normalizedQuery),
    );
  }

  static bool _isExactLocationPreference(
    Restaurant restaurant,
    String typedQuery,
  ) {
    final query = typedQuery.trim();
    if (query.isEmpty) {
      return false;
    }

    if (_zipPattern.hasMatch(query)) {
      return restaurant.zipCode.trim() == query;
    }

    final parts = query.split(',').map((part) => part.trim()).toList();
    final queryCity = _normalizeCity(parts.first);
    if (queryCity.isEmpty || _normalizeCity(restaurant.city) != queryCity) {
      return false;
    }

    if (parts.length > 1) {
      final queryStateCode = canonicalUsStateCode(parts.last);
      final restaurantStateCode = canonicalUsStateCode(restaurant.state);
      return queryStateCode != null &&
          restaurantStateCode != null &&
          restaurantStateCode == queryStateCode;
    }
    return true;
  }

  static String _normalizeCity(String value) {
    return value.trim().toLowerCase().replaceAll(_whitespacePattern, ' ');
  }

  static double _degreesToRadians(double degrees) {
    return degrees * math.pi / 180;
  }
}
