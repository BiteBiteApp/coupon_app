import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:flutter_test/flutter_test.dart';

const String _fixturePath =
    'test/fixtures/customer_bitesaver_menu_page_v1.json';

Map<String, dynamic> _map(Object? value) =>
    Map<String, dynamic>.from(value! as Map);

void main() {
  test(
    'menu request serialization and response parsing share one wire fixture',
    () {
      final fixture =
          jsonDecode(File(_fixturePath).readAsStringSync())!
              as Map<String, dynamic>;
      final request = _map(fixture['request']);
      final response = _map(fixture['response']);
      final binding = CustomerBiteSaverSessionBinding(
        clientInstanceId: request['clientInstanceId']! as String,
        sessionId: request['sessionId']! as String,
        capability: request['capability']! as String,
        criteriaFingerprint: request['criteriaFingerprint']! as String,
        attemptGeneration: response['attemptGeneration']! as int,
        queryFingerprint: response['queryFingerprint']! as String,
      );

      final encodedRequest = CustomerBiteSaverMenuPageRequest(
        clientRequestId: request['clientRequestId']! as String,
        binding: binding,
        restaurantId: CustomerBiteSaverRestaurantId(
          request['restaurantId']! as String,
        ),
        cursor: request['cursor'] as String?,
      ).toJson();
      expect(encodedRequest, request);

      final parsed = CustomerBiteSaverMenuPageResult.fromJson(response);
      expect(parsed.toJson(), response);
      expect(parsed.entries[0], isA<CustomerBiteSaverMenuImageEntry>());
      expect(parsed.entries[1], isA<CustomerBiteSaverMenuItemEntry>());
      expect(parsed.entries[2], isA<CustomerBiteSaverMenuSectionEntry>());
    },
  );

  test(
    'menu response parser rejects private fields and malformed entry keys',
    () {
      final fixture =
          jsonDecode(File(_fixturePath).readAsStringSync())!
              as Map<String, dynamic>;
      final response = _map(fixture['response']);
      final privateResponse = jsonDecode(jsonEncode(response))! as Map;
      privateResponse['ownerUserId'] = 'private-canary';
      expect(
        () => CustomerBiteSaverMenuPageResult.fromJson(privateResponse),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
      );

      final malformedResponse = jsonDecode(jsonEncode(response))! as Map;
      final entries = malformedResponse['entries']! as List;
      (entries.first as Map)['key'] = 'source-document-id';
      expect(
        () => CustomerBiteSaverMenuPageResult.fromJson(malformedResponse),
        throwsA(isA<CustomerBiteSaverProtocolException>()),
      );
    },
  );
}
