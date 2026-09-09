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

class SharedLocationOperationToken {
  final int _revision;

  const SharedLocationOperationToken._(this._revision);
}

class SharedLocationRestoreLease {
  final int _id;
  final SharedLocationOperationToken operationToken;
  bool _released = false;

  SharedLocationRestoreLease._({required int id, required this.operationToken})
    : _id = id;
}

class SharedLocationStateService {
  static const String _prefersLiveLocationKey = 'prefers_live_location';
  static const String _savedZipCodeKey = 'saved_zip_code';
  static final RegExp _fiveDigitZipPattern = RegExp(r'^\d{5}$');

  static SharedLocationState _state = const SharedLocationState();
  static Future<SharedLocationRestoreResult>? _restoreFuture;
  static bool _hasRestoredFromStorage = false;
  static int _operationRevision = 0;
  static int _nextRestoreLeaseId = 0;
  static final Map<int, int> _activeRestoreLeaseRevisions = <int, int>{};
  static int _persistenceEpoch = 0;
  static Future<void> _preferenceMutationQueue = Future<void>.value();
  static Future<void>? _preferenceMutationBarrierForTesting;

  static SharedLocationState get state => _state;

  static SharedLocationOperationToken beginLocationOperation() {
    _operationRevision += 1;
    _hasRestoredFromStorage = true;
    return SharedLocationOperationToken._(_operationRevision);
  }

  static SharedLocationOperationToken currentLocationOperationToken() {
    return SharedLocationOperationToken._(_operationRevision);
  }

  static SharedLocationRestoreLease acquireRestoreLease() {
    final lease = SharedLocationRestoreLease._(
      id: ++_nextRestoreLeaseId,
      operationToken: currentLocationOperationToken(),
    );
    _activeRestoreLeaseRevisions[lease._id] = lease.operationToken._revision;
    return lease;
  }

  static void releaseRestoreLease(
    SharedLocationRestoreLease lease, {
    required bool cancelIfLastOwner,
  }) {
    if (lease._released) {
      return;
    }
    lease._released = true;
    final releasedRevision = _activeRestoreLeaseRevisions.remove(lease._id);
    if (releasedRevision == null || !cancelIfLastOwner) {
      return;
    }

    final hasAnotherOwner = _activeRestoreLeaseRevisions.values.any(
      (revision) => revision == releasedRevision,
    );
    if (!hasAnotherOwner) {
      cancelLocationOperationIfCurrent(lease.operationToken);
    }
  }

  static bool ownsLocationOperation(SharedLocationOperationToken token) {
    return token._revision == _operationRevision;
  }

  static void cancelLocationOperationIfCurrent(
    SharedLocationOperationToken token,
  ) {
    if (!ownsLocationOperation(token)) {
      return;
    }
    final hasRestoreOwner = _activeRestoreLeaseRevisions.values.any(
      (revision) => revision == token._revision,
    );
    if (hasRestoreOwner) {
      return;
    }
    _operationRevision += 1;
    _restoreFuture = null;
  }

  static Future<SharedLocationRestoreResult> restoreOnLaunch({
    required Future<({String? city, String? zip})> Function(Position position)
    reverseLookupLocation,
    @visibleForTesting
    Future<List<Location>> Function(String query)? locationGeocoder,
    @visibleForTesting Future<bool> Function()? locationServiceEnabledLoader,
    @visibleForTesting
    Future<LocationPermission> Function()? locationPermissionLoader,
    @visibleForTesting Future<Position> Function()? currentPositionLoader,
  }) {
    if (_hasRestoredFromStorage) {
      return Future.value(SharedLocationRestoreResult(state: _state));
    }

    if (_restoreFuture != null) {
      return _restoreFuture!;
    }

    final restoreRevision = _operationRevision;
    final restoreFuture = _restoreOnLaunchInternal(
      restoreRevision: restoreRevision,
      reverseLookupLocation: reverseLookupLocation,
      locationGeocoder: locationGeocoder,
      locationServiceEnabledLoader: locationServiceEnabledLoader,
      locationPermissionLoader: locationPermissionLoader,
      currentPositionLoader: currentPositionLoader,
    );
    _restoreFuture = restoreFuture;
    unawaited(
      restoreFuture.then<void>(
        (_) {
          if (identical(_restoreFuture, restoreFuture)) {
            _restoreFuture = null;
          }
        },
        onError: (Object _, StackTrace stackTrace) {
          if (identical(_restoreFuture, restoreFuture)) {
            _restoreFuture = null;
          }
        },
      ),
    );
    return restoreFuture;
  }

