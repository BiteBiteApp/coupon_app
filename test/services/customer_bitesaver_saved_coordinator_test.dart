import 'dart:async';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_saved.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_device_use_service.dart';
import 'package:coupon_app/services/customer_bitesaver_saved_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/customer_bitesaver_device_use_fixture.dart';

String _restaurantId(int index) =>
    'bsr_${String.fromCharCode(65 + index % 26) * 42}${index % 10}';

String _offerId(int index) =>
    'bso_${String.fromCharCode(97 + index % 26) * 42}${index % 10}';

Map<String, Object?> _restaurant(String id, {String? name}) =>
    <String, Object?>{
      'restaurantId': id,
      'displayName': name ?? 'Restaurant $id',
      'streetAddress': '1 Public Way',
      'city': 'Orlando',
      'state': 'FL',
      'zipCode': '32801',
      'formattedAddress': '1 Public Way, Orlando, FL 32801',
      'imageUrl': null,
      'phone': null,
      'website': null,
      'businessHours': <Object?>[],
      'bio': null,
      'distanceMiles': 0.0,
      'isLocal': false,
      'catalogBindingAvailable': false,
      'offers': <Object?>[],
      'hasMoreOffers': false,
      'usableOfferCount': null,
      'offerCountState': 'unknown',
      'favoriteState': 'unknown',
    };

Map<String, Object?> _offer(
  String id, {
  String usageRule = 'Unlimited',
  String usagePolicy = 'unlimited',
  bool isProximityOnly = false,
}) => <String, Object?>{
  'offerId': id,
  'offerOccurrence': 'bsoc1.${'a' * 43}',
  'offerType': 'coupon',
  'title': 'Saved coupon',
  'details': 'Details',
  'couponCode': 'SAVE',
  'couponNumber': null,
  'usageRule': usageRule,
  'usagePolicy': usagePolicy,
  'availabilityMode': null,
  'daysOfWeek': <Object?>[],
  'allDay': null,
  'startTime': null,
  'endTime': null,
  'startAtMillis': null,
  'endAtMillis': null,
  'expiresAtMillis': null,
  'expiresText': null,
  'isProximityOnly': isProximityOnly,
  'proximityRadiusMiles': isProximityOnly ? 1.0 : null,
  'imageUrl': null,
  'sourceCreatedAtMillis': 1,
  'available': false,
  'availabilityReason': 'savedReadOnly',
  'redemptionPolicyLabel': 'Unlimited',
  'activeTimerExpiresAtMillis': null,
  'nextAvailableAtMillis': null,
  'usageState': 'unknown',
};

Map<String, Object?> _entry({
  required String restaurantId,
  String? offerId,
  bool available = true,
  String? accessToken,
  String usageRule = 'Unlimited',
  String usagePolicy = 'unlimited',
  bool isProximityOnly = false,
}) => <String, Object?>{
  'favoriteKind': offerId == null
      ? CustomerBiteSaverFavoriteContract.restaurantKind
      : CustomerBiteSaverFavoriteContract.couponKind,
  'restaurantId': restaurantId,
  'offerId': offerId,
  'availability': available ? 'available' : 'unavailable',
  'restaurant': available ? _restaurant(restaurantId) : null,
  'offer': available && offerId != null
      ? _offer(
          offerId,
          usageRule: usageRule,
          usagePolicy: usagePolicy,
          isProximityOnly: isProximityOnly,
        )
      : null,
  'accessToken': available
      ? accessToken ?? 'bssv1.test-token-$restaurantId-$offerId'
      : null,
};

CustomerBiteSaverSavedPageResult _page(
  CustomerBiteSaverSavedSection section,
  List<Map<String, Object?>> entries, {
  String? cursor,
}) => CustomerBiteSaverSavedPageResult.fromJson(<String, Object?>{
  'schemaVersion': 1,
  'section': section.name,
  'entries': entries,
  'nextCursor': cursor,
  'hasMore': cursor != null,
  'partial': false,
});

