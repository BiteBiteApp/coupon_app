import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fixturePath =
    'test/fixtures/customer_bitesaver_client_boundary_v1.json';

Map<String, dynamic> _map(Object? value) =>
    Map<String, dynamic>.from(value! as Map);

Map<String, dynamic> _copyMap(Object? value) =>
    jsonDecode(jsonEncode(value))! as Map<String, dynamic>;

Map<String, dynamic> _directResultMap(Object? value) =>
    _copyMap(value)..remove('evaluationContext');

void main() {
  late Map<String, dynamic> fixture;
  late Map<String, dynamic> signedRequests;
  late Map<String, dynamic> signedResponses;
  late Map<String, dynamic> guestRequests;
  late Map<String, dynamic> guestResponses;

  setUpAll(() {
    fixture =
        jsonDecode(File(_fixturePath).readAsStringSync())!
            as Map<String, dynamic>;
    final signed = _map(fixture['signed']);
    final guest = _map(fixture['guest']);
    signedRequests = _map(signed['requests']);
    signedResponses = _map(signed['responses']);
    guestRequests = _map(guest['requests']);
    guestResponses = _map(guest['responses']);
  });

  test('contract constants match the backend-generated fixture', () {
    final contract = _map(fixture['contract']);
    expect(
      fixture['fixtureVersion'],
      'bitestar.customer-bitesaver-client-boundary.v1',
    );
    expect(
      contract['protocolVersion'],
      CustomerBiteSaverSearchContract.protocolVersion,
    );
    expect(
      contract['schemaVersion'],
      CustomerBiteSaverSearchContract.schemaVersion,
    );
    expect(contract['region'], 'us-central1');
    expect(contract['pageSize'], CustomerBiteSaverSearchContract.pageSize);
    expect(
      contract['pageConsumeLimit'],
      CustomerBiteSaverSearchContract.maximumPageScan,
    );
    expect(
      Set<int>.from(contract['supportedRadiiMiles']! as List),
      CustomerBiteSaverSearchContract.supportedRadiiMiles,
    );
  });

  test(
    'production fixture carries the New York daily boundary without offset reuse',
    () {
      final daily = _map(fixture['dailyUsageParity']);
      final parsed = parseCustomerBiteSaverEndpointResponse(
        daily['response'],
        expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      );
      expect(
        parsed,
        isA<
          CustomerBiteSaverDirectResponse<CustomerBiteSaverRestaurantPageResult>
        >(),
      );
      final direct =
          parsed
              as CustomerBiteSaverDirectResponse<
                CustomerBiteSaverRestaurantPageResult
              >;
      final context = direct.evaluationContext;
      final completionAtMillis = daily['completionAtMillis']! as int;
      expect(
        context.evaluationAtMillis,
        DateTime.parse('2026-03-08T07:30:00.000Z').millisecondsSinceEpoch,
      );
      expect(
        completionAtMillis,
        DateTime.parse('2026-03-08T04:30:00.000Z').millisecondsSinceEpoch,
      );
      expect(context.timeZone, 'America/New_York');
      expect(context.utcOffsetMinutes, -240);
      expect(context.oncePerDayUnavailableAt(completionAtMillis), isFalse);
      expect(
        direct.result.restaurants.single.offers.map(
          (offer) => offer.usagePolicy,
        ),
        everyElement(CustomerBiteSaverUsagePolicy.oncePerDay),
      );
    },
  );

  test('all request DTOs serialize to exact callable request records', () {
    final startJson = _map(signedRequests['start']);
    final criteria = CustomerBiteSaverSearchCriteria(
      latitude: (startJson['latitude']! as num).toDouble(),
      longitude: (startJson['longitude']! as num).toDouble(),
      radiusMiles: startJson['radiusMiles']! as int,
      locationMode: CustomerBiteSaverLocationMode.current,
      typedLocation: null,
      searchText: startJson['searchText']! as String,
      timeZone: startJson['timeZone']! as String,
      utcOffsetMinutes: startJson['utcOffsetMinutes']! as int,
    );
    final startRequest = CustomerBiteSaverStartRequest(
      clientRequestId: startJson['clientRequestId']! as String,
      clientInstanceId: startJson['clientInstanceId']! as String,
      criteria: criteria,
      freshSearch: startJson['freshSearch']! as bool,
    );
    expect(startRequest.toJson(), startJson);

    final started = CustomerBiteSaverStartResponse.fromJson(
      signedResponses['start'],
    );
    final binding = CustomerBiteSaverSessionBinding.fromStart(
      clientInstanceId: startRequest.clientInstanceId,
      response: started,
    );
    expect(binding.attemptGeneration, started.attemptGeneration);
    expect(binding.queryFingerprint, started.queryFingerprint);

    final statusJson = _map(signedRequests['status']);
    expect(
      CustomerBiteSaverStatusRequest(
        clientRequestId: statusJson['clientRequestId']! as String,
        binding: binding,
      ).toJson(),
      statusJson,
    );

    final restaurantJson = _map(signedRequests['restaurantPage']);
    expect(
      CustomerBiteSaverRestaurantPageRequest(
        clientRequestId: restaurantJson['clientRequestId']! as String,
        binding: binding,
        cursor: restaurantJson['cursor'] as String?,
        guestStateRevision: restaurantJson['guestStateRevision'] as int?,
      ).toJson(),
      restaurantJson,
    );

    final offerJson = _map(signedRequests['offerPage']);
    expect(
      CustomerBiteSaverOfferPageRequest(
        clientRequestId: offerJson['clientRequestId']! as String,
        binding: binding,
        restaurantId: CustomerBiteSaverRestaurantId(
          offerJson['restaurantId']! as String,
        ),
        cursor: offerJson['cursor'] as String?,
        guestStateRevision: offerJson['guestStateRevision'] as int?,
      ).toJson(),
      offerJson,
    );

    final favoriteJson = _map(signedRequests['favoriteStates']);
    expect(
      CustomerBiteSaverFavoriteStatesRequest(
        clientRequestId: favoriteJson['clientRequestId']! as String,
        binding: binding,
        restaurantIds: (favoriteJson['restaurantIds']! as List)
            .cast<String>()
            .map(CustomerBiteSaverRestaurantId.new)
            .toList(),
        offerIds: (favoriteJson['offerIds']! as List)
            .cast<String>()
            .map(CustomerBiteSaverOfferId.new)
            .toList(),
      ).toJson(),
      favoriteJson,
    );

    final validationJson = _map(signedRequests['redemptionValidation']);
    final validationRequest = CustomerBiteSaverRedemptionValidationRequest(
      clientRequestId: validationJson['clientRequestId']! as String,
      binding: binding,
      restaurantId: CustomerBiteSaverRestaurantId(
        validationJson['restaurantId']! as String,
      ),
      offerId: CustomerBiteSaverOfferId(validationJson['offerId']! as String),
      offerOccurrence: validationJson['offerOccurrence']! as String,
      redemptionRequestId: validationJson['redemptionRequestId']! as String,
      currentCoordinates: null,
      guestStateRevision: null,
    );
    expect(validationRequest.toJson(), validationJson);

    final redemptionStartJson = _map(signedRequests['redemptionStart']);
    expect(
      CustomerBiteSaverRedemptionStartRequest.fromValidation(
        request: validationRequest,
        clientRequestId: redemptionStartJson['clientRequestId']! as String,
        validationId: redemptionStartJson['validationId']! as String,
      ).toJson(),
      redemptionStartJson,
    );

    final continuationJson = _map(guestRequests['restaurantContinuation']);
    final guestBinding = CustomerBiteSaverSessionBinding(
      clientInstanceId: continuationJson['clientInstanceId']! as String,
      sessionId: continuationJson['sessionId']! as String,
      capability: continuationJson['capability']! as String,
      criteriaFingerprint: continuationJson['criteriaFingerprint']! as String,
    );
    expect(
      CustomerBiteSaverGuestContinuationRequest(
        clientRequestId: continuationJson['clientRequestId']! as String,
        binding: guestBinding,
        operationRef: continuationJson['operationRef']! as String,
        checkToken: continuationJson['checkToken']! as String,
        batchSequence: continuationJson['batchSequence']! as int,
        guestStateRevision: continuationJson['guestStateRevision']! as int,
        unavailableOfferIds: (continuationJson['unavailableOfferIds']! as List)
            .cast<String>()
            .map(CustomerBiteSaverOfferId.new)
            .toList(),
      ).toJson(),
      continuationJson,
    );
  });

  test('start and every status state parse closed and round-trip', () {
    final start = CustomerBiteSaverStartResponse.fromJson(
      signedResponses['start'],
    );
    expect(start.state, CustomerBiteSaverSearchState.preparing);
    expect(start.toJson(), signedResponses['start']);

    final statuses = _map(signedResponses['status']);
    for (final entry in statuses.entries) {
      final response = CustomerBiteSaverStatusResponse.fromJson(entry.value);
      expect(
        response.state.name,
        entry.key == 'expiredAfterFailure' ? 'expired' : entry.key,
      );
      expect(response.toJson(), entry.value);
    }
    final failed = CustomerBiteSaverStatusResponse.fromJson(statuses['failed']);
    expect(failed.retriable, isTrue);
    expect(failed.failureCode, CustomerBiteSaverFailureCode.preparationFailed);
    final expiredAfterFailure = CustomerBiteSaverStatusResponse.fromJson(
      statuses['expiredAfterFailure'],
    );
    expect(expiredAfterFailure.state, CustomerBiteSaverSearchState.expired);
    expect(expiredAfterFailure.retriable, isTrue);
    expect(
      expiredAfterFailure.failureCode,
      CustomerBiteSaverFailureCode.preparationFailed,
    );
  });

  test(
    'signed bare page, favorite, validation, and start shapes round-trip',
    () {
      final restaurantPage = CustomerBiteSaverRestaurantPageResult.fromJson(
        _directResultMap(signedResponses['restaurantPage']),
      );
      expect(
        restaurantPage.toJson(),
        _directResultMap(signedResponses['restaurantPage']),
      );
      expect(restaurantPage.restaurants, hasLength(1));
      final restaurant = restaurantPage.restaurants.single;
      expect(restaurant.displayName, 'Fixture Café 😀');
      expect(restaurant.favoriteState, CustomerBiteSaverFavoriteState.unknown);
      expect(restaurant.usableOfferCount, 2);
      expect(restaurant.offers, hasLength(2));
      final rawRestaurant = _map(
        (_map(signedResponses['restaurantPage'])['restaurants']! as List)
            .single,
      );
      final rawOffer = _map((rawRestaurant['offers']! as List).first);
      expect(
        restaurant.offers.first.offerOccurrence,
        rawOffer['offerOccurrence'],
      );

      final offerPage = CustomerBiteSaverOfferPageResult.fromJson(
        _directResultMap(signedResponses['offerPage']),
      );
      expect(
        offerPage.toJson(),
        _directResultMap(signedResponses['offerPage']),
      );
      expect(offerPage.offers.first.availabilityReason, 'available');

      final favorites = CustomerBiteSaverFavoriteStatesResponse.fromJson(
        signedResponses['favoriteStates'],
      );
      expect(favorites.toJson(), signedResponses['favoriteStates']);
      expect(
        favorites.states.map((entry) => entry.state),
        everyElement(CustomerBiteSaverFavoriteState.notFavorite),
      );

      final validation = CustomerBiteSaverRedemptionValidationResult.fromJson(
        _directResultMap(signedResponses['redemptionValidation']),
      );
      expect(validation.allowed, isTrue);
      expect(validation.reason, 'available');
      expect(
        validation.toJson(),
        _directResultMap(signedResponses['redemptionValidation']),
      );

      final redemption = CustomerBiteSaverRedemptionStartResult.fromJson(
        signedResponses['redemptionStart'],
      );
      expect(redemption.status, CustomerBiteSaverRedemptionStatus.started);
      expect(
        redemption.timerExpiresAtMillis! - redemption.timerStartedAtMillis!,
        CustomerBiteSaverSearchContract.redemptionTimerMilliseconds,
      );
      expect(redemption.toJson(), signedResponses['redemptionStart']);
    },
  );

  test(
    'signed page and validation data are distinguished from guest envelopes',
    () {
      final restaurant = parseCustomerBiteSaverEndpointResponse(
        signedResponses['restaurantPage'],
        expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      );
      final offer = parseCustomerBiteSaverEndpointResponse(
        signedResponses['offerPage'],
        expectedOperation: CustomerBiteSaverGuestOperation.offerPage,
        resultParser: CustomerBiteSaverOfferPageResult.fromJson,
      );
      final validation = parseCustomerBiteSaverEndpointResponse(
        signedResponses['redemptionValidation'],
        expectedOperation: CustomerBiteSaverGuestOperation.redemptionStart,
        resultParser: CustomerBiteSaverRedemptionValidationResult.fromJson,
      );
      expect(
        restaurant,
        isA<
          CustomerBiteSaverDirectResponse<CustomerBiteSaverRestaurantPageResult>
        >(),
      );
      expect(
        offer,
        isA<
          CustomerBiteSaverDirectResponse<CustomerBiteSaverOfferPageResult>
        >(),
      );
      expect(
        validation,
        isA<
          CustomerBiteSaverDirectResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >(),
      );
    },
  );

  test('guest challenges for page, offer, and validation parse closed', () {
    final cases =
        <
          (
            String,
            CustomerBiteSaverGuestOperation,
            CustomerBiteSaverOperationResult Function(Object?),
          )
        >[
          (
            'restaurantChallenge',
            CustomerBiteSaverGuestOperation.restaurantPage,
            CustomerBiteSaverRestaurantPageResult.fromJson,
          ),
          (
            'offerChallenge',
            CustomerBiteSaverGuestOperation.offerPage,
            CustomerBiteSaverOfferPageResult.fromJson,
          ),
          (
            'validationChallenge',
            CustomerBiteSaverGuestOperation.redemptionStart,
            CustomerBiteSaverRedemptionValidationResult.fromJson,
          ),
        ];
    for (final (key, operation, parser) in cases) {
      final response = parseCustomerBiteSaverEndpointResponse(
        guestResponses[key],
        expectedOperation: operation,
        resultParser: parser,
      );
      expect(
        response,
        isA<
          CustomerBiteSaverGuestCheckRequired<CustomerBiteSaverOperationResult>
        >(),
      );
      final challenge =
          response
              as CustomerBiteSaverGuestCheckRequired<
                CustomerBiteSaverOperationResult
              >;
      expect(challenge.candidates, isNotEmpty);
      expect(challenge.operation, operation);
      expect(challenge.toJson(), guestResponses[key]);
      expect(
        challenge.logicalExpiresAtMillis,
        greaterThan(challenge.evaluationContext.evaluationAtMillis),
      );
      expect(
        challenge.evaluationContext.validUntilExclusiveMillis,
        challenge.logicalExpiresAtMillis,
      );
    }
  });

  test(
    'a later valid guest batch may expire beyond evaluation plus five minutes',
    () {
      final delayedBatch = _copyMap(guestResponses['restaurantChallenge']);
      final evaluationAtMillis =
          _map(delayedBatch['evaluationContext'])['evaluationAtMillis']! as int;
      final delayedExpiry =
          evaluationAtMillis +
          CustomerBiteSaverSearchContract.guestCheckLifetimeMilliseconds +
          const Duration(minutes: 1).inMilliseconds;
      final evaluationContext = _map(delayedBatch['evaluationContext']);
      evaluationContext['validUntilExclusiveMillis'] = delayedExpiry;
      delayedBatch['evaluationContext'] = evaluationContext;
      delayedBatch['logicalExpiresAtMillis'] = delayedExpiry;

      final parsed =
          parseCustomerBiteSaverEndpointResponse(
                delayedBatch,
                expectedOperation:
                    CustomerBiteSaverGuestOperation.restaurantPage,
                resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
              )
              as CustomerBiteSaverGuestCheckRequired<
                CustomerBiteSaverRestaurantPageResult
              >;

      expect(parsed.toJson(), delayedBatch);
    },
  );

  test('guest completes for all three operations parse and round-trip', () {
    for (final key in <String>[
      'restaurantComplete',
      'offerComplete',
      'validationComplete',
    ]) {
      final response = parseCustomerBiteSaverGuestContinuationResponse(
        guestResponses[key],
      );
      expect(
        response,
        isA<CustomerBiteSaverGuestComplete<CustomerBiteSaverOperationResult>>(),
      );
      expect(response.toJson(), guestResponses[key]);
    }
    final validation =
        parseCustomerBiteSaverGuestContinuationResponse(
              guestResponses['validationComplete'],
            )
            as CustomerBiteSaverGuestComplete<CustomerBiteSaverOperationResult>;
    final result =
        validation.result as CustomerBiteSaverRedemptionValidationResult;
    expect(
      result.evaluatedAtMillis,
      validation.evaluationContext.evaluationAtMillis,
    );
  });

  test('guest retry remains a normal typed server result', () {
    final response = parseCustomerBiteSaverGuestContinuationResponse(
      guestResponses['retryRequired'],
    );
    expect(
      response,
      isA<
        CustomerBiteSaverGuestRetryRequired<CustomerBiteSaverOperationResult>
      >(),
    );
    final retry =
        response
            as CustomerBiteSaverGuestRetryRequired<
              CustomerBiteSaverOperationResult
            >;
    expect(retry.reason, CustomerBiteSaverGuestRetryReason.checkExpired);
    expect(
      retry.restartFrom,
      CustomerBiteSaverGuestRestartFrom.originalOperation,
    );
    expect(retry.toJson(), guestResponses['retryRequired']);
  });

  test('closed parsing rejects extra, missing, and unsupported variants', () {
    final startExtra = _copyMap(signedResponses['start']);
    startExtra['privateState'] = true;
    expect(
      () => CustomerBiteSaverStartResponse.fromJson(startExtra),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final offerMissing = _directResultMap(signedResponses['offerPage']);
    offerMissing.remove('offers');
    expect(
      () => CustomerBiteSaverOfferPageResult.fromJson(offerMissing),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final unknownOutcome = _copyMap(guestResponses['retryRequired']);
    unknownOutcome['outcome'] = 'continueAnyway';
    expect(
      () => parseCustomerBiteSaverGuestContinuationResponse(unknownOutcome),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final wrongOperation = _copyMap(guestResponses['restaurantChallenge']);
    wrongOperation['operation'] = 'offerPage';
    expect(
      () => parseCustomerBiteSaverEndpointResponse(
        wrongOperation,
        expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      ),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
  });

  test('usage-evaluation metadata is closed, coherent, and bounded', () {
    final source = _copyMap(
      _map(signedResponses['restaurantPage'])['evaluationContext'],
    );
    final evaluationAtMillis = source['evaluationAtMillis']! as int;

    void expectInvalid(Map<String, dynamic> value, String reason) {
      expect(
        () => CustomerBiteSaverEvaluationContext.fromJson(value),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
        reason: reason,
      );
    }

    expectInvalid(_copyMap(source)..['schemaVersion'] = 2, 'wrong version');
    expectInvalid(_copyMap(source)..remove('timeZone'), 'missing field');
    expectInvalid(_copyMap(source)..['extra'] = true, 'extra field');
    expectInvalid(_copyMap(source)..['timeZone'] = 7, 'zone type');
    expectInvalid(
      _copyMap(source)..['timeZone'] = ' America/New_York',
      'noncanonical zone spelling',
    );
    expectInvalid(
      _copyMap(source)..['utcOffsetMinutes'] = '-240',
      'offset type',
    );
    expectInvalid(
      _copyMap(source)..['validUntilExclusiveMillis'] = evaluationAtMillis,
      'non-live interval',
    );
    expectInvalid(
      _copyMap(source)
        ..['validUntilExclusiveMillis'] =
            evaluationAtMillis +
            CustomerBiteSaverSearchContract
                .usageEvaluationMaximumLifetimeMilliseconds +
            1,
      'unbounded lifetime',
    );
    expectInvalid(
      _copyMap(source)..['oncePerDayUnavailableWindows'] = <Object?>[],
      'missing daily window',
    );
    expectInvalid(
      _copyMap(source)
        ..['oncePerDayUnavailableWindows'] = <Object?>[
          <String, Object?>{
            'startAtMillisInclusive': evaluationAtMillis - 100,
            'endAtMillisExclusive': evaluationAtMillis + 2,
          },
        ],
      'window does not end at evaluation plus one',
    );
    expectInvalid(
      _copyMap(source)
        ..['oncePerDayUnavailableWindows'] = <Object?>[
          <String, Object?>{
            'startAtMillisInclusive': evaluationAtMillis - 100,
            'endAtMillisExclusive': evaluationAtMillis - 50,
          },
          <String, Object?>{
            'startAtMillisInclusive': evaluationAtMillis - 50,
            'endAtMillisExclusive': evaluationAtMillis + 1,
          },
        ],
      'adjacent windows must be merged',
    );
    expectInvalid(
      _copyMap(source)
        ..['oncePerDayUnavailableWindows'] = <Object?>[
          <String, Object?>{
            'startAtMillisInclusive': evaluationAtMillis - 100,
            'endAtMillisExclusive': evaluationAtMillis - 40,
          },
          <String, Object?>{
            'startAtMillisInclusive': evaluationAtMillis - 50,
            'endAtMillisExclusive': evaluationAtMillis + 1,
          },
        ],
      'overlapping windows are invalid',
    );
    expectInvalid(
      _copyMap(source)
        ..['oncePerDayUnavailableWindows'] = <Object?>[
          <String, Object?>{
            'startAtMillisInclusive':
                evaluationAtMillis +
                1 -
                CustomerBiteSaverSearchContract
                    .usageEvaluationMaximumWindowMilliseconds -
                1,
            'endAtMillisExclusive': evaluationAtMillis + 1,
          },
        ],
      'unbounded daily window',
    );
  });

  test('capability decoder rejects a noncanonical trailing-bit spelling', () {
    final response = _copyMap(signedResponses['start']);
    final capability = response['capability']! as String;
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    final lastIndex = alphabet.indexOf(capability[capability.length - 1]);
    expect(lastIndex % 4, 0);
    response['capability'] =
        capability.substring(0, capability.length - 1) +
        alphabet[lastIndex + 1];
    expect(
      () => CustomerBiteSaverStartResponse.fromJson(response),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
  });

  test('backend scalar limits accept surrogate pairs without UTF-16 drift', () {
    final page = _directResultMap(signedResponses['restaurantPage']);
    final restaurants = page['restaurants']! as List<dynamic>;
    final restaurant = _map(restaurants.single);
    restaurant['displayName'] = List<String>.filled(200, '😀').join();
    restaurants[0] = restaurant;
    expect(
      CustomerBiteSaverRestaurantPageResult.fromJson(
        page,
      ).restaurants.single.displayName.runes.length,
      200,
    );
    restaurant['displayName'] = '${restaurant['displayName']}😀';
    expect(
      () => CustomerBiteSaverRestaurantPageResult.fromJson(page),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
  });

  test('unknown offer count permits a valid one-preview terminal card', () {
    final page = _directResultMap(signedResponses['restaurantPage']);
    final restaurants = page['restaurants']! as List<dynamic>;
    final restaurant = _map(restaurants.single);
    restaurant['offers'] = <dynamic>[(restaurant['offers']! as List).first];
    restaurant['offerCountState'] = 'unknown';
    restaurant['usableOfferCount'] = null;
    restaurant['hasMoreOffers'] = false;
    restaurants[0] = restaurant;

    final parsed = CustomerBiteSaverRestaurantPageResult.fromJson(page);

    expect(parsed.restaurants.single.offers, hasLength(1));
    expect(
      parsed.restaurants.single.offerCountState,
      CustomerBiteSaverOfferCountState.unknown,
    );
    expect(parsed.restaurants.single.hasMoreOffers, isFalse);
  });

  test(
    'open availability reason is preserved while discriminators stay closed',
    () {
      final response = _directResultMap(signedResponses['offerPage']);
      final offers = response['offers']! as List<dynamic>;
      final offer = _map(offers.first);
      offer['availabilityReason'] = 'futureServerReason';
      offers[0] = offer;
      expect(
        CustomerBiteSaverOfferPageResult.fromJson(
          response,
        ).offers.first.availabilityReason,
        'futureServerReason',
      );
      offer['usageState'] = 'futureState';
      expect(
        () => CustomerBiteSaverOfferPageResult.fromJson(response),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
      );
    },
  );

  test('offer availability and usage state combinations stay coherent', () {
    final response = _directResultMap(signedResponses['offerPage']);
    final offers = response['offers']! as List<dynamic>;
    final original = _copyMap(offers.first);

    for (final usageState in <String>['unavailable', 'unknown']) {
      final incoherent = _copyMap(original)
        ..['available'] = true
        ..['usageState'] = usageState;
      offers[0] = incoherent;
      expect(
        () => CustomerBiteSaverOfferPageResult.fromJson(response),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
        reason: 'available coupons cannot have $usageState usage',
      );
    }

    for (final usageState in <String>['unavailable', 'unknown']) {
      final dailySpecial = _copyMap(original)
        ..['offerType'] = 'dailySpecial'
        ..['usagePolicy'] = null
        ..['available'] = false
        ..['usageState'] = usageState;
      offers[0] = dailySpecial;
      expect(
        () => CustomerBiteSaverOfferPageResult.fromJson(response),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
        reason: 'daily specials cannot have $usageState usage',
      );
    }

    for (final valid in <Map<String, dynamic>>[
      _copyMap(original)
        ..['available'] = false
        ..['usageState'] = 'unknown',
      _copyMap(original)
        ..['available'] = false
        ..['usageState'] = 'unavailable',
      _copyMap(original)
        ..['offerType'] = 'dailySpecial'
        ..['usagePolicy'] = null
        ..['available'] = false
        ..['usageState'] = 'available',
    ]) {
      offers[0] = valid;
      expect(
        CustomerBiteSaverOfferPageResult.fromJson(
          response,
        ).offers.first.usageState.name,
        valid['usageState'],
      );
    }
  });

  test('restaurant pages reject offer IDs repeated across restaurants', () {
    final page = _directResultMap(signedResponses['restaurantPage']);
    final restaurants = page['restaurants']! as List<dynamic>;
    final duplicateRestaurant = _copyMap(restaurants.single);
    final restaurantId = duplicateRestaurant['restaurantId']! as String;
    duplicateRestaurant['restaurantId'] =
        '${restaurantId.substring(0, restaurantId.length - 1)}1';
    restaurants.add(duplicateRestaurant);

    expect(
      () => CustomerBiteSaverRestaurantPageResult.fromJson(page),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
  });

  test('producer cross-field invariants reject incoherent results', () {
    final status = _copyMap(_map(signedResponses['status'])['ready']);
    status['failureCode'] = 'preparation_failed';
    status['retriable'] = true;
    expect(
      () => CustomerBiteSaverStatusResponse.fromJson(status),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final page = _directResultMap(signedResponses['restaurantPage']);
    final restaurants = page['restaurants']! as List<dynamic>;
    final restaurant = _map(restaurants.single);
    restaurant['offerCountState'] = 'unknown';
    restaurant['usableOfferCount'] = 2;
    restaurants[0] = restaurant;
    expect(
      () => CustomerBiteSaverRestaurantPageResult.fromJson(page),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final validation = _directResultMap(
      signedResponses['redemptionValidation'],
    );
    validation['reason'] = 'notActuallyAvailable';
    expect(
      () => CustomerBiteSaverRedemptionValidationResult.fromJson(validation),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
    final tooLong = _directResultMap(signedResponses['redemptionValidation']);
    tooLong['validationExpiresAtMillis'] =
        (tooLong['evaluatedAtMillis']! as int) + 60 * 1000 + 1;
    expect(
      () => CustomerBiteSaverRedemptionValidationResult.fromJson(tooLong),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final challenge = _copyMap(guestResponses['restaurantChallenge']);
    challenge['logicalExpiresAtMillis'] =
        (_map(challenge['evaluationContext'])['evaluationAtMillis']! as int) -
        1;
    expect(
      () => parseCustomerBiteSaverEndpointResponse(
        challenge,
        expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      ),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );

    final mismatchedChallenge = _copyMap(guestResponses['restaurantChallenge']);
    mismatchedChallenge['logicalExpiresAtMillis'] =
        (mismatchedChallenge['logicalExpiresAtMillis']! as int) + 1;
    expect(
      () => parseCustomerBiteSaverEndpointResponse(
        mismatchedChallenge,
        expectedOperation: CustomerBiteSaverGuestOperation.restaurantPage,
        resultParser: CustomerBiteSaverRestaurantPageResult.fromJson,
      ),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
  });

  test('request limits, normalization, and opaque values are exact', () {
    expect(
      () => CustomerBiteSaverSearchCriteria(
        latitude: 0,
        longitude: 0,
        radiusMiles: 10,
        locationMode: CustomerBiteSaverLocationMode.current,
        typedLocation: null,
        searchText: '',
        timeZone: 'America/New_York',
        utcOffsetMinutes: -240,
      ),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
    expect(
      () => CustomerBiteSaverSearchCriteria(
        latitude: 28,
        longitude: -81,
        radiusMiles: 10,
        locationMode: CustomerBiteSaverLocationMode.current,
        typedLocation: null,
        searchText: List<String>.filled(201, '😀').join(),
        timeZone: 'America/New_York',
        utcOffsetMinutes: -240,
      ),
      throwsA(isA<CustomerBiteSaverProtocolException>()),
    );
    final typed = CustomerBiteSaverCityLocation(
      city: '  New   York ',
      state: ' new   york ',
    );
    expect(typed.city, 'new york');
    expect(typed.state, 'NY');

    final started = CustomerBiteSaverStartResponse.fromJson(
      signedResponses['start'],
    );
    final binding = CustomerBiteSaverSessionBinding.fromStart(
      clientInstanceId: 'fixture-client-instance-0001',
      response: started,
    );
    const cursor = 'bsc1.Ab-_09';
    expect(
      CustomerBiteSaverRestaurantPageRequest(
        clientRequestId: 'opaque-cursor-request-0001',
        binding: binding,
        cursor: cursor,
        guestStateRevision: null,
      ).cursor,
      same(cursor),
    );
  });
}