  static Future<SharedLocationRestoreResult> _restoreOnLaunchInternal({
    required int restoreRevision,
    required Future<({String? city, String? zip})> Function(Position position)
    reverseLookupLocation,
    Future<List<Location>> Function(String query)? locationGeocoder,
    Future<bool> Function()? locationServiceEnabledLoader,
    Future<LocationPermission> Function()? locationPermissionLoader,
    Future<Position> Function()? currentPositionLoader,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final prefersLiveLocation = prefs.getBool(_prefersLiveLocationKey) ?? false;
    final savedZipCode = (prefs.getString(_savedZipCodeKey) ?? '').trim();

    try {
      if (prefersLiveLocation) {
        final serviceEnabled =
            await (locationServiceEnabledLoader?.call() ??
                Geolocator.isLocationServiceEnabled());
        final permission =
            await (locationPermissionLoader?.call() ??
                Geolocator.checkPermission());

        if (!serviceEnabled ||
            permission == LocationPermission.denied ||
            permission == LocationPermission.deniedForever) {
          return _publishRestoreIfCurrent(
            restoreRevision,
            const SharedLocationRestoreResult(
              state: SharedLocationState(),
              message: 'Enable location to see nearby results.',
            ),
          );
        }

        final position =
            await (currentPositionLoader?.call() ??
                Geolocator.getCurrentPosition());
        final locationDetails = await reverseLookupLocation(position);
        final searchText = locationDetails.city?.isNotEmpty == true
            ? locationDetails.city!
            : (locationDetails.zip?.isNotEmpty == true
                  ? locationDetails.zip!
                  : '');

        return _publishRestoreIfCurrent(
          restoreRevision,
          SharedLocationRestoreResult(
            state: SharedLocationState(
              usingCurrentLocation: true,
              currentPosition: position,
              searchText: searchText.trim(),
              detectedCity: locationDetails.city?.trim(),
              detectedZip: locationDetails.zip?.trim(),
            ),
          ),
        );
      }

      if (savedZipCode.isNotEmpty) {
        SharedLocationState restoredState = SharedLocationState(
          searchText: savedZipCode,
        );

        try {
          final locations =
              await (locationGeocoder?.call(savedZipCode) ??
                  geocodeSearchQuery(savedZipCode));
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

        return _publishRestoreIfCurrent(
          restoreRevision,
          SharedLocationRestoreResult(state: restoredState),
        );
      }

      return _publishRestoreIfCurrent(
        restoreRevision,
        const SharedLocationRestoreResult(state: SharedLocationState()),
      );
    } catch (_) {
      return _publishRestoreIfCurrent(
        restoreRevision,
        const SharedLocationRestoreResult(
          state: SharedLocationState(),
          message: 'Could not refresh your location right now.',
        ),
      );
    }
  }

  static SharedLocationRestoreResult _publishRestoreIfCurrent(
    int restoreRevision,
    SharedLocationRestoreResult result,
  ) {
    if (_hasRestoredFromStorage || restoreRevision != _operationRevision) {
      return SharedLocationRestoreResult(state: _state);
    }

    _state = result.state;
    _hasRestoredFromStorage = true;
    return result;
  }

  static void saveTypedLocation({
    required double latitude,
    required double longitude,
    required String label,
    required String searchText,
  }) {
    final token = beginLocationOperation();
    unawaited(
      saveTypedLocationForOperation(
        token,
        latitude: latitude,
        longitude: longitude,
        label: label,
        searchText: searchText,
      ),
    );
  }

  static Future<bool> saveTypedLocationForOperation(
    SharedLocationOperationToken token, {
    required double latitude,
    required double longitude,
    required String label,
    required String searchText,
  }) {
    if (!ownsLocationOperation(token)) {
      return Future<bool>.value(false);
    }

    _state = SharedLocationState(
      usingTypedSearchLocation: true,
      typedLatitude: latitude,
      typedLongitude: longitude,
      typedLabel: label.trim(),
      searchText: searchText.trim(),
    );
    _hasRestoredFromStorage = true;
    final persistence = _enqueuePreferenceMutation(
      (prefs) => _persistPreference(
        prefs,
        prefersLiveLocation: false,
        savedZipCode: searchText.trim(),
      ),
    );
    return persistence.then((_) => true);
  }

  static void saveCurrentLocation({
    required Position position,
    required String searchText,
    String? detectedCity,
    String? detectedZip,
  }) {
    final token = beginLocationOperation();
    unawaited(
      saveCurrentLocationForOperation(
        token,
        position: position,
        searchText: searchText,
        detectedCity: detectedCity,
        detectedZip: detectedZip,
      ),
    );
  }

  static Future<bool> saveCurrentLocationForOperation(
    SharedLocationOperationToken token, {
    required Position position,
    required String searchText,
    String? detectedCity,
    String? detectedZip,
  }) {
    if (!ownsLocationOperation(token)) {
      return Future<bool>.value(false);
    }

    _state = SharedLocationState(
      usingCurrentLocation: true,
      currentPosition: position,
      searchText: searchText.trim(),
      detectedCity: detectedCity?.trim(),
      detectedZip: detectedZip?.trim(),
    );
    _hasRestoredFromStorage = true;
    final persistence = _enqueuePreferenceMutation(
      (prefs) => _persistPreference(prefs, prefersLiveLocation: true),
    );
    return persistence.then((_) => true);
  }

  static void clear() {
    final token = beginLocationOperation();
    unawaited(clearForOperation(token));
  }

  static Future<bool> clearForOperation(SharedLocationOperationToken token) {
    if (!ownsLocationOperation(token)) {
      return Future<bool>.value(false);
    }

    _state = const SharedLocationState();
    _hasRestoredFromStorage = true;
    final persistence = _enqueuePreferenceMutation(_clearPreference);
    return persistence.then((_) => true);
  }

  static Future<bool> clearTypedLocationForOperation(
    SharedLocationOperationToken token,
  ) {
    if (!ownsLocationOperation(token)) {
      return Future<bool>.value(false);
    }

    if (_state.usingCurrentLocation) {
      return _preferenceMutationQueue.then((_) => true);
    }

    _state = const SharedLocationState();
    _hasRestoredFromStorage = true;
    final persistence = _enqueuePreferenceMutation(_clearTypedPreference);
    return persistence.then((_) => true);
  }

  static Future<void> _persistPreference(
    SharedPreferences prefs, {
    required bool prefersLiveLocation,
    String? savedZipCode,
  }) async {
    await prefs.setBool(_prefersLiveLocationKey, prefersLiveLocation);

    final trimmedZipCode = savedZipCode?.trim() ?? '';
    if (trimmedZipCode.isEmpty) {
      await prefs.remove(_savedZipCodeKey);
    } else {
      await prefs.setString(_savedZipCodeKey, trimmedZipCode);
    }
  }

  static Future<void> _clearPreference(SharedPreferences prefs) async {
    await prefs.remove(_prefersLiveLocationKey);
    await prefs.remove(_savedZipCodeKey);
  }

  static Future<void> _clearTypedPreference(SharedPreferences prefs) async {
    if (prefs.getBool(_prefersLiveLocationKey) == true) {
      return;
    }
    await _clearPreference(prefs);
  }

  static Future<void> _enqueuePreferenceMutation(
    Future<void> Function(SharedPreferences prefs) mutation,
  ) async {
    final persistenceEpoch = _persistenceEpoch;
    final testingBarrier = _preferenceMutationBarrierForTesting;
    final previousMutation = _preferenceMutationQueue;
    final queuedMutation = () async {
      try {
        await previousMutation;
      } catch (_) {}
      if (persistenceEpoch != _persistenceEpoch) {
        return;
      }
      if (testingBarrier != null) {
        await testingBarrier;
      }
      final prefs = await SharedPreferences.getInstance();
      if (persistenceEpoch != _persistenceEpoch) {
        return;
      }
      await mutation(prefs);
    }();
    _preferenceMutationQueue = queuedMutation;
    try {
      await queuedMutation;
    } catch (_) {}
  }

  @visibleForTesting
  static Future<void> waitForPendingPersistence() async {
    try {
      await _preferenceMutationQueue;
    } catch (_) {}
  }

  @visibleForTesting
  static void setPreferenceMutationBarrierForTesting(Future<void>? barrier) {
    _preferenceMutationBarrierForTesting = barrier;
  }

  @visibleForTesting
  static void resetForTesting() {
    _operationRevision += 1;
    _persistenceEpoch += 1;
    _state = const SharedLocationState();
    _restoreFuture = null;
    _hasRestoredFromStorage = false;
    _activeRestoreLeaseRevisions.clear();
    _preferenceMutationQueue = Future<void>.value();
    _preferenceMutationBarrierForTesting = null;
  }

  static Future<List<Location>> geocodeSearchQuery(String query) async {
    final trimmedQuery = query.trim();
    final candidates = _geocodeCandidatesFor(trimmedQuery);
    Object? lastError;

    for (final candidate in candidates) {
      try {
        final locations = await locationFromAddress(candidate);
        if (locations.isNotEmpty) {
          return locations;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError != null) {
      throw lastError;
    }
    return const <Location>[];
  }

  static List<String> _geocodeCandidatesFor(String query) {
    if (!kIsWeb && Platform.isIOS && _fiveDigitZipPattern.hasMatch(query)) {
      return <String>['$query, USA', query];
    }
    return <String>[query];
  }
}
