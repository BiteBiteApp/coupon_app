import 'dart:async';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_saved.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_saved_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:flutter_test/flutter_test.dart';

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

CustomerBiteSaverDirectResponse<CustomerBiteSaverRedemptionValidationResult>
_validation({
  required String restaurantId,
  required String offerId,
  bool allowed = true,
  String reason = 'available',
  String usagePolicy = 'oncePerCustomer',
  int? activeTimerExpiresAtMillis,
}) {
  final context = CustomerBiteSaverEvaluationContext.fromJson(<String, Object?>{
    'schemaVersion': 1,
    'sessionId': 'bss_${'S' * 43}',
    'attemptGeneration': 0,
    'queryFingerprint': 'f' * 64,
    'evaluationAtMillis': _evaluationAtMillis,
    'timeZone': 'America/New_York',
    'utcOffsetMinutes': -240,
    'availabilityGeneration': 'a' * 64,
    'validUntilExclusiveMillis': _evaluationAtMillis + 60 * 1000,
    'oncePerDayUnavailableWindows': <Object?>[
      <String, Object?>{
        'startAtMillisInclusive': _evaluationAtMillis - 60 * 1000,
        'endAtMillisExclusive': _evaluationAtMillis + 1,
      },
    ],
  });
  final result =
      CustomerBiteSaverRedemptionValidationResult.fromJson(<String, Object?>{
        'schemaVersion': 1,
        'restaurantId': restaurantId,
        'offerId': offerId,
        'allowed': allowed,
        'reason': reason,
        'usagePolicy': usagePolicy,
        'evaluatedAtMillis': _evaluationAtMillis,
        'activeTimerExpiresAtMillis': activeTimerExpiresAtMillis,
        'nextAvailableAtMillis': null,
        'validationId': allowed ? 'bsv_${'V' * 43}' : null,
        'validationExpiresAtMillis': allowed
            ? _evaluationAtMillis + 60 * 1000
            : null,
      });
  return CustomerBiteSaverDirectResponse(result, evaluationContext: context);
}

