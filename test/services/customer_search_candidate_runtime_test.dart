import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_runtime.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/customer_bitescore_search_service.dart';
import 'package:coupon_app/services/customer_search_candidate_runtime.dart';
import 'package:flutter_test/flutter_test.dart';

final class _Preferences implements CustomerBiteSaverGuestUsagePreferences {
  final values = <String, String>{};
  @override
  Future<String?> getString(String key) async => values[key];
  @override
  Future<void> setString(String key, String value) async => values[key] = value;
  @override
  Future<void> remove(String key) async => values.remove(key);
}

Map<String, dynamic> _restaurant(String id) => {
  'customerPublicProjectionVersion':
      'bitestar.bitescore-customer-public-restaurant.v1',
  'source': 'biteScore',
  'entityType': 'restaurant',
  'sourceDocumentId': id,
  'publicVisible': true,
  'displayName': 'Candidate Kitchen',
  'normalizedName': 'candidate kitchen',
  'streetAddress': '1 Main St',
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'latitude': 28.5,
  'longitude': -81.3,
  'isClaimed': false,
  'cuisineTags': <String>[],
};

Map<String, dynamic> _scoreResponse({List<Object?> items = const []}) => {
  'schemaVersion': 1,
  'sessionId': 'candidate-score-session',
  'queryFingerprint': 'a' * 64,
  'state': 'ready',
  'scannedCount': 1,
  'items': items,
  'nextCursor': null,
  'hasMore': false,
};

void main() {
  tearDown(() {
    CustomerSearchCandidateRuntime.testEnabled = null;
    CustomerBiteSaverRuntime.testEnabled = null;
    CustomerBiteScoreRuntime.testEnabled = null;
  });

  test(
    'candidate is off by default and enables existing consumers explicitly',
    () {
      expect(CustomerSearchCandidateRuntime.isEnabled, isFalse);
      expect(CustomerBiteSaverRuntime.isEnabled, isFalse);
      expect(CustomerBiteScoreRuntime.isEnabled, isFalse);
      CustomerSearchCandidateRuntime.testEnabled = true;
      expect(CustomerBiteSaverRuntime.isEnabled, isTrue);
      expect(CustomerBiteScoreRuntime.isEnabled, isTrue);
    },
  );

  test(
    'candidate routing preserves profile, menu, saved and redemption calls',
    () {
      for (final operation in [
        'getCustomerBiteSaverMenuPage',
        'getCustomerBiteSaverSavedPage',
        'getCustomerBiteSaverFavoriteStates',
        'startCustomerBiteSaverOfferRedemption',
        'validateCustomerBiteSaverOfferRedemptionStart',
        'getCustomerBiteScoreDetail',
        'startCustomerBiteScoreProfileList',
        'getCustomerBiteScoreSuggestions',
      ]) {
        expect(
          CustomerSearchCandidateRuntime.endpoint(operation, {}, enabled: true),
          operation,
        );
      }
      for (final kind in [
        'publicProfile',
        'publicProfileUse',
        'restaurantMedia',
      ]) {
        expect(
          CustomerSearchCandidateRuntime.endpoint(
            'getCustomerBiteSaverSearchPage',
            {'kind': kind},
            enabled: true,
          ),
          'getCustomerBiteSaverSearchPage',
        );
      }
    },
  );

  for (final enabled in [false, true]) {
    test(
      'BiteScore and Finder controller consume selected native-shaped results ($enabled)',
      () async {
        CustomerSearchCandidateRuntime.testEnabled = enabled;
        final calls = <String>[];
        final api = CustomerBiteScoreSearchService(
          transport: (name, request) async {
            calls.add(name);
            if (name.startsWith('start')) return _scoreResponse();
            return _scoreResponse(items: [_restaurant('exact-catalog-id')]);
          },
        );
        // A service keeps its selected backend for its session lifetime.
        CustomerSearchCandidateRuntime.testEnabled = !enabled;
        for (final finder in [false, true]) {
          final controller = CustomerBiteScoreSearchController(
            api: api,
            actorKey: () => 'guest',
            criteria: {
              'kind': 'restaurant',
              if (finder) 'finder': {'state': 'FL', 'location': 'Orlando'},
            },
          );
          await controller.updateCriteria(controller.criteria);
          expect(controller.error, isNull);
          expect(controller.restaurants.single.id, 'exact-catalog-id');
          expect(controller.restaurants.single.name, 'Candidate Kitchen');
          controller.dispose();
        }
        final suffix = enabled ? 'V2' : '';
        expect(calls, [
          'startCustomerBiteScoreSearch$suffix',
          'getCustomerBiteScoreSearchPage$suffix',
          'startCustomerBiteScoreSearch$suffix',
          'getCustomerBiteScoreSearchPage$suffix',
        ]);
      },
    );

    test(
      'BiteSaver coordinator delivers a useful page through selected service ($enabled)',
      () async {
        CustomerSearchCandidateRuntime.testEnabled = enabled;
        final fixture =
            jsonDecode(
                  File(
                    'test/fixtures/customer_bitesaver_client_boundary_v1.json',
                  ).readAsStringSync(),
                )
                as Map;
        final responses = (fixture['signed'] as Map)['responses'] as Map;
        final calls = <String>[];
        final api = CustomerBiteSaverService(
          transport: (name, request) async {
            calls.add(name);
            if (name.startsWith('startCustomerBiteSaverSearch')) {
              return {...responses['start'] as Map, 'state': 'ready'};
            }
            if (name.startsWith('getCustomerBiteSaverSearchPage')) {
              return responses['restaurantPage'];
            }
            if (name == 'getCustomerBiteSaverFavoriteStates') {
              return {
                'schemaVersion': 1,
                'states': [
                  for (final id in [
                    ...request['restaurantIds']! as List,
                    ...request['offerIds']! as List,
                  ])
                    {'id': id, 'state': 'notFavorite'},
                ],
              };
            }
            throw StateError('Unexpected endpoint $name');
          },
        );
        const auth = CustomerBiteSaverAuthSnapshot.signed('candidate-user');
        final now = DateTime.fromMillisecondsSinceEpoch(
          1789225201000,
          isUtc: true,
        );
        final coordinator = CustomerBiteSaverSearchCoordinator(
          api: api,
          guestUsageStore: CustomerBiteSaverGuestUsageStore(
            guestDeviceId: 'candidate-device',
            preferences: _Preferences(),
            clock: () => now,
          ),
          clientInstanceId: 'candidate-client-0001',
          initialAuth: auth,
          authSnapshotProvider: () => auth,
          clock: () => now,
        );
        await coordinator.startSearch(
          CustomerBiteSaverSearchCriteria(
            latitude: 28.5383,
            longitude: -81.3792,
            radiusMiles: 10,
            locationMode: CustomerBiteSaverLocationMode.current,
            typedLocation: null,
            searchText: '',
            timeZone: 'America/New_York',
            utcOffsetMinutes: -240,
          ),
        );
        expect(coordinator.status, CustomerBiteSaverCoordinatorStatus.ready);
        expect(coordinator.restaurants, isNotEmpty);
        expect(coordinator.restaurants.first.offers, isNotEmpty);
        final suffix = enabled ? 'V2' : '';
        expect(calls, [
          'startCustomerBiteSaverSearch$suffix',
          'getCustomerBiteSaverSearchPage$suffix',
          'getCustomerBiteSaverFavoriteStates',
        ]);
        coordinator.dispose();
      },
    );
  }
}
