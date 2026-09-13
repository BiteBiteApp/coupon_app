import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/customer_load_more_controller.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fixturePath =
    'test/fixtures/customer_bitesaver_client_boundary_v1.json';
const String _clientInstanceId = 'coordinator-client-0001';
const int _evaluationAtMillis = 1789225200000;

late Map<String, dynamic> _fixture;
late Map<String, dynamic> _signedResponses;
late Map<String, dynamic> _guestResponses;

Map<String, dynamic> _map(Object? value) =>
    Map<String, dynamic>.from(value! as Map);

Map<String, dynamic> _copyMap(Object? value) =>
    jsonDecode(jsonEncode(value))! as Map<String, dynamic>;

Map<String, dynamic> _directResultMap(Object? value) =>
    _copyMap(value)..remove('evaluationContext');

CustomerBiteSaverSearchCriteria _criteria([
  String searchText = '',
  String timeZone = 'America/New_York',
]) => CustomerBiteSaverSearchCriteria(
  latitude: 28.5383,
  longitude: -81.3792,
  radiusMiles: 10,
  locationMode: CustomerBiteSaverLocationMode.current,
  typedLocation: null,
  searchText: searchText,
  timeZone: timeZone,
  utcOffsetMinutes: -240,
);

CustomerBiteSaverStartResponse _startResponse({
  String state = 'ready',
  int attemptGeneration = 0,
  String? queryFingerprint,
}) {
  final json = _copyMap(_signedResponses['start']);
  json['state'] = state;
  json['attemptGeneration'] = attemptGeneration;
  if (queryFingerprint != null) {
    json['queryFingerprint'] = queryFingerprint;
  }
  return CustomerBiteSaverStartResponse.fromJson(json);
}

CustomerBiteSaverStatusResponse _statusResponse(String state) =>
    CustomerBiteSaverStatusResponse.fromJson(
      _map(_map(_signedResponses['status'])[state]),
    );

String _token(int value) => value.toRadixString(36).padLeft(43, '0');
String _restaurantId(int value) => 'bsr_${_token(value)}';
String _offerId(int value) => 'bso_${_token(value)}';

Map<String, dynamic> _offerJson(int value) {
  final restaurant = _map(
    (_map(_signedResponses['restaurantPage'])['restaurants']! as List).first,
  );
  final offer = _copyMap((restaurant['offers']! as List).first);
  offer['offerId'] = _offerId(value);
  offer['offerOccurrence'] = 'bsoc1.offer_${_token(value)}';
  offer['title'] = 'Offer $value';
  offer['usagePolicy'] = 'oncePerCustomer';
  offer['sourceCreatedAtMillis'] = _evaluationAtMillis - value;
  return offer;
}

CustomerBiteSaverOffer _offer(int value) =>
    CustomerBiteSaverOffer.fromJson(_offerJson(value));

Map<String, dynamic> _restaurantJson(
  int value, {
  List<Map<String, dynamic>> offers = const <Map<String, dynamic>>[],
  bool hasMoreOffers = false,
}) {
  final template = _map(
    (_map(_signedResponses['restaurantPage'])['restaurants']! as List).first,
  );
  final restaurant = _copyMap(template);
  restaurant['restaurantId'] = _restaurantId(value);
  restaurant['displayName'] = 'Restaurant $value';
  restaurant['offers'] = offers;
  restaurant['hasMoreOffers'] = hasMoreOffers;
  restaurant['usableOfferCount'] = hasMoreOffers
      ? offers.length + 1
      : offers.length;
  restaurant['offerCountState'] = 'current';
  return restaurant;
}

CustomerBiteSaverRestaurantPageResult _restaurantPage(
  List<Map<String, dynamic>> restaurants, {
  String? nextCursor,
  bool partial = false,
  int attemptGeneration = 0,
  String? queryFingerprint,
}) {
  final template = _directResultMap(_signedResponses['restaurantPage']);
  template['attemptGeneration'] = attemptGeneration;
  if (queryFingerprint != null) {
    template['queryFingerprint'] = queryFingerprint;
  }
  template['restaurants'] = restaurants;
  template['nextCursor'] = nextCursor;
  template['hasMore'] = nextCursor != null;
  template['partial'] = partial;
  return CustomerBiteSaverRestaurantPageResult.fromJson(template);
}

CustomerBiteSaverOfferPageResult _offerPage(
  CustomerBiteSaverRestaurantId restaurantId,
  List<CustomerBiteSaverOffer> offers, {
  String? nextCursor,
  bool partial = false,
}) => CustomerBiteSaverOfferPageResult.fromJson(<String, Object?>{
  'schemaVersion': 1,
  'restaurantId': restaurantId.value,
  'offers': offers.map((offer) => offer.toJson()).toList(),
  'nextCursor': nextCursor,
  'hasMore': nextCursor != null,
  'partial': partial,
});

CustomerBiteSaverEvaluationContext _evaluationContextFor(
  CustomerBiteSaverOperationResult result, {
  int? validUntilExclusiveMillis,
  List<CustomerBiteSaverOncePerDayUnavailableWindow>? windows,
}) {
  final evaluationAtMillis = switch (result) {
    CustomerBiteSaverRedemptionValidationResult value =>
      value.evaluatedAtMillis,
    _ => _evaluationAtMillis,
  };
  final attemptGeneration = switch (result) {
    CustomerBiteSaverRestaurantPageResult value => value.attemptGeneration,
    _ => 0,
  };
  final queryFingerprint = switch (result) {
    CustomerBiteSaverRestaurantPageResult value => value.queryFingerprint,
    _ => _map(_signedResponses['start'])['queryFingerprint']! as String,
  };
  return CustomerBiteSaverEvaluationContext(
    sessionId: _map(_signedResponses['start'])['sessionId']! as String,
    attemptGeneration: attemptGeneration,
    queryFingerprint: queryFingerprint,
    evaluationAtMillis: evaluationAtMillis,
    timeZone: 'America/New_York',
    utcOffsetMinutes: -240,
    availabilityGeneration: 'a' * 64,
    validUntilExclusiveMillis:
        validUntilExclusiveMillis ??
        evaluationAtMillis +
            CustomerBiteSaverSearchContract
                .usageEvaluationMaximumLifetimeMilliseconds,
    oncePerDayUnavailableWindows:
        windows ??
        <CustomerBiteSaverOncePerDayUnavailableWindow>[
          CustomerBiteSaverOncePerDayUnavailableWindow(
            startAtMillisInclusive:
                evaluationAtMillis - Duration.millisecondsPerDay,
            endAtMillisExclusive: evaluationAtMillis + 1,
          ),
        ],
  );
}

CustomerBiteSaverEvaluationContext _localEvaluationContext(
  int evaluationAtMillis, {
  String availabilityGeneration =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
}) => CustomerBiteSaverEvaluationContext(
  sessionId: _map(_signedResponses['start'])['sessionId']! as String,
  attemptGeneration: 0,
  queryFingerprint:
      _map(_signedResponses['start'])['queryFingerprint']! as String,
  evaluationAtMillis: evaluationAtMillis,
  timeZone: 'America/New_York',
  utcOffsetMinutes: -240,
  availabilityGeneration: availabilityGeneration,
  validUntilExclusiveMillis:
      evaluationAtMillis +
      CustomerBiteSaverSearchContract
          .usageEvaluationMaximumLifetimeMilliseconds,
  oncePerDayUnavailableWindows: <CustomerBiteSaverOncePerDayUnavailableWindow>[
    CustomerBiteSaverOncePerDayUnavailableWindow(
      startAtMillisInclusive: evaluationAtMillis - Duration.millisecondsPerDay,
      endAtMillisExclusive: evaluationAtMillis + 1,
    ),
  ],
);

CustomerBiteSaverDirectResponse<T> _direct<
  T extends CustomerBiteSaverOperationResult
>(T result, {CustomerBiteSaverEvaluationContext? evaluationContext}) =>
    CustomerBiteSaverDirectResponse<T>(
      result,
      evaluationContext: evaluationContext ?? _evaluationContextFor(result),
    );

CustomerBiteSaverFavoriteStatesResponse _favoriteResponse(
  CustomerBiteSaverFavoriteStatesRequest request, {
  String state = 'unknown',
}) => CustomerBiteSaverFavoriteStatesResponse.fromJson(<String, Object?>{
  'schemaVersion': 1,
  'states': <Map<String, Object?>>[
    ...request.restaurantIds.map(
      (id) => <String, Object?>{'id': id.value, 'state': state},
    ),
    ...request.offerIds.map(
      (id) => <String, Object?>{'id': id.value, 'state': state},
    ),
  ],
});

CustomerBiteSaverEndpointResponse<CustomerBiteSaverRedemptionValidationResult>
_signedValidationResponse(
  CustomerBiteSaverRestaurantId restaurantId,
  CustomerBiteSaverOfferId offerId,
) {
  final json = _directResultMap(_signedResponses['redemptionValidation']);
  json['restaurantId'] = restaurantId.value;
  json['offerId'] = offerId.value;
  return _direct(CustomerBiteSaverRedemptionValidationResult.fromJson(json));
}

CustomerBiteSaverEndpointResponse<CustomerBiteSaverRestaurantPageResult>
_guestRestaurantResponse(
  Map<String, dynamic> source, {
  int guestStateRevision = 0,
}) {
  final json = _copyMap(source);
  json['guestStateRevision'] = guestStateRevision;
  return parseCustomerBiteSaverEndpointResponse<
    CustomerBiteSaverRestaurantPageResult
  >(
    json,
    expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
    resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
  );
}

CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>
_guestOfferResponse(Map<String, dynamic> source, {int guestStateRevision = 0}) {
  final json = _copyMap(source);
  json['guestStateRevision'] = guestStateRevision;
  return parseCustomerBiteSaverEndpointResponse<
    CustomerBiteSaverOfferPageResult
  >(
    json,
    expectedOperation: CustomerBiteSaverGuestOperation.offerPage,
    resultParser: CustomerBiteSaverOfferPageResult.fromJson,
  );
}

CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
_guestContinuationResponse(
  Map<String, dynamic> source, {
  int guestStateRevision = 0,
}) {
  final json = _copyMap(source);
  json['guestStateRevision'] = guestStateRevision;
  return parseCustomerBiteSaverGuestContinuationResponse(json);
}

CustomerBiteSaverEndpointResponse<CustomerBiteSaverRedemptionValidationResult>
_guestValidationResponse(
  Map<String, dynamic> source, {
  int guestStateRevision = 0,
}) {
  final json = _copyMap(source);
  json['guestStateRevision'] = guestStateRevision;
  return parseCustomerBiteSaverEndpointResponse<
    CustomerBiteSaverRedemptionValidationResult
  >(
    json,
    expectedOperation: CustomerBiteSaverGuestOperation.redemptionStart,
    resultParser: CustomerBiteSaverRedemptionValidationResult.fromJson,
  );
}

