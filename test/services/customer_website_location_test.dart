@TestOn('browser')
library;

import 'dart:async';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_runtime.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/customer_bitesaver_favorite_service.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';

import 'package:fake_async/fake_async.dart';
import 'package:coupon_app/services/customer_browser_location_service.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _GuestAuth implements CustomerBiteSaverFavoriteAuth {
  @override
  CustomerBiteSaverFavoriteUser? get currentUser => null;
}

class _UnusedFavoriteStore extends Fake implements CustomerBiteSaverFavoriteStore {}
class _UnusedUsagePreferences extends Fake implements CustomerBiteSaverGuestUsagePreferences {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
  });
  tearDown(() async {
    await SharedLocationStateService.waitForPendingPersistence();
    SharedLocationStateService.resetForTesting();
  });
  test(
    'unavailable callable gives safe feedback without a false search center',
    () async {
      SharedLocationStateService.setBrowserResolverForTesting(
        CustomerBrowserLocationService(
          transport: (_) async => throw FirebaseFunctionsException(
            code: 'failed-precondition',
            message: 'private raw error',
          ),
        ),
      );
      for (final query in ['34461', 'Ocala, FL', 'not a real location']) {
        await expectLater(
          SharedLocationStateService.geocodeSearchQuery(query),
          throwsA(isA<CustomerLocationException>()),
        );
        expect(
          SharedLocationStateService.state.usingTypedSearchLocation,
          isFalse,
        );
      }
    },
  );
  test(
    'restored browser ZIP keeps text and makes zero paid calls until Search',
    () async {
      SharedPreferences.setMockInitialValues({'saved_zip_code': '32801'});
      var calls = 0;
      SharedLocationStateService.setBrowserResolverForTesting(
        CustomerBrowserLocationService(
          transport: (_) async {
            calls++;
            throw StateError('unexpected');
          },
        ),
      );
      final restored = await SharedLocationStateService.restoreOnLaunch(
        reverseLookupLocation: (_) async => (city: null, zip: null),
      );
      expect(restored.state.searchText, '32801');
      expect(restored.state.typedLatitude, isNull);
      expect(restored.state.usingTypedSearchLocation, isFalse);
      expect(restored.message, 'Press Search to use your saved city or ZIP.');
      expect(calls, 0);
    },
  );
  test(
    'injected resolver keeps accepted persistence, reuse and stale ownership fences',
    () async {
      final old = SharedLocationStateService.beginLocationOperation();
      final delayed = Completer<List<Location>>();
      final pending = SharedLocationStateService.geocodeSearchQuery(
        '32801',
        locationGeocoder: (_) => delayed.future,
      );
      final newer = SharedLocationStateService.beginLocationOperation();
      await SharedLocationStateService.saveTypedLocationForOperation(
        newer,
        latitude: 28.5,
        longitude: -81.3,
        label: 'Orlando, FL',
        searchText: 'Orlando, FL',
      );
      delayed.complete([
        Location(latitude: 30.3, longitude: -81.6, timestamp: DateTime.now()),
      ]);
      final result = await pending;
      expect(
        await SharedLocationStateService.saveTypedLocationForOperation(
          old,
          latitude: result.first.latitude,
          longitude: result.first.longitude,
          label: '32801',
          searchText: '32801',
        ),
        isFalse,
      );
      final reused = await SharedLocationStateService.geocodeSearchQuery(
        'Orlando, FL',
        reuseConfirmed: true,
        locationGeocoder: (_) async =>
            throw StateError('confirmed native seam must reuse'),
      );
      expect(reused.first.latitude, 28.5);
      SharedLocationStateService.resetForTesting();
      final restored = await SharedLocationStateService.restoreOnLaunch(
        reverseLookupLocation: (_) async => (city: null, zip: null),
        locationGeocoder: (query) async {
          expect(query, 'Orlando, FL');
          return reused;
        },
      );
      expect(restored.state.usingTypedSearchLocation, isTrue);
      expect(restored.state.searchText, 'Orlando, FL');
    },
  );
  for (final bFirst in [false, true]) {
    test(
      'A B A pending reuse keeps selected provenance (B first: $bFirst)',
      () async {
        final a = Completer<Object?>(), b = Completer<Object?>();
        var calls = 0;
        SharedLocationStateService.setBrowserResolverForTesting(
          CustomerBrowserLocationService(
            transport: (r) {
              calls++;
              return r['query'] == '34461' ? a.future : b.future;
            },
          ),
        );
        SharedLocationStateService.beginLocationOperation();
        final first = SharedLocationStateService.geocodeSearchQuery('34461');
        SharedLocationStateService.beginLocationOperation();
        final second = SharedLocationStateService.geocodeSearchQuery(
          'Ocala, FL',
        );
        final current = SharedLocationStateService.beginLocationOperation();
        final third = SharedLocationStateService.geocodeSearchQuery('34461');
        Map<String, Object> result(double lat) => {
          'schemaVersion': 1,
          'latitude': lat,
          'longitude': -82.14,
          'provider': 'google',
          'cacheSeconds': 86400,
        };
        if (bFirst) {
          b.complete(result(30));
          await second;
        }
        a.complete(result(29.18));
        final selected = (await third).first;
        await SharedLocationStateService.saveTypedLocationForOperation(
          current,
          latitude: selected.latitude,
          longitude: selected.longitude,
          label: '34461',
          searchText: '34461',
        );
        if (!bFirst) {
          b.complete(result(30));
          await second;
        }
        await first;
        expect(SharedLocationStateService.state.typedLatitude, 29.18);
        expect(SharedLocationStateService.usesGoogleSearchCenter, isTrue);
        expect(SharedLocationStateService.state.googleExpiresAt, isNotNull);
        expect(calls, 2);
      },
    );
  }
  test(
    'cached A pending B cached A preserves expiry and avoids a paid repeat',
    () async {
      final pendingB = Completer<Object?>();
      var calls = 0;
      Map<String, Object> result(double lat) => {
        'schemaVersion': 1,
        'latitude': lat,
        'longitude': -82.14,
        'provider': 'google',
        'cacheSeconds': 86400,
      };
      SharedLocationStateService.setBrowserResolverForTesting(
        CustomerBrowserLocationService(
          transport: (r) {
            calls++;
            return r['query'] == '34461'
                ? Future<Object?>.value(result(29.18))
                : pendingB.future;
          },
        ),
      );
      await SharedLocationStateService.geocodeSearchQuery('34461');
      final b = SharedLocationStateService.geocodeSearchQuery('Ocala, FL');
      final current = SharedLocationStateService.beginLocationOperation();
      final a = SharedLocationStateService.geocodeSearchQuery('34461');
      pendingB.complete(result(30));
      await b;
      final selected = (await a).first;
      await SharedLocationStateService.saveTypedLocationForOperation(
        current,
        latitude: selected.latitude,
        longitude: selected.longitude,
        label: '34461',
        searchText: '34461',
      );
      expect(SharedLocationStateService.usesGoogleSearchCenter, isTrue);
      await SharedLocationStateService.geocodeSearchQuery('34461');
      expect(calls, 2);
    },
  );
  test(
    'current device location restoration bypasses Google entirely',
    () async {
      var calls = 0;
      SharedLocationStateService.setBrowserResolverForTesting(
        CustomerBrowserLocationService(
          transport: (_) async {
            calls++;
            throw StateError('must not geocode GPS');
          },
        ),
      );
      SharedPreferences.setMockInitialValues({'prefers_live_location': true});
      final restored = await SharedLocationStateService.restoreOnLaunch(
        reverseLookupLocation: (_) async => (city: null, zip: null),
        locationServiceEnabledLoader: () async => true,
        locationPermissionLoader: () async => LocationPermission.whileInUse,
        currentPositionLoader: () async => Position(
          latitude: 29.18,
          longitude: -82.14,
          timestamp: DateTime.now(),
          accuracy: 1,
          altitude: 0,
          altitudeAccuracy: 0,
          heading: 0,
          headingAccuracy: 0,
          speed: 0,
          speedAccuracy: 0,
        ),
      );
      expect(restored.state.usingCurrentLocation, isTrue);
      expect(restored.state.currentPosition!.latitude, 29.18);
      expect(calls, 0);
      expect(SharedLocationStateService.usesGoogleSearchCenter, isFalse);
    },
  );
  test(
    'accepted Google center expires without another lookup or losing saved text',
    () async {
      var calls = 0;
      SharedLocationStateService.setBrowserResolverForTesting(
        CustomerBrowserLocationService(
          transport: (_) async {
            calls++;
            return {
              'schemaVersion': 1,
              'latitude': 29.18,
              'longitude': -82.14,
              'provider': 'google',
              'cacheSeconds': 86400,
            };
          },
        ),
      );
      final center = (await SharedLocationStateService.geocodeSearchQuery(
        '34461',
      )).first;
      final composition = CustomerBiteSaverComposition(
        api: CustomerBiteSaverService(transport: (_, _) async =>
            throw StateError('synthetic search unavailable')),
        favoriteService: CustomerBiteSaverFavoriteService(
          auth: _GuestAuth(), store: _UnusedFavoriteStore()),
        guestUsageStore: CustomerBiteSaverGuestUsageStore(
          guestDeviceId: 'location-retention-test',
          preferences: _UnusedUsagePreferences()),
        currentUser: () => null,
        userChanges: () => const Stream.empty(),
      );
      addTearDown(composition.dispose);
      // No Browse screen is mounted: the production composition owns retention.
      final criteria = CustomerBiteSaverSearchCriteria(
        latitude: center.latitude, longitude: center.longitude, radiusMiles: 15,
        locationMode: CustomerBiteSaverLocationMode.typed,
        typedLocation: CustomerBiteSaverZipLocation('34461'),
        searchText: '', timeZone: 'America/New_York', utcOffsetMinutes: -240,
      );
      await composition.browse.startSearch(criteria);
      expect(composition.browse.criteria, same(criteria));
      fakeAsync((async) {
        final token = SharedLocationStateService.beginLocationOperation();
        unawaited(
          SharedLocationStateService.saveTypedLocationForOperation(
            token,
            latitude: center.latitude,
            longitude: center.longitude,
            label: '34461',
            searchText: '34461',
          ),
        );
        expect(SharedLocationStateService.usesGoogleSearchCenter, isTrue);
        expect(composition.browse.criteria, same(criteria));
        async.elapse(const Duration(hours: 24, seconds: 1));
        expect(
          SharedLocationStateService.state.usingTypedSearchLocation,
          isFalse,
        );
        expect(SharedLocationStateService.state.searchText, '34461');
        expect(composition.browse.criteria, isNull);
        expect(calls, 1);
        SharedLocationStateService.resetForTesting();
        async.flushMicrotasks();
      });
      SharedLocationStateService.resetForTesting();
    },
  );
}