const int _evaluationAtMillis = 1_789_560_000_000;

final class _FakeSavedApi implements CustomerBiteSaverSavedApi {
  final List<CustomerBiteSaverSavedPageRequest> pageRequests =
      <CustomerBiteSaverSavedPageRequest>[];
  final List<CustomerBiteSaverSavedMenuPageRequest> menuRequests =
      <CustomerBiteSaverSavedMenuPageRequest>[];
  final Map<CustomerBiteSaverSavedSection, List<Object>> responses =
      <CustomerBiteSaverSavedSection, List<Object>>{
        CustomerBiteSaverSavedSection.restaurants: <Object>[],
        CustomerBiteSaverSavedSection.coupons: <Object>[],
      };
  final List<CustomerBiteSaverSavedRedemptionValidationRequest>
  validationRequests = <CustomerBiteSaverSavedRedemptionValidationRequest>[];
  final List<CustomerBiteSaverSavedRedemptionStartRequest> startRequests =
      <CustomerBiteSaverSavedRedemptionStartRequest>[];
  @override
  Future<
    CustomerBiteSaverEndpointResponse<
      CustomerBiteSaverRedemptionValidationResult
    >
  >
  validateCustomerBiteSaverSavedOfferRedemptionStart(
    CustomerBiteSaverSavedRedemptionValidationRequest request,
  ) async {
    validationRequests.add(request);
    throw StateError('Legacy Saved validation must remain unused.');
  }

  @override
  Future<CustomerBiteSaverRedemptionStartResult>
  startCustomerBiteSaverSavedOfferRedemption(
    CustomerBiteSaverSavedRedemptionStartRequest request,
  ) async {
    startRequests.add(request);
    throw StateError('Legacy Saved start must remain unused.');
  }

  void enqueue(CustomerBiteSaverSavedSection section, Object response) {
    responses[section]!.add(response);
  }

  @override
  Future<CustomerBiteSaverSavedPageResult> getCustomerBiteSaverSavedPage(
    CustomerBiteSaverSavedPageRequest request,
  ) async {
    pageRequests.add(request);
    final response = responses[request.section]!.removeAt(0);
    if (response is Future<CustomerBiteSaverSavedPageResult>) return response;
    if (response is CustomerBiteSaverSavedPageResult) return response;
    throw response;
  }

  @override
  Future<CustomerBiteSaverMenuPageResult> getCustomerBiteSaverSavedMenuPage(
    CustomerBiteSaverSavedMenuPageRequest request,
  ) async {
    menuRequests.add(request);
    return CustomerBiteSaverMenuPageResult.fromJson(<String, Object?>{
      'schemaVersion': 1,
      'state': 'available',
      'attemptGeneration': 0,
      'queryFingerprint': 'f' * 64,
      'restaurantId': _restaurantId(0),
      'menuStyle': 'biteSaver',
      'entries': <Object?>[],
      'nextCursor': null,
      'hasMore': false,
    });
  }
}

final class _Actions {
  final List<String> calls = <String>[];
  Completer<void>? nextCompletion;
  Object? nextError;

  Future<void> _run(String call) async {
    calls.add(call);
    final completion = nextCompletion;
    nextCompletion = null;
    if (completion != null) await completion.future;
    final error = nextError;
    nextError = null;
    if (error != null) throw error;
  }

