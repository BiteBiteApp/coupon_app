import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/services/app_update/app_update_service.dart';
import 'package:coupon_app/services/app_update/ios_update_eligibility.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'app_update_service_test.dart'
    show MemoryUpdateStorage, FakeUpdatePlatform;

void main() {
  late DateTime now;
  late Map<String, Object?> policy;
  late Map<String, Object?> local;
  late Map<String, Object?> app;
  late List<Uri> requests;
  Future<Object?> fetch(Uri uri) async {
    requests.add(uri);
    return uri == IosUpdateEligibility.policyUrl
        ? policy
        : {
            'resultCount': 1,
            'results': [app],
          };
  }

  IosUpdateEligibility provider({Future<Object?> Function(Uri)? request}) =>
      IosUpdateEligibility(
        snapshot: () async => local,
        fetch: request ?? fetch,
        clock: () => now,
      );
  setUp(() {
    now = DateTime.utc(2026, 10, 15);
    policy = {
      'schemaVersion': 1,
      'enabled': true,
      'bundleId': 'com.colesmart.bitestar',
      'appleId': '6792401678',
      'version': '1.10',
      'urgent': false,
      'issuedAt': now.toIso8601String(),
      'expiresAt': now.add(const Duration(days: 1)).toIso8601String(),
    };
    local = {
      'publicInstallation': true,
      'externalEntry': false,
      'bundleId': 'com.colesmart.bitestar',
      'appleId': '6792401678',
      'installedVersion': '1.9.0',
      'country': 'CA',
      'device': 'iPhone17,1',
      'osVersion': '18.0',
    };
    app = {
      'trackId': 6792401678,
      'bundleId': 'com.colesmart.bitestar',
      'kind': 'software',
      'version': '1.10.0',
      'minimumOsVersion': '17.0',
      'supportedDevices': ['iPhone16Pro-iPhone16Pro'],
    };
    requests = [];
  });

  test(
    'real HTTP adapter rejects redirects, stale cache, wrong MIME and oversized JSON',
    () async {
      for (final response in [
        http.Response(
          '{}',
          302,
          headers: {
            'content-type': 'application/json',
            'location': 'https://other.example',
          },
        ),
        http.Response('{}', 200, headers: {'content-type': 'text/html'}),
        http.Response(
          '{}',
          200,
          headers: {'content-type': 'application/json', 'age': '301'},
        ),
        http.Response(
          '{}',
          200,
          headers: {'content-type': 'application/json', 'age': 'unknown'},
        ),
        http.Response(
          ' ' * 65537,
          200,
          headers: {'content-type': 'application/json'},
        ),
      ]) {
        final result = await http.runWithClient(
          () => IosUpdateEligibility.fetchJson(IosUpdateEligibility.policyUrl),
          () => MockClient((request) async {
            expect(request.followRedirects, false);
            expect(request.headers['Cache-Control'], 'no-cache, no-store');
            return response;
          }),
        );
        expect(result, isNull);
      }
      expect(
        await http.runWithClient(
          () => IosUpdateEligibility.fetchJson(IosUpdateEligibility.policyUrl),
          () => MockClient(
            (_) async => http.Response(
              '{"enabled":false}',
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
          ),
        ),
        {'enabled': false},
      );
    },
  );

  test(
    'Apple text/javascript is JSON-decoded only for the exact Apple endpoint',
    () async {
      final apple = Uri.https('itunes.apple.com', '/lookup', {
        'id': '6792401678',
      });
      Future<Object?> request(Uri uri, String body) => http.runWithClient(
        () => IosUpdateEligibility.fetchJson(uri),
        () => MockClient(
          (_) async => http.Response(
            body,
            200,
            headers: {'content-type': 'text/javascript; charset=utf-8'},
          ),
        ),
      );
      expect(await request(apple, '{"resultCount":0,"results":[]}'), {
        'resultCount': 0,
        'results': [],
      });
      expect(await request(IosUpdateEligibility.policyUrl, '{}'), isNull);
      expect(
        await request(Uri.https('itunes.apple.com', '/other'), '{}'),
        isNull,
      );
      expect(await request(Uri.https('example.com', '/lookup'), '{}'), isNull);
      await expectLater(request(apple, 'callback({})'), throwsFormatException);
      await expectLater(request(apple, '<html>'), throwsFormatException);
    },
  );

  test(
    'verified marketing tokens require exact device and app listing agreement',
    () async {
      app['supportedDevices'] = ['iPhone16ProMax-iPhone16ProMax'];
      expect(await provider().check(), isNull);
      app['supportedDevices'] = ['iPhone17,1-iPhone17,1'];
      expect(
        await provider().check(),
        isNull,
      ); // Reject synthetic hardware tokens.
      app['supportedDevices'] = ['iPhone16Pro-iPhone16Pro'];
      expect(await provider().check(), isNotNull);
      local['device'] = 'iPhone18,1';
      expect(await provider().check(), isNull);
      app['supportedDevices'] = ['iPhone17Pro-iPhone17Pro'];
      expect(await provider().check(), isNotNull);
      local['device'] = 'iPad17,4'; // Unknown: no guess, no gate.
      expect(await provider().check(), isNull);
    },
  );

  test(
    'iOS hung native or network check times out without changing saved history',
    () async {
      final storage = MemoryUpdateStorage();
      storage.data['app_update.v1.ios:com.colesmart.bitestar:6792401678:1.10.0'] =
          '{"count":1,"at":0}';
      final saved = Map.of(storage.data);
      final platform = FakeUpdatePlatform();
      platform.onCheck = () async => AppUpdateRelease.fromIos(
        await provider(request: (_) => Completer<Object?>().future).check(),
      );
      final service = AppUpdateService(
        platform: platform,
        storage: storage,
        clock: () => now,
      );
      expect(await service.check(), isNull);
      expect(storage.data, saved);
    },
  );

  test(
    'verified exact identity/version uses actual storefront, never default US',
    () async {
      final release = AppUpdateRelease.fromIos(await provider().check())!;
      expect(release.key, 'ios:com.colesmart.bitestar:6792401678:1.10.0');
      expect(release.build, isNull);
      expect(release.urgent, false);
      expect(requests.last.queryParameters, {
        'id': '6792401678',
        'country': 'CA',
        'entity': 'software',
      });
    },
  );
  test('numeric tuples, canonical equality and invalid versions', () {
    expect(compareIosVersions('1.10', '1.9'), 1);
    expect(compareIosVersions('2', '1.99.99'), 1);
    expect(compareIosVersions('1.2', '1.2.0'), 0);
    for (final v in ['1.2-beta', '1.2.3.4', '-1', '', '1e3', '9999999999']) {
      expect(canonicalIosVersion(v), isNull, reason: v);
    }
  });
  test(
    'missing Apple ID disables real provider before any network or native work',
    () async {
      expect(
        await IosUpdateEligibility(
          expectedAppleId: null,
          snapshot: () => throw StateError('must not read'),
          fetch: (uri) => throw StateError('must not fetch'),
        ).check(),
        isNull,
      );
    },
  );
  test(
    'checked-in policy is disabled and exact Hosting headers preserve routes',
    () {
      final file = jsonDecode(
        File('web/app-updates/ios.json').readAsStringSync(),
      );
      expect(file['enabled'], false);
      expect(file['urgent'], false);
      expect(IosUpdateEligibility.configuredAppleId, '6792401678');
      expect(IosUpdateEligibility.bundleId, 'com.colesmart.bitestar');
      expect(file['appleId'], '6792401678');
      expect(file['bundleId'], 'com.colesmart.bitestar');
      expect(file['issuedAt'], isNull);
      expect(file['expiresAt'], isNull);
      expect(file['version'], isNull);
      final hosting = jsonDecode(
        File('firebase.json').readAsStringSync(),
      )['hosting'];
      expect(hosting['public'], 'build/web');
      final header = (hosting['headers'] as List).singleWhere(
        (h) => h['source'] == '/app-updates/ios.json',
      );
      expect(
        header['headers'],
        contains(
          equals({'key': 'Cache-Control', 'value': 'no-store, max-age=0'}),
        ),
      );
      expect((hosting['rewrites'] as List).last, {
        'source': '**',
        'destination': '/index.html',
      });
    },
  );
  test(
    'configured identity with checked-in disabled policy never requests Apple facts',
    () async {
      final file = jsonDecode(
        File('web/app-updates/ios.json').readAsStringSync(),
      );
      final fetched = <Uri>[];
      final eligibility = IosUpdateEligibility(
        snapshot: () =>
            throw StateError('disabled policy must not read native facts'),
        fetch: (uri) async {
          fetched.add(uri);
          return file;
        },
        clock: () => now,
      );
      expect(await eligibility.check(), isNull);
      expect(fetched, [IosUpdateEligibility.policyUrl]);
    },
  );

  test('missing, disabled, malformed, non-JSON policy fails open', () async {
    for (final value in [
      null,
      {},
      false,
      '<html>',
      {...policy, 'enabled': false},
      {...policy, 'schemaVersion': 2},
      {...policy, 'urgent': 'true'},
      {...policy, 'appleId': 6792401678},
      {...policy, 'version': 'next'},
    ]) {
      expect(await provider(request: (_) async => value).check(), isNull);
    }
  });
  test(
    'expired, future, missing, non-UTC and excessive policy lifetime fail open',
    () async {
      final original = Map<String, Object?>.from(policy);
      for (final patch in [
        {'expiresAt': now.toIso8601String()},
        {'issuedAt': now.add(const Duration(seconds: 1)).toIso8601String()},
        {'expiresAt': null},
        {'issuedAt': '2026-10-15T00:00:00'},
        {'expiresAt': now.add(const Duration(days: 8)).toIso8601String()},
      ]) {
        policy = {...original, ...patch};
        expect(await provider().check(), isNull, reason: '$patch');
      }
    },
  );
  test('every identity boundary rejects mismatch', () async {
    for (final target in [policy, local, app]) {
      final original = target['bundleId'];
      target['bundleId'] = 'com.old.bitesaver';
      expect(await provider().check(), isNull);
      target['bundleId'] = original;
    }
    policy['appleId'] = '987654321';
    expect(await provider().check(), isNull);
    policy['appleId'] = '6792401678';
    local['appleId'] = '987654321';
    expect(await provider().check(), isNull);
    local['appleId'] = '6792401678';
    app['trackId'] = 987654321;
    expect(await provider().check(), isNull);
  });
  test(
    'current or newer installed version and wrong public target fail open',
    () async {
      for (final version in ['1.10', '1.10.1', '2.0']) {
        local['installedVersion'] = version;
        expect(await provider().check(), isNull);
      }
      local['installedVersion'] = '1.9';
      app['version'] = '1.11';
      expect(await provider().check(), isNull);
    },
  );
  test(
    'development, TestFlight, external-entry, unknown storefront/device rejected',
    () async {
      final original = Map<String, Object?>.from(local);
      for (final patch in [
        {'publicInstallation': false},
        {'publicInstallation': null},
        {'externalEntry': true},
        {'country': null},
        {'country': 'USA'},
        {'device': 'arm64'},
        {'device': 'iPhone99,1'},
        {'osVersion': 'unknown'},
        {'osVersion': '16.9'},
      ]) {
        local = {...original, ...patch};
        expect(await provider().check(), isNull, reason: '$patch');
      }
    },
  );
  test(
    'unknown compatibility, malformed listing, unavailable storefront rejected',
    () async {
      final original = Map<String, Object?>.from(app);
      for (final patch in [
        {'supportedDevices': null},
        {'supportedDevices': []},
        {
          'supportedDevices': ['iPhone17,10-iPhone17,10'],
        },
        {'minimumOsVersion': null},
        {'kind': 'mac-software'},
      ]) {
        app = {...original, ...patch};
        expect(await provider().check(), isNull, reason: '$patch');
      }
      for (final result in [
        null,
        {},
        {'resultCount': 0, 'results': []},
        {'resultCount': 1, 'results': []},
        {
          'resultCount': 2,
          'results': [original, original],
        },
      ]) {
        expect(
          await provider(
            request: (u) async =>
                u == IosUpdateEligibility.policyUrl ? policy : result,
          ).check(),
          isNull,
        );
      }
    },
  );
  test('network failure and expiry during lookup do not gate', () async {
    expect(
      await provider(
        request: (_) => throw const SocketException('offline'),
      ).check(),
      isNull,
    );
    expect(
      await provider(
        request: (u) async {
          final result = await fetch(u);
          if (u != IosUpdateEligibility.policyUrl) {
            now = now.add(const Duration(days: 1));
          }
          return result;
        },
      ).check(),
      isNull,
    );
  });
  test(
    'iOS two full postponements persist across service recreation/account switch',
    () async {
      final storage = MemoryUpdateStorage();
      final platform = FakeUpdatePlatform();
      platform.onCheck = () async =>
          AppUpdateRelease.fromIos(await provider().check());
      AppUpdateService service() => AppUpdateService(
        platform: platform,
        storage: storage,
        clock: () => now,
      );
      Future<void> refresh() async {
        policy['issuedAt'] = now.toIso8601String();
        policy['expiresAt'] = now
            .add(const Duration(days: 1))
            .toIso8601String();
      }

      for (var count = 0; count < 2; count++) {
        final decision = (await service().check())!;
        expect(decision.postponements, count);
        expect(decision.required, false);
        expect(await service().postpone(decision), true);
        now = now.add(const Duration(hours: 23, minutes: 59));
        await refresh(); // Same public release, fresh policy cannot spend/reset snooze.
        policy['version'] = '1.10.0';
        expect(await service().check(), isNull);
        now = now.add(const Duration(minutes: 1));
        await refresh();
      }
      expect((await service().check())!.required, true);
      final saved = Map.of(storage.data);
      policy['enabled'] = false;
      expect(await service().check(), isNull);
      expect(storage.data, saved);
      policy['enabled'] = true;
      expect((await service().check())!.postponements, 2);
      local['installedVersion'] = '1.10';
      expect(await service().check(), isNull);
      expect(storage.data, saved);
    },
  );
  test(
    'urgent independent of versions; disabling or network failure retains snoozes',
    () async {
      final storage = MemoryUpdateStorage();
      final platform = FakeUpdatePlatform();
      platform.onCheck = () async =>
          AppUpdateRelease.fromIos(await provider().check());
      final service = AppUpdateService(
        platform: platform,
        storage: storage,
        clock: () => now,
      );
      await service.postpone((await service.check())!);
      policy['urgent'] = true;
      final urgent = (await service.check())!;
      expect(urgent.required, true);
      expect(await service.postpone(urgent), false);
      policy['urgent'] = false;
      expect(await service.check(), isNull);
      expect(
        storage.data.keys.single,
        'app_update.v1.ios:com.colesmart.bitestar:6792401678:1.10.0',
      );
    },
  );
  test(
    'Android keys and priority 5 remain unchanged and independent of iOS',
    () {
      for (var priority = 0; priority <= 5; priority++) {
        final release = AppUpdateRelease.fromPlatform({
          'eligible': true,
          'package': 'com.colesmart.bitestar',
          'installed': 1,
          'available': 10,
          'priority': priority,
          'inProgress': false,
        })!;
        expect(release.key, 'android:com.colesmart.bitestar:10');
        expect(release.urgent, priority == 5);
        expect(release.iosVersion, isNull);
      }
      expect(AppUpdateRelease.fromPlatform({'platform': 'ios'}), isNull);
      expect(AppUpdateRelease.fromIos({'platform': 'android'}), isNull);
    },
  );
}
