import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SharedLocationState {
  final bool usingCurrentLocation;
  final Position? currentPosition;
  final bool usingTypedSearchLocation;
  final double? typedLatitude;
  final double? typedLongitude;
  final String typedLabel;
  final String searchText;
  final String? detectedCity;
  final String? detectedZip;

  const SharedLocationState({
    this.usingCurrentLocation = false,
    this.currentPosition,
    this.usingTypedSearchLocation = false,
    this.typedLatitude,
    this.typedLongitude,
    this.typedLabel = '',
    this.searchText = '',
    this.detectedCity,
    this.detectedZip,
  });
}

class SharedLocationRestoreResult {
  final SharedLocationState state;
  final String? message;

  const SharedLocationRestoreResult({required this.state, this.message});
}

class SharedLocationStateService {
  static const String _prefersLiveLocationKey = 'prefers_live_location';
  static const String _savedZipCodeKey = 'saved_zip_code';
  static final RegExp _fiveDigitZipPattern = RegExp(r'^\d{5}$');

  static SharedLocationState _state = const SharedLocationState();
  static Future<SharedLocationRestoreResult>? _restoreFuture;
  static bool _hasRestoredFromStorage = false;

  static SharedLocationState get state => _state;

  static Future<SharedLocationRestoreResult> restoreOnLaunch({
    required Future<({String? city, String? zip})> Function(Position position)
    reverseLookupLocation,
  }) {
    if (_hasRestoredFromStorage) {
      return Future.value(SharedLocationRestoreResult(state: _state));
    }

    if (_restoreFuture != null) {
      return _restoreFuture!;
    }

    _restoreFuture = _restoreOnLaunchInternal(
      reverseLookupLocation: reverseLookupLocation,
    );
    return _restoreFuture!;
  }