  CustomerBiteSaverSavedFavoriteActions get value =>
      CustomerBiteSaverSavedFavoriteActions(
        upsertRestaurant: (identity, userId) =>
            _run('save-r:${identity.restaurantId.value}:$userId'),
        removeRestaurant: (id, userId) => _run('remove-r:${id.value}:$userId'),
        upsertCoupon: (identity, userId) =>
            _run('save-c:${identity.offerId.value}:$userId'),
        removeCoupon: (id, userId) => _run('remove-c:${id.value}:$userId'),
      );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'pages independently, appends, and preserves prior rows on failure',
    () async {
      final api = _FakeSavedApi();
      final actions = _Actions();
      var currentUser = 'owner-a';
      final restaurantEntries = List<Map<String, Object?>>.generate(
        25,
        (index) => _entry(restaurantId: _restaurantId(index)),
      );
      api
        ..enqueue(
          CustomerBiteSaverSavedSection.restaurants,
          _page(
            CustomerBiteSaverSavedSection.restaurants,
            restaurantEntries,
            cursor: 'next-page',
          ),
        )
        ..enqueue(
          CustomerBiteSaverSavedSection.coupons,
          StateError('coupon page failed'),
        )
        ..enqueue(
          CustomerBiteSaverSavedSection.restaurants,
          _page(
            CustomerBiteSaverSavedSection.restaurants,
            <Map<String, Object?>>[
              _entry(restaurantId: _restaurantId(24)),
              _entry(restaurantId: _restaurantId(25)),
            ],
          ),
        );
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: 'owner-a',
        api: api,
        favoriteActions: actions.value,
        isAccountCurrent: (userId) => currentUser == userId,
        requestIdGenerator: () =>
            'request-${api.pageRequests.length + 1000000000}',
      );
      addTearDown(coordinator.dispose);

