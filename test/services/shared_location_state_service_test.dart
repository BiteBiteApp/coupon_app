import 'dart:async';

import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

Location location(double latitude, double longitude) => Location(
  latitude: latitude,
  longitude: longitude,
  timestamp: DateTime.utc(2026, 9, 7),
);

Position position(double latitude, double longitude) => Position(
  latitude: latitude,
  longitude: longitude,
  timestamp: DateTime.utc(2026, 9, 7),
  accuracy: 1,
  altitude: 0,
  altitudeAccuracy: 0,
  heading: 0,
  headingAccuracy: 0,
  speed: 0,
  speedAccuracy: 0,
);

Future<({String? city, String? zip})> noReverseLookup(Position _) async {
  return (city: null, zip: null);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedLocationStateService.resetForTesting();
    SharedPreferences.setMockInitialValues(const <String, Object>{});
  });

  tearDown(() async {
    await SharedLocationStateService.waitForPendingPersistence();
    SharedLocationStateService.resetForTesting();
  });

  test('saved ZIP restore cannot overwrite a newer typed selection', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'prefers_live_location': false,
      'saved_zip_code': 'old city',
    });
    final restoreStarted = Completer<void>();
    final restoredLocations = Completer<List<Location>>();

    final restore = SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationGeocoder: (query) {
        expect(query, 'old city');
        restoreStarted.complete();
        return restoredLocations.future;
      },
    );
    await restoreStarted.future;

    final newerTypedOperation =
        SharedLocationStateService.beginLocationOperation();
    await SharedLocationStateService.saveTypedLocationForOperation(
      newerTypedOperation,
      latitude: 42.1,
      longitude: -72.5,
      label: 'new city',
      searchText: 'new city',
    );
    restoredLocations.complete(<Location>[location(28.5, -81.3)]);
    final result = await restore;

    expect(result.state.typedLabel, 'new city');
    expect(SharedLocationStateService.state.typedLabel, 'new city');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('prefers_live_location'), isFalse);
    expect(prefs.getString('saved_zip_code'), 'new city');
  });

  test('saved GPS restore cannot overwrite a clear action', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'prefers_live_location': true,
    });
    final positionRequested = Completer<void>();
    final restoredPosition = Completer<Position>();

    final restore = SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationServiceEnabledLoader: () async => true,
      locationPermissionLoader: () async => LocationPermission.always,
      currentPositionLoader: () {
        positionRequested.complete();
        return restoredPosition.future;
      },
    );
    await positionRequested.future;

    final clearOperation = SharedLocationStateService.beginLocationOperation();
    await SharedLocationStateService.clearForOperation(clearOperation);
    restoredPosition.complete(position(28.5, -81.3));
    await restore;

    expect(SharedLocationStateService.state.usingCurrentLocation, isFalse);
    expect(SharedLocationStateService.state.currentPosition, isNull);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.containsKey('prefers_live_location'), isFalse);
    expect(prefs.containsKey('saved_zip_code'), isFalse);
  });

  test(
    'accepted current persistence survives a later typed failure that preserves current mode',
    () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'prefers_live_location': false,
        'saved_zip_code': 'old city',
      });
      final currentOperation =
          SharedLocationStateService.beginLocationOperation();
      await SharedLocationStateService.saveCurrentLocationForOperation(
        currentOperation,
        position: position(42.36, -71.06),
        searchText: '',
      );

      final typedOperation =
          SharedLocationStateService.beginLocationOperation();
      expect(
        await SharedLocationStateService.clearTypedLocationForOperation(
          typedOperation,
        ),
        isTrue,
      );
      await SharedLocationStateService.waitForPendingPersistence();

      expect(SharedLocationStateService.state.usingCurrentLocation, isTrue);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('prefers_live_location'), isTrue);
      expect(prefs.containsKey('saved_zip_code'), isFalse);
    },
  );

  test(
    'blocked accepted current write survives ownership invalidation and reaches disk',
    () async {
      final persistenceBarrier = Completer<void>();
      SharedLocationStateService.setPreferenceMutationBarrierForTesting(
        persistenceBarrier.future,
      );

      final earlierTypedOperation =
          SharedLocationStateService.beginLocationOperation();
      final earlierTypedSave =
          SharedLocationStateService.saveTypedLocationForOperation(
            earlierTypedOperation,
            latitude: 28.5,
            longitude: -81.3,
            label: 'old city',
            searchText: 'old city',
          );
      final acceptedCurrentOperation =
          SharedLocationStateService.beginLocationOperation();
      final acceptedCurrentSave =
          SharedLocationStateService.saveCurrentLocationForOperation(
            acceptedCurrentOperation,
            position: position(42.36, -71.06),
            searchText: '',
          );

      final failedTypedOperation =
          SharedLocationStateService.beginLocationOperation();
      final failedTypedClear =
          SharedLocationStateService.clearTypedLocationForOperation(
            failedTypedOperation,
          );
      expect(SharedLocationStateService.state.usingCurrentLocation, isTrue);

      persistenceBarrier.complete();
      expect(await earlierTypedSave, isTrue);
      expect(await acceptedCurrentSave, isTrue);
      expect(await failedTypedClear, isTrue);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('prefers_live_location'), isTrue);
      expect(prefs.containsKey('saved_zip_code'), isFalse);
      expect(SharedLocationStateService.state.usingCurrentLocation, isTrue);
    },
  );

  test(
    'accepted preference mutations serialize so the latest state wins',
    () async {
      final typedOperation =
          SharedLocationStateService.beginLocationOperation();
      await SharedLocationStateService.saveTypedLocationForOperation(
        typedOperation,
        latitude: 42.1,
        longitude: -72.5,
        label: 'typed city',
        searchText: 'typed city',
      );
      final currentOperation =
          SharedLocationStateService.beginLocationOperation();
      await SharedLocationStateService.saveCurrentLocationForOperation(
        currentOperation,
        position: position(42.36, -71.06),
        searchText: '',
      );
      final clearOperation =
          SharedLocationStateService.beginLocationOperation();
      await SharedLocationStateService.clearForOperation(clearOperation);
      await SharedLocationStateService.waitForPendingPersistence();

      expect(SharedLocationStateService.state.usingCurrentLocation, isFalse);
      expect(
        SharedLocationStateService.state.usingTypedSearchLocation,
        isFalse,
      );
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('prefers_live_location'), isFalse);
      expect(prefs.containsKey('saved_zip_code'), isFalse);
    },
  );

  test(
    'non-mutating invalidation cannot skip an accepted durable save',
    () async {
      final acceptedOperation =
          SharedLocationStateService.beginLocationOperation();
      final acceptedSave =
          SharedLocationStateService.saveTypedLocationForOperation(
            acceptedOperation,
            latitude: 42.1,
            longitude: -72.5,
            label: 'accepted city',
            searchText: 'accepted city',
          );

      SharedLocationStateService.beginLocationOperation();
      expect(await acceptedSave, isTrue);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('prefers_live_location'), isFalse);
      expect(prefs.getString('saved_zip_code'), 'accepted city');
    },
  );

  test(
    'accepted typed clear survives invalidation and cannot resurrect',
    () async {
      final seededOperation =
          SharedLocationStateService.beginLocationOperation();
      await SharedLocationStateService.saveTypedLocationForOperation(
        seededOperation,
        latitude: 28.5,
        longitude: -81.3,
        label: 'old city',
        searchText: 'old city',
      );

      final persistenceBarrier = Completer<void>();
      SharedLocationStateService.setPreferenceMutationBarrierForTesting(
        persistenceBarrier.future,
      );
      final clearOperation =
          SharedLocationStateService.beginLocationOperation();
      final acceptedClear =
          SharedLocationStateService.clearTypedLocationForOperation(
            clearOperation,
          );
      SharedLocationStateService.beginLocationOperation();

      persistenceBarrier.complete();
      expect(await acceptedClear, isTrue);
      final clearedPrefs = await SharedPreferences.getInstance();
      expect(clearedPrefs.containsKey('prefers_live_location'), isFalse);
      expect(clearedPrefs.containsKey('saved_zip_code'), isFalse);

      SharedLocationStateService.resetForTesting();
      var geocoderCalled = false;
      final restored = await SharedLocationStateService.restoreOnLaunch(
        reverseLookupLocation: noReverseLookup,
        locationGeocoder: (_) async {
          geocoderCalled = true;
          return <Location>[location(28.5, -81.3)];
        },
      );
      expect(geocoderCalled, isFalse);
      expect(restored.state.usingTypedSearchLocation, isFalse);
      expect(restored.state.searchText, isEmpty);
    },
  );

  test('cancelled pending restore can be retried by a later mount', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'prefers_live_location': false,
      'saved_zip_code': 'saved city',
    });
    final firstStarted = Completer<void>();
    final firstLocations = Completer<List<Location>>();
    final firstRestoreLease = SharedLocationStateService.acquireRestoreLease();
    final firstRestore = SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationGeocoder: (_) {
        firstStarted.complete();
        return firstLocations.future;
      },
    );
    await firstStarted.future;

    SharedLocationStateService.releaseRestoreLease(
      firstRestoreLease,
      cancelIfLastOwner: true,
    );
    final secondRestore = await SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationGeocoder: (_) async => <Location>[location(42.1, -72.5)],
    );
    firstLocations.complete(<Location>[location(28.5, -81.3)]);
    await firstRestore;

    expect(secondRestore.state.typedLabel, 'saved city');
    expect(secondRestore.state.typedLatitude, 42.1);
    expect(SharedLocationStateService.state.typedLatitude, 42.1);
  });

  test('one restore owner cannot cancel a co-owner replacement', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'prefers_live_location': false,
      'saved_zip_code': 'saved city',
    });
    final restoredLocations = Completer<List<Location>>();
    final outgoingLease = SharedLocationStateService.acquireRestoreLease();
    final outgoingRestore = SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationGeocoder: (_) => restoredLocations.future,
    );
    final incomingLease = SharedLocationStateService.acquireRestoreLease();
    final incomingRestore = SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationGeocoder: (_) => restoredLocations.future,
    );
    expect(identical(incomingRestore, outgoingRestore), isTrue);

    SharedLocationStateService.releaseRestoreLease(
      outgoingLease,
      cancelIfLastOwner: true,
    );
    expect(
      SharedLocationStateService.ownsLocationOperation(
        incomingLease.operationToken,
      ),
      isTrue,
    );

    restoredLocations.complete(<Location>[location(42.1, -72.5)]);
    final result = await incomingRestore;
    SharedLocationStateService.releaseRestoreLease(
      incomingLease,
      cancelIfLastOwner: false,
    );

    expect(result.state.typedLabel, 'saved city');
    expect(SharedLocationStateService.state.typedLatitude, 42.1);
  });

  test('an old owner cannot cancel a newer screen operation', () {
    final oldOwner = SharedLocationStateService.acquireRestoreLease();
    final newerOperation = SharedLocationStateService.beginLocationOperation();

    SharedLocationStateService.releaseRestoreLease(
      oldOwner,
      cancelIfLastOwner: true,
    );

    expect(
      SharedLocationStateService.ownsLocationOperation(newerOperation),
      isTrue,
    );
  });

  test('stale typed failure cannot clear a newer current selection', () async {
    final staleTypedOperation =
        SharedLocationStateService.beginLocationOperation();
    final currentOperation =
        SharedLocationStateService.beginLocationOperation();
    await SharedLocationStateService.saveCurrentLocationForOperation(
      currentOperation,
      position: position(42.36, -71.06),
      searchText: '',
    );

    expect(
      await SharedLocationStateService.clearTypedLocationForOperation(
        staleTypedOperation,
      ),
      isFalse,
    );
    await SharedLocationStateService.waitForPendingPersistence();

    expect(SharedLocationStateService.state.usingCurrentLocation, isTrue);
    expect(SharedLocationStateService.state.currentPosition?.latitude, 42.36);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('prefers_live_location'), isTrue);
  });

  test('stale restoration failure cannot clear a newer success', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'prefers_live_location': false,
      'saved_zip_code': 'old city',
    });
    final restoreStarted = Completer<void>();
    final restoredLocations = Completer<List<Location>>();
    final restore = SharedLocationStateService.restoreOnLaunch(
      reverseLookupLocation: noReverseLookup,
      locationGeocoder: (_) {
        restoreStarted.complete();
        return restoredLocations.future;
      },
    );
    await restoreStarted.future;

    final newerTypedOperation =
        SharedLocationStateService.beginLocationOperation();
    await SharedLocationStateService.saveTypedLocationForOperation(
      newerTypedOperation,
      latitude: 42.1,
      longitude: -72.5,
      label: 'new city',
      searchText: 'new city',
    );
    restoredLocations.completeError(StateError('old restore failed'));
    final result = await restore;

    expect(result.message, isNull);
    expect(result.state.typedLabel, 'new city');
    expect(SharedLocationStateService.state.typedLabel, 'new city');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('saved_zip_code'), 'new city');
  });
}
