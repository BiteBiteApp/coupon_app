import 'package:geolocator/geolocator.dart';

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
  static final RegExp _zipPattern = RegExp(r'^\d{5}(?:-\d{4})?$');
  static final RegExp _stateCodePattern = RegExp(r'^[A-Za-z]{2}$');

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

    final calculate = distanceCalculator ?? _distanceMiles;
    final distanceMiles = calculate(
      centerLatitude,
      centerLongitude,
      restaurantLatitude,
      restaurantLongitude,
    );
    if (!distanceMiles.isFinite ||
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

  static double _distanceMiles(
    double centerLatitude,
    double centerLongitude,
    double restaurantLatitude,
    double restaurantLongitude,
  ) {
    return Geolocator.distanceBetween(
          centerLatitude,
          centerLongitude,
          restaurantLatitude,
          restaurantLongitude,
        ) /
        1609.344;
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

    if (parts.length > 1 && _stateCodePattern.hasMatch(parts.last)) {
      return restaurant.state.trim().toUpperCase() == parts.last.toUpperCase();
    }
    return true;
  }

  static String _normalizeCity(String value) {
    return value.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  }
}
