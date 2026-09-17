import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_saved.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:flutter_test/flutter_test.dart';

String get _restaurantId => 'bsr_${'R' * 43}';
String get _offerId => 'bso_${'O' * 43}';

Map<String, Object?> _restaurant() => <String, Object?>{
  'restaurantId': _restaurantId,
  'displayName': 'Saved Restaurant',
  'streetAddress': null,
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'formattedAddress': null,
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

Map<String, Object?> _savedPage() => <String, Object?>{
  'schemaVersion': 1,
  'section': 'restaurants',
  'entries': <Object?>[
    <String, Object?>{
      'favoriteKind': 'bitesaverRestaurant',
      'restaurantId': _restaurantId,
      'offerId': null,
      'availability': 'available',
      'restaurant': _restaurant(),
      'offer': null,
      'accessToken': 'bssv1.saved-access',
    },
  ],
  'nextCursor': 'bssv1.next-page',
  'hasMore': true,
  'partial': false,
};

Map<String, Object?> _menuPage() => <String, Object?>{
  'schemaVersion': 1,
  'state': 'available',
  'attemptGeneration': 0,
  'queryFingerprint': 'f' * 64,
  'restaurantId': _restaurantId,
  'menuStyle': 'biteSaver',
  'entries': <Object?>[],
  'nextCursor': null,
  'hasMore': false,
};

Map<String, Object?> _savedRedemptionValidation() => <String, Object?>{
  'schemaVersion': 1,
  'restaurantId': _restaurantId,
  'offerId': _offerId,
  'allowed': true,
  'reason': 'available',
  'usagePolicy': 'oncePerCustomer',
  'evaluatedAtMillis': 1_789_560_000_000,
  'activeTimerExpiresAtMillis': null,
  'nextAvailableAtMillis': null,
  'validationId': 'bsv_${'V' * 43}',
  'validationExpiresAtMillis': 1_789_560_060_000,
  'evaluationContext': <String, Object?>{
    'schemaVersion': 1,
    'sessionId': 'bss_${'S' * 43}',
    'attemptGeneration': 0,
    'queryFingerprint': 'f' * 64,
    'evaluationAtMillis': 1_789_560_000_000,
    'timeZone': 'America/New_York',
    'utcOffsetMinutes': -240,
    'availabilityGeneration': 'a' * 64,
    'validUntilExclusiveMillis': 1_789_560_060_000,
    'oncePerDayUnavailableWindows': <Object?>[
      <String, Object?>{
        'startAtMillisInclusive': 1_789_559_940_000,
        'endAtMillisExclusive': 1_789_560_000_001,
      },
    ],
  },
};

Map<String, Object?> _savedRedemptionStart() => <String, Object?>{
  'schemaVersion': 1,
  'restaurantId': _restaurantId,
  'offerId': _offerId,
  'redemptionId': 'bsrd_${'D' * 43}',
  'status': 'started',
  'timerStartedAtMillis': 1_789_560_000_000,
  'timerExpiresAtMillis': 1_789_560_300_000,
};

void main() {
  test('Saved cross-runtime fixture matches the Dart wire contract', () {
    final fixture =
        jsonDecode(
              File(
                'test/fixtures/customer_bitesaver_saved_page_v1.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final request = Map<String, dynamic>.from(fixture['request']! as Map);
    final response = CustomerBiteSaverSavedPageResult.fromJson(
      fixture['response'],
    );
    expect(
      fixture['fixtureVersion'],
      'bitestar.customer-bitesaver-saved-page.v1',
    );
    expect(
      CustomerBiteSaverSavedPageRequest(
        clientRequestId: request['clientRequestId']! as String,
        section: CustomerBiteSaverSavedSection.restaurants,
        cursor: null,
      ).toJson(),
      request,
    );
    expect(response.section, CustomerBiteSaverSavedSection.restaurants);
    expect(response.entries, hasLength(1));
    expect(response.entries.single.isAvailable, isFalse);
    expect(
      response.entries.single.restaurantId?.value,
      'bsr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  test('Saved redemption cross-runtime fixture matches typed wire models', () {
    final fixture =
        jsonDecode(
              File(
                'test/fixtures/customer_bitesaver_saved_redemption_v1.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final validationJson = Map<String, Object?>.from(
      fixture['validationRequest']! as Map,
    );
    final coordinates = Map<String, Object?>.from(
      validationJson['currentCoordinates']! as Map,
    );
    final validationRequest = CustomerBiteSaverSavedRedemptionValidationRequest(
      clientRequestId: validationJson['clientRequestId']! as String,
      accessToken: validationJson['accessToken']! as String,
      restaurantId: CustomerBiteSaverRestaurantId(
        validationJson['restaurantId']! as String,
      ),
      offerId: CustomerBiteSaverOfferId(validationJson['offerId']! as String),
      redemptionRequestId: validationJson['redemptionRequestId']! as String,
      timeZone: validationJson['timeZone']! as String,
      utcOffsetMinutes: validationJson['utcOffsetMinutes']! as int,
      currentCoordinates: CustomerBiteSaverCoordinates.fromJson(coordinates),
    );
    final startJson = Map<String, Object?>.from(
      fixture['startRequest']! as Map,
    );
    final startRequest =
        CustomerBiteSaverSavedRedemptionStartRequest.fromValidation(
          request: validationRequest,
          clientRequestId: startJson['clientRequestId']! as String,
          validationId: startJson['validationId']! as String,
        );
    final validationResponse = parseCustomerBiteSaverEndpointResponse(
      fixture['validationResponse'],
      expectedOperation: CustomerBiteSaverGuestOperation.redemptionStart,
      resultParser: CustomerBiteSaverRedemptionValidationResult.fromJson,
    );
    final startResponse = CustomerBiteSaverRedemptionStartResult.fromJson(
      fixture['startResponse'],
    );

    expect(
      fixture['fixtureVersion'],
      'bitestar.customer-bitesaver-saved-redemption.v1',
    );
    expect(validationRequest.toJson(), validationJson);
    expect(startRequest.toJson(), startJson);
    expect(
      validationResponse,
      isA<
        CustomerBiteSaverDirectResponse<
          CustomerBiteSaverRedemptionValidationResult
        >
      >(),
    );
    expect(startResponse.status, CustomerBiteSaverRedemptionStatus.started);
    expect(
      startResponse.timerExpiresAtMillis! - startResponse.timerStartedAtMillis!,
      CustomerBiteSaverSearchContract.redemptionTimerMilliseconds,
    );
  });

  test(
    'Saved callables use exact names, wire requests, and strict DTOs',
    () async {
      final calls = <(String, Map<String, Object?>)>[];
      final service = CustomerBiteSaverService(
        transport: (name, request) async {
          calls.add((name, Map<String, Object?>.from(request)));
          return name == CustomerBiteSaverService.savedPageCallableName
              ? _savedPage()
              : _menuPage();
        },
      );
      final page = await service.getCustomerBiteSaverSavedPage(
        const CustomerBiteSaverSavedPageRequest(
          clientRequestId: 'saved-service-request-0001',
          section: CustomerBiteSaverSavedSection.restaurants,
          cursor: null,
        ),
      );
      final menu = await service.getCustomerBiteSaverSavedMenuPage(
        const CustomerBiteSaverSavedMenuPageRequest(
          clientRequestId: 'saved-menu-service-0001',
          accessToken: 'bssv1.saved-access',
          cursor: null,
        ),
      );

      expect(page.entries.single.restaurant!.displayName, 'Saved Restaurant');
      expect(page.entries.single.favoriteId, _restaurantId);
      expect(menu.restaurantId.value, _restaurantId);
      expect(calls.map((call) => call.$1), <String>[
        CustomerBiteSaverService.savedPageCallableName,
        CustomerBiteSaverService.savedMenuPageCallableName,
      ]);
      expect(calls[0].$2, <String, Object?>{
        'schemaVersion': 1,
        'clientRequestId': 'saved-service-request-0001',
        'section': 'restaurants',
        'cursor': null,
      });
      expect(calls[1].$2, <String, Object?>{
        'schemaVersion': 1,
        'clientRequestId': 'saved-menu-service-0001',
        'accessToken': 'bssv1.saved-access',
        'cursor': null,
      });
    },
  );

  test('malformed or non-progress Saved responses fail closed', () async {
    final sameCursor = _savedPage()..['nextCursor'] = 'same-cursor';
    final service = CustomerBiteSaverService(
      transport: (_, _) async => sameCursor,
    );
    await expectLater(
      service.getCustomerBiteSaverSavedPage(
        const CustomerBiteSaverSavedPageRequest(
          clientRequestId: 'saved-service-request-0002',
          section: CustomerBiteSaverSavedSection.restaurants,
          cursor: 'same-cursor',
        ),
      ),
      throwsA(
        isA<CustomerBiteSaverServiceException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverServiceFailureKind.invalidResponse,
        ),
      ),
    );

    final extraField = _savedPage()..['privateSourceId'] = 'must-not-parse';
    final malformed = CustomerBiteSaverService(
      transport: (_, _) async => extraField,
    );
    await expectLater(
      malformed.getCustomerBiteSaverSavedPage(
        const CustomerBiteSaverSavedPageRequest(
          clientRequestId: 'saved-service-request-0003',
          section: CustomerBiteSaverSavedSection.restaurants,
          cursor: null,
        ),
      ),
      throwsA(isA<CustomerBiteSaverServiceException>()),
    );
  });

  test('Saved callable errors preserve callable classification', () async {
    final service = CustomerBiteSaverService(
      transport: (_, _) async =>
          throw const CustomerBiteSaverCallableTransportException(
            code: 'permission-denied',
            message: 'signed account required',
          ),
    );
    await expectLater(
      service.getCustomerBiteSaverSavedPage(
        const CustomerBiteSaverSavedPageRequest(
          clientRequestId: 'saved-service-request-0004',
          section: CustomerBiteSaverSavedSection.restaurants,
          cursor: null,
        ),
      ),
      throwsA(
        isA<CustomerBiteSaverServiceException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverServiceFailureKind.callable,
        ),
      ),
    );
  });

  test('unavailable rows carry no public detail or access token', () {
    final result = CustomerBiteSaverSavedPageResult.fromJson(<String, Object?>{
      'schemaVersion': 1,
      'section': 'coupons',
      'entries': <Object?>[
        <String, Object?>{
          'favoriteKind': 'bitesaverCoupon',
          'restaurantId': _restaurantId,
          'offerId': _offerId,
          'availability': 'unavailable',
          'restaurant': null,
          'offer': null,
          'accessToken': null,
        },
      ],
      'nextCursor': null,
      'hasMore': false,
      'partial': false,
    });
    expect(result.entries.single.isAvailable, isFalse);
    expect(result.entries.single.favoriteId, _offerId);
  });

  test(
    'Saved redemption callables preserve the exact typed envelope',
    () async {
      final calls = <(String, Map<String, Object?>)>[];
      final service = CustomerBiteSaverService(
        transport: (name, request) async {
          calls.add((name, Map<String, Object?>.from(request)));
          return name ==
                  CustomerBiteSaverService.savedRedemptionValidationCallableName
              ? _savedRedemptionValidation()
              : _savedRedemptionStart();
        },
      );
      final validationRequest =
          CustomerBiteSaverSavedRedemptionValidationRequest(
            clientRequestId: 'saved-validation-service-0001',
            accessToken: 'bssv1.saved-coupon-access',
            restaurantId: CustomerBiteSaverRestaurantId(_restaurantId),
            offerId: CustomerBiteSaverOfferId(_offerId),
            redemptionRequestId: 'saved-redemption-logical-0001',
            timeZone: 'America/New_York',
            utcOffsetMinutes: -240,
            currentCoordinates: CustomerBiteSaverCoordinates(
              latitude: 28.5383,
              longitude: -81.3792,
              capturedAtMillis: 1_789_560_000_000,
            ),
          );
      final validation = await service
          .validateCustomerBiteSaverSavedOfferRedemptionStart(
            validationRequest,
          );
      expect(
        validation,
        isA<
          CustomerBiteSaverDirectResponse<
            CustomerBiteSaverRedemptionValidationResult
          >
        >(),
      );
      final startRequest =
          CustomerBiteSaverSavedRedemptionStartRequest.fromValidation(
            request: validationRequest,
            clientRequestId: 'saved-start-service-0001',
            validationId: 'bsv_${'V' * 43}',
          );
      final started = await service.startCustomerBiteSaverSavedOfferRedemption(
        startRequest,
      );

      expect(started.status, CustomerBiteSaverRedemptionStatus.started);
      expect(calls.map((call) => call.$1), <String>[
        CustomerBiteSaverService.savedRedemptionValidationCallableName,
        CustomerBiteSaverService.savedRedemptionStartCallableName,
      ]);
      expect(calls.first.$2, validationRequest.toJson());
      expect(calls.last.$2, startRequest.toJson());
      expect(calls.first.$2['currentCoordinates'], <String, Object?>{
        'latitude': 28.5383,
        'longitude': -81.3792,
        'capturedAtMillis': 1_789_560_000_000,
      });
    },
  );
}