      await expectLater(coordinator.refreshAll(), throwsStateError);
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.restaurants),
        hasLength(25),
      );
      expect(
        coordinator.errorFor(CustomerBiteSaverSavedSection.coupons),
        isNotNull,
      );
      await coordinator.loadMore(CustomerBiteSaverSavedSection.restaurants);
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.restaurants),
        hasLength(26),
      );
      expect(api.pageRequests.last.cursor, 'next-page');

      currentUser = 'owner-b';
      expect(
        () => coordinator.captureAccess(
          coordinator.entries(CustomerBiteSaverSavedSection.restaurants).first,
        ),
        throwsA(isA<CustomerBiteSaverStaleOperationException>()),
      );
    },
  );

  test(
    'confirmed writes synchronize state while failures stay truthful and retryable',
    () async {
      final api = _FakeSavedApi();
      final actions = _Actions();
      final id = _restaurantId(0);
      api.enqueue(
        CustomerBiteSaverSavedSection.restaurants,
        _page(CustomerBiteSaverSavedSection.restaurants, <Map<String, Object?>>[
          _entry(restaurantId: id),
        ]),
      );
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: 'owner-a',
        api: api,
        favoriteActions: actions.value,
        isAccountCurrent: (_) => true,
        requestIdGenerator: () =>
            'request-${api.pageRequests.length + actions.calls.length + 1000000000}',
      );
      addTearDown(coordinator.dispose);
      await coordinator.refresh(CustomerBiteSaverSavedSection.restaurants);
      final restaurant = coordinator
          .entries(CustomerBiteSaverSavedSection.restaurants)
          .single
          .restaurant!;
      expect(
        coordinator.restaurantFavoriteState(restaurant.restaurantId),
        CustomerBiteSaverFavoriteState.favorite,
      );

      actions.nextError = StateError('write failed');
      await expectLater(
        coordinator.setRestaurantFavorite(restaurant, false),
        throwsStateError,
      );
      expect(
        coordinator.restaurantFavoriteState(restaurant.restaurantId),
        CustomerBiteSaverFavoriteState.favorite,
      );
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.restaurants),
        hasLength(1),
      );

      final delayed = Completer<void>();
      actions.nextCompletion = delayed;
      final write = coordinator.setRestaurantFavorite(restaurant, false);
      expect(coordinator.isPending(id), isTrue);
      await expectLater(
        coordinator.setRestaurantFavorite(restaurant, true),
        throwsStateError,
      );
      delayed.complete();
      await write;
      expect(
        coordinator.restaurantFavoriteState(restaurant.restaurantId),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.restaurants),
        isEmpty,
      );
      expect(
        actions.calls.where((call) => call.startsWith('remove-r:')),
        hasLength(2),
      );
    },
  );

  test(
    'late page and account-replaced write completions cannot overwrite ownership',
    () async {
      final api = _FakeSavedApi();
      final actions = _Actions();
      final id = _restaurantId(0);
      final initial = _page(
        CustomerBiteSaverSavedSection.restaurants,
        <Map<String, Object?>>[_entry(restaurantId: id)],
      );
      api.enqueue(CustomerBiteSaverSavedSection.restaurants, initial);
      var currentUser = 'owner-a';
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: 'owner-a',
        api: api,
        favoriteActions: actions.value,
        isAccountCurrent: (userId) => currentUser == userId,
        requestIdGenerator: () =>
            'request-${api.pageRequests.length + actions.calls.length + 2000000000}',
      );
      addTearDown(coordinator.dispose);
      await coordinator.refresh(CustomerBiteSaverSavedSection.restaurants);
      final restaurant = coordinator
          .entries(CustomerBiteSaverSavedSection.restaurants)
          .single
          .restaurant!;

      final stalePage = Completer<CustomerBiteSaverSavedPageResult>();
      api.enqueue(CustomerBiteSaverSavedSection.restaurants, stalePage.future);
      final refresh = coordinator.refresh(
        CustomerBiteSaverSavedSection.restaurants,
      );
      await Future<void>.delayed(Duration.zero);
      await coordinator.setRestaurantFavorite(restaurant, false);
      stalePage.complete(initial);
      await refresh;
      expect(
        coordinator.restaurantFavoriteState(restaurant.restaurantId),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.restaurants),
        isEmpty,
      );

      final delayedWrite = Completer<void>();
      actions.nextCompletion = delayedWrite;
      final save = coordinator.setRestaurantFavorite(restaurant, true);
      currentUser = 'owner-b';
      delayedWrite.complete();
      await save;
      expect(
        coordinator.restaurantFavoriteState(restaurant.restaurantId),
        CustomerBiteSaverFavoriteState.notFavorite,
      );
    },
  );

  test(
    'neutral unavailable rows remain removable without public detail',
    () async {
      final api = _FakeSavedApi();
      final actions = _Actions();
      final offerId = _offerId(0);
      api.enqueue(
        CustomerBiteSaverSavedSection.coupons,
        _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
          _entry(
            restaurantId: _restaurantId(0),
            offerId: offerId,
            available: false,
          ),
        ]),
      );
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: 'owner-a',
        api: api,
        favoriteActions: actions.value,
        isAccountCurrent: (_) => true,
        requestIdGenerator: () =>
            'request-${api.pageRequests.length + actions.calls.length + 3000000000}',
      );
      addTearDown(coordinator.dispose);
      await coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
      final entry = coordinator
          .entries(CustomerBiteSaverSavedSection.coupons)
          .single;
      expect(entry.isAvailable, isFalse);
      expect(() => coordinator.captureAccess(entry), throwsStateError);

      await coordinator.removeCouponFavorite(entry.offerId!);
      expect(actions.calls, <String>['remove-c:$offerId:owner-a']);
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.coupons),
        isEmpty,
      );
    },
  );

  test(
    'save coalesces a bounded refresh when the section is already loading',
    () async {
      final api = _FakeSavedApi();
      final actions = _Actions();
      final id = _restaurantId(0);
      final entry = _entry(restaurantId: id);
      api.enqueue(
        CustomerBiteSaverSavedSection.restaurants,
        _page(CustomerBiteSaverSavedSection.restaurants, <Map<String, Object?>>[
          entry,
        ]),
      );
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: 'owner-a',
        api: api,
        favoriteActions: actions.value,
        isAccountCurrent: (_) => true,
        requestIdGenerator: () =>
            'request-${api.pageRequests.length + actions.calls.length + 4000000000}',
      );
      addTearDown(coordinator.dispose);
      await coordinator.refresh(CustomerBiteSaverSavedSection.restaurants);
      final restaurant = coordinator
          .entries(CustomerBiteSaverSavedSection.restaurants)
          .single
          .restaurant!;
      await coordinator.setRestaurantFavorite(restaurant, false);

      final older = Completer<CustomerBiteSaverSavedPageResult>();
      api
        ..enqueue(CustomerBiteSaverSavedSection.restaurants, older.future)
        ..enqueue(
          CustomerBiteSaverSavedSection.restaurants,
          _page(
            CustomerBiteSaverSavedSection.restaurants,
            <Map<String, Object?>>[entry],
          ),
        );
      final inFlight = coordinator.refresh(
        CustomerBiteSaverSavedSection.restaurants,
      );
      await Future<void>.delayed(Duration.zero);
      await coordinator.setRestaurantFavorite(restaurant, true);
      older.complete(
        _page(
          CustomerBiteSaverSavedSection.restaurants,
          const <Map<String, Object?>>[],
        ),
      );
      await inFlight;
      for (
        var attempt = 0;
        attempt < 10 &&
            coordinator
                .entries(CustomerBiteSaverSavedSection.restaurants)
                .isEmpty;
        attempt++
      ) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(api.pageRequests, hasLength(3));
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.restaurants),
        hasLength(1),
      );
      expect(
        coordinator.restaurantFavoriteState(restaurant.restaurantId),
        CustomerBiteSaverFavoriteState.favorite,
      );
    },
  );

  test('Saved read, favorite and menu do not start device use', () async {
    final fixture = await _savedUseFixture();
    final access = fixture.access;
    await fixture.coordinator.loadMenuPage(access, null);
    await fixture.coordinator.setOfferFavorite(
      access.restaurant,
      access.offer!,
      false,
    );
    expect(fixture.device.stages, isEmpty);
    expect(fixture.api.validationRequests, isEmpty);
    expect(fixture.api.startRequests, isEmpty);
  });

  test(
    'Saved explicit use carries real authority, coalesces taps and keeps anchors',
    () async {
      final fixture = await _savedUseFixture();
      final first = fixture.coordinator.useCoupon(fixture.access);
      final second = fixture.coordinator.useCoupon(fixture.access);
      expect(identical(first, second), isTrue);
      final presentation = await first;
      expect(
        presentation.status,
        CustomerBiteSaverRedemptionPresentationStatus.started,
      );
      expect(presentation.timerStartedAtMillis, _evaluationAtMillis);
      expect(presentation.timerExpiresAtMillis, _evaluationAtMillis + 300000);
      expect(fixture.device.stages, <String>[
        'capability',
        'admission',
        'challenge',
        'proof',
        'use',
      ]);
      final request =
          fixture.device.submissions.single['request'] as Map<String, Object?>;
      expect(request['origin'], <String, Object?>{
        'kind': 'saved',
        'accessToken': fixture.access.accessToken,
      });
      expect(request['timeZone'], 'America/New_York');
      expect(request['utcOffsetMinutes'], -240);
      expect(request['currentCoordinates'], isNull);
      expect(fixture.api.validationRequests, isEmpty);
      expect(fixture.api.startRequests, isEmpty);
      fixture.coordinator.cancelCouponUse(fixture.access);
      expect(
        fixture.coordinator.redemptionPresentationFor(
          fixture.access.offer!.offerId,
        ),
        same(presentation),
      );
    },
  );

  test(
    'uncertain Saved device use retries exact proof and frozen authority time and location',
    () async {
      var timeReads = 0;
      var coordinateReads = 0;
      final fixture = await _savedUseFixture(
        proximity: true,
        timeContextProvider: () async {
          timeReads += 1;
          return (timeZone: 'America/New_York', utcOffsetMinutes: -240);
        },
        currentCoordinatesProvider: () async {
          coordinateReads += 1;
          return CustomerBiteSaverCoordinates(
            latitude: 28.5,
            longitude: -81.3,
            capturedAtMillis: _evaluationAtMillis,
          );
        },
      );
      fixture.device.beforeStage = (stage) async {
        if (stage == 'use' && fixture.device.submissions.length == 1) {
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        }
      };
      await expectLater(
        fixture.coordinator.useCoupon(fixture.access),
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      final firstSend = fixture.device.submissions.single;
      fixture.api.enqueue(
        CustomerBiteSaverSavedSection.coupons,
        _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
          _entry(
            restaurantId: _restaurantId(0),
            offerId: _offerId(0),
            accessToken: 'bssv1.refreshed-saved-access',
            usagePolicy: 'oncePerCustomer',
            isProximityOnly: true,
          ),
        ]),
      );
      await fixture.coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
      final refreshed = fixture.coordinator.captureAccess(
        fixture.coordinator
            .entries(CustomerBiteSaverSavedSection.coupons)
            .single,
      );
      final recovered = await fixture.coordinator.useCoupon(refreshed);
      expect(recovered.timerStartedAtMillis, _evaluationAtMillis);
      expect(fixture.device.submissions, hasLength(2));
      expect(fixture.device.submissions.last, firstSend);
      expect(
        fixture.device.stages.where((stage) => stage == 'proof'),
        hasLength(1),
      );
      expect(timeReads, 1);
      expect(coordinateReads, 1);
      expect(fixture.api.startRequests, isEmpty);
    },
  );

  test(
    'Saved active result continues current device timer without restarting',
    () async {
      final fixture = await _savedUseFixture();
      fixture.device.status = 'active';
      final presentation = await fixture.coordinator.useCoupon(fixture.access);
      expect(
        presentation.status,
        CustomerBiteSaverRedemptionPresentationStatus.active,
      );
      expect(presentation.timerStartedAtMillis, _evaluationAtMillis);
      expect(presentation.timerExpiresAtMillis, _evaluationAtMillis + 300000);
    },
  );

  test('Saved denial cannot borrow another device timer', () async {
    final fixture = await _savedUseFixture();
    fixture.device.status = 'denied';
    await expectLater(
      fixture.coordinator.useCoupon(fixture.access),
      throwsA(isA<CustomerBiteSaverRedemptionDeniedException>()),
    );
    expect(
      fixture.coordinator.redemptionPresentationFor(
        fixture.access.offer!.offerId,
      ),
      isNull,
    );
    expect(fixture.api.startRequests, isEmpty);
  });

  test('Saved unlimited remains reusable with no fabricated timer', () async {
    final fixture = await _savedUseFixture(usagePolicy: 'unlimited');
    fixture.device.status = 'unlimited';
    final first = await fixture.coordinator.useCoupon(fixture.access);
    final second = await fixture.coordinator.useCoupon(fixture.access);
    expect(
      first.status,
      CustomerBiteSaverRedemptionPresentationStatus.unlimited,
    );
    expect(second.timerStartedAtMillis, isNull);
    expect(second.timerExpiresAtMillis, isNull);
    expect(fixture.device.submissions, hasLength(2));
  });

  for (final stage in <String>[
    'capability',
    'admission',
    'challenge',
    'proof',
    'use',
  ]) {
    for (final nextUser in <String?>[null, 'owner-b']) {
      test(
        'Saved ${nextUser == null ? 'sign-out' : 'account replacement'} during $stage fences next work and result',
        () async {
          String? currentUser = 'owner-a';
          final fixture = await _savedUseFixture(
            isAccountCurrent: (userId) => userId == currentUser,
          );
          final reached = Completer<void>();
          final release = Completer<void>();
          fixture.device.beforeStage = (name) async {
            if (name == stage) {
              reached.complete();
              await release.future;
            }
          };
          final operation = fixture.coordinator.useCoupon(fixture.access);
          final failure = expectLater(
            operation,
            throwsA(
              isA<CustomerBiteSaverDeviceUseException>().having(
                (e) => e.kind,
                'kind',
                CustomerBiteSaverDeviceUseFailureKind.stale,
              ),
            ),
          );
          await reached.future;
          currentUser = nextUser;
          release.complete();
          await failure;
          expect(fixture.device.stages.last, stage);
          expect(
            fixture.coordinator.redemptionPresentationFor(
              fixture.access.offer!.offerId,
            ),
            isNull,
          );
          expect(fixture.api.startRequests, isEmpty);
        },
      );
    }
  }

  test(
    'Saved explicit owner cancellation during native proof prevents submission',
    () async {
      final fixture = await _savedUseFixture();
      final reached = Completer<void>();
      final release = Completer<void>();
      fixture.device.beforeStage = (stage) async {
        if (stage == 'proof') {
          reached.complete();
          await release.future;
        }
      };
      final operation = fixture.coordinator.useCoupon(fixture.access);
      final failure = expectLater(
        operation,
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      await reached.future;
      fixture.coordinator.cancelCouponUse(fixture.access);
      release.complete();
      await failure;
      expect(fixture.device.submissions, isEmpty);
      expect(fixture.access.isCurrent, isTrue);
    },
  );

  test(
    'invalidating an older Saved access does not cancel a newer exact retry',
    () async {
      final fixture = await _savedUseFixture();
      final reached = Completer<void>();
      final release = Completer<void>();
      fixture.device.beforeStage = (stage) async {
        if (stage != 'use') return;
        if (fixture.device.submissions.length == 1) {
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        }
        reached.complete();
        await release.future;
      };
      await expectLater(
        fixture.coordinator.useCoupon(fixture.access),
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      final nextAccess = fixture.coordinator.captureAccess(
        fixture.coordinator
            .entries(CustomerBiteSaverSavedSection.coupons)
            .single,
      );
      final recovery = fixture.coordinator.useCoupon(nextAccess);
      await reached.future;
      fixture.coordinator.cancelCouponUse(fixture.access);
      release.complete();
      final result = await recovery;
      expect(result.timerStartedAtMillis, _evaluationAtMillis);
      expect(fixture.device.submissions.last, fixture.device.submissions.first);
    },
  );

  test(
    'Saved explicit owner cancellation during time lookup never starts the native provider',
    () async {
      final time = Completer<({String timeZone, int utcOffsetMinutes})>();
      final fixture = await _savedUseFixture(
        timeContextProvider: () => time.future,
      );
      final use = fixture.coordinator.useCoupon(fixture.access);
      final failure = expectLater(
        use,
        throwsA(isA<CustomerBiteSaverStaleOperationException>()),
      );
      fixture.coordinator.cancelCouponUse(fixture.access);
      time.complete((timeZone: 'America/New_York', utcOffsetMinutes: -240));
      await failure;
      expect(fixture.device.stages, isEmpty);
    },
  );

  test(
    'Saved route mount fence prevents use before disposal notification',
    () async {
      var mounted = true;
      final fixture = await _savedUseFixture();
      fixture.device.beforeStage = (stage) async {
        if (stage == 'challenge') mounted = false;
      };
      await expectLater(
        fixture.coordinator.useCoupon(fixture.access, isCurrent: () => mounted),
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      expect(fixture.device.stages, isNot(contains('proof')));
      expect(fixture.device.submissions, isEmpty);
    },
  );

  for (final scenario
      in <
        ({
          String label,
          String stage,
          Object error,
          CustomerBiteSaverDeviceUseFailureKind kind,
        })
      >[
        (
          label: 'cooldown',
          stage: 'admission',
          error: const CustomerBiteSaverDeviceUseTransportException(
            code: 'resource-exhausted',
            ambiguous: false,
            retryAfterMillis: 5000,
          ),
          kind: CustomerBiteSaverDeviceUseFailureKind.temporaryCooldown,
        ),
        (
          label: 'network',
          stage: 'use',
          error: const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          ),
          kind: CustomerBiteSaverDeviceUseFailureKind.ambiguous,
        ),
        (
          label: 'expired authority',
          stage: 'admission',
          error: const CustomerBiteSaverDeviceUseTransportException(
            code: 'permission-denied',
            ambiguous: false,
          ),
          kind: CustomerBiteSaverDeviceUseFailureKind.rejected,
        ),
        (
          label: 'challenge rejection',
          stage: 'challenge',
          error: const CustomerBiteSaverDeviceUseTransportException(
            code: 'failed-precondition',
            ambiguous: false,
          ),
          kind: CustomerBiteSaverDeviceUseFailureKind.rejected,
        ),
        (
          label: 'provider',
          stage: 'proof',
          error: PlatformException(code: 'device-proof-provider-unavailable'),
          kind: CustomerBiteSaverDeviceUseFailureKind.proof,
        ),
        (
          label: 'server rejection',
          stage: 'use',
          error: const CustomerBiteSaverDeviceUseTransportException(
            code: 'permission-denied',
            ambiguous: false,
          ),
          kind: CustomerBiteSaverDeviceUseFailureKind.rejected,
        ),
      ]) {
    test(
      'Saved ${scenario.label} fails closed without legacy fallback',
      () async {
        final fixture = await _savedUseFixture();
        fixture.device.beforeStage = (stage) async {
          if (stage == scenario.stage) throw scenario.error;
        };
        await expectLater(
          fixture.coordinator.useCoupon(fixture.access),
          throwsA(
            isA<CustomerBiteSaverDeviceUseException>().having(
              (e) => e.kind,
              'kind',
              scenario.kind,
            ),
          ),
        );
        expect(fixture.api.validationRequests, isEmpty);
        expect(fixture.api.startRequests, isEmpty);
        expect(
          fixture.coordinator.redemptionPresentationFor(
            fixture.access.offer!.offerId,
          ),
          isNull,
        );
      },
    );
  }
}

Future<
  ({
    CustomerBiteSaverSavedCoordinator coordinator,
    CustomerBiteSaverSavedAccess access,
    _FakeSavedApi api,
    CustomerBiteSaverDeviceUseFixture device,
  })
>
_savedUseFixture({
  bool proximity = false,
  String usagePolicy = 'oncePerCustomer',
  CustomerBiteSaverSavedAccountCurrent? isAccountCurrent,
  CustomerBiteSaverSavedTimeContextProvider? timeContextProvider,
  CustomerBiteSaverSavedCurrentCoordinatesProvider? currentCoordinatesProvider,
}) async {
  final api = _FakeSavedApi();
  final device = CustomerBiteSaverDeviceUseFixture();
  addTearDown(device.dispose);
  api.enqueue(
    CustomerBiteSaverSavedSection.coupons,
    _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
      _entry(
        restaurantId: _restaurantId(0),
        offerId: _offerId(0),
        usagePolicy: usagePolicy,
        isProximityOnly: proximity,
      ),
    ]),
  );
  var sequence = 0;
  final coordinator = CustomerBiteSaverSavedCoordinator(
    userId: 'owner-a',
    api: api,
    favoriteActions: _Actions().value,
    isAccountCurrent: isAccountCurrent ?? (_) => true,
    requestIdGenerator: () =>
        'saved-device-request-${(++sequence).toString().padLeft(4, '0')}',
    timeContextProvider:
        timeContextProvider ??
        () async => (timeZone: 'America/New_York', utcOffsetMinutes: -240),
    currentCoordinatesProvider: currentCoordinatesProvider,
    deviceUseService: device.service,
    clock: () => DateTime.fromMillisecondsSinceEpoch(_evaluationAtMillis),
  );
  addTearDown(coordinator.dispose);
  await coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
  return (
    coordinator: coordinator,
    access: coordinator.captureAccess(
      coordinator.entries(CustomerBiteSaverSavedSection.coupons).single,
    ),
    api: api,
    device: device,
  );
}