CustomerBiteSaverRedemptionStartResult _started({
  required String restaurantId,
  required String offerId,
  String status = 'started',
}) => CustomerBiteSaverRedemptionStartResult.fromJson(<String, Object?>{
  'schemaVersion': 1,
  'restaurantId': restaurantId,
  'offerId': offerId,
  'redemptionId': status == 'unlimited' ? null : 'bsrd_${'D' * 43}',
  'status': status,
  'timerStartedAtMillis': status == 'unlimited' ? null : _evaluationAtMillis,
  'timerExpiresAtMillis': status == 'unlimited'
      ? null
      : _evaluationAtMillis + 5 * 60 * 1000,
});

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
  final List<Object> validationResponses = <Object>[];
  final List<Object> startResponses = <Object>[];

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
    final response = validationResponses.removeAt(0);
    if (response
        is Future<
          CustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >) {
      return response;
    }
    if (response
        is CustomerBiteSaverEndpointResponse<
          CustomerBiteSaverRedemptionValidationResult
        >) {
      return response;
    }
    throw response;
  }

  @override
  Future<CustomerBiteSaverRedemptionStartResult>
  startCustomerBiteSaverSavedOfferRedemption(
    CustomerBiteSaverSavedRedemptionStartRequest request,
  ) async {
    startRequests.add(request);
    final response = startResponses.removeAt(0);
    if (response is Future<CustomerBiteSaverRedemptionStartResult>) {
      return response;
    }
    if (response is CustomerBiteSaverRedemptionStartResult) return response;
    throw response;
  }

  void enqueueValidation(Object response) => validationResponses.add(response);

  void enqueueStart(Object response) => startResponses.add(response);

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

  test(
    'Saved coupon use coalesces taps and retains canonical timer anchors',
    () async {
      final api = _FakeSavedApi();
      final actions = _Actions();
      final restaurantId = _restaurantId(0);
      final offerId = _offerId(0);
      api.enqueue(
        CustomerBiteSaverSavedSection.coupons,
        _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
          _entry(
            restaurantId: restaurantId,
            offerId: offerId,
            usageRule: 'Once per customer',
            usagePolicy: 'oncePerCustomer',
          ),
        ]),
      );
      api
        ..enqueueValidation(
          _validation(restaurantId: restaurantId, offerId: offerId),
        )
        ..enqueueStart(_started(restaurantId: restaurantId, offerId: offerId));
      var requestSequence = 0;
      var guestStoreLoads = 0;
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: 'owner-a',
        api: api,
        favoriteActions: actions.value,
        isAccountCurrent: (_) => true,
        requestIdGenerator: () =>
            'saved-use-request-${(++requestSequence).toString().padLeft(4, '0')}',
        timeContextProvider: () async =>
            (timeZone: 'America/New_York', utcOffsetMinutes: -240),
        guestUsageStoreLoader: () async {
          guestStoreLoads += 1;
          return null;
        },
        clock: () => DateTime.fromMillisecondsSinceEpoch(_evaluationAtMillis),
      );
      addTearDown(coordinator.dispose);
      await coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
      final access = coordinator.captureAccess(
        coordinator.entries(CustomerBiteSaverSavedSection.coupons).single,
      );

      final first = coordinator.useCoupon(access);
      final second = coordinator.useCoupon(access);
      expect(identical(first, second), isTrue);
      final presentation = await first;

      expect(
        presentation.status,
        CustomerBiteSaverRedemptionPresentationStatus.started,
      );
      expect(presentation.timerStartedAtMillis, _evaluationAtMillis);
      expect(
        presentation.timerExpiresAtMillis,
        _evaluationAtMillis + 5 * 60 * 1000,
      );
      expect(
        coordinator.redemptionPresentationFor(
          CustomerBiteSaverOfferId(offerId),
        ),
        same(presentation),
      );
      expect(api.validationRequests, hasLength(1));
      expect(api.startRequests, hasLength(1));
      expect(guestStoreLoads, 1);
      expect(
        api.validationRequests.single.toJson(),
        containsPair('currentCoordinates', null),
      );
      expect(
        api.startRequests.single.redemptionRequestId,
        api.validationRequests.single.redemptionRequestId,
      );
    },
  );

  test('uncertain Saved start retries the exact frozen request', () async {
    final api = _FakeSavedApi();
    final actions = _Actions();
    final restaurantId = _restaurantId(1);
    final offerId = _offerId(1);
    api.enqueue(
      CustomerBiteSaverSavedSection.coupons,
      _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
        _entry(
          restaurantId: restaurantId,
          offerId: offerId,
          usageRule: 'Once per customer',
          usagePolicy: 'oncePerCustomer',
        ),
      ]),
    );
    api
      ..enqueueValidation(
        _validation(restaurantId: restaurantId, offerId: offerId),
      )
      ..enqueueStart(
        const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.transport,
          code: 'deadline-exceeded',
          message: 'outcome unknown',
        ),
      )
      ..enqueueStart(_started(restaurantId: restaurantId, offerId: offerId));
    var requestSequence = 0;
    final coordinator = CustomerBiteSaverSavedCoordinator(
      userId: 'owner-a',
      api: api,
      favoriteActions: actions.value,
      isAccountCurrent: (_) => true,
      requestIdGenerator: () =>
          'saved-retry-request-${(++requestSequence).toString().padLeft(4, '0')}',
      timeContextProvider: () async =>
          (timeZone: 'America/New_York', utcOffsetMinutes: -240),
      guestUsageStoreLoader: () async => null,
      clock: () => DateTime.fromMillisecondsSinceEpoch(_evaluationAtMillis),
    );
    addTearDown(coordinator.dispose);
    await coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
    final access = coordinator.captureAccess(
      coordinator.entries(CustomerBiteSaverSavedSection.coupons).single,
    );

    await expectLater(
      coordinator.useCoupon(access),
      throwsA(
        isA<CustomerBiteSaverServiceException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverServiceFailureKind.transport,
        ),
      ),
    );
    final firstStart = api.startRequests.single.toJson();
    api.enqueue(
      CustomerBiteSaverSavedSection.coupons,
      _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
        _entry(
          restaurantId: restaurantId,
          offerId: offerId,
          accessToken: 'bssv1.refreshed-saved-access',
          usageRule: 'Once per customer',
          usagePolicy: 'oncePerCustomer',
        ),
      ]),
    );
    await coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
    final refreshedAccess = coordinator.captureAccess(
      coordinator.entries(CustomerBiteSaverSavedSection.coupons).single,
    );
    expect(refreshedAccess.accessToken, isNot(access.accessToken));
    final recovered = await coordinator.useCoupon(refreshedAccess);

    expect(
      recovered.status,
      CustomerBiteSaverRedemptionPresentationStatus.started,
    );
    expect(api.validationRequests, hasLength(1));
    expect(api.startRequests, hasLength(2));
    expect(api.startRequests.last.toJson(), firstStart);
  });

  test('account replacement fences a late Saved start completion', () async {
    final api = _FakeSavedApi();
    final actions = _Actions();
    final restaurantId = _restaurantId(2);
    final offerId = _offerId(2);
    api.enqueue(
      CustomerBiteSaverSavedSection.coupons,
      _page(CustomerBiteSaverSavedSection.coupons, <Map<String, Object?>>[
        _entry(
          restaurantId: restaurantId,
          offerId: offerId,
          usageRule: 'Once per customer',
          usagePolicy: 'oncePerCustomer',
        ),
      ]),
    );
    final delayedStart = Completer<CustomerBiteSaverRedemptionStartResult>();
    api
      ..enqueueValidation(
        _validation(restaurantId: restaurantId, offerId: offerId),
      )
      ..enqueueStart(delayedStart.future);
    var currentUser = 'owner-a';
    var requestSequence = 0;
    final coordinator = CustomerBiteSaverSavedCoordinator(
      userId: 'owner-a',
      api: api,
      favoriteActions: actions.value,
      isAccountCurrent: (userId) => currentUser == userId,
      requestIdGenerator: () =>
          'saved-fence-request-${(++requestSequence).toString().padLeft(4, '0')}',
      timeContextProvider: () async =>
          (timeZone: 'America/New_York', utcOffsetMinutes: -240),
      guestUsageStoreLoader: () async => null,
      clock: () => DateTime.fromMillisecondsSinceEpoch(_evaluationAtMillis),
    );
    addTearDown(coordinator.dispose);
    await coordinator.refresh(CustomerBiteSaverSavedSection.coupons);
    final access = coordinator.captureAccess(
      coordinator.entries(CustomerBiteSaverSavedSection.coupons).single,
    );
    final operation = coordinator.useCoupon(access);
    while (api.startRequests.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    currentUser = 'owner-b';
    delayedStart.complete(
      _started(restaurantId: restaurantId, offerId: offerId),
    );

    await expectLater(
      operation,
      throwsA(isA<CustomerBiteSaverStaleOperationException>()),
    );
    expect(
      coordinator.redemptionPresentationFor(CustomerBiteSaverOfferId(offerId)),
      isNull,
    );
  });
}
