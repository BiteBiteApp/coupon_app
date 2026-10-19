import 'dart:async';
import 'dart:convert';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/customer_search_http_transport.dart';
import 'package:coupon_app/services/customer_bitescore_search_service.dart';
import 'package:coupon_app/services/customer_search_candidate_runtime.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  tearDown(() => CustomerSearchCandidateRuntime.testEnabled = null);
  test(
    'explicit origin, per-call verified-token transport and real service seam',
    () async {
      var tokens = 0;
      final requests = <http.Request>[];
      final transport = CustomerSearchHttpTransport(
        serviceUrl: Uri.parse('https://synthetic-isolated-123.run.app'),
        idToken: () async => 'synthetic-${++tokens}',
        appCheckToken: () async => 'synthetic-appcheck',
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({
              'result': {'schemaVersion': 1},
            }),
            200,
          );
        }),
      );
      CustomerSearchCandidateRuntime.testEnabled = true;
      final service = CustomerBiteScoreSearchService(transport: transport.call);
      for (var i = 0; i < 2; i++) {
        expect(
          await service.invoke('startCustomerBiteScoreSearch', {
            'schemaVersion': 1,
          }),
          {'schemaVersion': 1},
        );
      }
      expect(tokens, 2);
      for (var i = 0; i < requests.length; i++) {
        expect(
          requests[i].url.toString(),
          'https://synthetic-isolated-123.run.app/startCustomerBiteScoreSearchV2',
        );
        expect(
          requests[i].headers['authorization'],
          'Bearer synthetic-${i + 1}',
        );
        expect(
          requests[i].headers['x-firebase-appcheck'],
          'synthetic-appcheck',
        );
        expect(jsonDecode(requests[i].body), {
          'data': {'schemaVersion': 1},
        });
        expect(requests[i].followRedirects, isFalse);
      }
      transport.close();
    },
  );

  test('guest sends no identity and invalid routes/URLs never send', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.headers.containsKey('authorization'), isFalse);
      expect(request.headers.containsKey('x-firebase-appcheck'), isFalse);
      return http.Response('{"result":null}', 200);
    });
    for (final url in [
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'https://coupon-app-29446.web.app',
      'https://x.run.app/path',
      'https://user@x.run.app',
      'https://x.run.app?x=1',
    ]) {
      expect(
        () => CustomerSearchHttpTransport(
          serviceUrl: Uri.parse(url),
          idToken: () async => null,
          client: client,
        ),
        throwsArgumentError,
      );
    }
    final transport = CustomerSearchHttpTransport(
      serviceUrl: Uri.parse('http://127.0.0.1:8080'),
      allowLoopbackForTesting: true,
      idToken: () async => null,
      client: client,
    );
    await expectLater(
      transport.call('startCustomerBiteSaverOfferRedemption', {}),
      throwsArgumentError,
    );
    expect(calls, 0);
    expect(await transport.call('startCustomerBiteSaverSearchV2', {}), isNull);
    expect(calls, 1);
    transport.close();
  });

  test(
    'native callable error is preserved; no retry or success fabrication',
    () async {
      var calls = 0;
      final transport = CustomerSearchHttpTransport(
        serviceUrl: Uri.parse('https://x.run.app'),
        idToken: () async => null,
        client: MockClient((_) async {
          calls++;
          return http.Response(
            '{"error":{"status":"PERMISSION_DENIED","message":"Denied"}}',
            403,
          );
        }),
      );
      await expectLater(
        transport.call('startCustomerBiteSaverSearchV2', {}),
        throwsA(
          isA<FirebaseFunctionsException>().having(
            (e) => e.code,
            'code',
            'permission-denied',
          ),
        ),
      );
      expect(calls, 1);
      transport.close();
    },
  );

  test(
    'whole call deadline includes stalled token retrieval; never sends late',
    () async {
      var calls = 0;
      final token = Completer<String?>();
      final transport = CustomerSearchHttpTransport(
        serviceUrl: Uri.parse('https://x.run.app'),
        idToken: () => token.future,
        timeout: const Duration(milliseconds: 5),
        client: MockClient((_) async {
          calls++;
          return http.Response('{"result":null}', 200);
        }),
      );
      await expectLater(
        transport.call('startCustomerBiteSaverSearchV2', {}),
        throwsA(
          isA<FirebaseFunctionsException>().having(
            (e) => e.code,
            'code',
            'deadline-exceeded',
          ),
        ),
      );
      token.complete('late');
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(calls, 0);
      transport.close();
    },
  );

  test(
    'explicit fallback preserves legacy profile Saved and redemption transport',
    () async {
      var sends = 0;
      final transport = CustomerSearchHttpTransport(
        serviceUrl: Uri.parse('https://x.run.app'),
        idToken: () async => null,
        client: MockClient((_) async {
          sends++;
          return http.Response('{"result":null}', 200);
        }),
      );
      final protected = <String>[];
      final route = transport.withFallback((name, request) async {
        protected.add(name);
        return request;
      });
      for (final name in [
        'getCustomerBiteSaverSearchPage',
        'getCustomerBiteSaverSavedPage',
        'startCustomerBiteSaverOfferRedemption',
        'getCustomerBiteScoreDetail',
      ]) {
        final request = <String, Object?>{
          'kind': 'publicProfile',
          'unchangedIdentity': 'synthetic-id',
        };
        expect(await route(name, request), same(request));
      }
      expect(protected.length, 4);
      expect(sends, 0);
      transport.close();
    },
  );
}
