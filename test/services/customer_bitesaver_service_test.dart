import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fixturePath =
    'test/fixtures/customer_bitesaver_client_boundary_v1.json';

Map<String, dynamic> _map(Object? value) =>
    Map<String, dynamic>.from(value! as Map);

Map<String, dynamic> _copyMap(Object? value) =>
    jsonDecode(jsonEncode(value))! as Map<String, dynamic>;

final class _Invocation {
  const _Invocation(this.callableName, this.request);

  final String callableName;
  final Map<String, Object?> request;
}

void main() {
  late Map<String, dynamic> signedRequests;
  late Map<String, dynamic> signedResponses;
  late Map<String, dynamic> guestRequests;
  late Map<String, dynamic> guestResponses;
  late CustomerBiteSaverSessionBinding signedBinding;
  late CustomerBiteSaverSessionBinding guestBinding;

  setUpAll(() {
    final fixture =
        jsonDecode(File(_fixturePath).readAsStringSync())!
            as Map<String, dynamic>;
    final signed = _map(fixture['signed']);
    final guest = _map(fixture['guest']);
    signedRequests = _map(signed['requests']);
    signedResponses = _map(signed['responses']);
    guestRequests = _map(guest['requests']);
    guestResponses = _map(guest['responses']);

    final signedStartRequest = _map(signedRequests['start']);
    signedBinding = CustomerBiteSaverSessionBinding.fromStart(
      clientInstanceId: signedStartRequest['clientInstanceId']! as String,
      response: CustomerBiteSaverStartResponse.fromJson(
        signedResponses['start'],
      ),
    );
    final guestContinuation = _map(guestRequests['restaurantContinuation']);
    final guestComplete = _map(guestResponses['restaurantComplete']);
    guestBinding = CustomerBiteSaverSessionBinding(
      clientInstanceId: guestContinuation['clientInstanceId']! as String,
      sessionId: guestContinuation['sessionId']! as String,
      capability: guestContinuation['capability']! as String,
      criteriaFingerprint: guestContinuation['criteriaFingerprint']! as String,
      attemptGeneration: guestComplete['attemptGeneration']! as int,
      queryFingerprint: guestComplete['queryFingerprint']! as String,
    );
  });

  CustomerBiteSaverStartRequest startRequest() {
    final json = _map(signedRequests['start']);
    return CustomerBiteSaverStartRequest(
      clientRequestId: json['clientRequestId']! as String,
      clientInstanceId: json['clientInstanceId']! as String,
      criteria: CustomerBiteSaverSearchCriteria(
        latitude: (json['latitude']! as num).toDouble(),
        longitude: (json['longitude']! as num).toDouble(),
        radiusMiles: json['radiusMiles']! as int,
        locationMode: CustomerBiteSaverLocationMode.current,
        typedLocation: null,
        searchText: json['searchText']! as String,
        timeZone: json['timeZone']! as String,
        utcOffsetMinutes: json['utcOffsetMinutes']! as int,
      ),
      freshSearch: json['freshSearch']! as bool,
    );
  }

  CustomerBiteSaverStatusRequest statusRequest() {
    final json = _map(signedRequests['status']);
    return CustomerBiteSaverStatusRequest(
      clientRequestId: json['clientRequestId']! as String,
      binding: signedBinding,
    );
  }

  CustomerBiteSaverRestaurantPageRequest restaurantPageRequest() {
    final json = _map(signedRequests['restaurantPage']);
    return CustomerBiteSaverRestaurantPageRequest(
      clientRequestId: json['clientRequestId']! as String,
      binding: signedBinding,
      cursor: json['cursor'] as String?,
      guestStateRevision: json['guestStateRevision'] as int?,
    );
  }

  CustomerBiteSaverOfferPageRequest offerPageRequest() {
    final json = _map(signedRequests['offerPage']);
    return CustomerBiteSaverOfferPageRequest(
      clientRequestId: json['clientRequestId']! as String,
      binding: signedBinding,
      restaurantId: CustomerBiteSaverRestaurantId(
        json['restaurantId']! as String,
      ),
      cursor: json['cursor'] as String?,
      guestStateRevision: json['guestStateRevision'] as int?,
    );
  }

  CustomerBiteSaverMenuPageRequest menuPageRequest() {
    final restaurantId =
        _map(signedRequests['offerPage'])['restaurantId']! as String;
    return CustomerBiteSaverMenuPageRequest(
      clientRequestId: 'menu-page-request-00001',
      binding: signedBinding,
      restaurantId: CustomerBiteSaverRestaurantId(restaurantId),
      cursor: null,
    );
  }

  Map<String, Object?> menuPageResponse() {
    final request = menuPageRequest();
    return <String, Object?>{
      'schemaVersion': 1,
      'state': 'available',
      'attemptGeneration': signedBinding.attemptGeneration,
      'queryFingerprint': signedBinding.queryFingerprint,
      'restaurantId': request.restaurantId.value,
      'menuStyle': 'biteSaver',
      'entries': <Map<String, Object?>>[
        <String, Object?>{
          'kind': 'item',
          'key': 'bsme_${'m' * 43}',
          'name': 'Fixture item',
          'description': 'Fixture description',
          'price': 'Market price',
          'category': 'Dinner',
          'sortOrder': 4,
        },
      ],
      'nextCursor': null,
      'hasMore': false,
    };
  }

  CustomerBiteSaverGuestContinuationRequest continuationRequest() {
    final json = _map(guestRequests['restaurantContinuation']);
    return CustomerBiteSaverGuestContinuationRequest(
      clientRequestId: json['clientRequestId']! as String,
      binding: guestBinding,
      operationRef: json['operationRef']! as String,
      checkToken: json['checkToken']! as String,
      batchSequence: json['batchSequence']! as int,
      guestStateRevision: json['guestStateRevision']! as int,
      unavailableOfferIds: (json['unavailableOfferIds']! as List)
          .cast<String>()
          .map(CustomerBiteSaverOfferId.new)
          .toList(),
    );
  }

  CustomerBiteSaverFavoriteStatesRequest favoriteRequest() {
    final json = _map(signedRequests['favoriteStates']);
    return CustomerBiteSaverFavoriteStatesRequest(
      clientRequestId: json['clientRequestId']! as String,
      binding: signedBinding,
      restaurantIds: (json['restaurantIds']! as List)
          .cast<String>()
          .map(CustomerBiteSaverRestaurantId.new)
          .toList(),
      offerIds: (json['offerIds']! as List)
          .cast<String>()
          .map(CustomerBiteSaverOfferId.new)
          .toList(),
    );
  }

  CustomerBiteSaverRedemptionValidationRequest validationRequest() {
    final json = _map(signedRequests['redemptionValidation']);
    return CustomerBiteSaverRedemptionValidationRequest(
      clientRequestId: json['clientRequestId']! as String,
      binding: signedBinding,
      restaurantId: CustomerBiteSaverRestaurantId(
        json['restaurantId']! as String,
      ),
      offerId: CustomerBiteSaverOfferId(json['offerId']! as String),
      offerOccurrence: json['offerOccurrence']! as String,
      redemptionRequestId: json['redemptionRequestId']! as String,
      currentCoordinates: null,
      guestStateRevision: null,
    );
  }

  CustomerBiteSaverRedemptionStartRequest redemptionStartRequest() {
    final json = _map(signedRequests['redemptionStart']);
    final validation = validationRequest();
    return CustomerBiteSaverRedemptionStartRequest.fromValidation(
      request: validation,
      clientRequestId: json['clientRequestId']! as String,
      validationId: json['validationId']! as String,
    );
  }

  test(
    'all nine methods use exact callable names and request payloads',
    () async {
      final calls = <_Invocation>[];
      final responses = <String, Object?>{
        CustomerBiteSaverService.startCallableName: signedResponses['start'],
        CustomerBiteSaverService.statusCallableName: _map(
          signedResponses['status'],
        )['preparing'],
        CustomerBiteSaverService.restaurantPageCallableName:
            signedResponses['restaurantPage'],
        CustomerBiteSaverService.offerPageCallableName:
            signedResponses['offerPage'],
        CustomerBiteSaverService.menuPageCallableName: menuPageResponse(),
        CustomerBiteSaverService.guestContinuationCallableName:
            guestResponses['restaurantComplete'],
        CustomerBiteSaverService.favoriteStatesCallableName:
            signedResponses['favoriteStates'],
        CustomerBiteSaverService.redemptionValidationCallableName:
            signedResponses['redemptionValidation'],
        CustomerBiteSaverService.redemptionStartCallableName:
            signedResponses['redemptionStart'],
      };
      final service = CustomerBiteSaverService(
        transport: (callableName, request) async {
          calls.add(_Invocation(callableName, request));
          return responses[callableName];
        },
      );

      expect(
        await service.startCustomerBiteSaverSearch(startRequest()),
        isA<CustomerBiteSaverStartResponse>(),
      );
      expect(
        await service.getCustomerBiteSaverSearchStatus(statusRequest()),
        isA<CustomerBiteSaverStatusResponse>(),
      );
      expect(
        await service.getCustomerBiteSaverSearchPage(restaurantPageRequest()),
        isA<
          CustomerBiteSaverDirectResponse<CustomerBiteSaverRestaurantPageResult>
        >(),
      );
      expect(
        await service.getCustomerBiteSaverOfferPage(offerPageRequest()),
        isA<
          CustomerBiteSaverDirectResponse<CustomerBiteSaverOfferPageResult>
        >(),
      );
      expect(
        await service.getCustomerBiteSaverMenuPage(menuPageRequest()),
        isA<CustomerBiteSaverMenuPageResult>(),
      );
      expect(
        await service.continueCustomerBiteSaverGuestOfferCheck(
          continuationRequest(),
        ),
        isA<CustomerBiteSaverGuestComplete<CustomerBiteSaverOperationResult>>(),
      );
      expect(
        await service.getCustomerBiteSaverFavoriteStates(favoriteRequest()),
        isA<CustomerBiteSaverFavoriteStatesResponse>(),
      );
      expect(
        await service.validateCustomerBiteSaverOfferRedemptionStart(
          validationRequest(),
        ),
        isA<
          CustomerBiteSaverDirectResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >(),
      );
      expect(
        await service.startCustomerBiteSaverOfferRedemption(
          redemptionStartRequest(),
        ),
        isA<CustomerBiteSaverRedemptionStartResult>(),
      );

      expect(CustomerBiteSaverService.region, 'us-central1');
      expect(calls.map((call) => call.callableName), <String>[
        CustomerBiteSaverService.startCallableName,
        CustomerBiteSaverService.statusCallableName,
        CustomerBiteSaverService.restaurantPageCallableName,
        CustomerBiteSaverService.offerPageCallableName,
        CustomerBiteSaverService.menuPageCallableName,
        CustomerBiteSaverService.guestContinuationCallableName,
        CustomerBiteSaverService.favoriteStatesCallableName,
        CustomerBiteSaverService.redemptionValidationCallableName,
        CustomerBiteSaverService.redemptionStartCallableName,
      ]);
      expect(calls[0].request, signedRequests['start']);
      expect(calls[1].request, signedRequests['status']);
      expect(calls[2].request, signedRequests['restaurantPage']);
      expect(calls[3].request, signedRequests['offerPage']);
      expect(calls[4].request, menuPageRequest().toJson());
      expect(calls[5].request, guestRequests['restaurantContinuation']);
      expect(calls[6].request, signedRequests['favoriteStates']);
      expect(calls[7].request, signedRequests['redemptionValidation']);
      expect(calls[8].request, signedRequests['redemptionStart']);
    },
  );

  test(
    'exact immutable request is replayed after uncertain transport failure',
    () async {
      final calls = <Map<String, Object?>>[];
      var attempt = 0;
      final service = CustomerBiteSaverService(
        transport: (_, request) async {
          calls.add(Map<String, Object?>.from(request));
          attempt += 1;
          if (attempt == 1) throw StateError('connection lost after send');
          return signedResponses['offerPage'];
        },
      );
      final request = offerPageRequest();
      await expectLater(
        service.getCustomerBiteSaverOfferPage(request),
        throwsA(
          isA<CustomerBiteSaverServiceException>().having(
            (error) => error.kind,
            'kind',
            CustomerBiteSaverServiceFailureKind.transport,
          ),
        ),
      );
      await service.getCustomerBiteSaverOfferPage(request);
      expect(calls, hasLength(2));
      expect(calls[1], calls[0]);
      expect(
        calls[1]['clientRequestId'],
        _map(signedRequests['offerPage'])['clientRequestId'],
      );
    },
  );

  test(
    'callable, transport, and invalid-response failures stay distinct',
    () async {
      final callableService = CustomerBiteSaverService(
        transport: (_, _) async =>
            throw const CustomerBiteSaverCallableTransportException(
              code: 'resource-exhausted',
              message: 'Please wait before starting another search.',
            ),
      );
      await expectLater(
        callableService.startCustomerBiteSaverSearch(startRequest()),
        throwsA(
          isA<CustomerBiteSaverServiceException>()
              .having(
                (error) => error.kind,
                'kind',
                CustomerBiteSaverServiceFailureKind.callable,
              )
              .having((error) => error.code, 'code', 'resource-exhausted'),
        ),
      );

      final transportService = CustomerBiteSaverService(
        transport: (_, _) async => throw StateError('offline'),
      );
      await expectLater(
        transportService.startCustomerBiteSaverSearch(startRequest()),
        throwsA(
          isA<CustomerBiteSaverServiceException>().having(
            (error) => error.kind,
            'kind',
            CustomerBiteSaverServiceFailureKind.transport,
          ),
        ),
      );

      final malformed = _copyMap(signedResponses['start'])..['private'] = true;
      final invalidResponseService = CustomerBiteSaverService(
        transport: (_, _) async => malformed,
      );
      await expectLater(
        invalidResponseService.startCustomerBiteSaverSearch(startRequest()),
        throwsA(
          isA<CustomerBiteSaverServiceException>()
              .having(
                (error) => error.kind,
                'kind',
                CustomerBiteSaverServiceFailureKind.invalidResponse,
              )
              .having((error) => error.code, 'code', 'invalid-response'),
        ),
      );
    },
  );

  test('Firebase transient callable codes remain transport failures', () async {
    for (final code in <String>[
      'cancelled',
      'deadline-exceeded',
      'unavailable',
      'functions/unavailable',
    ]) {
      // The protected constructor represents the public error delivered by the
      // FlutterFire callable boundary.
      // ignore: invalid_use_of_protected_member
      final firebaseError = FirebaseFunctionsException(
        code: code,
        message: 'transient transport failure',
      );
      final service = CustomerBiteSaverService(
        transport: (_, _) async => throw firebaseError,
      );

      await expectLater(
        service.startCustomerBiteSaverSearch(startRequest()),
        throwsA(
          isA<CustomerBiteSaverServiceException>()
              .having(
                (error) => error.kind,
                'kind',
                CustomerBiteSaverServiceFailureKind.transport,
              )
              .having((error) => error.code, 'code', code),
        ),
      );
    }

    // `internal` and `unknown` can be authoritative server failures; preserve
    // them as callable failures instead of guessing that they are offline.
    for (final code in <String>['internal', 'unknown']) {
      // ignore: invalid_use_of_protected_member
      final firebaseError = FirebaseFunctionsException(
        code: code,
        message: 'server failure',
      );
      final service = CustomerBiteSaverService(
        transport: (_, _) async => throw firebaseError,
      );
      await expectLater(
        service.startCustomerBiteSaverSearch(startRequest()),
        throwsA(
          isA<CustomerBiteSaverServiceException>().having(
            (error) => error.kind,
            'kind',
            CustomerBiteSaverServiceFailureKind.callable,
          ),
        ),
      );
    }
  });

  test('favorite states must match exact requested identity order', () async {
    final response = _copyMap(signedResponses['favoriteStates']);
    final states = response['states']! as List<dynamic>;
    response['states'] = states.reversed.toList();
    final service = CustomerBiteSaverService(
      transport: (_, _) async => response,
    );
    await expectLater(
      service.getCustomerBiteSaverFavoriteStates(favoriteRequest()),
      throwsA(
        isA<CustomerBiteSaverServiceException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverServiceFailureKind.invalidResponse,
        ),
      ),
    );
  });

  test(
    'page result generation is corroborated with its session binding',
    () async {
      final response = _copyMap(signedResponses['restaurantPage']);
      response['queryFingerprint'] = 'a' * 64;
      final service = CustomerBiteSaverService(
        transport: (_, _) async => response,
      );
      await expectLater(
        service.getCustomerBiteSaverSearchPage(restaurantPageRequest()),
        throwsA(
          isA<CustomerBiteSaverServiceException>().having(
            (error) => error.kind,
            'kind',
            CustomerBiteSaverServiceFailureKind.invalidResponse,
          ),
        ),
      );
    },
  );

  test('menu continuation must advance its protected cursor', () async {
    const cursor = 'bsc1.fixture_menu_input';
    final base = menuPageRequest();
    final request = CustomerBiteSaverMenuPageRequest(
      clientRequestId: 'menu-page-request-00002',
      binding: signedBinding,
      restaurantId: base.restaurantId,
      cursor: cursor,
    );
    final response = menuPageResponse()
      ..['nextCursor'] = cursor
      ..['hasMore'] = true;
    final service = CustomerBiteSaverService(
      transport: (_, _) async => response,
    );

    await expectLater(
      service.getCustomerBiteSaverMenuPage(request),
      throwsA(
        isA<CustomerBiteSaverServiceException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverServiceFailureKind.invalidResponse,
        ),
      ),
    );
  });

  test(
    'offer, validation, and redemption identities match their requests',
    () async {
      final otherRestaurant = 'bsr_${'R' * 43}';
      final otherOffer = 'bso_${'O' * 43}';

      final offerResponse = _copyMap(signedResponses['offerPage']);
      offerResponse['restaurantId'] = otherRestaurant;
      final offerService = CustomerBiteSaverService(
        transport: (_, _) async => offerResponse,
      );
      await expectLater(
        offerService.getCustomerBiteSaverOfferPage(offerPageRequest()),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );

      final validationResponse = _copyMap(
        signedResponses['redemptionValidation'],
      );
      validationResponse['offerId'] = otherOffer;
      final validationService = CustomerBiteSaverService(
        transport: (_, _) async => validationResponse,
      );
      await expectLater(
        validationService.validateCustomerBiteSaverOfferRedemptionStart(
          validationRequest(),
        ),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );

      final startResponse = _copyMap(signedResponses['redemptionStart']);
      startResponse['restaurantId'] = otherRestaurant;
      final startService = CustomerBiteSaverService(
        transport: (_, _) async => startResponse,
      );
      await expectLater(
        startService.startCustomerBiteSaverOfferRedemption(
          redemptionStartRequest(),
        ),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );
    },
  );

  test(
    'guest complete envelope corroborates inner generation and timer anchor',
    () async {
      final restaurantComplete = _copyMap(guestResponses['restaurantComplete']);
      final restaurantResult = _map(restaurantComplete['result']);
      restaurantResult['queryFingerprint'] = 'b' * 64;
      restaurantComplete['result'] = restaurantResult;
      final restaurantService = CustomerBiteSaverService(
        transport: (_, _) async => restaurantComplete,
      );
      await expectLater(
        restaurantService.continueCustomerBiteSaverGuestOfferCheck(
          continuationRequest(),
        ),
        throwsA(isA<CustomerBiteSaverServiceException>()),
      );

      final validationComplete = _copyMap(guestResponses['validationComplete']);
      final validationResult = _map(validationComplete['result']);
      validationResult['evaluatedAtMillis'] =
          (validationResult['evaluatedAtMillis']! as int) + 1;
      validationComplete['result'] = validationResult;
      final validationService = CustomerBiteSaverService(
        transport: (_, _) async => validationComplete,
      );
      final validationContinuationJson = _map(
        guestRequests['validationContinuation'],
      );
      final validationContinuation = CustomerBiteSaverGuestContinuationRequest(
        clientRequestId:
            validationContinuationJson['clientRequestId']! as String,
        binding: guestBinding,
        operationRef: validationContinuationJson['operationRef']! as String,
        checkToken: validationContinuationJson['checkToken']! as String,
        batchSequence: validationContinuationJson['batchSequence']! as int,
        guestStateRevision:
            validationContinuationJson['guestStateRevision']! as int,
        unavailableOfferIds: const <CustomerBiteSaverOfferId>[],
      );
      await expectLater(
        validationService.continueCustomerBiteSaverGuestOfferCheck(
          validationContinuation,
        ),
        throwsA(
          isA<CustomerBiteSaverServiceException>().having(
            (error) => error.kind,
            'kind',
            CustomerBiteSaverServiceFailureKind.invalidResponse,
          ),
        ),
      );
    },
  );
}