final class _MemoryPreferences
    implements CustomerBiteSaverGuestUsagePreferences {
  final Map<String, String> values = <String, String>{};
  final List<String> readKeys = <String>[];
  int mutationCount = 0;
  int? throwOnMutationNumber;
  Future<void> Function(String key)? beforeRead;
  Future<void> Function(int mutationNumber, String key, String? value)?
  beforeMutation;

  @override
  Future<String?> getString(String key) async {
    readKeys.add(key);
    await beforeRead?.call(key);
    return values[key];
  }

  @override
  Future<void> remove(String key) => _mutate(key, null);

  @override
  Future<void> setString(String key, String value) => _mutate(key, value);

  Future<void> _mutate(String key, String? value) async {
    mutationCount += 1;
    await beforeMutation?.call(mutationCount, key, value);
    if (throwOnMutationNumber == mutationCount) {
      throwOnMutationNumber = null;
      throw StateError('synthetic preference write failure');
    }
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

final class _ManualTask implements CustomerBiteSaverScheduledTask {
  _ManualTask(this.delay, this.callback);

  final Duration delay;
  final void Function() callback;
  bool cancelled = false;
  bool fired = false;

  @override
  void cancel() => cancelled = true;

  void fire() {
    if (!cancelled && !fired) {
      fired = true;
      callback();
    }
  }
}

final class _ManualScheduler {
  final List<_ManualTask> tasks = <_ManualTask>[];

  CustomerBiteSaverScheduledTask schedule(
    Duration delay,
    void Function() callback,
  ) {
    final task = _ManualTask(delay, callback);
    tasks.add(task);
    return task;
  }
}

final class _FakeApi implements CustomerBiteSaverApi {
  Future<CustomerBiteSaverStartResponse> Function(
    CustomerBiteSaverStartRequest request,
  )?
  onStart;
  Future<CustomerBiteSaverStatusResponse> Function(
    CustomerBiteSaverStatusRequest request,
  )?
  onStatus;
  Future<
    CustomerBiteSaverEndpointResponse<CustomerBiteSaverRestaurantPageResult>
  >
  Function(CustomerBiteSaverRestaurantPageRequest request)?
  onRestaurantPage;
  Future<CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>>
  Function(CustomerBiteSaverOfferPageRequest request)?
  onOfferPage;
  Future<
    CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
  >
  Function(CustomerBiteSaverGuestContinuationRequest request)?
  onContinuation;
  Future<CustomerBiteSaverFavoriteStatesResponse> Function(
    CustomerBiteSaverFavoriteStatesRequest request,
  )?
  onFavorites;
  Future<
    CustomerBiteSaverEndpointResponse<
      CustomerBiteSaverRedemptionValidationResult
    >
  >
  Function(CustomerBiteSaverRedemptionValidationRequest request)?
  onValidation;
  Future<CustomerBiteSaverRedemptionStartResult> Function(
    CustomerBiteSaverRedemptionStartRequest request,
  )?
  onRedemptionStart;

  final List<CustomerBiteSaverStartRequest> startRequests = [];
  final List<CustomerBiteSaverStatusRequest> statusRequests = [];
  final List<CustomerBiteSaverRestaurantPageRequest> restaurantPageRequests =
      [];
  final List<CustomerBiteSaverOfferPageRequest> offerPageRequests = [];
  final List<CustomerBiteSaverGuestContinuationRequest> continuationRequests =
      [];
  final List<CustomerBiteSaverFavoriteStatesRequest> favoriteRequests = [];
  final List<CustomerBiteSaverRedemptionValidationRequest> validationRequests =
      [];
  final List<CustomerBiteSaverRedemptionStartRequest> redemptionStartRequests =
      [];

  @override
  Future<CustomerBiteSaverStartResponse> startCustomerBiteSaverSearch(
    CustomerBiteSaverStartRequest request,
  ) {
    startRequests.add(request);
    return onStart!(request);
  }

  @override
  Future<CustomerBiteSaverStatusResponse> getCustomerBiteSaverSearchStatus(
    CustomerBiteSaverStatusRequest request,
  ) {
    statusRequests.add(request);
    return onStatus!(request);
  }

  @override
  Future<
    CustomerBiteSaverEndpointResponse<CustomerBiteSaverRestaurantPageResult>
  >
  getCustomerBiteSaverSearchPage(
    CustomerBiteSaverRestaurantPageRequest request,
  ) {
    restaurantPageRequests.add(request);
    return onRestaurantPage!(request);
  }

  @override
  Future<CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>>
  getCustomerBiteSaverOfferPage(CustomerBiteSaverOfferPageRequest request) {
    offerPageRequests.add(request);
    final handler = onOfferPage;
    if (handler != null) return handler(request);
    return Future.value(
      _direct(
        _offerPage(request.restaurantId, const <CustomerBiteSaverOffer>[]),
      ),
    );
  }

  @override
  Future<
    CustomerBiteSaverGuestOperationResponse<CustomerBiteSaverOperationResult>
  >
  continueCustomerBiteSaverGuestOfferCheck(
    CustomerBiteSaverGuestContinuationRequest request,
  ) {
    continuationRequests.add(request);
    return onContinuation!(request);
  }

  @override
  Future<CustomerBiteSaverFavoriteStatesResponse>
  getCustomerBiteSaverFavoriteStates(
    CustomerBiteSaverFavoriteStatesRequest request,
  ) {
    favoriteRequests.add(request);
    final handler = onFavorites;
    return handler?.call(request) ?? Future.value(_favoriteResponse(request));
  }

  @override
  Future<
    CustomerBiteSaverEndpointResponse<
      CustomerBiteSaverRedemptionValidationResult
    >
  >
  validateCustomerBiteSaverOfferRedemptionStart(
    CustomerBiteSaverRedemptionValidationRequest request,
  ) {
    validationRequests.add(request);
    return onValidation!(request);
  }

  @override
  Future<CustomerBiteSaverRedemptionStartResult>
  startCustomerBiteSaverOfferRedemption(
    CustomerBiteSaverRedemptionStartRequest request,
  ) {
    redemptionStartRequests.add(request);
    return onRedemptionStart!(request);
  }
}

final class _Harness {
  _Harness({
    required this.api,
    required CustomerBiteSaverAuthSnapshot auth,
    _ManualScheduler? scheduler,
    CustomerBiteSaverFavoriteActions? favoriteActions,
    CustomerBiteSaverDelay? delay,
    DateTime Function()? coordinatorClock,
    int maximumStatusPolls = 20,
    int maximumGuestProtocolSteps = 12,
  }) : preferences = _MemoryPreferences(),
       scheduler = scheduler ?? _ManualScheduler(),
       now = DateTime.fromMillisecondsSinceEpoch(
         _evaluationAtMillis + 1000,
         isUtc: true,
       ) {
    store = CustomerBiteSaverGuestUsageStore(
      guestDeviceId: 'coordinator-guest-device',
      preferences: preferences,
      clock: () => now,
    );
    var sequence = 0;
    coordinator = CustomerBiteSaverSearchCoordinator(
      api: api,
      guestUsageStore: store,
      clientInstanceId: _clientInstanceId,
      initialAuth: auth,
      favoriteActions: favoriteActions,
      requestIdGenerator: () =>
          'coordinator-request-${(++sequence).toString().padLeft(8, '0')}',
      clock: coordinatorClock ?? () => now,
      scheduler: this.scheduler.schedule,
      delay: delay ?? (_) async {},
      maximumStatusPolls: maximumStatusPolls,
      maximumGuestProtocolSteps: maximumGuestProtocolSteps,
    );
  }

  final _FakeApi api;
  final _MemoryPreferences preferences;
  final _ManualScheduler scheduler;
  late final CustomerBiteSaverGuestUsageStore store;
  late final CustomerBiteSaverSearchCoordinator coordinator;
  DateTime now;

  void dispose() => coordinator.dispose();
}

Future<CustomerBiteSaverGuestRedemptionStart> _seedActiveTimer(
  _Harness harness, {
  required CustomerBiteSaverRestaurantId restaurantId,
  required CustomerBiteSaverOfferId offerId,
  required String redemptionRequestId,
  required int minutesBeforeEvaluation,
  required int expectedRevision,
}) async {
  final startedAt =
      _evaluationAtMillis -
      Duration(minutes: minutesBeforeEvaluation).inMilliseconds;
  harness.now = DateTime.fromMillisecondsSinceEpoch(startedAt, isUtc: true);
  final started = await harness.store.startRedemption(
    redemptionRequestId: redemptionRequestId,
    restaurantId: restaurantId,
    offerId: offerId,
    usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
    reusableAfterTimer: true,
    evaluationContext: _localEvaluationContext(startedAt),
    validationExpiresAtMillis: startedAt + 60000,
    expectedGuestStateRevision: expectedRevision,
  );
  harness.now = DateTime.fromMillisecondsSinceEpoch(
    _evaluationAtMillis + 1000,
    isUtc: true,
  );
  return started;
}

void main() {
  setUpAll(() {
    _fixture =
        jsonDecode(File(_fixturePath).readAsStringSync())!
            as Map<String, dynamic>;
    _signedResponses = _map(_map(_fixture['signed'])['responses']);
    _guestResponses = _map(_map(_fixture['guest'])['responses']);
  });

  test(
    'signed page point-reads retained guest evidence before availability',
    () async {
      final api = _FakeApi();
      final offerJson = _offerJson(901);
      offerJson['offerType'] = 'coupon';
      offerJson['usageRule'] = 'Once per customer';
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(901, offers: <Map<String, dynamic>>[offerJson]),
        ]),
      );
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(901));
      final localOfferId = CustomerBiteSaverOfferId(_offerId(901));
      api.onValidation = (_) async =>
          _signedValidationResponse(restaurantId, localOfferId);
      api.onRedemptionStart = (_) async =>
          throw StateError('locally restricted start reached the server');
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      final localStartAt =
          _evaluationAtMillis -
          customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds;
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        localStartAt,
        isUtc: true,
      );
      await harness.store.startRedemption(
        redemptionRequestId: 'signed-overlay-local-use-0001',
        restaurantId: restaurantId,
        offerId: localOfferId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: CustomerBiteSaverEvaluationContext(
          sessionId: _map(_signedResponses['start'])['sessionId']! as String,
          attemptGeneration: 0,
          queryFingerprint:
              _map(_signedResponses['start'])['queryFingerprint']! as String,
          evaluationAtMillis: localStartAt,
          timeZone: 'America/New_York',
          utcOffsetMinutes: -240,
          availabilityGeneration: 'a' * 64,
          validUntilExclusiveMillis:
              localStartAt +
              CustomerBiteSaverSearchContract
                  .usageEvaluationMaximumLifetimeMilliseconds,
          oncePerDayUnavailableWindows:
              <CustomerBiteSaverOncePerDayUnavailableWindow>[
                CustomerBiteSaverOncePerDayUnavailableWindow(
                  startAtMillisInclusive:
                      localStartAt - Duration.millisecondsPerDay,
                  endAtMillisExclusive: localStartAt + 1,
                ),
              ],
        ),
        validationExpiresAtMillis: localStartAt + 60000,
        expectedGuestStateRevision: 0,
      );
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        _evaluationAtMillis + 1000,
        isUtc: true,
      );
      harness.preferences.readKeys.clear();

      await harness.coordinator.startSearch(_criteria());

      expect(
        harness.preferences.readKeys,
        contains(harness.store.offerKey(localOfferId)),
      );
      final effective = harness.coordinator.effectiveOfferAvailability(
        localOfferId,
      );
      expect(effective.serverAvailable, isTrue);
      expect(
        effective.localUsageState,
        CustomerBiteSaverLocalUsageOverlayState.unavailable,
      );
      expect(effective.available, isFalse);
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: localOfferId,
        redemptionRequestId: 'signed-overlay-validation-0001',
      );
      expect(decision.allowed, isFalse);
      expect(decision.reason, 'localUsageUnavailable');
      await expectLater(
        harness.coordinator.startValidatedRedemption(),
        throwsA(isA<StateError>()),
      );
      expect(api.redemptionStartRequests, isEmpty);
    },
  );

  test('signed active-timer overlay expires into Fresh Search', () async {
    final api = _FakeApi();
    final offerJson = _offerJson(902)
      ..['usagePolicy'] = 'reusableAfterTimer'
      ..['usageRule'] = 'Reusable after timer';
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(902, offers: <Map<String, dynamic>>[offerJson]),
      ]),
    );
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    final localStartAt =
        _evaluationAtMillis - const Duration(minutes: 4).inMilliseconds;
    final offerId = CustomerBiteSaverOfferId(_offerId(902));
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      localStartAt,
      isUtc: true,
    );
    final localStart = await harness.store.startRedemption(
      redemptionRequestId: 'signed-overlay-active-timer-0001',
      restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(902)),
      offerId: offerId,
      usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      reusableAfterTimer: true,
      evaluationContext: CustomerBiteSaverEvaluationContext(
        sessionId: _map(_signedResponses['start'])['sessionId']! as String,
        attemptGeneration: 0,
        queryFingerprint:
            _map(_signedResponses['start'])['queryFingerprint']! as String,
        evaluationAtMillis: localStartAt,
        timeZone: 'America/New_York',
        utcOffsetMinutes: -240,
        availabilityGeneration: 'b' * 64,
        validUntilExclusiveMillis:
            localStartAt +
            CustomerBiteSaverSearchContract
                .usageEvaluationMaximumLifetimeMilliseconds,
        oncePerDayUnavailableWindows:
            <CustomerBiteSaverOncePerDayUnavailableWindow>[
              CustomerBiteSaverOncePerDayUnavailableWindow(
                startAtMillisInclusive:
                    localStartAt - Duration.millisecondsPerDay,
                endAtMillisExclusive: localStartAt + 1,
              ),
            ],
      ),
      validationExpiresAtMillis: localStartAt + 60000,
      expectedGuestStateRevision: 0,
    );
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      _evaluationAtMillis + 1000,
      isUtc: true,
    );

    await harness.coordinator.startSearch(_criteria());

    final effective = harness.coordinator.effectiveOfferAvailability(offerId);
    expect(
      effective.localUsageState,
      CustomerBiteSaverLocalUsageOverlayState.activeTimer,
    );
    expect(
      effective.localActiveTimerExpiresAtMillis,
      localStart.timerExpiresAtMillis,
    );
    final timerExpiryTask = harness.scheduler.tasks.singleWhere(
      (task) =>
          !task.cancelled &&
          task.delay ==
              Duration(
                milliseconds:
                    localStart.timerExpiresAtMillis -
                    harness.now.millisecondsSinceEpoch,
              ),
    );
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      localStart.timerExpiresAtMillis,
      isUtc: true,
    );
    final expiredEffective = harness.coordinator.effectiveOfferAvailability(
      offerId,
    );
    expect(
      expiredEffective.localUsageState,
      CustomerBiteSaverLocalUsageOverlayState.unknown,
    );
    expect(expiredEffective.available, isFalse);
    timerExpiryTask.fire();

    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
    );
  });

  test('guest active-timer evidence expires into Fresh Search', () async {
    final api = _FakeApi();
    api.onStart = (_) async => _startResponse();
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
    );
    addTearDown(harness.dispose);

    final challenge = _copyMap(_guestResponses['restaurantChallenge']);
    final candidate = _map((challenge['candidates']! as List).first);
    final offerId = CustomerBiteSaverOfferId(candidate['offerId']! as String);
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(903));
    final localStartAt =
        _evaluationAtMillis - const Duration(minutes: 4).inMilliseconds;
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      localStartAt,
      isUtc: true,
    );
    final localStart = await harness.store.startRedemption(
      redemptionRequestId: 'guest-page-active-timer-0001',
      restaurantId: restaurantId,
      offerId: offerId,
      usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      reusableAfterTimer: true,
      evaluationContext: _localEvaluationContext(localStartAt),
      validationExpiresAtMillis: localStartAt + 60000,
      expectedGuestStateRevision: 0,
    );
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      _evaluationAtMillis + 1000,
      isUtc: true,
    );
    challenge['guestStateRevision'] = 1;
    api.onRestaurantPage = (_) async =>
        _guestRestaurantResponse(challenge, guestStateRevision: 1);
    final complete = _copyMap(_guestResponses['restaurantComplete']);
    final result = _map(complete['result']);
    result['restaurants'] = <Object?>[];
    complete['result'] = result;
    api.onContinuation = (_) async =>
        _guestContinuationResponse(complete, guestStateRevision: 1);

    await harness.coordinator.startSearch(_criteria());

    expect(
      api.continuationRequests.single.unavailableOfferIds,
      isNot(contains(offerId)),
    );
    final timerExpiryTask = harness.scheduler.tasks.singleWhere(
      (task) =>
          !task.cancelled &&
          task.delay ==
              Duration(
                milliseconds:
                    localStart.timerExpiresAtMillis -
                    harness.now.millisecondsSinceEpoch,
              ),
    );
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      localStart.timerExpiresAtMillis,
      isUtc: true,
    );
    timerExpiryTask.fire();

    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
    );
  });

  test(
    'guest restaurant non-progress rejects its pending timer deadline',
    () async {
      const repeatedCursor = 'bsc1.rejected-guest-timer';
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final challenge = _copyMap(_guestResponses['restaurantChallenge']);
      final challengedOfferId = CustomerBiteSaverOfferId(
        _map((challenge['candidates']! as List).first)['offerId']! as String,
      );
      final active = await _seedActiveTimer(
        harness,
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(920)),
        offerId: challengedOfferId,
        redemptionRequestId: 'rejected-restaurant-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );
      final initial = _copyMap(_guestResponses['restaurantComplete']);
      initial['guestStateRevision'] = 1;
      final initialResult = _map(initial['result']);
      initialResult['nextCursor'] = repeatedCursor;
      initialResult['hasMore'] = true;
      initial['result'] = initialResult;
      final rejected = _copyMap(_guestResponses['restaurantComplete']);
      rejected['guestStateRevision'] = 1;
      final rejectedResult = _map(rejected['result']);
      rejectedResult['nextCursor'] = repeatedCursor;
      rejectedResult['hasMore'] = true;
      rejected['result'] = rejectedResult;
      var pageCalls = 0;
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        return pageCalls == 1
            ? _guestRestaurantResponse(initial, guestStateRevision: 1)
            : _guestRestaurantResponse(challenge, guestStateRevision: 1);
      };
      api.onContinuation = (_) async =>
          _guestContinuationResponse(rejected, guestStateRevision: 1);

      await harness.coordinator.startSearch(_criteria());
      final pager = harness.coordinator.restaurantPager!;
      final acceptedContextDeadline =
          _map(initial['evaluationContext'])['validUntilExclusiveMillis']!
              as int;
      final acceptedContextTask = harness.scheduler.tasks.singleWhere(
        (task) =>
            !task.cancelled &&
            task.delay ==
                Duration(
                  milliseconds:
                      acceptedContextDeadline -
                      harness.now.millisecondsSinceEpoch,
                ),
      );

      await pager.loadMore();

      final rejectedDelay = Duration(
        milliseconds:
            active.timerExpiresAtMillis - harness.now.millisecondsSinceEpoch,
      );
      expect(pager.error, isA<CustomerLoadMoreNonProgressException>());
      expect(acceptedContextTask.cancelled, isFalse);
      expect(
        harness.scheduler.tasks.where(
          (task) => !task.cancelled && task.delay == rejectedDelay,
        ),
        isEmpty,
      );
      expect(
        pager.items,
        hasLength((initialResult['restaurants']! as List).length),
      );

      harness.now = DateTime.fromMillisecondsSinceEpoch(
        active.timerExpiresAtMillis,
        isUtc: true,
      );
      for (final task in harness.scheduler.tasks.where(
        (task) => !task.cancelled && task.delay == rejectedDelay,
      )) {
        task.fire();
      }
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
    },
  );

  test(
    'expired unaccepted timer evidence fails only its pending page',
    () async {
      const repeatedCursor = 'bsc1.delayed-rejected-guest-timer';
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final challenge = _copyMap(_guestResponses['restaurantChallenge']);
      final challengedOfferId = CustomerBiteSaverOfferId(
        _map((challenge['candidates']! as List).first)['offerId']! as String,
      );
      final active = await _seedActiveTimer(
        harness,
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(921)),
        offerId: challengedOfferId,
        redemptionRequestId: 'delayed-rejected-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );
      final initial = _copyMap(_guestResponses['restaurantComplete']);
      initial['guestStateRevision'] = 1;
      final initialResult = _map(initial['result']);
      initialResult['nextCursor'] = repeatedCursor;
      initialResult['hasMore'] = true;
      initial['result'] = initialResult;
      final rejected = _copyMap(_guestResponses['restaurantComplete']);
      rejected['guestStateRevision'] = 1;
      final rejectedResult = _map(rejected['result']);
      rejectedResult['nextCursor'] = repeatedCursor;
      rejectedResult['hasMore'] = true;
      rejected['result'] = rejectedResult;
      var pageCalls = 0;
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        return pageCalls == 1
            ? _guestRestaurantResponse(initial, guestStateRevision: 1)
            : _guestRestaurantResponse(challenge, guestStateRevision: 1);
      };
      final completionGate =
          Completer<
            CustomerBiteSaverGuestOperationResponse<
              CustomerBiteSaverOperationResult
            >
          >();
      api.onContinuation = (_) => completionGate.future;

      await harness.coordinator.startSearch(_criteria());
      final pager = harness.coordinator.restaurantPager!;
      final acceptedContextDeadline =
          _map(initial['evaluationContext'])['validUntilExclusiveMillis']!
              as int;
      final acceptedContextTask = harness.scheduler.tasks.singleWhere(
        (task) =>
            !task.cancelled &&
            task.delay ==
                Duration(
                  milliseconds:
                      acceptedContextDeadline -
                      harness.now.millisecondsSinceEpoch,
                ),
      );
      final load = pager.loadMore();
      await pumpEventQueue();
      expect(api.continuationRequests, hasLength(1));

      harness.now = DateTime.fromMillisecondsSinceEpoch(
        active.timerExpiresAtMillis,
        isUtc: true,
      );
      completionGate.complete(
        _guestContinuationResponse(rejected, guestStateRevision: 1),
      );
      await load;

      expect(pager.error, isA<CustomerBiteSaverStaleOperationException>());
      expect(
        pager.items,
        hasLength((initialResult['restaurants']! as List).length),
      );
      expect(acceptedContextTask.cancelled, isFalse);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
    },
  );

  test(
    'guest additional-offer non-progress rejects its timer deadline',
    () async {
      const repeatedCursor = 'bsc1.rejected-offer-timer';
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final challenge = _copyMap(_guestResponses['offerChallenge']);
      final challengedOfferId = CustomerBiteSaverOfferId(
        _map((challenge['candidates']! as List).first)['offerId']! as String,
      );
      final active = await _seedActiveTimer(
        harness,
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(930)),
        offerId: challengedOfferId,
        redemptionRequestId: 'rejected-offer-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(931));
      final restaurantComplete = _copyMap(
        _guestResponses['restaurantComplete'],
      );
      restaurantComplete['guestStateRevision'] = 1;
      final restaurantResult = _map(restaurantComplete['result']);
      restaurantResult['restaurants'] = <Map<String, dynamic>>[
        _restaurantJson(
          931,
          offers: <Map<String, dynamic>>[_offerJson(931)],
          hasMoreOffers: true,
        ),
      ];
      restaurantComplete['result'] = restaurantResult;
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(restaurantComplete, guestStateRevision: 1);

      final first = _copyMap(_guestResponses['offerComplete']);
      first['guestStateRevision'] = 1;
      final firstResult = _map(first['result']);
      firstResult['restaurantId'] = restaurantId.value;
      firstResult['offers'] = <Map<String, dynamic>>[_offerJson(932)];
      firstResult['nextCursor'] = repeatedCursor;
      firstResult['hasMore'] = true;
      first['result'] = firstResult;
      final rejected = _copyMap(_guestResponses['offerComplete']);
      rejected['guestStateRevision'] = 1;
      final rejectedResult = _map(rejected['result']);
      rejectedResult['restaurantId'] = restaurantId.value;
      rejectedResult['offers'] = <Map<String, dynamic>>[_offerJson(933)];
      rejectedResult['nextCursor'] = repeatedCursor;
      rejectedResult['hasMore'] = true;
      rejected['result'] = rejectedResult;
      var offerPageCalls = 0;
      api.onOfferPage = (_) async {
        offerPageCalls += 1;
        return offerPageCalls == 1
            ? _guestOfferResponse(first, guestStateRevision: 1)
            : _guestOfferResponse(challenge, guestStateRevision: 1);
      };
      api.onContinuation = (_) async =>
          _guestContinuationResponse(rejected, guestStateRevision: 1);

      await harness.coordinator.startSearch(_criteria());
      final pager = await harness.coordinator.loadOffers(restaurantId);
      final acceptedContextDeadline =
          _map(
                restaurantComplete['evaluationContext'],
              )['validUntilExclusiveMillis']!
              as int;
      final acceptedContextTask = harness.scheduler.tasks.singleWhere(
        (task) =>
            !task.cancelled &&
            task.delay ==
                Duration(
                  milliseconds:
                      acceptedContextDeadline -
                      harness.now.millisecondsSinceEpoch,
                ),
      );

      await pager.loadMore();

      final rejectedDelay = Duration(
        milliseconds:
            active.timerExpiresAtMillis - harness.now.millisecondsSinceEpoch,
      );
      expect(pager.error, isA<CustomerLoadMoreNonProgressException>());
      expect(pager.items.map((offer) => offer.offerId.value), <String>[
        _offerId(932),
      ]);
      expect(acceptedContextTask.cancelled, isFalse);
      expect(
        harness.scheduler.tasks.where(
          (task) => !task.cancelled && task.delay == rejectedDelay,
        ),
        isEmpty,
      );
    },
  );

  test('guest ownership rejection cannot install a challenged timer', () async {
    const nextCursor = 'bsc1.rejected-owner-timer';
    final api = _FakeApi();
    api.onStart = (_) async => _startResponse();
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
    );
    addTearDown(harness.dispose);
    final challenge = _copyMap(_guestResponses['restaurantChallenge']);
    final challengedOfferId = CustomerBiteSaverOfferId(
      _map((challenge['candidates']! as List).first)['offerId']! as String,
    );
    final active = await _seedActiveTimer(
      harness,
      restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(940)),
      offerId: challengedOfferId,
      redemptionRequestId: 'rejected-owner-timer-0001',
      minutesBeforeEvaluation: 4,
      expectedRevision: 0,
    );
    final ownedOffer = _offerJson(940)..['offerId'] = challengedOfferId.value;
    final initial = _copyMap(_guestResponses['restaurantComplete']);
    initial['guestStateRevision'] = 1;
    final initialResult = _map(initial['result']);
    initialResult['restaurants'] = <Map<String, dynamic>>[
      _restaurantJson(940, offers: <Map<String, dynamic>>[ownedOffer]),
    ];
    initialResult['nextCursor'] = nextCursor;
    initialResult['hasMore'] = true;
    initial['result'] = initialResult;
    final rejected = _copyMap(_guestResponses['restaurantComplete']);
    rejected['guestStateRevision'] = 1;
    final rejectedResult = _map(rejected['result']);
    rejectedResult['restaurants'] = <Map<String, dynamic>>[
      _restaurantJson(941, offers: <Map<String, dynamic>>[ownedOffer]),
    ];
    rejectedResult['nextCursor'] = null;
    rejectedResult['hasMore'] = false;
    rejected['result'] = rejectedResult;
    var pageCalls = 0;
    api.onRestaurantPage = (_) async {
      pageCalls += 1;
      return pageCalls == 1
          ? _guestRestaurantResponse(initial, guestStateRevision: 1)
          : _guestRestaurantResponse(challenge, guestStateRevision: 1);
    };
    api.onContinuation = (_) async =>
        _guestContinuationResponse(rejected, guestStateRevision: 1);

    await harness.coordinator.startSearch(_criteria());
    final pager = harness.coordinator.restaurantPager!;
    final acceptedContextDeadline =
        _map(initial['evaluationContext'])['validUntilExclusiveMillis']! as int;
    final acceptedContextTask = harness.scheduler.tasks.singleWhere(
      (task) =>
          !task.cancelled &&
          task.delay ==
              Duration(
                milliseconds:
                    acceptedContextDeadline -
                    harness.now.millisecondsSinceEpoch,
              ),
    );

    await pager.loadMore();

    final rejectedDelay = Duration(
      milliseconds:
          active.timerExpiresAtMillis - harness.now.millisecondsSinceEpoch,
    );
    expect(pager.error, isA<CustomerBiteSaverProtocolException>());
    expect(pager.items, hasLength(1));
    expect(acceptedContextTask.cancelled, isFalse);
    expect(
      harness.scheduler.tasks.where(
        (task) => !task.cancelled && task.delay == rejectedDelay,
      ),
      isEmpty,
    );
    await expectLater(
      harness.coordinator.validateRedemption(
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(941)),
        offerId: challengedOfferId,
        redemptionRequestId: 'rejected-owner-validation-0001',
      ),
      throwsA(isA<StateError>()),
    );
  });

  test('accepted repeated guest rounds install their earliest timer', () async {
    final api = _FakeApi();
    api.onStart = (_) async => _startResponse();
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
    );
    addTearDown(harness.dispose);
    final sourceChallenge = _copyMap(_guestResponses['restaurantChallenge']);
    final sourceCandidates = sourceChallenge['candidates']! as List;
    final firstOfferId = CustomerBiteSaverOfferId(
      _map(sourceCandidates[0])['offerId']! as String,
    );
    final secondOfferId = CustomerBiteSaverOfferId(
      _map(sourceCandidates[1])['offerId']! as String,
    );
    final firstTimer = await _seedActiveTimer(
      harness,
      restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(950)),
      offerId: firstOfferId,
      redemptionRequestId: 'multi-round-timer-a-0001',
      minutesBeforeEvaluation: 4,
      expectedRevision: 0,
    );
    await _seedActiveTimer(
      harness,
      restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(951)),
      offerId: secondOfferId,
      redemptionRequestId: 'multi-round-timer-b-0001',
      minutesBeforeEvaluation: 3,
      expectedRevision: 1,
    );
    final firstChallenge = _copyMap(sourceChallenge);
    firstChallenge['guestStateRevision'] = 2;
    firstChallenge['candidates'] = <Object?>[sourceCandidates[0]];
    final secondChallenge = _copyMap(sourceChallenge);
    secondChallenge['guestStateRevision'] = 2;
    secondChallenge['batchSequence'] = 1;
    secondChallenge['candidates'] = <Object?>[sourceCandidates[1]];
    final complete = _copyMap(_guestResponses['restaurantComplete']);
    complete['guestStateRevision'] = 2;
    final completionGate =
        Completer<
          CustomerBiteSaverGuestOperationResponse<
            CustomerBiteSaverOperationResult
          >
        >();
    api.onRestaurantPage = (_) async =>
        _guestRestaurantResponse(firstChallenge, guestStateRevision: 2);
    var continuations = 0;
    api.onContinuation = (_) {
      continuations += 1;
      return continuations == 1
          ? Future.value(
              _guestContinuationResponse(
                secondChallenge,
                guestStateRevision: 2,
              ),
            )
          : completionGate.future;
    };

    final search = harness.coordinator.startSearch(_criteria());
    await pumpEventQueue();
    final earliestDelay = Duration(
      milliseconds:
          firstTimer.timerExpiresAtMillis - harness.now.millisecondsSinceEpoch,
    );
    expect(continuations, 2);
    expect(
      harness.scheduler.tasks.where(
        (task) => !task.cancelled && task.delay == earliestDelay,
      ),
      isEmpty,
    );

    completionGate.complete(
      _guestContinuationResponse(complete, guestStateRevision: 2),
    );
    await search;

    expect(
      harness.scheduler.tasks.where(
        (task) => !task.cancelled && task.delay == earliestDelay,
      ),
      hasLength(1),
    );
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.ready,
    );
  });

  test(
    'stale guest page completion cannot cross auth with its timer',
    () async {
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      final challenge = _copyMap(_guestResponses['restaurantChallenge']);
      challenge['guestStateRevision'] = 1;
      final complete = _copyMap(_guestResponses['restaurantComplete']);
      complete['guestStateRevision'] = 1;
      final completionGate =
          Completer<
            CustomerBiteSaverGuestOperationResponse<
              CustomerBiteSaverOperationResult
            >
          >();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(challenge, guestStateRevision: 1);
      api.onContinuation = (_) => completionGate.future;
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final challengedOfferId = CustomerBiteSaverOfferId(
        _map((challenge['candidates']! as List).first)['offerId']! as String,
      );
      final active = await _seedActiveTimer(
        harness,
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(952)),
        offerId: challengedOfferId,
        redemptionRequestId: 'stale-auth-page-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );

      final search = harness.coordinator.startSearch(_criteria());
      await pumpEventQueue();
      expect(api.continuationRequests, hasLength(1));
      await harness.coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
      );
      completionGate.complete(
        _guestContinuationResponse(complete, guestStateRevision: 1),
      );
      await search;

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.idle,
      );
      expect(harness.coordinator.restaurantPager, isNull);
      expect(
        harness.scheduler.tasks.where(
          (task) =>
              !task.cancelled &&
              task.delay ==
                  Duration(
                    milliseconds:
                        active.timerExpiresAtMillis -
                        harness.now.millisecondsSinceEpoch,
                  ),
        ),
        isEmpty,
      );
    },
  );

  test(
    'accepted signed and guest page contexts expire without coupon overlays',
    () async {
      const validUntilExclusiveMillis = _evaluationAtMillis + 1500;
      for (final auth in <CustomerBiteSaverAuthSnapshot>[
        const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        const CustomerBiteSaverAuthSnapshot.signedOut(),
      ]) {
        final api = _FakeApi();
        api.onStart = (_) async => _startResponse();
        final dailyOffer = _offerJson(auth.isSigned ? 904 : 905)
          ..['offerType'] = 'dailySpecial'
          ..['usagePolicy'] = null;
        final page = _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            auth.isSigned ? 904 : 905,
            offers: <Map<String, dynamic>>[dailyOffer],
          ),
        ]);
        if (auth.isSigned) {
          api.onRestaurantPage = (_) async => _direct(
            page,
            evaluationContext: _evaluationContextFor(
              page,
              validUntilExclusiveMillis: validUntilExclusiveMillis,
            ),
          );
        } else {
          final complete = _copyMap(_guestResponses['restaurantComplete']);
          final result = _map(complete['result']);
          result['restaurants'] = <Map<String, dynamic>>[
            _restaurantJson(905, offers: <Map<String, dynamic>>[dailyOffer]),
          ];
          complete['result'] = result;
          final context = _map(complete['evaluationContext']);
          context['validUntilExclusiveMillis'] = validUntilExclusiveMillis;
          complete['evaluationContext'] = context;
          api.onRestaurantPage = (_) async =>
              _guestRestaurantResponse(complete);
        }
        final harness = _Harness(api: api, auth: auth);
        addTearDown(harness.dispose);

        await harness.coordinator.startSearch(_criteria());

        final contextExpiryTask = harness.scheduler.tasks.singleWhere(
          (task) =>
              !task.cancelled &&
              task.delay == const Duration(milliseconds: 500),
        );
        harness.now = DateTime.fromMillisecondsSinceEpoch(
          validUntilExclusiveMillis,
          isUtc: true,
        );
        contextExpiryTask.fire();
        expect(
          harness.coordinator.status,
          CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
        );
      }
    },
  );

  test(
    'synchronous accepted-page expiry cannot repopulate guest or signed state',
    () async {
      for (final signed in <bool>[false, true]) {
        final api = _FakeApi();
        api.onStart = (_) async => _startResponse();
        final deadline = _evaluationAtMillis + 1001;
        var armed = false;
        var armedClockReads = 0;
        var pageCalls = 0;
        final schedulingClockRead = signed ? 5 : 2;
        final harness = _Harness(
          api: api,
          auth: signed
              ? const CustomerBiteSaverAuthSnapshot.signed('signed-a')
              : const CustomerBiteSaverAuthSnapshot.signedOut(),
          coordinatorClock: () {
            if (!armed) {
              return DateTime.fromMillisecondsSinceEpoch(
                _evaluationAtMillis + 1000,
                isUtc: true,
              );
            }
            armedClockReads += 1;
            return DateTime.fromMillisecondsSinceEpoch(
              armedClockReads >= schedulingClockRead ? deadline : deadline - 1,
              isUtc: true,
            );
          },
        );
        addTearDown(harness.dispose);
        final restaurantValue = signed ? 960 : 961;
        final replacementRestaurantValue = signed ? 1060 : 1061;
        final offerJson = _offerJson(restaurantValue);
        final page = _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            restaurantValue,
            offers: <Map<String, dynamic>>[offerJson],
          ),
        ]);
        final replacementPage = _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            replacementRestaurantValue,
            offers: <Map<String, dynamic>>[offerJson],
          ),
        ]);
        if (signed) {
          api.onRestaurantPage = (_) async {
            pageCalls += 1;
            if (pageCalls > 1) {
              return _direct(replacementPage);
            }
            armed = true;
            return _direct(
              page,
              evaluationContext: _evaluationContextFor(
                page,
                validUntilExclusiveMillis: deadline,
              ),
            );
          };
        } else {
          final complete = _copyMap(_guestResponses['restaurantComplete']);
          final result = _map(complete['result']);
          result['restaurants'] = <Map<String, dynamic>>[
            _restaurantJson(961, offers: <Map<String, dynamic>>[offerJson]),
          ];
          complete['result'] = result;
          final context = _map(complete['evaluationContext']);
          context['validUntilExclusiveMillis'] = deadline;
          complete['evaluationContext'] = context;
          final replacementComplete = _copyMap(
            _guestResponses['restaurantComplete'],
          );
          final replacementResult = _map(replacementComplete['result']);
          replacementResult['restaurants'] = <Map<String, dynamic>>[
            _restaurantJson(
              replacementRestaurantValue,
              offers: <Map<String, dynamic>>[offerJson],
            ),
          ];
          replacementComplete['result'] = replacementResult;
          api.onRestaurantPage = (_) async {
            pageCalls += 1;
            if (pageCalls > 1) {
              return _guestRestaurantResponse(replacementComplete);
            }
            armed = true;
            return _guestRestaurantResponse(complete);
          };
        }
        CustomerLoadMoreController<CustomerBiteSaverRestaurant>? captured;
        Future<void>? replacementSearch;
        var sawFreshSearchRequired = false;
        var pagerNotifications = 0;
        harness.coordinator.addListener(() {
          if (harness.coordinator.status ==
                  CustomerBiteSaverCoordinatorStatus.freshSearchRequired &&
              replacementSearch == null) {
            sawFreshSearchRequired = true;
            armed = false;
            replacementSearch = harness.coordinator.startSearch(
              _criteria('replacement'),
            );
          }
          final pager = harness.coordinator.restaurantPager;
          if (captured == null && pager != null) {
            captured = pager;
            pager.addListener(() => pagerNotifications += 1);
          }
        });

        await harness.coordinator.startSearch(_criteria());
        await replacementSearch!;

        expect(armedClockReads, schedulingClockRead);
        expect(sawFreshSearchRequired, isTrue);
        expect(
          harness.coordinator.status,
          CustomerBiteSaverCoordinatorStatus.ready,
        );
        expect(harness.coordinator.restaurantPager?.error, isNull);
        expect(
          harness.coordinator.restaurants.single.restaurantId.value,
          _restaurantId(replacementRestaurantValue),
        );
        expect(captured, isNotNull);
        expect(captured!.isDisposed, isTrue);
        expect(captured!.items, isEmpty);
        expect(captured!.pageEnvelope, isNull);
        expect(captured!.hasNext, isFalse);
        expect(captured!.error, isNull);
        expect(pagerNotifications, 1);
        expect(
          harness.coordinator
              .effectiveOfferAvailability(
                CustomerBiteSaverOfferId(offerJson['offerId']! as String),
              )
              .localUsageState,
          signed
              ? CustomerBiteSaverLocalUsageOverlayState.clear
              : CustomerBiteSaverLocalUsageOverlayState.notApplicable,
        );
      }
    },
  );

  test('server-canonical IANA aliases remain session-bound', () async {
    for (final auth in <CustomerBiteSaverAuthSnapshot>[
      const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      const CustomerBiteSaverAuthSnapshot.signedOut(),
    ]) {
      final api = _FakeApi();
      api.onStart = (request) async {
        expect(request.criteria.timeZone, 'US/Eastern');
        return _startResponse();
      };
      final page = _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(auth.isSigned ? 906 : 907),
      ]);
      if (auth.isSigned) {
        api.onRestaurantPage = (_) async => _direct(page);
      } else {
        final complete = _copyMap(_guestResponses['restaurantComplete']);
        final result = _map(complete['result']);
        result['restaurants'] = <Map<String, dynamic>>[_restaurantJson(907)];
        complete['result'] = result;
        api.onRestaurantPage = (_) async => _guestRestaurantResponse(complete);
      }
      final harness = _Harness(api: api, auth: auth);

      await harness.coordinator.startSearch(_criteria('', 'US/Eastern'));

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurants, hasLength(1));
      harness.dispose();
    }
  });

  test('an expired signed evaluation requires a fresh search', () async {
    final api = _FakeApi();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(904));
    final offerId = CustomerBiteSaverOfferId(_offerId(904));
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(904, offers: <Map<String, dynamic>>[_offerJson(904)]),
      ]),
    );
    final validationJson =
        _directResultMap(_signedResponses['redemptionValidation'])
          ..['restaurantId'] = restaurantId.value
          ..['offerId'] = offerId.value;
    final validation = CustomerBiteSaverRedemptionValidationResult.fromJson(
      validationJson,
    );
    api.onValidation = (_) async => _direct(
      validation,
      evaluationContext: _evaluationContextFor(
        validation,
        validUntilExclusiveMillis: _evaluationAtMillis + 1500,
      ),
    );
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);
    await harness.coordinator.startSearch(_criteria());
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      _evaluationAtMillis + 1500,
      isUtc: true,
    );

    await expectLater(
      harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'signed-expired-context-0001',
      ),
      throwsA(isA<CustomerBiteSaverFreshSearchRequiredException>()),
    );
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
    );
    expect(api.redemptionStartRequests, isEmpty);
  });

  test('signed validation cannot cross a local revision change', () async {
    final api = _FakeApi();
    final pendingValidation =
        Completer<
          CustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(903));
    final offerId = CustomerBiteSaverOfferId(_offerId(903));
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(903, offers: <Map<String, dynamic>>[_offerJson(903)]),
      ]),
    );
    api.onValidation = (_) => pendingValidation.future;
    api.onRedemptionStart = (_) async =>
        throw StateError('stale local evidence reached signed start');
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);
    await harness.coordinator.startSearch(_criteria());

    final validation = harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerId,
      redemptionRequestId: 'signed-local-revision-race-0001',
    );
    await pumpEventQueue();
    final localEvaluationAt = _evaluationAtMillis + 1000;
    await harness.store.startRedemption(
      redemptionRequestId: 'signed-local-revision-write-0001',
      restaurantId: restaurantId,
      offerId: offerId,
      usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      evaluationContext: _localEvaluationContext(localEvaluationAt),
      validationExpiresAtMillis: localEvaluationAt + 60000,
      expectedGuestStateRevision: 0,
    );
    pendingValidation.complete(
      _signedValidationResponse(restaurantId, offerId),
    );

    await expectLater(
      validation,
      throwsA(isA<CustomerBiteSaverFreshSearchRequiredException>()),
    );
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
    );
    expect(harness.coordinator.redemptionDecision, isNull);
    expect(api.redemptionStartRequests, isEmpty);
  });

  test(
    'preparing polls are paced/non-overlapping and READY updates binding before page',
    () async {
      final api = _FakeApi();
      final scheduler = _ManualScheduler();
      final pendingStatus = Completer<CustomerBiteSaverStatusResponse>();
      api.onStart = (_) async => _startResponse(state: 'preparing');
      api.onStatus = (_) => pendingStatus.future;
      api.onRestaurantPage = (request) async {
        expect(request.binding.attemptGeneration, 1);
        expect(request.binding.queryFingerprint, 'f' * 64);
        return _direct(
          _restaurantPage(
            <Map<String, dynamic>>[_restaurantJson(1)],
            attemptGeneration: 1,
            queryFingerprint: 'f' * 64,
          ),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        scheduler: scheduler,
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.preparing,
      );
      expect(scheduler.tasks, hasLength(1));

      final firstPoll = harness.coordinator.pollNow();
      final duplicatePoll = harness.coordinator.pollNow();
      expect(api.statusRequests, hasLength(1));
      final readyJson = _copyMap(
        _map(_map(_signedResponses['status'])['ready']),
      );
      readyJson['attemptGeneration'] = 1;
      readyJson['queryFingerprint'] = 'f' * 64;
      pendingStatus.complete(
        CustomerBiteSaverStatusResponse.fromJson(readyJson),
      );
      await Future.wait(<Future<void>>[firstPoll, duplicatePoll]);

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(
        harness.coordinator.restaurants.single.displayName,
        'Restaurant 1',
      );
      expect(api.restaurantPageRequests.single.binding.attemptGeneration, 1);
    },
  );

  test('bounded preparing polls stop and surface an error', () async {
    final api = _FakeApi();
    api.onStart = (_) async => _startResponse(state: 'preparing');
    api.onStatus = (_) async => _statusResponse('preparing');
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      maximumStatusPolls: 2,
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    await harness.coordinator.pollNow();
    await harness.coordinator.pollNow();

    expect(api.statusRequests, hasLength(2));
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.error,
    );
    expect(
      harness.coordinator.error,
      isA<CustomerBiteSaverProtocolBudgetException>(),
    );
  });

  test(
    'transient status failure replays the exact request and recovers',
    () async {
      final api = _FakeApi();
      var statusAttempts = 0;
      api.onStart = (_) async => _startResponse(state: 'preparing');
      api.onStatus = (_) async {
        statusAttempts += 1;
        if (statusAttempts == 1) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.transport,
            code: 'transport-error',
            message: 'uncertain',
          );
        }
        return _statusResponse('ready');
      };
      api.onRestaurantPage = (_) async =>
          _direct(_restaurantPage(<Map<String, dynamic>>[_restaurantJson(1)]));
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.pollNow();
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.error,
      );
      final uncertainRequest = api.statusRequests.single.toJson();

      await harness.coordinator.retryStatusPoll();

      expect(api.statusRequests, hasLength(2));
      expect(api.statusRequests.last.toJson(), uncertainRequest);
      expect(harness.coordinator.statusPollCount, 1);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurants, hasLength(1));
    },
  );

  test('paced gate retry clears a recovered preparing error', () async {
    final api = _FakeApi();
    final scheduler = _ManualScheduler();
    var statusCalls = 0;
    api.onStart = (_) async => _startResponse(state: 'preparing');
    api.onStatus = (_) async {
      statusCalls += 1;
      if (statusCalls == 1) {
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.callable,
          code: 'resource-exhausted',
          message: 'The previous status request is still settling.',
        );
      }
      return _statusResponse('preparing');
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      scheduler: scheduler,
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    await harness.coordinator.pollNow();
    final retainedRequest = api.statusRequests.single.toJson();
    expect(harness.coordinator.error, isA<CustomerBiteSaverServiceException>());
    final retry = scheduler.tasks.last;
    expect(retry.delay, harness.coordinator.statusPollInterval);

    retry.fire();
    await pumpEventQueue();

    expect(api.statusRequests, hasLength(2));
    expect(api.statusRequests.last.toJson(), retainedRequest);
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.preparing,
    );
    expect(harness.coordinator.error, isNull);
  });

  test(
    'resource-exhausted status retries are bounded and explicit retry resets the budget',
    () async {
      final api = _FakeApi();
      final scheduler = _ManualScheduler();
      var statusCalls = 0;
      api.onStart = (_) async => _startResponse(state: 'preparing');
      api.onStatus = (_) async {
        statusCalls += 1;
        if (statusCalls <= 3) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.callable,
            code: 'resource-exhausted',
            message: 'The previous status request is still settling.',
          );
        }
        return _statusResponse('ready');
      };
      api.onRestaurantPage = (_) async =>
          _direct(_restaurantPage(<Map<String, dynamic>>[_restaurantJson(1)]));
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        scheduler: scheduler,
        maximumStatusPolls: 2,
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.pollNow();
      final retainedRequest = api.statusRequests.single.toJson();
      scheduler.tasks.last.fire();
      await pumpEventQueue();

      expect(api.statusRequests, hasLength(2));
      expect(api.statusRequests.last.toJson(), retainedRequest);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.error,
      );
      expect(
        harness.coordinator.error,
        isA<CustomerBiteSaverServiceException>(),
      );
      expect(
        scheduler.tasks.where((task) => !task.cancelled && !task.fired),
        isEmpty,
      );

      await harness.coordinator.retryStatusPoll();

      expect(api.statusRequests, hasLength(3));
      expect(api.statusRequests.last.toJson(), retainedRequest);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.preparing,
      );
      final resetBudgetRetry = scheduler.tasks.last;
      expect(resetBudgetRetry.cancelled, isFalse);
      expect(resetBudgetRetry.fired, isFalse);
      resetBudgetRetry.fire();
      await pumpEventQueue();

      expect(api.statusRequests, hasLength(4));
      expect(api.statusRequests.last.toJson(), retainedRequest);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.error, isNull);
      expect(harness.coordinator.restaurants, hasLength(1));
    },
  );

  test(
    'failed and expired statuses remain terminal until explicit action',
    () async {
      for (final terminal in <String>['failed', 'expired']) {
        final api = _FakeApi();
        api.onStart = (_) async => _startResponse(state: 'preparing');
        api.onStatus = (_) async => _statusResponse(terminal);
        final harness = _Harness(
          api: api,
          auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        );
        await harness.coordinator.startSearch(_criteria());
        await harness.coordinator.pollNow();
        expect(
          harness.coordinator.status,
          terminal == 'failed'
              ? CustomerBiteSaverCoordinatorStatus.failed
              : CustomerBiteSaverCoordinatorStatus.expired,
        );
        expect(api.startRequests, hasLength(1));
        if (terminal == 'failed') {
          expect(harness.coordinator.failureRetriable, isTrue);
        }
        harness.dispose();
      }
    },
  );

  test(
    'READY deadline reconciles authoritative expiry and disables paging',
    () async {
      final api = _FakeApi();
      final scheduler = _ManualScheduler();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _direct(_restaurantPage(<Map<String, dynamic>>[_restaurantJson(1)]));
      api.onStatus = (_) async => _statusResponse('expired');
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        scheduler: scheduler,
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final logicalExpiry = harness.coordinator.logicalExpiresAtMillis!;
      expect(scheduler.tasks, hasLength(2));
      expect(
        scheduler.tasks.first.delay,
        Duration(
          milliseconds: logicalExpiry - harness.now.millisecondsSinceEpoch,
        ),
      );

      harness.now = DateTime.fromMillisecondsSinceEpoch(
        logicalExpiry,
        isUtc: true,
      );
      scheduler.tasks.first.fire();
      await pumpEventQueue();

      expect(api.statusRequests, hasLength(1));
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.expired,
      );
      expect(harness.coordinator.restaurantPager, isNull);
      expect(harness.coordinator.restaurants, isEmpty);
      expect(
        scheduler.tasks.where((task) => !task.cancelled && !task.fired),
        isEmpty,
      );
    },
  );

  test(
    'READY reconciliation preserves pages when the server slid expiry',
    () async {
      final api = _FakeApi();
      final scheduler = _ManualScheduler();
      final oldExpiry = _startResponse().logicalExpiresAtMillis;
      final newExpiry = oldExpiry + const Duration(minutes: 10).inMilliseconds;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        final page = _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(1),
        ]);
        return _direct(
          page,
          evaluationContext: _evaluationContextFor(
            page,
            validUntilExclusiveMillis: newExpiry,
          ),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        scheduler: scheduler,
      );
      addTearDown(harness.dispose);
      await harness.coordinator.startSearch(_criteria());
      final originalPager = harness.coordinator.restaurantPager;
      expect(harness.coordinator.logicalExpiresAtMillis, oldExpiry);
      final ready = _copyMap(_map(_signedResponses['status'])['ready']);
      ready['logicalExpiresAtMillis'] = newExpiry;
      api.onStatus = (_) async =>
          CustomerBiteSaverStatusResponse.fromJson(ready);

      harness.now = DateTime.fromMillisecondsSinceEpoch(oldExpiry, isUtc: true);
      scheduler.tasks.first.fire();
      await pumpEventQueue();

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurantPager, same(originalPager));
      expect(
        harness.coordinator.restaurants.single.displayName,
        'Restaurant 1',
      );
      expect(api.restaurantPageRequests, hasLength(1));
      expect(scheduler.tasks, hasLength(3));
      expect(
        scheduler.tasks.last.delay,
        Duration(milliseconds: newExpiry - oldExpiry),
      );
    },
  );

  test('definitive page precondition reconciles to terminal expiry', () async {
    final api = _FakeApi();
    var pageCalls = 0;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async {
      pageCalls += 1;
      if (pageCalls == 1) {
        return _direct(
          _restaurantPage(<Map<String, dynamic>>[
            _restaurantJson(1),
          ], nextCursor: 'bsc1.page-1'),
        );
      }
      throw const CustomerBiteSaverServiceException(
        kind: CustomerBiteSaverServiceFailureKind.callable,
        code: 'failed-precondition',
        message: 'The BiteSaver search is not ready.',
      );
    };
    api.onStatus = (_) async => _statusResponse('expired');
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    final obsoletePager = harness.coordinator.restaurantPager!;
    await obsoletePager.loadMore();

    expect(api.restaurantPageRequests, hasLength(2));
    expect(api.statusRequests, hasLength(1));
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.expired,
    );
    expect(harness.coordinator.restaurantPager, isNull);
    await obsoletePager.loadMore();
    expect(api.restaurantPageRequests, hasLength(2));
  });

  test(
    'page reconciliation gate retries the exact status request at short cadence',
    () async {
      final api = _FakeApi();
      final scheduler = _ManualScheduler();
      var pageCalls = 0;
      var statusCalls = 0;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        if (pageCalls == 1) {
          return _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(1),
            ], nextCursor: 'bsc1.page-1'),
          );
        }
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.callable,
          code: 'failed-precondition',
          message: 'The BiteSaver search is not ready.',
        );
      };
      api.onStatus = (_) async {
        statusCalls += 1;
        if (statusCalls == 1) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.callable,
            code: 'resource-exhausted',
            message: 'The previous status request is still settling.',
          );
        }
        return _statusResponse('ready');
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        scheduler: scheduler,
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.restaurantPager!.loadMore();

      expect(api.statusRequests, hasLength(1));
      final retainedRequest = api.statusRequests.single.toJson();
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurantPager, isNull);
      expect(scheduler.tasks.last.cancelled, isFalse);
      expect(
        scheduler.tasks.last.delay,
        harness.coordinator.statusPollInterval,
      );

      scheduler.tasks.last.fire();
      await pumpEventQueue();

      expect(api.statusRequests, hasLength(2));
      expect(api.statusRequests.last.toJson(), retainedRequest);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
      );
    },
  );

  test(
    'expired append cursor requires Fresh Search without exact replay',
    () async {
      final api = _FakeApi();
      var pageCalls = 0;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        if (pageCalls == 1) {
          return _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(1),
            ], nextCursor: 'bsc1.page-1'),
          );
        }
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.callable,
          code: 'functions/invalid-argument',
          message: 'The BiteSaver page cursor is invalid or expired.',
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final obsoletePager = harness.coordinator.restaurantPager!;
      await obsoletePager.loadMore();

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
      );
      expect(harness.coordinator.restaurantPager, isNull);
      expect(api.statusRequests, isEmpty);
      await obsoletePager.loadMore();
      expect(api.restaurantPageRequests, hasLength(2));
    },
  );

  test(
    'offer append failure preserves restaurant and prior offer results',
    () async {
      final api = _FakeApi();
      var offerPageCalls = 0;
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            1,
            offers: <Map<String, dynamic>>[_offerJson(1)],
            hasMoreOffers: true,
          ),
        ]),
      );
      api.onOfferPage = (_) async {
        offerPageCalls += 1;
        if (offerPageCalls == 1) {
          return _direct(
            _offerPage(restaurantId, <CustomerBiteSaverOffer>[
              _offer(2),
            ], nextCursor: 'bsc1.offer-page-1'),
          );
        }
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.callable,
          code: 'resource-exhausted',
          message: 'Try this page again later.',
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final restaurantPager = harness.coordinator.restaurantPager;
      final offerPager = await harness.coordinator.loadOffers(restaurantId);
      expect(offerPager.items.map((offer) => offer.offerId.value), <String>[
        _offerId(2),
      ]);

      await offerPager.loadMore();

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurantPager, same(restaurantPager));
      expect(harness.coordinator.restaurants, hasLength(1));
      expect(offerPager.items.map((offer) => offer.offerId.value), <String>[
        _offerId(2),
      ]);
      expect(offerPager.error, isA<CustomerBiteSaverServiceException>());
      expect(offerPager.hasRetry, isTrue);
    },
  );

  test(
    'offer precondition preserves restaurants and restarts only its pager',
    () async {
      final api = _FakeApi();
      var offerPageCalls = 0;
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            1,
            offers: <Map<String, dynamic>>[_offerJson(1)],
            hasMoreOffers: true,
          ),
        ]),
      );
      api.onOfferPage = (_) async {
        offerPageCalls += 1;
        if (offerPageCalls == 1) {
          return _direct(
            _offerPage(restaurantId, <CustomerBiteSaverOffer>[
              _offer(2),
            ], nextCursor: 'bsc1.offer-page-1'),
          );
        }
        if (offerPageCalls == 2) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.callable,
            code: 'failed-precondition',
            message: 'The offer catalog changed; restart this offer page.',
          );
        }
        return _direct(
          _offerPage(restaurantId, <CustomerBiteSaverOffer>[_offer(3)]),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final restaurantPager = harness.coordinator.restaurantPager;
      final oldOfferPager = await harness.coordinator.loadOffers(restaurantId);
      await oldOfferPager.loadMore();

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurantPager, same(restaurantPager));
      expect(harness.coordinator.restaurants, hasLength(1));
      expect(oldOfferPager.items.map((offer) => offer.offerId.value), <String>[
        _offerId(2),
      ]);
      expect(oldOfferPager.error, isA<CustomerBiteSaverServiceException>());
      expect(
        harness.coordinator.offerPageRequiresRestart(restaurantId),
        isTrue,
      );
      expect(api.statusRequests, isEmpty);

      final replacement = await harness.coordinator.loadOffers(restaurantId);

      expect(replacement, isNot(same(oldOfferPager)));
      expect(oldOfferPager.isDisposed, isTrue);
      expect(
        harness.coordinator.offerPageRequiresRestart(restaurantId),
        isFalse,
      );
      expect(replacement.items.map((offer) => offer.offerId.value), <String>[
        _offerId(3),
      ]);
      expect(harness.coordinator.restaurantPager, same(restaurantPager));
      expect(api.offerPageRequests, hasLength(3));
    },
  );

  test(
    'later restaurant page rejects cross-page offer ownership atomically',
    () async {
      final api = _FakeApi();
      var pageCalls = 0;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        if (pageCalls == 1) {
          return _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(1, offers: <Map<String, dynamic>>[_offerJson(1)]),
            ], nextCursor: 'bsc1.offer-ownership'),
          );
        }
        if (pageCalls == 2) {
          return _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(2, offers: <Map<String, dynamic>>[_offerJson(2)]),
              _restaurantJson(3, offers: <Map<String, dynamic>>[_offerJson(1)]),
            ]),
          );
        }
        return _direct(
          _restaurantPage(<Map<String, dynamic>>[
            _restaurantJson(4, offers: <Map<String, dynamic>>[_offerJson(2)]),
          ]),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final pager = harness.coordinator.restaurantPager!;
      await pager.loadMore();

      expect(pager.error, isA<CustomerBiteSaverProtocolException>());
      expect(
        pager.items.map((restaurant) => restaurant.restaurantId.value),
        <String>[_restaurantId(1)],
      );
      expect(
        harness.coordinator.previewOffersFor(
          CustomerBiteSaverRestaurantId(_restaurantId(2)),
        ),
        isEmpty,
      );
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(3)),
          offerId: CustomerBiteSaverOfferId(_offerId(1)),
          redemptionRequestId: 'cross-page-owner-rejected-0001',
        ),
        throwsA(isA<StateError>()),
      );

      await pager.retry();

      expect(pager.error, isNull);
      expect(
        pager.items.map((restaurant) => restaurant.restaurantId.value),
        <String>[_restaurantId(1), _restaurantId(4)],
      );
      expect(
        harness.coordinator
            .previewOffersFor(CustomerBiteSaverRestaurantId(_restaurantId(4)))
            .map((offer) => offer.offerId.value),
        <String>[_offerId(2)],
      );
    },
  );

  test(
    'rejected signed ownership cannot replace a retained usage overlay',
    () async {
      final api = _FakeApi();
      var pageCalls = 0;
      final retainedOffer = _offerJson(11);
      final conflictingOffer = _offerJson(11)
        ..['usageRule'] = 'Unlimited'
        ..['usagePolicy'] = 'unlimited';
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        return pageCalls == 1
            ? _direct(
                _restaurantPage(<Map<String, dynamic>>[
                  _restaurantJson(
                    11,
                    offers: <Map<String, dynamic>>[retainedOffer],
                  ),
                ], nextCursor: 'bsc1.overlay-ownership'),
              )
            : _direct(
                _restaurantPage(<Map<String, dynamic>>[
                  _restaurantJson(
                    12,
                    offers: <Map<String, dynamic>>[conflictingOffer],
                  ),
                ]),
              );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);
      final offerId = CustomerBiteSaverOfferId(_offerId(11));
      final localStartAt =
          _evaluationAtMillis -
          customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds;
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        localStartAt,
        isUtc: true,
      );
      await harness.store.startRedemption(
        redemptionRequestId: 'signed-overlay-owner-0001',
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(11)),
        offerId: offerId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: _localEvaluationContext(localStartAt),
        validationExpiresAtMillis: localStartAt + 60000,
        expectedGuestStateRevision: 0,
      );
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        _evaluationAtMillis + 1000,
        isUtc: true,
      );

      await harness.coordinator.startSearch(_criteria());
      expect(
        harness.coordinator.effectiveOfferAvailability(offerId).localUsageState,
        CustomerBiteSaverLocalUsageOverlayState.unavailable,
      );

      await harness.coordinator.restaurantPager!.loadMore();

      expect(
        harness.coordinator.restaurantPager!.error,
        isA<CustomerBiteSaverProtocolException>(),
      );
      expect(
        harness.coordinator.effectiveOfferAvailability(offerId).localUsageState,
        CustomerBiteSaverLocalUsageOverlayState.unavailable,
      );
    },
  );

  test(
    'concurrent offer pagers reject one cross-restaurant offer owner',
    () async {
      final api = _FakeApi();
      final firstRestaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      final secondRestaurantId = CustomerBiteSaverRestaurantId(
        _restaurantId(2),
      );
      final sharedOfferId = CustomerBiteSaverOfferId(_offerId(9));
      final firstPage =
          Completer<
            CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>
          >();
      final secondPage =
          Completer<
            CustomerBiteSaverEndpointResponse<CustomerBiteSaverOfferPageResult>
          >();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(1, hasMoreOffers: true),
          _restaurantJson(2, hasMoreOffers: true),
        ]),
      );
      api.onOfferPage = (request) => request.restaurantId == firstRestaurantId
          ? firstPage.future
          : secondPage.future;
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final firstLoad = harness.coordinator.loadOffers(firstRestaurantId);
      final secondLoad = harness.coordinator.loadOffers(secondRestaurantId);
      await pumpEventQueue();
      expect(api.offerPageRequests, hasLength(2));

      firstPage.complete(
        _direct(
          _offerPage(firstRestaurantId, <CustomerBiteSaverOffer>[_offer(9)]),
        ),
      );
      final firstPager = await firstLoad;
      secondPage.complete(
        _direct(
          _offerPage(secondRestaurantId, <CustomerBiteSaverOffer>[
            _offer(10),
            _offer(9),
          ]),
        ),
      );
      final secondPager = await secondLoad;

      expect(firstPager.error, isNull);
      expect(firstPager.items.map((offer) => offer.offerId.value), <String>[
        sharedOfferId.value,
      ]);
      expect(secondPager.error, isA<CustomerBiteSaverProtocolException>());
      expect(secondPager.items, isEmpty);
      await expectLater(
        harness.coordinator.setOfferFavorite(
          CustomerBiteSaverOfferId(_offerId(10)),
          true,
        ),
        throwsA(isA<StateError>()),
      );
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: secondRestaurantId,
          offerId: sharedOfferId,
          redemptionRequestId: 'concurrent-owner-rejected-0001',
        ),
        throwsA(isA<StateError>()),
      );
    },
  );

  test(
    'pause cancels READY deadline and resume status-checks before paging',
    () async {
      final api = _FakeApi();
      final scheduler = _ManualScheduler();
      final events = <String>[];
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        events.add('page');
        return _direct(
          _restaurantPage(<Map<String, dynamic>>[_restaurantJson(1)]),
        );
      };
      api.onStatus = (_) async {
        events.add('status');
        return _statusResponse('ready');
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        scheduler: scheduler,
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      expect(scheduler.tasks, hasLength(2));
      final oldDeadlines = List<_ManualTask>.of(scheduler.tasks);
      harness.coordinator.pause();
      expect(oldDeadlines.every((task) => task.cancelled), isTrue);
      for (final oldDeadline in oldDeadlines) {
        oldDeadline.fire();
      }
      await pumpEventQueue();
      expect(api.statusRequests, isEmpty);

      events.clear();
      await harness.coordinator.resume();
      expect(events, <String>['status', 'page']);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(harness.coordinator.restaurants, hasLength(1));
    },
  );

  test(
    'new criteria and auth realms suppress older awaited success and error',
    () async {
      final api = _FakeApi();
      final oldStart = Completer<CustomerBiteSaverStartResponse>();
      api.onStart = (request) {
        if (request.criteria.searchText == 'old') return oldStart.future;
        return Future.value(_startResponse());
      };
      api.onRestaurantPage = (_) async =>
          _direct(_restaurantPage(<Map<String, dynamic>>[_restaurantJson(2)]));
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      final stale = harness.coordinator.startSearch(_criteria('old'));
      await harness.coordinator.startSearch(_criteria('new'));
      oldStart.completeError(StateError('stale failure'));
      await stale;
      expect(harness.coordinator.criteria!.searchText, 'new');
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(
        harness.coordinator.restaurants.single.restaurantId.value,
        _restaurantId(2),
      );

      await harness.coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
      );
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.idle,
      );
      expect(harness.coordinator.hasSession, isFalse);
      expect(harness.coordinator.restaurants, isEmpty);
    },
  );

  test('stale page errors cannot invalidate a newer search', () async {
    final api = _FakeApi();
    final oldAppend =
        Completer<
          CustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRestaurantPageResult
          >
        >();
    var pageCalls = 0;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) {
      pageCalls += 1;
      if (pageCalls == 1) {
        return Future.value(
          _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(1),
            ], nextCursor: 'bsc1.old-page'),
          ),
        );
      }
      if (pageCalls == 2) {
        return oldAppend.future;
      }
      return Future.value(
        _direct(_restaurantPage(<Map<String, dynamic>>[_restaurantJson(2)])),
      );
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria('old'));
    final staleLoad = harness.coordinator.restaurantPager!.loadMore();
    await pumpEventQueue();
    await harness.coordinator.startSearch(_criteria('new'));
    oldAppend.completeError(
      const CustomerBiteSaverServiceException(
        kind: CustomerBiteSaverServiceFailureKind.callable,
        code: 'failed-precondition',
        message: 'The old search is no longer ready.',
      ),
    );
    await staleLoad;

    expect(harness.coordinator.criteria?.searchText, 'new');
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.ready,
    );
    expect(
      harness.coordinator.restaurants.single.restaurantId.value,
      _restaurantId(2),
    );
    expect(api.statusRequests, isEmpty);
  });

  test(
    'restaurant and offer pagers retain order beyond 120 and separate previews',
    () async {
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (request) async {
        final page = request.cursor == null
            ? 0
            : int.parse(request.cursor!.substring('bsc1.page-'.length));
        final first = page * 25;
        final restaurants = List<Map<String, dynamic>>.generate(
          25,
          (offset) => _restaurantJson(
            first + offset + 1,
            offers: first + offset == 0
                ? <Map<String, dynamic>>[_offerJson(1), _offerJson(2)]
                : const <Map<String, dynamic>>[],
            hasMoreOffers: first + offset == 0,
          ),
        );
        return _direct(
          _restaurantPage(
            restaurants,
            nextCursor: page < 4 ? 'bsc1.page-${page + 1}' : null,
          ),
        );
      };
      api.onOfferPage = (request) async => _direct(
        _offerPage(request.restaurantId, <CustomerBiteSaverOffer>[
          _offer(1),
          _offer(3),
          _offer(4),
        ]),
      );
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      for (var page = 0; page < 4; page += 1) {
        await harness.coordinator.restaurantPager!.loadMore();
      }
      expect(harness.coordinator.restaurants, hasLength(125));
      expect(harness.coordinator.restaurantPager!.trimmedBeforeCount, 0);
      expect(
        harness.coordinator.restaurants.map(
          (value) => value.restaurantId.value,
        ),
        List<String>.generate(125, (index) => _restaurantId(index + 1)),
      );

      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      expect(
        harness.coordinator
            .previewOffersFor(restaurantId)
            .map((offer) => offer.offerId.value),
        <String>[_offerId(1), _offerId(2)],
      );
      final offerPager = await harness.coordinator.loadOffers(restaurantId);
      expect(offerPager.items.map((offer) => offer.offerId.value), <String>[
        _offerId(3),
        _offerId(4),
      ]);
      expect(
        harness.coordinator.restaurantPager!.status,
        CustomerLoadMoreStatus.data,
      );
    },
  );

  test(
    'rejected non-progress cannot authorize IDs or daily-special saves',
    () async {
      final api = _FakeApi();
      final dailyOffer = _offerJson(8)
        ..['offerType'] = 'dailySpecial'
        ..['usagePolicy'] = null;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (request) async => _direct(
        request.cursor == null
            ? _restaurantPage(<Map<String, dynamic>>[
                _restaurantJson(1, offers: <Map<String, dynamic>>[dailyOffer]),
              ], nextCursor: 'bsc1.repeated')
            : _restaurantPage(<Map<String, dynamic>>[
                _restaurantJson(2),
              ], nextCursor: 'bsc1.repeated'),
      );
      var favoriteWrites = 0;
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        favoriteActions: CustomerBiteSaverFavoriteActions(
          upsertRestaurant: (_) async => favoriteWrites += 1,
          removeRestaurant: (_) async => favoriteWrites += 1,
          upsertCoupon: (_) async => favoriteWrites += 1,
          removeCoupon: (_) async => favoriteWrites += 1,
        ),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.restaurantPager!.loadMore();
      expect(
        harness.coordinator.restaurantPager!.error,
        isA<CustomerLoadMoreNonProgressException>(),
      );
      expect(
        harness.coordinator.restaurants.map(
          (value) => value.restaurantId.value,
        ),
        <String>[_restaurantId(1)],
      );
      await expectLater(
        harness.coordinator.setRestaurantFavorite(
          CustomerBiteSaverRestaurantId(_restaurantId(2)),
          true,
        ),
        throwsA(isA<StateError>()),
      );
      await expectLater(
        harness.coordinator.setOfferFavorite(
          CustomerBiteSaverOfferId(_offerId(8)),
          true,
        ),
        throwsA(isA<StateError>()),
      );
      expect(favoriteWrites, 0);
    },
  );

  test(
    'rejected non-progress cannot poison ownership or signed overlays',
    () async {
      final api = _FakeApi();
      var pageCalls = 0;
      final retainedOffer = _offerJson(20);
      final replacementOverlay = _offerJson(20)
        ..['usageRule'] = 'Unlimited'
        ..['usagePolicy'] = 'unlimited';
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        return switch (pageCalls) {
          1 => _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(
                20,
                offers: <Map<String, dynamic>>[retainedOffer],
              ),
            ], nextCursor: 'bsc1.non-progress-side-effects'),
          ),
          2 => _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(
                20,
                offers: <Map<String, dynamic>>[replacementOverlay],
              ),
              _restaurantJson(
                21,
                offers: <Map<String, dynamic>>[_offerJson(21)],
              ),
            ], nextCursor: 'bsc1.non-progress-side-effects'),
          ),
          3 => _direct(
            _restaurantPage(<Map<String, dynamic>>[
              _restaurantJson(
                22,
                offers: <Map<String, dynamic>>[_offerJson(21)],
              ),
            ]),
          ),
          _ => throw StateError('unexpected page request'),
        };
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);
      final retainedOfferId = CustomerBiteSaverOfferId(_offerId(20));
      final localStartAt =
          _evaluationAtMillis -
          customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds;
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        localStartAt,
        isUtc: true,
      );
      await harness.store.startRedemption(
        redemptionRequestId: 'non-progress-overlay-0001',
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(20)),
        offerId: retainedOfferId,
        usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
        evaluationContext: _localEvaluationContext(localStartAt),
        validationExpiresAtMillis: localStartAt + 60000,
        expectedGuestStateRevision: 0,
      );
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        _evaluationAtMillis + 1000,
        isUtc: true,
      );

      await harness.coordinator.startSearch(_criteria());
      final pager = harness.coordinator.restaurantPager!;
      expect(
        harness.coordinator
            .effectiveOfferAvailability(retainedOfferId)
            .localUsageState,
        CustomerBiteSaverLocalUsageOverlayState.unavailable,
      );

      await pager.loadMore();

      expect(pager.error, isA<CustomerLoadMoreNonProgressException>());
      expect(
        harness.coordinator
            .effectiveOfferAvailability(retainedOfferId)
            .localUsageState,
        CustomerBiteSaverLocalUsageOverlayState.unavailable,
      );

      harness.now = harness.now.add(const Duration(seconds: 1));
      await pager.retry();

      expect(pager.error, isNull);
      expect(
        pager.items.map((restaurant) => restaurant.restaurantId.value),
        <String>[_restaurantId(20), _restaurantId(22)],
      );
      expect(
        harness.coordinator
            .previewOffersFor(CustomerBiteSaverRestaurantId(_restaurantId(22)))
            .map((offer) => offer.offerId.value),
        <String>[_offerId(21)],
      );
    },
  );

  test('signed and guest daily specials cannot enter redemption', () async {
    for (final auth in <CustomerBiteSaverAuthSnapshot>[
      const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      const CustomerBiteSaverAuthSnapshot.signedOut(),
    ]) {
      final api = _FakeApi();
      final dailyOffer = _offerJson(8)
        ..['offerType'] = 'dailySpecial'
        ..['usagePolicy'] = null;
      final restaurant = _restaurantJson(
        1,
        offers: <Map<String, dynamic>>[dailyOffer],
      );
      api.onStart = (_) async => _startResponse();
      if (auth.isSigned) {
        api.onRestaurantPage = (_) async =>
            _direct(_restaurantPage(<Map<String, dynamic>>[restaurant]));
      } else {
        final complete = _copyMap(_guestResponses['restaurantComplete']);
        final result = _map(complete['result']);
        result['restaurants'] = <Map<String, dynamic>>[restaurant];
        complete['result'] = result;
        api.onRestaurantPage = (_) async => _guestRestaurantResponse(complete);
      }
      var validations = 0;
      api.onValidation = (_) async {
        validations += 1;
        throw StateError('daily special reached validation');
      };
      final harness = _Harness(api: api, auth: auth);

      await harness.coordinator.startSearch(_criteria());
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(1)),
          offerId: CustomerBiteSaverOfferId(_offerId(8)),
          redemptionRequestId: 'daily-special-rejected-0001',
        ),
        throwsA(isA<StateError>()),
      );
      expect(validations, 0);
      harness.dispose();
    }
  });

  test(
    'guest continuation transport failure replays the exact pending answer',
    () async {
      final api = _FakeApi();
      final challenge = _copyMap(_guestResponses['restaurantChallenge']);
      challenge['guestStateRevision'] = 1;
      final complete = _copyMap(_guestResponses['restaurantComplete']);
      complete['guestStateRevision'] = 1;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(challenge, guestStateRevision: 1);
      var continuationAttempt = 0;
      api.onContinuation = (_) async {
        continuationAttempt += 1;
        if (continuationAttempt == 1) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.transport,
            code: 'transport-error',
            message: 'uncertain',
          );
        }
        return _guestContinuationResponse(complete, guestStateRevision: 1);
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final challengedOfferId = CustomerBiteSaverOfferId(
        _map((challenge['candidates']! as List).first)['offerId']! as String,
      );
      final active = await _seedActiveTimer(
        harness,
        restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(970)),
        offerId: challengedOfferId,
        redemptionRequestId: 'uncertain-pending-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );

      await harness.coordinator.startSearch(_criteria());
      expect(
        harness.coordinator.restaurantPager!.status,
        CustomerLoadMoreStatus.error,
      );
      expect(api.restaurantPageRequests, hasLength(1));
      expect(api.continuationRequests, hasLength(1));
      final failedAnswer = api.continuationRequests.single.toJson();
      final timerDelay = Duration(
        milliseconds:
            active.timerExpiresAtMillis - harness.now.millisecondsSinceEpoch,
      );
      expect(
        harness.scheduler.tasks.where(
          (task) => !task.cancelled && task.delay == timerDelay,
        ),
        isEmpty,
      );

      await harness.coordinator.restaurantPager!.retry();
      expect(api.restaurantPageRequests, hasLength(1));
      expect(api.continuationRequests, hasLength(2));
      expect(api.continuationRequests.last.toJson(), failedAnswer);
      expect(
        harness.coordinator.restaurantPager!.status,
        CustomerLoadMoreStatus.data,
      );
      expect(
        harness.scheduler.tasks.where(
          (task) => !task.cancelled && task.delay == timerDelay,
        ),
        hasLength(1),
      );
    },
  );

  test(
    'wrong-operation continuation stays pending for exact pager retry',
    () async {
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _guestRestaurantResponse(
        _map(_guestResponses['restaurantChallenge']),
      );
      var continuationAttempt = 0;
      api.onContinuation = (_) async {
        continuationAttempt += 1;
        return _guestContinuationResponse(
          _map(
            _guestResponses[continuationAttempt == 1
                ? 'validationComplete'
                : 'restaurantComplete'],
          ),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());

      expect(
        harness.coordinator.restaurantPager!.error,
        isA<CustomerBiteSaverProtocolException>(),
      );
      expect(api.restaurantPageRequests, hasLength(1));
      expect(api.continuationRequests, hasLength(1));
      final retainedContinuation = api.continuationRequests.single.toJson();

      await harness.coordinator.restaurantPager!.retry();

      expect(api.restaurantPageRequests, hasLength(1));
      expect(api.continuationRequests, hasLength(2));
      expect(api.continuationRequests.last.toJson(), retainedContinuation);
      expect(
        harness.coordinator.restaurantPager!.status,
        CustomerLoadMoreStatus.data,
      );
    },
  );

  test('twenty-five guest challenges complete across paced yields', () async {
    const challengeCount = 25;
    const protocolStepsPerYield = 4;
    final api = _FakeApi();
    final delayCalls = <Duration>[];

    Map<String, dynamic> challenge(int sequence) {
      final challenge = _copyMap(_guestResponses['restaurantChallenge']);
      challenge['batchSequence'] = sequence;
      challenge['candidates'] = <Map<String, Object?>>[
        <String, Object?>{
          'offerId': _offerId(100 + sequence),
          'usagePolicy': 'oncePerCustomer',
        },
      ];
      return challenge;
    }

    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _guestRestaurantResponse(challenge(0));
    var observedChallenges = 1;
    api.onContinuation = (_) async {
      if (observedChallenges < challengeCount) {
        final response = challenge(observedChallenges);
        observedChallenges += 1;
        return _guestContinuationResponse(response);
      }
      return _guestContinuationResponse(
        _map(_guestResponses['restaurantComplete']),
      );
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      maximumGuestProtocolSteps: protocolStepsPerYield,
      delay: (duration) async => delayCalls.add(duration),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());

    expect(observedChallenges, challengeCount);
    expect(api.restaurantPageRequests, hasLength(1));
    expect(api.continuationRequests, hasLength(challengeCount));
    expect(delayCalls, hasLength(greaterThanOrEqualTo(6)));
    expect(delayCalls, everyElement(harness.coordinator.guestRetryDelay));
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.ready,
    );
    expect(harness.coordinator.restaurantPager!.error, isNull);
  });

  test(
    'server original-operation retry is paced and gets a new transport ID',
    () async {
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      var pageCalls = 0;
      api.onRestaurantPage = (_) async {
        pageCalls += 1;
        if (pageCalls == 1) {
          final retry = _copyMap(_guestResponses['retryRequired']);
          retry['guestStateRevision'] = 0;
          return parseCustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRestaurantPageResult
          >(
            retry,
            expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
            resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
          );
        }
        return _guestRestaurantResponse(
          _map(_guestResponses['restaurantComplete']),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      expect(api.restaurantPageRequests, hasLength(2));
      expect(
        api.restaurantPageRequests.first.clientRequestId,
        isNot(api.restaurantPageRequests.last.clientRequestId),
      );
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
    },
  );

  test(
    'work-budget restart preserves accepted guest policy progress',
    () async {
      final api = _FakeApi();
      final restaurantComplete = _copyMap(
        _guestResponses['restaurantComplete'],
      );
      final restaurant = _map(
        (_map(restaurantComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        restaurant['restaurantId']! as String,
      );
      final offer = _map((restaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(offer['offerId']! as String);
      var validationCalls = 0;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(restaurantComplete);
      api.onValidation = (_) async {
        validationCalls += 1;
        return _guestValidationResponse(
          _map(
            _guestResponses[validationCalls == 1
                ? 'validationChallenge'
                : 'validationComplete'],
          ),
        );
      };
      api.onContinuation = (_) async {
        final retry = _copyMap(_guestResponses['retryRequired']);
        retry['operation'] = 'redemptionStart';
        retry['reason'] = 'workBudget';
        retry['restartFrom'] = 'originalOperation';
        return _guestContinuationResponse(retry);
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-work-budget-0001',
      );
      final receipt = await harness.coordinator.startValidatedRedemption();

      expect(decision.allowed, isTrue);
      expect(api.validationRequests, hasLength(2));
      expect(
        api.validationRequests.first.clientRequestId,
        isNot(api.validationRequests.last.clientRequestId),
      );
      expect(api.continuationRequests, hasLength(1));
      expect(receipt.isUnlimited, isFalse);
      expect(receipt.timerStartedAtMillis, _evaluationAtMillis);
      expect(await harness.store.readRevision(), 1);
    },
  );

  test('work-budget page restart retains its pending timer deadline', () async {
    final api = _FakeApi();
    final challenge = _copyMap(_guestResponses['restaurantChallenge']);
    challenge['guestStateRevision'] = 1;
    final complete = _copyMap(_guestResponses['restaurantComplete']);
    complete['guestStateRevision'] = 1;
    var pageCalls = 0;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async {
      pageCalls += 1;
      return pageCalls == 1
          ? _guestRestaurantResponse(challenge, guestStateRevision: 1)
          : _guestRestaurantResponse(complete, guestStateRevision: 1);
    };
    api.onContinuation = (_) async {
      final retry = _copyMap(_guestResponses['retryRequired']);
      retry['guestStateRevision'] = 1;
      retry['reason'] = 'workBudget';
      retry['restartFrom'] = 'originalOperation';
      return _guestContinuationResponse(retry, guestStateRevision: 1);
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
    );
    addTearDown(harness.dispose);
    final challengedOfferId = CustomerBiteSaverOfferId(
      _map((challenge['candidates']! as List).first)['offerId']! as String,
    );
    final active = await _seedActiveTimer(
      harness,
      restaurantId: CustomerBiteSaverRestaurantId(_restaurantId(971)),
      offerId: challengedOfferId,
      redemptionRequestId: 'work-budget-page-timer-0001',
      minutesBeforeEvaluation: 4,
      expectedRevision: 0,
    );

    await harness.coordinator.startSearch(_criteria());

    expect(api.restaurantPageRequests, hasLength(2));
    expect(api.continuationRequests, hasLength(1));
    expect(
      harness.scheduler.tasks.where(
        (task) =>
            !task.cancelled &&
            task.delay ==
                Duration(
                  milliseconds:
                      active.timerExpiresAtMillis -
                      harness.now.millisecondsSinceEpoch,
                ),
      ),
      hasLength(1),
    );
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.ready,
    );
  });

  test(
    'same guest realm can retain a compatible session; realm changes clear it',
    () async {
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(_map(_guestResponses['restaurantComplete']));
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.anonymous('anonymous-user'),
      );
      expect(api.startRequests, hasLength(1));
      expect(api.restaurantPageRequests, hasLength(2));
      expect(harness.coordinator.hasSession, isTrue);

      await harness.coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      expect(harness.coordinator.hasSession, isFalse);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.idle,
      );
    },
  );

  test(
    'favorite read and write completions cannot cross auth realms',
    () async {
      final api = _FakeApi();
      final favoriteRead = Completer<CustomerBiteSaverFavoriteStatesResponse>();
      final favoriteWrite = Completer<void>();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(1, offers: <Map<String, dynamic>>[_offerJson(1)]),
        ]),
      );
      api.onFavorites = (_) => favoriteRead.future;
      final actions = CustomerBiteSaverFavoriteActions(
        upsertRestaurant: (_) => favoriteWrite.future,
        removeRestaurant: (_) async {},
        upsertCoupon: (_) async {},
        removeCoupon: (_) async {},
      );
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
        favoriteActions: actions,
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      final write = harness.coordinator.setRestaurantFavorite(
        restaurantId,
        true,
      );
      final requested = api.favoriteRequests.single;
      await harness.coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.signed('signed-b'),
      );
      favoriteRead.complete(_favoriteResponse(requested, state: 'favorite'));
      favoriteWrite.complete();
      await write;
      await pumpEventQueue();

      expect(
        harness.coordinator.restaurantFavoriteState(restaurantId),
        CustomerBiteSaverFavoriteState.unknown,
      );
      expect(harness.coordinator.hasSession, isFalse);
    },
  );

  test(
    'validation and signed start replay exact immutable transport requests',
    () async {
      final api = _FakeApi();
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(1, offers: <Map<String, dynamic>>[_offerJson(1)]),
        ]),
      );
      var starts = 0;
      api.onRedemptionStart = (_) async {
        starts += 1;
        if (starts == 1) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.transport,
            code: 'transport-error',
            message: 'uncertain',
          );
        }
        return CustomerBiteSaverRedemptionStartResult.fromJson(
          _signedResponses['redemptionStart'],
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final fixtureRestaurant = CustomerBiteSaverRestaurant.fromJson(
        (_map(_signedResponses['restaurantPage'])['restaurants']! as List)
            .first,
      );
      // Use the IDs and occurrence delivered by this coordinator, not fixture IDs.
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      final offerId = CustomerBiteSaverOfferId(_offerId(1));
      final validation = _directResultMap(
        _signedResponses['redemptionValidation'],
      );
      validation['restaurantId'] = restaurantId.value;
      validation['offerId'] = offerId.value;
      var validations = 0;
      api.onValidation = (_) async {
        validations += 1;
        if (validations == 1) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.transport,
            code: 'transport-error',
            message: 'uncertain validation',
          );
        }
        return _direct(
          CustomerBiteSaverRedemptionValidationResult.fromJson(validation),
        );
      };
      final originalCoordinates = CustomerBiteSaverCoordinates(
        latitude: 28.5383,
        longitude: -81.3792,
        capturedAtMillis: _evaluationAtMillis,
      );
      final changedCoordinates = CustomerBiteSaverCoordinates(
        latitude: 28.5483,
        longitude: -81.3792,
        capturedAtMillis: _evaluationAtMillis,
      );
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: 'logical-redemption-0001',
          currentCoordinates: originalCoordinates,
        ),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );
      final failedValidationRequest = api.validationRequests.single.toJson();
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: 'logical-redemption-0001',
          currentCoordinates: changedCoordinates,
        ),
        throwsA(isA<StateError>()),
      );
      expect(api.validationRequests, hasLength(1));
      await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'logical-redemption-0001',
        currentCoordinates: originalCoordinates,
      );
      expect(api.validationRequests, hasLength(2));
      expect(api.validationRequests.last.toJson(), failedValidationRequest);

      await expectLater(
        harness.coordinator.startValidatedRedemption(),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );
      final failedRequest = api.redemptionStartRequests.single.toJson();
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: 'logical-redemption-0002',
          currentCoordinates: originalCoordinates,
        ),
        throwsA(isA<StateError>()),
      );
      expect(api.validationRequests, hasLength(2));
      api.onStatus = (_) async => _statusResponse('expired');
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        _signedResponses['start']['logicalExpiresAtMillis']! as int,
        isUtc: true,
      );
      await harness.coordinator.pollNow();
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.expired,
      );
      final startJson = _copyMap(_signedResponses['redemptionStart']);
      startJson['restaurantId'] = restaurantId.value;
      startJson['offerId'] = offerId.value;
      api.onRedemptionStart = (_) async =>
          CustomerBiteSaverRedemptionStartResult.fromJson(startJson);
      final receipt = await harness.coordinator.startValidatedRedemption();

      expect(api.redemptionStartRequests, hasLength(2));
      expect(api.redemptionStartRequests.last.toJson(), failedRequest);
      expect(
        receipt.timerStartedAtMillis,
        _signedResponses['redemptionStart']['timerStartedAtMillis'],
      );
      expect(
        receipt.timerExpiresAtMillis,
        _signedResponses['redemptionStart']['timerExpiresAtMillis'],
      );
      expect(fixtureRestaurant.offers, isNotEmpty);
    },
  );

  test(
    'same validation intent deduplicates and older success cannot replace latest',
    () async {
      final api = _FakeApi();
      final first =
          Completer<
            CustomerBiteSaverEndpointResponse<
              CustomerBiteSaverRedemptionValidationResult
            >
          >();
      final second =
          Completer<
            CustomerBiteSaverEndpointResponse<
              CustomerBiteSaverRedemptionValidationResult
            >
          >();
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      final firstOfferId = CustomerBiteSaverOfferId(_offerId(1));
      final secondOfferId = CustomerBiteSaverOfferId(_offerId(2));
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            1,
            offers: <Map<String, dynamic>>[_offerJson(1), _offerJson(2)],
          ),
        ]),
      );
      api.onValidation = (request) =>
          request.offerId == firstOfferId ? first.future : second.future;
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final older = harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: firstOfferId,
        redemptionRequestId: 'redemption-race-older-0001',
      );
      await pumpEventQueue();
      final duplicate = harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: firstOfferId,
        redemptionRequestId: 'redemption-race-older-0001',
      );
      await pumpEventQueue();
      expect(api.validationRequests, hasLength(1));
      final olderExpectation = expectLater(
        older,
        throwsA(isA<CustomerBiteSaverStaleOperationException>()),
      );
      final duplicateExpectation = expectLater(
        duplicate,
        throwsA(isA<CustomerBiteSaverStaleOperationException>()),
      );

      final latest = harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: secondOfferId,
        redemptionRequestId: 'redemption-race-latest-0001',
      );
      await pumpEventQueue();
      expect(api.validationRequests, hasLength(2));
      expect(harness.coordinator.redemptionDecision, isNull);
      second.complete(_signedValidationResponse(restaurantId, secondOfferId));
      final latestDecision = await latest;
      expect(latestDecision.offerId, secondOfferId);

      first.complete(_signedValidationResponse(restaurantId, firstOfferId));
      await Future.wait(<Future<void>>[olderExpectation, duplicateExpectation]);
      expect(harness.coordinator.redemptionDecision?.offerId, secondOfferId);
      expect(harness.coordinator.redemptionError, isNull);
    },
  );

  test('pause/resume preserves uncertain signed start recovery', () async {
    final api = _FakeApi();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
    final offerId = CustomerBiteSaverOfferId(_offerId(1));
    var startAttempts = 0;
    api.onStart = (_) async => _startResponse();
    api.onStatus = (_) async => _statusResponse('ready');
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(1, offers: <Map<String, dynamic>>[_offerJson(1)]),
      ]),
    );
    api.onValidation = (_) async =>
        _signedValidationResponse(restaurantId, offerId);
    api.onRedemptionStart = (_) async {
      startAttempts += 1;
      if (startAttempts == 1) {
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.transport,
          code: 'transport-error',
          message: 'uncertain',
        );
      }
      final result = _copyMap(_signedResponses['redemptionStart']);
      result['restaurantId'] = restaurantId.value;
      result['offerId'] = offerId.value;
      return CustomerBiteSaverRedemptionStartResult.fromJson(result);
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    final decision = await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerId,
      redemptionRequestId: 'pause-recovery-redemption-0001',
    );
    await expectLater(
      harness.coordinator.startValidatedRedemption(),
      throwsA(isA<CustomerBiteSaverServiceException>()),
    );
    final uncertainRequest = api.redemptionStartRequests.single.toJson();
    await expectLater(
      harness.coordinator.freshSearch(),
      throwsA(isA<StateError>()),
    );

    harness.coordinator.pause();
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.paused,
    );
    await harness.coordinator.resume();
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      decision.validationExpiresAtMillis! + 1,
      isUtc: true,
    );
    final receipt = await harness.coordinator.startValidatedRedemption();

    expect(api.redemptionStartRequests, hasLength(2));
    expect(api.redemptionStartRequests.last.toJson(), uncertainRequest);
    expect(receipt.timerStartedAtMillis, isNotNull);
  });

  test('same signed realm preserves an uncertain exact start', () async {
    final api = _FakeApi();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
    final offerId = CustomerBiteSaverOfferId(_offerId(1));
    var startAttempts = 0;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(1, offers: <Map<String, dynamic>>[_offerJson(1)]),
      ]),
    );
    api.onValidation = (_) async =>
        _signedValidationResponse(restaurantId, offerId);
    api.onRedemptionStart = (_) async {
      startAttempts += 1;
      if (startAttempts == 1) {
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.transport,
          code: 'transport-error',
          message: 'uncertain',
        );
      }
      final result = _copyMap(_signedResponses['redemptionStart']);
      result['restaurantId'] = restaurantId.value;
      result['offerId'] = offerId.value;
      return CustomerBiteSaverRedemptionStartResult.fromJson(result);
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    final decision = await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerId,
      redemptionRequestId: 'same-realm-recovery-0001',
    );
    await expectLater(
      harness.coordinator.startValidatedRedemption(),
      throwsA(isA<CustomerBiteSaverServiceException>()),
    );
    final retainedRequest = api.redemptionStartRequests.single.toJson();

    await harness.coordinator.updateAuth(
      const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      decision.validationExpiresAtMillis! + 1,
      isUtc: true,
    );
    final receipt = await harness.coordinator.startValidatedRedemption();

    expect(api.redemptionStartRequests, hasLength(2));
    expect(api.redemptionStartRequests.last.toJson(), retainedRequest);
    expect(receipt.timerStartedAtMillis, isNotNull);
  });

  test('older validation error cannot poison a newer decision', () async {
    final api = _FakeApi();
    final older =
        Completer<
          CustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
    final firstOfferId = CustomerBiteSaverOfferId(_offerId(1));
    final secondOfferId = CustomerBiteSaverOfferId(_offerId(2));
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(
          1,
          offers: <Map<String, dynamic>>[_offerJson(1), _offerJson(2)],
        ),
      ]),
    );
    api.onValidation = (request) {
      if (request.offerId == firstOfferId) return older.future;
      return Future.value(
        _signedValidationResponse(restaurantId, secondOfferId),
      );
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    final stale = harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: firstOfferId,
      redemptionRequestId: 'redemption-error-older-0001',
    );
    final staleExpectation = expectLater(stale, throwsA(isA<StateError>()));
    await pumpEventQueue();
    final latest = await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: secondOfferId,
      redemptionRequestId: 'redemption-error-latest-0001',
    );
    older.completeError(StateError('late validation failure'));
    await staleExpectation;

    expect(latest.offerId, secondOfferId);
    expect(harness.coordinator.redemptionDecision?.offerId, secondOfferId);
    expect(harness.coordinator.redemptionError, isNull);
  });

  test(
    'superseded signed local validation cannot install its earlier expiry',
    () async {
      final api = _FakeApi();
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(980));
      final firstOfferId = CustomerBiteSaverOfferId(_offerId(980));
      final secondOfferId = CustomerBiteSaverOfferId(_offerId(981));
      final firstDeadline = _evaluationAtMillis + 2000;
      final secondDeadline = _evaluationAtMillis + 10000;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            980,
            offers: <Map<String, dynamic>>[_offerJson(980), _offerJson(981)],
          ),
        ]),
      );
      api.onValidation = (request) async {
        final response = _directResultMap(
          _signedResponses['redemptionValidation'],
        );
        response['restaurantId'] = restaurantId.value;
        response['offerId'] = request.offerId.value;
        final result = CustomerBiteSaverRedemptionValidationResult.fromJson(
          response,
        );
        return _direct(
          result,
          evaluationContext: _evaluationContextFor(
            result,
            validUntilExclusiveMillis: request.offerId == firstOfferId
                ? firstDeadline
                : secondDeadline,
          ),
        );
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);
      await harness.coordinator.startSearch(_criteria());
      final blockedRead = Completer<void>();
      final releaseRead = Completer<void>();
      var didBlock = false;
      harness.preferences.beforeRead = (key) async {
        if (!didBlock && key == harness.store.offerKey(firstOfferId)) {
          didBlock = true;
          blockedRead.complete();
          await releaseRead.future;
        }
      };

      final stale = harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: firstOfferId,
        redemptionRequestId: 'superseded-local-validation-0001',
      );
      final staleExpectation = expectLater(
        stale,
        throwsA(isA<CustomerBiteSaverStaleOperationException>()),
      );
      await blockedRead.future;
      final current = harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: secondOfferId,
        redemptionRequestId: 'current-local-validation-0001',
      );
      releaseRead.complete();

      await staleExpectation;
      final currentDecision = await current;

      expect(currentDecision.offerId, secondOfferId);
      expect(harness.coordinator.redemptionDecision?.offerId, secondOfferId);
      expect(
        harness.scheduler.tasks.where(
          (task) =>
              !task.cancelled &&
              task.delay ==
                  Duration(
                    milliseconds:
                        firstDeadline - harness.now.millisecondsSinceEpoch,
                  ),
        ),
        isEmpty,
      );
      expect(
        harness.scheduler.tasks.where(
          (task) =>
              !task.cancelled &&
              task.delay ==
                  Duration(
                    milliseconds:
                        secondDeadline - harness.now.millisecondsSinceEpoch,
                  ),
        ),
        hasLength(1),
      );
    },
  );

  test('ABA validation cleanup cannot erase the newest exact retry', () async {
    final api = _FakeApi();
    final firstA =
        Completer<
          CustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >();
    final secondA =
        Completer<
          CustomerBiteSaverEndpointResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
    final offerA = CustomerBiteSaverOfferId(_offerId(1));
    final offerB = CustomerBiteSaverOfferId(_offerId(2));
    var validationCall = 0;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(
          1,
          offers: <Map<String, dynamic>>[_offerJson(1), _offerJson(2)],
        ),
      ]),
    );
    api.onValidation = (request) {
      validationCall += 1;
      return switch (validationCall) {
        1 => firstA.future,
        2 => Future.value(_signedValidationResponse(restaurantId, offerB)),
        3 => secondA.future,
        4 => Future.value(_signedValidationResponse(restaurantId, offerA)),
        _ => throw StateError('unexpected validation call'),
      };
    };
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    final staleA = harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerA,
      redemptionRequestId: 'aba-redemption-a-0001',
    );
    final staleAExpectation = expectLater(
      staleA,
      throwsA(isA<CustomerBiteSaverStaleOperationException>()),
    );
    await pumpEventQueue();
    await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerB,
      redemptionRequestId: 'aba-redemption-b-0001',
    );
    final currentA = harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerA,
      redemptionRequestId: 'aba-redemption-a-0001',
    );
    await pumpEventQueue();
    final currentARequest = api.validationRequests[2].toJson();

    firstA.complete(_signedValidationResponse(restaurantId, offerA));
    await staleAExpectation;
    secondA.completeError(
      const CustomerBiteSaverServiceException(
        kind: CustomerBiteSaverServiceFailureKind.transport,
        code: 'transport-error',
        message: 'uncertain latest A',
      ),
    );
    await expectLater(
      currentA,
      throwsA(isA<CustomerBiteSaverServiceException>()),
    );
    final recovered = await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerA,
      redemptionRequestId: 'aba-redemption-a-0001',
    );

    expect(api.validationRequests, hasLength(4));
    expect(api.validationRequests.last.toJson(), currentARequest);
    expect(recovered.offerId, offerA);
  });

  test(
    'in-flight signed start deduplicates and rejects superseding validation',
    () async {
      final api = _FakeApi();
      final pendingStart = Completer<CustomerBiteSaverRedemptionStartResult>();
      final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
      final firstOfferId = CustomerBiteSaverOfferId(_offerId(1));
      final secondOfferId = CustomerBiteSaverOfferId(_offerId(2));
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async => _direct(
        _restaurantPage(<Map<String, dynamic>>[
          _restaurantJson(
            1,
            offers: <Map<String, dynamic>>[_offerJson(1), _offerJson(2)],
          ),
        ]),
      );
      api.onValidation = (request) async =>
          _signedValidationResponse(restaurantId, request.offerId);
      api.onRedemptionStart = (_) => pendingStart.future;
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: firstOfferId,
        redemptionRequestId: 'signed-start-race-0001',
      );
      final firstStart = harness.coordinator.startValidatedRedemption();
      final duplicateStart = harness.coordinator.startValidatedRedemption();
      await pumpEventQueue();
      expect(api.redemptionStartRequests, hasLength(1));
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: secondOfferId,
          redemptionRequestId: 'signed-start-race-0002',
        ),
        throwsA(isA<StateError>()),
      );
      expect(api.validationRequests, hasLength(1));

      final response = _copyMap(_signedResponses['redemptionStart']);
      response['restaurantId'] = restaurantId.value;
      response['offerId'] = firstOfferId.value;
      pendingStart.complete(
        CustomerBiteSaverRedemptionStartResult.fromJson(response),
      );
      final receipts = await Future.wait(
        <Future<CustomerBiteSaverRedemptionReceipt>>[
          firstStart,
          duplicateStart,
        ],
      );
      expect(receipts, hasLength(2));
      expect(harness.coordinator.redemptionDecision, isNull);
      expect(harness.coordinator.redemptionError, isNull);
    },
  );

  test('new signed start rechecks local evidence after validation', () async {
    final api = _FakeApi();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(904));
    final offerId = CustomerBiteSaverOfferId(_offerId(904));
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async => _direct(
      _restaurantPage(<Map<String, dynamic>>[
        _restaurantJson(904, offers: <Map<String, dynamic>>[_offerJson(904)]),
      ]),
    );
    api.onValidation = (_) async =>
        _signedValidationResponse(restaurantId, offerId);
    api.onRedemptionStart = (_) async =>
        throw StateError('locally blocked new start reached the server');
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signed('signed-a'),
    );
    addTearDown(harness.dispose);
    await harness.coordinator.startSearch(_criteria());
    final decision = await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerId,
      redemptionRequestId: 'signed-post-validation-local-use-0001',
    );
    expect(decision.allowed, isTrue);

    final localEvaluationAt = _evaluationAtMillis + 1000;
    await harness.store.startRedemption(
      redemptionRequestId: 'signed-post-validation-write-0001',
      restaurantId: restaurantId,
      offerId: offerId,
      usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      evaluationContext: _localEvaluationContext(localEvaluationAt),
      validationExpiresAtMillis: localEvaluationAt + 60000,
      expectedGuestStateRevision: 0,
    );

    await expectLater(
      harness.coordinator.startValidatedRedemption(),
      throwsA(isA<CustomerBiteSaverFreshSearchRequiredException>()),
    );
    expect(api.redemptionStartRequests, isEmpty);
    expect(
      harness.coordinator.status,
      CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
    );
  });

  test('signed unlimited receipts expose nullable timer anchors', () {
    final response = _copyMap(_signedResponses['redemptionStart']);
    response['status'] = 'unlimited';
    response['redemptionId'] = null;
    response['timerStartedAtMillis'] = null;
    response['timerExpiresAtMillis'] = null;

    final receipt = CustomerBiteSaverRedemptionReceipt.signed(
      CustomerBiteSaverRedemptionStartResult.fromJson(response),
    );

    expect(receipt.isGuest, isFalse);
    expect(receipt.isUnlimited, isTrue);
    expect(receipt.timerStartedAtMillis, isNull);
    expect(receipt.timerExpiresAtMillis, isNull);
  });

  test(
    'guest validation rejects non-target challenges before targeted reads',
    () async {
      for (final rejectOnContinuation in <bool>[false, true]) {
        for (final includeExpectedTarget in <bool>[false, true]) {
          final api = _FakeApi();
          final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
          guestComplete['guestStateRevision'] = 0;
          final restaurant = _map(
            (_map(guestComplete['result'])['restaurants']! as List).first,
          );
          final restaurantId = CustomerBiteSaverRestaurantId(
            restaurant['restaurantId']! as String,
          );
          final offer = _map((restaurant['offers']! as List).first);
          final offerId = CustomerBiteSaverOfferId(offer['offerId']! as String);
          final probeOfferId = CustomerBiteSaverOfferId(_offerId(999));
          final validChallenge = _copyMap(
            _guestResponses['validationChallenge'],
          );
          expect(
            _map((validChallenge['candidates']! as List).single)['offerId'],
            offerId.value,
          );
          final malformedChallenge = _copyMap(validChallenge);
          malformedChallenge['candidates'] = <Map<String, Object?>>[
            if (includeExpectedTarget)
              <String, Object?>{
                'offerId': offerId.value,
                'usagePolicy': 'oncePerCustomer',
              },
            <String, Object?>{
              'offerId': probeOfferId.value,
              'usagePolicy': 'oncePerCustomer',
            },
          ];
          api.onStart = (_) async => _startResponse();
          api.onRestaurantPage = (_) async =>
              _guestRestaurantResponse(guestComplete);
          api.onValidation = (_) async => _guestValidationResponse(
            rejectOnContinuation ? validChallenge : malformedChallenge,
          );
          api.onContinuation = (_) async =>
              _guestContinuationResponse(malformedChallenge);
          final harness = _Harness(
            api: api,
            auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
          );

          await harness.coordinator.startSearch(_criteria());
          harness.preferences.readKeys.clear();
          await expectLater(
            harness.coordinator.validateRedemption(
              restaurantId: restaurantId,
              offerId: offerId,
              redemptionRequestId:
                  'guest-probe-${rejectOnContinuation ? 'later' : 'first'}-'
                  '${includeExpectedTarget ? 'many' : 'wrong'}-0001',
            ),
            throwsA(isA<CustomerBiteSaverProtocolException>()),
          );

          expect(
            harness.preferences.readKeys,
            isNot(contains(harness.store.offerKey(probeOfferId))),
          );
          expect(
            api.continuationRequests,
            hasLength(rejectOnContinuation ? 1 : 0),
          );
          expect(
            api.continuationRequests.expand(
              (request) => request.unavailableOfferIds,
            ),
            isNot(contains(probeOfferId)),
          );
          harness.dispose();
        }
      }
    },
  );

  test(
    'guest validation starts durable local timer and never calls signed start',
    () async {
      final api = _FakeApi();
      final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
      guestComplete['guestStateRevision'] = 0;
      final guestRestaurant = _map(
        (_map(guestComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        guestRestaurant['restaurantId']! as String,
      );
      final guestOffer = _map((guestRestaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(
        guestOffer['offerId']! as String,
      );
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(guestComplete);
      api.onValidation = (_) async => _guestValidationResponse(
        _map(_guestResponses['validationChallenge']),
      );
      var continuationAttempts = 0;
      api.onContinuation = (_) async {
        continuationAttempts += 1;
        if (continuationAttempts == 1) {
          throw const CustomerBiteSaverServiceException(
            kind: CustomerBiteSaverServiceFailureKind.transport,
            code: 'transport-error',
            message: 'uncertain validation continuation',
          );
        }
        return _guestContinuationResponse(
          _map(_guestResponses['validationComplete']),
        );
      };
      var signedStarts = 0;
      api.onRedemptionStart = (_) async {
        signedStarts += 1;
        throw StateError('guest called signed endpoint');
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: 'guest-redemption-0001',
        ),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );
      final failedContinuation = api.continuationRequests.single.toJson();
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-redemption-0001',
      );
      expect(api.validationRequests, hasLength(1));
      expect(api.continuationRequests, hasLength(2));
      expect(api.continuationRequests.last.toJson(), failedContinuation);
      expect(decision.allowed, isTrue);
      final receipt = await harness.coordinator.startValidatedRedemption();

      expect(receipt.isGuest, isTrue);
      expect(receipt.isUnlimited, isFalse);
      expect(receipt.timerStartedAtMillis, _evaluationAtMillis);
      expect(
        receipt.timerExpiresAtMillis,
        _evaluationAtMillis + const Duration(minutes: 5).inMilliseconds,
      );
      expect(signedStarts, 0);
      expect(harness.coordinator.guestStateRevision, 1);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
      );
      expect(await harness.store.readRevision(), 1);
    },
  );

  test(
    'guest start blocks superseding validation and recovers after cleanup uncertainty',
    () async {
      final api = _FakeApi();
      final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
      guestComplete['guestStateRevision'] = 0;
      final guestRestaurant = _map(
        (_map(guestComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        guestRestaurant['restaurantId']! as String,
      );
      final guestOffer = _map((guestRestaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(
        guestOffer['offerId']! as String,
      );
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(guestComplete);
      api.onValidation = (_) async => _guestValidationResponse(
        _map(_guestResponses['validationChallenge']),
      );
      api.onContinuation = (_) async => _guestContinuationResponse(
        _map(_guestResponses['validationComplete']),
      );
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      expect(harness.coordinator.restaurantPager?.error, isNull);
      expect(
        harness.coordinator
            .previewOffersFor(restaurantId)
            .map((candidate) => candidate.offerId),
        contains(offerId),
      );
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-recovery-redemption-0001',
      );
      final cleanupEntered = Completer<void>();
      final cleanupGate = Completer<void>();
      harness.preferences.beforeMutation = (mutationNumber, key, value) async {
        if (mutationNumber == 4) {
          cleanupEntered.complete();
          await cleanupGate.future;
        }
      };
      harness.preferences.throwOnMutationNumber = 4;
      final failedStart = harness.coordinator.startValidatedRedemption();
      final failedExpectation = expectLater(
        failedStart,
        throwsA(
          isA<CustomerBiteSaverGuestUsageException>().having(
            (error) => error.failure,
            'failure',
            CustomerBiteSaverGuestUsageFailure.writeFailed,
          ),
        ),
      );
      await cleanupEntered.future;
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: 'guest-recovery-redemption-0002',
        ),
        throwsA(isA<StateError>()),
      );
      cleanupGate.complete();
      await failedExpectation;

      expect(harness.preferences.values[harness.store.journalKey], isNotNull);
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        decision.validationExpiresAtMillis! + 1,
        isUtc: true,
      );
      final receipt = await harness.coordinator.startValidatedRedemption();

      expect(receipt.isGuest, isTrue);
      expect(
        receipt.guestResult?.status,
        CustomerBiteSaverGuestRedemptionStartStatus.replayed,
      );
      expect(receipt.timerStartedAtMillis, _evaluationAtMillis);
      expect(
        receipt.timerExpiresAtMillis,
        _evaluationAtMillis + const Duration(minutes: 5).inMilliseconds,
      );
      expect(receipt.guestResult?.guestStateRevision, 1);
      expect(harness.preferences.values[harness.store.journalKey], isNull);
      expect(harness.coordinator.guestStateRevision, 1);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
      );
    },
  );

  test(
    'signed-out to anonymous preserves uncertain guest start recovery',
    () async {
      final api = _FakeApi();
      final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
      final guestRestaurant = _map(
        (_map(guestComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        guestRestaurant['restaurantId']! as String,
      );
      final guestOffer = _map((guestRestaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(
        guestOffer['offerId']! as String,
      );
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(guestComplete);
      api.onValidation = (_) async => _guestValidationResponse(
        _map(_guestResponses['validationChallenge']),
      );
      api.onContinuation = (_) async => _guestContinuationResponse(
        _map(_guestResponses['validationComplete']),
      );
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-auth-recovery-0001',
      );
      harness.preferences.throwOnMutationNumber = 4;
      await expectLater(
        harness.coordinator.startValidatedRedemption(),
        throwsA(
          isA<CustomerBiteSaverGuestUsageException>().having(
            (error) => error.failure,
            'failure',
            CustomerBiteSaverGuestUsageFailure.writeFailed,
          ),
        ),
      );
      final originalOffer =
          harness.preferences.values[harness.store.offerKey(offerId)];

      await harness.coordinator.updateAuth(
        const CustomerBiteSaverAuthSnapshot.anonymous('anonymous-user'),
      );
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        decision.validationExpiresAtMillis! + 1,
        isUtc: true,
      );
      final receipt = await harness.coordinator.startValidatedRedemption();

      expect(
        receipt.guestResult?.status,
        CustomerBiteSaverGuestRedemptionStartStatus.replayed,
      );
      expect(receipt.timerStartedAtMillis, _evaluationAtMillis);
      expect(receipt.guestResult?.guestStateRevision, 1);
      expect(
        harness.preferences.values[harness.store.offerKey(offerId)],
        originalOffer,
      );
      expect(harness.preferences.values[harness.store.journalKey], isNull);
    },
  );

  test(
    'guest continuation validation rejects mismatched result identity',
    () async {
      final api = _FakeApi();
      final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
      guestComplete['guestStateRevision'] = 1;
      final guestRestaurant = _map(
        (_map(guestComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        guestRestaurant['restaurantId']! as String,
      );
      final guestOffer = _map((guestRestaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(
        guestOffer['offerId']! as String,
      );
      final mismatchedComplete = _copyMap(
        _guestResponses['validationComplete'],
      );
      mismatchedComplete['guestStateRevision'] = 1;
      final mismatchedResult = _map(mismatchedComplete['result']);
      mismatchedResult['offerId'] = _offerId(999);
      mismatchedComplete['result'] = mismatchedResult;
      final validationChallenge = _copyMap(
        _guestResponses['validationChallenge'],
      );
      validationChallenge['guestStateRevision'] = 1;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(guestComplete, guestStateRevision: 1);
      api.onValidation = (_) async =>
          _guestValidationResponse(validationChallenge, guestStateRevision: 1);
      api.onContinuation = (_) async =>
          _guestContinuationResponse(mismatchedComplete, guestStateRevision: 1);
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final active = await _seedActiveTimer(
        harness,
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'rejected-validation-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );

      await harness.coordinator.startSearch(_criteria());
      final acceptedContextDeadline =
          _map(guestComplete['evaluationContext'])['validUntilExclusiveMillis']!
              as int;
      final acceptedContextTask = harness.scheduler.tasks.singleWhere(
        (task) =>
            !task.cancelled &&
            task.delay ==
                Duration(
                  milliseconds:
                      acceptedContextDeadline -
                      harness.now.millisecondsSinceEpoch,
                ),
      );
      await expectLater(
        harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: 'guest-redemption-identity-0001',
        ),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
      );

      expect(harness.coordinator.redemptionDecision, isNull);
      final rejectedDelay = Duration(
        milliseconds:
            active.timerExpiresAtMillis - harness.now.millisecondsSinceEpoch,
      );
      expect(acceptedContextTask.cancelled, isFalse);
      expect(
        harness.scheduler.tasks.where(
          (task) => !task.cancelled && task.delay == rejectedDelay,
        ),
        isEmpty,
      );
      await expectLater(
        harness.coordinator.startValidatedRedemption(),
        throwsA(isA<StateError>()),
      );
      expect(await harness.store.readRevision(), 1);
    },
  );

  test(
    'accepted guest validation installs its challenged timer deadline',
    () async {
      final api = _FakeApi();
      final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
      guestComplete['guestStateRevision'] = 1;
      final guestRestaurant = _map(
        (_map(guestComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        guestRestaurant['restaurantId']! as String,
      );
      final guestOffer = _map((guestRestaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(
        guestOffer['offerId']! as String,
      );
      final validationChallenge = _copyMap(
        _guestResponses['validationChallenge'],
      );
      validationChallenge['guestStateRevision'] = 1;
      final validationComplete = _copyMap(
        _guestResponses['validationComplete'],
      );
      validationComplete['guestStateRevision'] = 1;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(guestComplete, guestStateRevision: 1);
      api.onValidation = (_) async =>
          _guestValidationResponse(validationChallenge, guestStateRevision: 1);
      api.onContinuation = (_) async =>
          _guestContinuationResponse(validationComplete, guestStateRevision: 1);
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);
      final active = await _seedActiveTimer(
        harness,
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'accepted-validation-timer-0001',
        minutesBeforeEvaluation: 4,
        expectedRevision: 0,
      );

      await harness.coordinator.startSearch(_criteria());
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'accepted-validation-timer-check-0001',
      );

      expect(decision.allowed, isTrue);
      final timerTask = harness.scheduler.tasks.singleWhere(
        (task) =>
            !task.cancelled &&
            task.delay ==
                Duration(
                  milliseconds:
                      active.timerExpiresAtMillis -
                      harness.now.millisecondsSinceEpoch,
                ),
      );
      harness.now = DateTime.fromMillisecondsSinceEpoch(
        active.timerExpiresAtMillis,
        isUtc: true,
      );
      timerTask.fire();

      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
      );
      expect(harness.coordinator.redemptionDecision, isNull);
    },
  );

  test(
    'guest allowed-unlimited completes without a local usage write',
    () async {
      final api = _FakeApi();
      final restaurantComplete = _copyMap(
        _guestResponses['restaurantComplete'],
      );
      restaurantComplete['guestStateRevision'] = 0;
      final restaurant = _map(
        (_map(restaurantComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        restaurant['restaurantId']! as String,
      );
      final offer = _map((restaurant['offers']! as List).first);
      offer['usageRule'] = 'Unlimited';
      offer['usagePolicy'] = 'unlimited';
      offer['redemptionPolicyLabel'] = 'Unlimited';
      restaurant['offers'] = <Map<String, dynamic>>[offer];
      restaurant['usableOfferCount'] = 1;
      final restaurantResult = _map(restaurantComplete['result']);
      restaurantResult['restaurants'] = <Map<String, dynamic>>[restaurant];
      restaurantComplete['result'] = restaurantResult;
      final offerId = CustomerBiteSaverOfferId(offer['offerId']! as String);
      final validationComplete = _copyMap(
        _guestResponses['validationComplete'],
      );
      validationComplete['guestStateRevision'] = 0;
      final validationResult = _map(validationComplete['result']);
      validationResult['usagePolicy'] = 'unlimited';
      validationComplete['result'] = validationResult;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(restaurantComplete);
      api.onValidation = (_) async =>
          _guestValidationResponse(validationComplete);
      var signedStarts = 0;
      api.onRedemptionStart = (_) async {
        signedStarts += 1;
        throw StateError('unexpected signed start');
      };
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      expect(harness.coordinator.restaurantPager?.error, isNull);
      expect(
        harness.coordinator
            .previewOffersFor(restaurantId)
            .map((candidate) => candidate.offerId),
        contains(offerId),
      );
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-unlimited-0001',
      );
      expect(decision.allowed, isTrue);
      final receipt = await harness.coordinator.startValidatedRedemption();

      expect(receipt.isGuest, isTrue);
      expect(receipt.isUnlimited, isTrue);
      expect(receipt.timerStartedAtMillis, isNull);
      expect(receipt.timerExpiresAtMillis, isNull);
      expect(await harness.store.readRevision(), 0);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.ready,
      );
      expect(signedStarts, 0);
    },
  );

  test(
    'guest revision change invalidates unlimited and timer authorizations',
    () async {
      for (final unlimited in <bool>[true, false]) {
        final api = _FakeApi();
        final restaurantComplete = _copyMap(
          _guestResponses['restaurantComplete'],
        );
        final restaurant = _map(
          (_map(restaurantComplete['result'])['restaurants']! as List).first,
        );
        final offer = _map((restaurant['offers']! as List).first);
        if (unlimited) {
          offer['usageRule'] = 'Unlimited';
          offer['usagePolicy'] = 'unlimited';
          offer['redemptionPolicyLabel'] = 'Unlimited';
        }
        restaurant['offers'] = <Map<String, dynamic>>[offer];
        restaurant['usableOfferCount'] = 1;
        final result = _map(restaurantComplete['result']);
        result['restaurants'] = <Map<String, dynamic>>[restaurant];
        restaurantComplete['result'] = result;
        final restaurantId = CustomerBiteSaverRestaurantId(
          restaurant['restaurantId']! as String,
        );
        final offerId = CustomerBiteSaverOfferId(offer['offerId']! as String);
        api.onStart = (_) async => _startResponse();
        api.onRestaurantPage = (_) async =>
            _guestRestaurantResponse(restaurantComplete);
        final validationSource = _copyMap(
          _guestResponses[unlimited
              ? 'validationComplete'
              : 'validationChallenge'],
        );
        if (unlimited) {
          final validationResult = _map(validationSource['result']);
          validationResult['usagePolicy'] = 'unlimited';
          validationSource['result'] = validationResult;
        }
        api.onValidation = (_) async =>
            _guestValidationResponse(validationSource);
        if (!unlimited) {
          api.onContinuation = (_) async => _guestContinuationResponse(
            _map(_guestResponses['validationComplete']),
          );
        }
        final harness = _Harness(
          api: api,
          auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
        );

        await harness.coordinator.startSearch(_criteria());
        await harness.coordinator.validateRedemption(
          restaurantId: restaurantId,
          offerId: offerId,
          redemptionRequestId: unlimited
              ? 'guest-revision-unlimited-0001'
              : 'guest-revision-timer-0001',
        );
        harness.preferences.values[harness.store.metaKey] = jsonEncode(
          <String, Object?>{
            'schemaVersion': 1,
            'guestStateRevision': 1,
            'activeOfferIds': <String>[],
          },
        );

        await expectLater(
          harness.coordinator.startValidatedRedemption(),
          throwsA(isA<CustomerBiteSaverFreshSearchRequiredException>()),
        );
        expect(
          harness.coordinator.status,
          CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
        );
        expect(harness.coordinator.redemptionDecision, isNull);
        await expectLater(
          harness.coordinator.startValidatedRedemption(),
          throwsA(isA<StateError>()),
        );
        expect(harness.preferences.mutationCount, 0);
        expect(await harness.store.readRevision(), 1);
        harness.dispose();
      }
    },
  );

  test(
    'queued guest revision race adopts durable revision and requires fresh search',
    () async {
      final api = _FakeApi();
      final guestComplete = _copyMap(_guestResponses['restaurantComplete']);
      final guestRestaurant = _map(
        (_map(guestComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        guestRestaurant['restaurantId']! as String,
      );
      final guestOffer = _map((guestRestaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(
        guestOffer['offerId']! as String,
      );
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(guestComplete);
      api.onValidation = (_) async => _guestValidationResponse(
        _map(_guestResponses['validationChallenge']),
      );
      api.onContinuation = (_) async => _guestContinuationResponse(
        _map(_guestResponses['validationComplete']),
      );
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-queued-race-0001',
      );

      final competingStore = CustomerBiteSaverGuestUsageStore(
        guestDeviceId: 'coordinator-guest-device',
        preferences: harness.preferences,
        clock: () => harness.now,
      );
      final evaluationContext = CustomerBiteSaverEvaluationContext.fromJson(
        _map(_map(_guestResponses['validationComplete'])['evaluationContext']),
      );
      final competingQueued = Completer<void>();
      late Future<CustomerBiteSaverGuestRedemptionStart> competingStart;
      var queueCompetingStart = true;
      harness.preferences.beforeRead = (key) async {
        if (queueCompetingStart && key == harness.store.metaKey) {
          queueCompetingStart = false;
          scheduleMicrotask(() {
            competingStart = competingStore.startRedemption(
              redemptionRequestId: 'guest-competing-race-0001',
              restaurantId: restaurantId,
              offerId: CustomerBiteSaverOfferId(_offerId(999)),
              usagePolicy: CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
              evaluationContext: evaluationContext,
              validationExpiresAtMillis: _evaluationAtMillis + 60000,
              expectedGuestStateRevision: 0,
            );
            competingQueued.complete();
          });
        }
      };

      final start = harness.coordinator.startValidatedRedemption();
      final startExpectation = expectLater(
        start,
        throwsA(isA<CustomerBiteSaverFreshSearchRequiredException>()),
      );
      await competingQueued.future;
      await startExpectation;
      expect((await competingStart).guestStateRevision, 1);

      expect(harness.coordinator.guestStateRevision, 1);
      expect(
        harness.coordinator.status,
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired,
      );
      expect(harness.coordinator.redemptionDecision, isNull);
      await expectLater(
        harness.coordinator.startValidatedRedemption(),
        throwsA(isA<StateError>()),
      );
    },
  );

  test('guest unlimited rechecks its deadline after revision read', () async {
    final api = _FakeApi();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
    final offerId = CustomerBiteSaverOfferId(_offerId(1));
    final unlimitedOffer = _offerJson(1)
      ..['usageRule'] = 'Unlimited'
      ..['usagePolicy'] = 'unlimited'
      ..['redemptionPolicyLabel'] = 'Unlimited';
    final restaurantComplete = _copyMap(_guestResponses['restaurantComplete']);
    final restaurantResult = _map(restaurantComplete['result']);
    restaurantResult['restaurants'] = <Map<String, dynamic>>[
      _restaurantJson(1, offers: <Map<String, dynamic>>[unlimitedOffer]),
    ];
    restaurantComplete['result'] = restaurantResult;
    final validationComplete = _copyMap(_guestResponses['validationComplete']);
    final validationResult = _map(validationComplete['result']);
    validationResult['restaurantId'] = restaurantId.value;
    validationResult['offerId'] = offerId.value;
    validationResult['usagePolicy'] = 'unlimited';
    validationComplete['result'] = validationResult;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async =>
        _guestRestaurantResponse(restaurantComplete);
    api.onValidation = (_) async =>
        _guestValidationResponse(validationComplete);
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    final decision = await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerId,
      redemptionRequestId: 'guest-unlimited-deadline-0001',
    );
    final readEntered = Completer<void>();
    final releaseRead = Completer<void>();
    var shouldBlock = true;
    harness.preferences.beforeRead = (key) async {
      if (shouldBlock && key == harness.store.metaKey) {
        shouldBlock = false;
        readEntered.complete();
        await releaseRead.future;
      }
    };

    final start = harness.coordinator.startValidatedRedemption();
    await readEntered.future;
    harness.now = DateTime.fromMillisecondsSinceEpoch(
      decision.validationExpiresAtMillis!,
      isUtc: true,
    );
    releaseRead.complete();

    await expectLater(
      start,
      throwsA(
        isA<CustomerBiteSaverGuestUsageException>().having(
          (error) => error.failure,
          'failure',
          CustomerBiteSaverGuestUsageFailure.validationExpired,
        ),
      ),
    );
    harness.preferences.beforeRead = null;
    expect(harness.preferences.mutationCount, 0);
    expect(await harness.store.readRevision(), 0);
  });

  test('guest legacy usage labels remain timer-only, not unlimited', () async {
    final api = _FakeApi();
    final restaurantId = CustomerBiteSaverRestaurantId(_restaurantId(1));
    final offerId = CustomerBiteSaverOfferId(_offerId(1));
    final legacyOffer = _offerJson(1)
      ..['usageRule'] = 'One per household'
      ..['usagePolicy'] = 'reusableAfterTimer'
      ..['redemptionPolicyLabel'] = 'One per household';
    final restaurantComplete = _copyMap(_guestResponses['restaurantComplete']);
    final restaurantResult = _map(restaurantComplete['result']);
    restaurantResult['restaurants'] = <Map<String, dynamic>>[
      _restaurantJson(1, offers: <Map<String, dynamic>>[legacyOffer]),
    ];
    restaurantComplete['result'] = restaurantResult;
    final validationComplete = _copyMap(_guestResponses['validationComplete']);
    final validationResult = _map(validationComplete['result']);
    validationResult['restaurantId'] = restaurantId.value;
    validationResult['offerId'] = offerId.value;
    validationResult['usagePolicy'] = 'reusableAfterTimer';
    validationComplete['result'] = validationResult;
    api.onStart = (_) async => _startResponse();
    api.onRestaurantPage = (_) async =>
        _guestRestaurantResponse(restaurantComplete);
    api.onValidation = (_) async =>
        _guestValidationResponse(validationComplete);
    final harness = _Harness(
      api: api,
      auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
    );
    addTearDown(harness.dispose);

    await harness.coordinator.startSearch(_criteria());
    await harness.coordinator.validateRedemption(
      restaurantId: restaurantId,
      offerId: offerId,
      redemptionRequestId: 'guest-timer-only-0001',
    );
    final receipt = await harness.coordinator.startValidatedRedemption();

    expect(receipt.isUnlimited, isFalse);
    expect(receipt.timerStartedAtMillis, _evaluationAtMillis);
    expect(
      receipt.timerExpiresAtMillis,
      _evaluationAtMillis + const Duration(minutes: 5).inMilliseconds,
    );
    expect(await harness.store.readRevision(), 1);
  });

  test(
    'guest denied direct completion remains a denial without policy',
    () async {
      final api = _FakeApi();
      final restaurantComplete = _copyMap(
        _guestResponses['restaurantComplete'],
      );
      restaurantComplete['guestStateRevision'] = 0;
      final restaurant = _map(
        (_map(restaurantComplete['result'])['restaurants']! as List).first,
      );
      final restaurantId = CustomerBiteSaverRestaurantId(
        restaurant['restaurantId']! as String,
      );
      final offer = _map((restaurant['offers']! as List).first);
      final offerId = CustomerBiteSaverOfferId(offer['offerId']! as String);
      final validationComplete = _copyMap(
        _guestResponses['validationComplete'],
      );
      validationComplete['guestStateRevision'] = 0;
      final validationResult = _map(validationComplete['result']);
      validationResult['allowed'] = false;
      validationResult['reason'] = 'alreadyUsed';
      validationResult['usagePolicy'] = null;
      validationResult['validationId'] = null;
      validationResult['validationExpiresAtMillis'] = null;
      validationComplete['result'] = validationResult;
      api.onStart = (_) async => _startResponse();
      api.onRestaurantPage = (_) async =>
          _guestRestaurantResponse(restaurantComplete);
      api.onValidation = (_) async =>
          _guestValidationResponse(validationComplete);
      final harness = _Harness(
        api: api,
        auth: const CustomerBiteSaverAuthSnapshot.signedOut(),
      );
      addTearDown(harness.dispose);

      await harness.coordinator.startSearch(_criteria());
      final decision = await harness.coordinator.validateRedemption(
        restaurantId: restaurantId,
        offerId: offerId,
        redemptionRequestId: 'guest-denied-00001',
      );

      expect(decision.allowed, isFalse);
      await expectLater(
        harness.coordinator.startValidatedRedemption(),
        throwsA(isA<StateError>()),
      );
      expect(await harness.store.readRevision(), 0);
    },
  );
}
