import 'dart:async';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/customer_browser_location_service.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object> center({double lat = 29.18, double lng = -82.14}) => {
  'schemaVersion': 1,
  'latitude': lat,
  'longitude': lng,
  'provider': 'google',
  'cacheSeconds': 86400,
};
void main() {
  test(
    'ZIP+4 and simultaneous identical submissions share one bounded request',
    () async {
      var calls = 0;
      final done = Completer<Object?>();
      final service = CustomerBrowserLocationService(
        transport: (request) {
          calls++;
          expect(request.keys.toSet(), {
            'schemaVersion',
            'query',
            'clientInstanceId',
          });
          return done.future;
        },
      );
      addTearDown(service.resetForTesting);
      final first = service.resolve('34461-1234');
      final second = service.resolve('34461');
      done.complete(center());
      expect((await first).first.latitude, 29.18);
      await second;
      await service.resolve('34461');
      expect(calls, 1);
    },
  );
  test(
    'city/state reuse and trusted city-only alias avoid new calls; unconfirmed city asks for state',
    () async {
      var calls = 0;
      final service = CustomerBrowserLocationService(
        transport: (_) async {
          calls++;
          return center();
        },
      );
      addTearDown(service.resetForTesting);
      await expectLater(
        service.resolve('Springfield'),
        throwsA(isA<CustomerLocationException>()),
      );
      expect(calls, 0);
      await service.resolve('Ocala, FL');
      await service.resolve(' ocala,  fl ');
      await service.resolve('Ocala');
      expect(calls, 1);
    },
  );
  test('expired coordinate cache cannot be reused after 24h', () async {
    var at = DateTime(2026, 10, 17);
    var calls = 0;
    final service = CustomerBrowserLocationService(
      now: () => at,
      transport: (_) async {
        calls++;
        return center();
      },
    );
    addTearDown(service.resetForTesting);
    await service.resolve('34461');
    at = at.add(const Duration(hours: 24));
    await service.resolve('34461');
    expect(calls, 2);
  });
  test('out of order completions cannot replace newer cached center', () async {
    final old = Completer<Object?>();
    var calls = 0;
    final service = CustomerBrowserLocationService(
      transport: (r) {
        calls++;
        return r['query'] == '34461'
            ? old.future
            : Future.value(center(lat: 30));
      },
    );
    addTearDown(service.resetForTesting);
    final pending = service.resolve('34461');
    await service.resolve('Ocala, FL');
    old.complete(center());
    await pending;
    expect((await service.resolve('Ocala, FL')).first.latitude, 30);
    expect(calls, 2);
  });
  test(
    'bad coordinates and unknown responses never become confirmed',
    () async {
      for (final result in [
        center(lat: double.nan),
        center(lng: 0),
        center(lat: 91),
        {'schemaVersion': 2},
        null,
      ]) {
        final service = CustomerBrowserLocationService(
          transport: (_) async => result,
        );
        addTearDown(service.resetForTesting);
        await expectLater(
          service.resolve('34461'),
          throwsA(isA<CustomerLocationException>()),
        );
      }
    },
  );
  test(
    'provider failure has no automatic retry and never exposes raw details',
    () async {
      var calls = 0;
      final service = CustomerBrowserLocationService(
        transport: (_) async {
          calls++;
          throw FirebaseFunctionsException(
            code: 'unavailable',
            message: 'SECRET_SENTINEL',
          );
        },
      );
      addTearDown(service.resetForTesting);
      await expectLater(
        service.resolve('34461'),
        throwsA(
          predicate(
            (e) =>
                e is CustomerLocationException &&
                !e.toString().contains('SECRET_SENTINEL'),
          ),
        ),
      );
      expect(calls, 1);
    },
  );
  test(
    'local invalid inputs and excessive concurrent requests are bounded',
    () async {
      var calls = 0;
      final pending = Completer<Object?>();
      final service = CustomerBrowserLocationService(
        transport: (_) {
          calls++;
          return pending.future;
        },
      );
      addTearDown(service.resetForTesting);
      for (final q in [
        '',
        '123 Main St',
        'https://evil.test',
        '34461\n',
        'A' * 121,
      ]) {
        await expectLater(
          service.resolve(q),
          throwsA(isA<CustomerLocationException>()),
        );
      }
      expect(calls, 0);
      final a = service.resolve('34461'), b = service.resolve('Ocala, FL');
      await expectLater(
        service.resolve('Boston, MA'),
        throwsA(isA<CustomerLocationException>()),
      );
      expect(calls, 2);
      pending.complete(center());
      await a;
      await b;
    },
  );
}