  static Future<SharedLocationRestoreResult> _restoreOnLaunchInternal({
    required Future<({String? city, String? zip})> Function(Position position)
    reverseLookupLocation,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final prefersLiveLocation = prefs.getBool(_prefersLiveLocationKey) ?? false;
    final savedZipCode = (prefs.getString(_savedZipCodeKey) ?? '').trim();

    try {
      if (prefersLiveLocation) {
        final serviceEnabled = await Geolocator.isLocationServiceEnabled();
        final permission = await Geolocator.checkPermission();

        if (!serviceEnabled ||
            permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          _state = const SharedLocationState();
          _hasRestoredFromStorage = true;
          return const SharedLocationRestoreResult(
            state: SharedLocationState(),
            message: 'Enable location to see nearby results.',
          );
        }

        final position = await Geolocator.getCurrentPosition();
        final locationDetails = await reverseLookupLocation(position);
        final searchText = locationDetails.city?.isNotEmpty == true
            ? locationDetails.city!
            : (locationDetails.zip?.isNotEmpty == true
                  ? locationDetails.zip!
                  : '');

        _state = SharedLocationState(
          usingCurrentLocation: true,
          currentPosition: position,
          searchText: searchText.trim(),
          detectedCity: locationDetails.city?.trim(),
          detectedZip: locationDetails.zip?.trim(),
        );
        await prefs.setBool(_prefersLiveLocationKey, true);
        await prefs.remove(_savedZipCodeKey);
        _hasRestoredFromStorage = true;
        return SharedLocationRestoreResult(state: _state);
      }

      if (savedZipCode.isNotEmpty) {
        SharedLocationState restoredState = SharedLocationState(
          searchText: savedZipCode,
        );

        try {
          final locations = await geocodeSearchQuery(savedZipCode);
          if (locations.isNotEmpty) {
            restoredState = SharedLocationState(
              usingTypedSearchLocation: true,
              typedLatitude: locations.first.latitude,
              typedLongitude: locations.first.longitude,
              typedLabel: savedZipCode,
              searchText: savedZipCode,
            );
          }
        } catch (_) {}

        _state = restoredState;
        _hasRestoredFromStorage = true;
        return SharedLocationRestoreResult(state: _state);
      }

      _state = const SharedLocationState();
      _hasRestoredFromStorage = true;
      return const SharedLocationRestoreResult(state: SharedLocationState());
    } catch (_) {
      _state = const SharedLocationState();
      _hasRestoredFromStorage = true;
      return const SharedLocationRestoreResult(
        state: SharedLocationState(),
        message: 'Could not refresh your location right now.',
      );
    } finally {
      _restoreFuture = null;
    }
  }

  static void saveTypedLocation({
    required double latitude,
    required double longitude,
    required String label,
    required String searchText,
  }) {
    _state = SharedLocationState(
      usingTypedSearchLocation: true,
      typedLatitude: latitude,
      typedLongitude: longitude,
      typedLabel: label.trim(),
      searchText: searchText.trim(),
    );
    unawaited(
      _persistPreference(
        prefersLiveLocation: false,
        savedZipCode: searchText.trim(),
      ),
    );
  }

  static void saveCurrentLocation({
    required Position position,
    required String searchText,
    String? detectedCity,
    String? detectedZip,
  }) {
    _state = SharedLocationState(
      usingCurrentLocation: true,
      currentPosition: position,
      searchText: searchText.trim(),
      detectedCity: detectedCity?.trim(),
      detectedZip: detectedZip?.trim(),
    );
    unawaited(_persistPreference(prefersLiveLocation: true));
  }

  static void clear() {
    _state = const SharedLocationState();
    unawaited(_clearPreference());
  }

  static Future<void> _persistPreference({
    required bool prefersLiveLocation,
    String? savedZipCode,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefersLiveLocationKey, prefersLiveLocation);

    final trimmedZipCode = savedZipCode?.trim() ?? '';
    if (trimmedZipCode.isEmpty) {
      await prefs.remove(_savedZipCodeKey);
    } else {
      await prefs.setString(_savedZipCodeKey, trimmedZipCode);
    }
  }

  static Future<void> _clearPreference() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefersLiveLocationKey);
    await prefs.remove(_savedZipCodeKey);
  }

  static Future<List<Location>> geocodeSearchQuery(String query) async {
    final trimmedQuery = query.trim();
    final candidates = _geocodeCandidatesFor(trimmedQuery);
    final shouldInspectAllCandidates = kDebugMode && candidates.length > 1;
    Object? lastError;
    List<Location>? selectedLocations;
    String? selectedCandidate;

    debugPrint(
      '[LocationGeocode] rawQuery="$trimmedQuery" '
      'candidates="${candidates.join(' | ')}"',
    );

    for (final candidate in candidates) {
      try {
        debugPrint('[LocationGeocode] locationFromAddress("$candidate")');
        final locations = await locationFromAddress(candidate);
        debugPrint(
          '[LocationGeocode] candidate="$candidate" '
          'returned ${locations.length} result(s)',
        );
        await _debugPrintGeocodeResults(candidate, locations);
        if (locations.isNotEmpty) {
          selectedLocations ??= locations;
          selectedCandidate ??= candidate;
          if (!shouldInspectAllCandidates) {
            debugPrint(
              '[LocationGeocode] usingCandidate="$candidate" '
              'lat=${locations.first.latitude}, '
              'lng=${locations.first.longitude}',
            );
            return locations;
          }
        }
      } catch (error) {
        debugPrint('[LocationGeocode] candidate="$candidate" error="$error"');
        lastError = error;
      }
    }

    if (selectedLocations != null) {
      debugPrint(
        '[LocationGeocode] usingCandidate="$selectedCandidate" '
        'lat=${selectedLocations.first.latitude}, '
        'lng=${selectedLocations.first.longitude}',
      );
      return selectedLocations;
    }

    if (lastError != null) {
      throw lastError;
    }
    return const <Location>[];
  }

  static bool isFiveDigitZipSearch(String query) {
    return _fiveDigitZipPattern.hasMatch(query.trim());
  }

  static List<String> _geocodeCandidatesFor(String query) {
    if (!kIsWeb && Platform.isIOS && _fiveDigitZipPattern.hasMatch(query)) {
      return <String>['$query, USA', query];
    }
    return <String>[query];
  }

  static Future<void> _debugPrintGeocodeResults(
    String candidate,
    List<Location> locations,
  ) async {
    if (!kDebugMode) return;

    for (var index = 0; index < locations.length; index += 1) {
      final location = locations[index];
      debugPrint(
        '[LocationGeocode] candidate="$candidate" result[$index] '
        'lat=${location.latitude}, lng=${location.longitude}',
      );

      try {
        final placemarks = await placemarkFromCoordinates(
          location.latitude,
          location.longitude,
        );
        if (placemarks.isEmpty) {
          debugPrint(
            '[LocationGeocode] candidate="$candidate" result[$index] '
            'reverse=none',
          );
          continue;
        }

        final placemark = placemarks.first;
        debugPrint(
          '[LocationGeocode] candidate="$candidate" result[$index] '
          'reverse locality="${placemark.locality}" '
          'state="${placemark.administrativeArea}" '
          'postalCode="${placemark.postalCode}" '
          'country="${placemark.country}"',
        );
      } catch (error) {
        debugPrint(
          '[LocationGeocode] candidate="$candidate" result[$index] '
          'reverseError="$error"',
        );
      }
    }
  }
}
