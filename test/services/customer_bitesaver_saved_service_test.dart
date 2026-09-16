import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_saved.dart';
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
}
