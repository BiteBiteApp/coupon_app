import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
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

Future<void> settleLocationPersistence(WidgetTester tester) async {
  for (var i = 0; i < 4; i += 1) {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
  }
}

Future<void> settleLocationAction(
  WidgetTester tester,
  Future<void> action,
) async {
  var completed = false;
  Object? failure;
  StackTrace? failureStack;
  action.then(
    (_) {
      completed = true;
    },
    onError: (Object error, StackTrace stackTrace) {
      failure = error;
      failureStack = stackTrace;
      completed = true;
    },
  );

  for (var i = 0; i < 20 && !completed; i += 1) {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();
  }
  if (!completed) {
    fail('Location action did not settle.');
  }
  if (failure != null) {
    Error.throwWithStackTrace(failure!, failureStack!);
  }
}

Restaurant restaurant(String documentId) => Restaurant(
  documentId: documentId,
  name: 'Twin Cafe',
  distance: Restaurant.defaultDistanceLabel,
  city: 'Springfield',
  state: 'MA',
  zipCode: '01234',
  latitude: 42.1015,
  longitude: -72.5898,
  coupons: const <Coupon>[
    Coupon(
      id: 'coupon',
      restaurant: 'Twin Cafe',
      title: 'Public offer',
      distance: '',
      usageRule: 'Unlimited',
    ),
  ],
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedLocationStateService.resetForTesting();
    SharedPreferences.setMockInitialValues(const <String, Object>{});
  });

  Future<dynamic> pumpHome(
    WidgetTester tester, {
    Key? key,
    required Future<List<Location>> Function(String query) geocoder,
    Future<Position> Function()? currentPositionLoader,
    Future<SharedLocationRestoreResult> Function()? locationRestoreLoader,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1024, 1200);
    addTearDown(tester.view.reset);
    addTearDown(SharedLocationStateService.resetForTesting);

    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          key: key,
          approvedAccountsStream:
              const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
          restaurantLoader: () async => const <Restaurant>[],
          locationGeocoder: geocoder,
          currentPositionLoader: currentPositionLoader,
          locationRestoreLoader: locationRestoreLoader,
          initializeFirebaseBackedState: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    return tester.state(find.byType(HomeScreen));
  }

  testWidgets('older success cannot replace a newer successful center', (
    tester,
  ) async {
    final pending = <String, Completer<List<Location>>>{};
    final state = await pumpHome(
      tester,
      geocoder: (query) {
        return (pending[query] = Completer<List<Location>>()).future;
      },
    );

    state.searchController.text = 'old city';
    final oldSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();
    state.searchController.text = 'new city';
    final newSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();

    pending['new city']!.complete(<Location>[location(42.1, -72.5)]);
    await tester.pump();
    await settleLocationAction(tester, newSearch);
    pending['old city']!.complete(<Location>[location(28.5, -81.3)]);
    await tester.pump();
    await settleLocationAction(tester, oldSearch);

    expect(state.usingTypedSearchLocation, isTrue);
    expect(state.typedSearchCenter.label, 'new city');
    expect(state.typedSearchCenter.latitude, 42.1);
  });

  testWidgets('older failure cannot clear a newer successful center', (
    tester,
  ) async {
    final pending = <String, Completer<List<Location>>>{};
    final state = await pumpHome(
      tester,
      geocoder: (query) {
        return (pending[query] = Completer<List<Location>>()).future;
      },
    );

    state.searchController.text = 'old city';
    final oldSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();
    state.searchController.text = 'new city';
    final newSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();
    pending['new city']!.complete(<Location>[location(42.1, -72.5)]);
    await tester.pump();
    await settleLocationAction(tester, newSearch);
    pending['old city']!.completeError(StateError('older failure'));
    await tester.pump();
    await settleLocationAction(tester, oldSearch);

    expect(state.usingTypedSearchLocation, isTrue);
    expect(state.typedSearchCenter.label, 'new city');
    expect(
      state.locationStatusMessage,
      'Using "new city" as your search center.',
    );
    expect(SharedLocationStateService.state.typedLabel, 'new city');
  });

  testWidgets(
    'current typed failure clears shared persistence and cannot resurrect on remount',
    (tester) async {
      await tester.runAsync(() {
        final operation = SharedLocationStateService.beginLocationOperation();
        return SharedLocationStateService.saveTypedLocationForOperation(
          operation,
          latitude: 28.5,
          longitude: -81.3,
          label: 'old city',
          searchText: 'old city',
        );
      });

      final state = await pumpHome(
        tester,
        geocoder: (_) async => const <Location>[],
      );
      expect(state.typedSearchCenter.label, 'old city');

      state.searchController.text = 'missing city';
      await settleLocationAction(tester, state.runSearch(<Restaurant>[]));
      await tester.pumpAndSettle();
      await settleLocationPersistence(tester);

      expect(state.typedSearchCenter, isNull);
      expect(state.usingTypedSearchLocation, isFalse);
      expect(
        SharedLocationStateService.state.usingTypedSearchLocation,
        isFalse,
      );
      final prefs = (await tester.runAsync(SharedPreferences.getInstance))!;
      expect(prefs.containsKey('saved_zip_code'), isFalse);
      expect(prefs.containsKey('prefers_live_location'), isFalse);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      SharedLocationStateService.resetForTesting();
      final remountedState = await pumpHome(
        tester,
        geocoder: (_) async => const <Location>[],
      );

      expect(remountedState.typedSearchCenter, isNull);
      expect(remountedState.searchController.text, isEmpty);
      expect(find.text('Could not search that location.'), findsNothing);
    },
  );

  testWidgets('radius and query changes invalidate pending typed geocodes', (
    tester,
  ) async {
    final pending = <Completer<List<Location>>>[];
    final state = await pumpHome(
      tester,
      geocoder: (_) {
        final completer = Completer<List<Location>>();
        pending.add(completer);
        return completer.future;
      },
    );

    state.searchController.text = 'Springfield, MA';
    final radiusSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();
    final dropdown = tester.widget<DropdownButtonFormField<String>>(
      find.byType(DropdownButtonFormField<String>),
    );
    dropdown.onChanged!('20 miles');
    await tester.pump();
    pending[0].complete(<Location>[location(42.1, -72.5)]);
    await tester.pump();
    await settleLocationAction(tester, radiusSearch);
    expect(state.selectedRadius, '20 miles');
    expect(state.typedSearchCenter, isNull);

    final querySearch = state.runSearch(<Restaurant>[]);
    await tester.pump();
    state.searchController.text = 'Boston, MA';
    await tester.pump();
    pending[1].complete(<Location>[location(42.1, -72.5)]);
    await tester.pump();
    await settleLocationAction(tester, querySearch);
    expect(state.typedSearchCenter, isNull);
  });

  testWidgets(
    'clear and current-location selection invalidate pending geocodes',
    (tester) async {
      final pendingGeocodes = <Completer<List<Location>>>[];
      final pendingPosition = Completer<Position>();
      final state = await pumpHome(
        tester,
        geocoder: (_) {
          final completer = Completer<List<Location>>();
          pendingGeocodes.add(completer);
          return completer.future;
        },
        currentPositionLoader: () => pendingPosition.future,
      );

      state.searchController.text = 'Springfield, MA';
      final clearedSearch = state.runSearch(<Restaurant>[]);
      await tester.pump();
      state.clearSearch();
      pendingGeocodes[0].complete(<Location>[location(42.1, -72.5)]);
      await tester.pump();
      await settleLocationAction(tester, clearedSearch);
      expect(state.usingTypedSearchLocation, isFalse);
      expect(state.typedSearchCenter, isNull);
      expect(state.searchQuery, isEmpty);

      state.searchController.text = 'Boston, MA';
      final oldTypedSearch = state.runSearch(<Restaurant>[]);
      await tester.pump();
      final currentLocationSearch = state.useMyLocation(<Restaurant>[]);
      await tester.pump();
      pendingPosition.complete(position(42.36, -71.06));
      await tester.pump();
      await settleLocationAction(tester, currentLocationSearch);
      pendingGeocodes[1].complete(<Location>[location(28.5, -81.3)]);
      await tester.pump();
      await settleLocationAction(tester, oldTypedSearch);

      expect(state.usingCurrentLocation, isTrue);
      expect(state.usingTypedSearchLocation, isFalse);
      expect(state.typedSearchCenter, isNull);
      expect(SharedLocationStateService.state.usingCurrentLocation, isTrue);
      expect(SharedLocationStateService.state.currentPosition?.latitude, 42.36);
    },
  );

  testWidgets('pending typed geocode suppresses authoritative no-results', (
    tester,
  ) async {
    final pending = Completer<List<Location>>();
    final state = await pumpHome(tester, geocoder: (_) => pending.future);

    state.searchController.text = 'Far Away';
    final search = state.runSearch(<Restaurant>[]);
    await tester.pump();

    expect(find.text('Finding this location\u2026'), findsWidgets);
    expect(find.text('No nearby deals yet'), findsNothing);
    expect(find.text('Could not search that location.'), findsNothing);

    pending.complete(<Location>[location(0.1, 0.1)]);
    await settleLocationAction(tester, search);
    await tester.pump();

    expect(find.text('Finding this location\u2026'), findsNothing);
    expect(find.text('No nearby deals yet'), findsOneWidget);
  });

  testWidgets('stale completion cannot clear a newer pending typed search', (
    tester,
  ) async {
    final pending = <String, Completer<List<Location>>>{};
    final state = await pumpHome(
      tester,
      geocoder: (query) {
        return (pending[query] = Completer<List<Location>>()).future;
      },
    );

    state.searchController.text = 'old city';
    final oldSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();
    state.searchController.text = 'new city';
    final newSearch = state.runSearch(<Restaurant>[]);
    await tester.pump();

    pending['old city']!.completeError(StateError('stale failure'));
    await settleLocationAction(tester, oldSearch);
    await tester.pump();
    expect(state.isSearchingLocation, isTrue);
    expect(find.text('Finding this location\u2026'), findsWidgets);
    expect(find.text('Could not search that location.'), findsNothing);

    pending['new city']!.complete(<Location>[location(42.1, -72.5)]);
    await settleLocationAction(tester, newSearch);
    await tester.pump();
    expect(state.typedSearchCenter.label, 'new city');
  });

  testWidgets('startup restore loses to a newer typed success', (tester) async {
    final restoreStarted = Completer<void>();
    final pendingRestore = Completer<SharedLocationRestoreResult>();
    final state = await pumpHome(
      tester,
      geocoder: (_) async => <Location>[location(42.1, -72.5)],
      locationRestoreLoader: () {
        if (!restoreStarted.isCompleted) {
          restoreStarted.complete();
        }
        return pendingRestore.future;
      },
    );
    await restoreStarted.future;

    state.searchController.text = 'new city';
    await settleLocationAction(tester, state.runSearch(<Restaurant>[]));
    pendingRestore.complete(
      const SharedLocationRestoreResult(
        state: SharedLocationState(
          usingTypedSearchLocation: true,
          typedLatitude: 28.5,
          typedLongitude: -81.3,
          typedLabel: 'saved old city',
          searchText: 'saved old city',
        ),
      ),
    );
    await tester.pump();

    expect(state.typedSearchCenter.label, 'new city');
    expect(state.searchController.text, 'new city');
    expect(SharedLocationStateService.state.typedLabel, 'new city');
  });

  testWidgets('startup restore loses to current location selection', (
    tester,
  ) async {
    final restoreStarted = Completer<void>();
    final pendingRestore = Completer<SharedLocationRestoreResult>();
    final state = await pumpHome(
      tester,
      geocoder: (_) async => const <Location>[],
      currentPositionLoader: () async => position(42.36, -71.06),
      locationRestoreLoader: () {
        if (!restoreStarted.isCompleted) {
          restoreStarted.complete();
        }
        return pendingRestore.future;
      },
    );
    await restoreStarted.future;

    await settleLocationAction(tester, state.useMyLocation(<Restaurant>[]));
    pendingRestore.complete(
      const SharedLocationRestoreResult(
        state: SharedLocationState(
          usingTypedSearchLocation: true,
          typedLatitude: 28.5,
          typedLongitude: -81.3,
          typedLabel: 'saved old city',
          searchText: 'saved old city',
        ),
      ),
    );
    await tester.pump();

    expect(state.usingCurrentLocation, isTrue);
    expect(state.currentPosition.latitude, 42.36);
    expect(state.typedSearchCenter, isNull);
    expect(SharedLocationStateService.state.usingCurrentLocation, isTrue);
  });

  testWidgets('startup GPS restore loses to clear', (tester) async {
    final restoreStarted = Completer<void>();
    final pendingRestore = Completer<SharedLocationRestoreResult>();
    final state = await pumpHome(
      tester,
      geocoder: (_) async => const <Location>[],
      locationRestoreLoader: () {
        if (!restoreStarted.isCompleted) {
          restoreStarted.complete();
        }
        return pendingRestore.future;
      },
    );
    await restoreStarted.future;

    state.clearSearch();
    pendingRestore.complete(
      SharedLocationRestoreResult(
        state: SharedLocationState(
          usingCurrentLocation: true,
          currentPosition: position(28.5, -81.3),
        ),
      ),
    );
    await tester.pump();

    expect(state.usingCurrentLocation, isFalse);
    expect(state.currentPosition, isNull);
    expect(SharedLocationStateService.state.usingCurrentLocation, isFalse);
  });

  testWidgets('stale startup failure cannot replace a newer success', (
    tester,
  ) async {
    final restoreStarted = Completer<void>();
    final pendingRestore = Completer<SharedLocationRestoreResult>();
    final state = await pumpHome(
      tester,
      geocoder: (_) async => <Location>[location(42.1, -72.5)],
      locationRestoreLoader: () {
        if (!restoreStarted.isCompleted) {
          restoreStarted.complete();
        }
        return pendingRestore.future;
      },
    );
    await restoreStarted.future;

    state.searchController.text = 'new city';
    await settleLocationAction(tester, state.runSearch(<Restaurant>[]));
    pendingRestore.completeError(StateError('stale restore failure'));
    await tester.pump();

    expect(state.typedSearchCenter.label, 'new city');
    expect(
      state.locationStatusMessage,
      'Using "new city" as your search center.',
    );
  });

  testWidgets('query and radius changes invalidate startup restoration', (
    tester,
  ) async {
    final queryRestore = Completer<SharedLocationRestoreResult>();
    final queryRestoreStarted = Completer<void>();
    var state = await pumpHome(
      tester,
      geocoder: (_) async => const <Location>[],
      locationRestoreLoader: () {
        queryRestoreStarted.complete();
        return queryRestore.future;
      },
    );
    await queryRestoreStarted.future;
    state.searchController.text = 'new draft';
    queryRestore.complete(
      const SharedLocationRestoreResult(
        state: SharedLocationState(
          usingTypedSearchLocation: true,
          typedLatitude: 28.5,
          typedLongitude: -81.3,
          typedLabel: 'saved city',
          searchText: 'saved city',
        ),
      ),
    );
    await tester.pump();
    expect(state.searchController.text, 'new draft');
    expect(state.typedSearchCenter, isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    SharedLocationStateService.resetForTesting();
    SharedPreferences.setMockInitialValues(const <String, Object>{});
    final radiusRestore = Completer<SharedLocationRestoreResult>();
    final radiusRestoreStarted = Completer<void>();
    state = await pumpHome(
      tester,
      geocoder: (_) async => const <Location>[],
      locationRestoreLoader: () {
        radiusRestoreStarted.complete();
        return radiusRestore.future;
      },
    );
    await radiusRestoreStarted.future;
    final dropdown = tester.widget<DropdownButtonFormField<String>>(
      find.byType(DropdownButtonFormField<String>),
    );
    dropdown.onChanged!('20 miles');
    radiusRestore.complete(
      const SharedLocationRestoreResult(
        state: SharedLocationState(
          usingTypedSearchLocation: true,
          typedLatitude: 28.5,
          typedLongitude: -81.3,
          typedLabel: 'saved city',
          searchText: 'saved city',
        ),
      ),
    );
    await tester.pump();
    expect(state.selectedRadius, '20 miles');
    expect(state.typedSearchCenter, isNull);
  });

  testWidgets('disposal before startup restoration completes is safe', (
    tester,
  ) async {
    final restoreStarted = Completer<void>();
    final pendingRestore = Completer<SharedLocationRestoreResult>();
    await pumpHome(
      tester,
      geocoder: (_) async => const <Location>[],
      locationRestoreLoader: () {
        restoreStarted.complete();
        return pendingRestore.future;
      },
    );
    await restoreStarted.future;

    await tester.pumpWidget(const SizedBox.shrink());
    pendingRestore.complete(
      const SharedLocationRestoreResult(state: SharedLocationState()),
    );
    await tester.pump();

    expect(tester.takeException(), isNull);
  });

  testWidgets('replacement Home keeps its co-owned startup restore alive', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'prefers_live_location': false,
      'saved_zip_code': 'saved city',
    });
    final restoreStarted = Completer<void>();
    final pendingLocations = Completer<List<Location>>();
    var geocoderCalls = 0;

    Future<SharedLocationRestoreResult> restoreLocation() {
      return SharedLocationStateService.restoreOnLaunch(
        reverseLookupLocation: (_) async =>
            (city: null as String?, zip: null as String?),
        locationGeocoder: (_) {
          geocoderCalls += 1;
          if (!restoreStarted.isCompleted) {
            restoreStarted.complete();
          }
          return pendingLocations.future;
        },
      );
    }

    await pumpHome(
      tester,
      key: const ValueKey<String>('outgoing-home'),
      geocoder: (_) async => const <Location>[],
      locationRestoreLoader: restoreLocation,
    );
    await restoreStarted.future;

    final replacementState = await pumpHome(
      tester,
      key: const ValueKey<String>('incoming-home'),
      geocoder: (_) async => const <Location>[],
      locationRestoreLoader: restoreLocation,
    );
    expect(geocoderCalls, 1);

    pendingLocations.complete(<Location>[location(42.1, -72.5)]);
    await tester.pumpAndSettle();

    expect(geocoderCalls, 1);
    expect(replacementState.typedSearchCenter.label, 'saved city');
    expect(replacementState.searchController.text, 'saved city');
    expect(SharedLocationStateService.state.typedLabel, 'saved city');
  });

  testWidgets('failed geocoding shows a controlled error, not no results', (
    tester,
  ) async {
    final state = await pumpHome(
      tester,
      geocoder: (_) async => const <Location>[],
    );
    state.searchController.text = 'not a real place';
    await settleLocationAction(tester, state.runSearch(<Restaurant>[]));
    await tester.pumpAndSettle();

    expect(find.text('Could not search that location.'), findsOneWidget);
    expect(find.text('No nearby deals yet'), findsNothing);
    expect(state.typedSearchCenter, isNull);
    expect(state.usingTypedSearchLocation, isFalse);
  });

  testWidgets('Home ordering ends with canonical account document ID', (
    tester,
  ) async {
    final state = await pumpHome(
      tester,
      geocoder: (_) async => <Location>[location(42.1015, -72.5898)],
    );
    state.searchController.text = 'Springfield, MA';
    await settleLocationAction(tester, state.runSearch(<Restaurant>[]));
    await tester.pump();

    final filtered =
        state.filterRestaurants(<Restaurant>[
              restaurant('restaurant-b'),
              restaurant('restaurant-a'),
            ])
            as List<Restaurant>;

    expect(filtered.map((candidate) => candidate.accountDocumentId), <String>[
      'restaurant-a',
      'restaurant-b',
    ]);
    expect(
      filtered.every((candidate) => candidate.distance == 'Local'),
      isTrue,
    );
  });
}
