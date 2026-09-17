import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:coupon_app/models/customer_bitesaver_device_usage.dart';
import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/services/customer_bitesaver_device_proof_service.dart';
import 'package:coupon_app/services/customer_bitesaver_device_use_service.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const MethodChannel _channel = MethodChannel(
  'com.colesmart.bitestar/bitesaver_device_proof',
);
const String _challengeId = 'bsdc_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _challengeBytes = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _credentialId = 'bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI';

final class _ManualTimer implements Timer {
  _ManualTimer(this._callback);

  final void Function() _callback;
  bool _active = true;

  void fire() {
    if (!_active) return;
    _active = false;
    _callback();
  }

  void fireStaleCallback() => _callback();

  @override
  void cancel() => _active = false;

  @override
  bool get isActive => _active;

  @override
  int get tick => _active ? 0 : 1;
}

CustomerBiteSaverCombinedUseRequest request({
  String logicalRequestId = 'device-use-request-0001',
  String offerCharacter = 'o',
}) => CustomerBiteSaverCombinedUseRequest(
  logicalRequestId: logicalRequestId,
  restaurantId: CustomerBiteSaverRestaurantId('bsr_${'r' * 43}'),
  offerId: CustomerBiteSaverOfferId('bso_${offerCharacter * 43}'),
  timeZone: 'America/New_York',
  utcOffsetMinutes: -240,
  currentCoordinates: null,
  origin: CustomerBiteSaverSavedUseAuthority(accessToken: 'saved-token'),
);

Map<String, Object?> challenge({
  String logicalRequestId = 'device-use-request-0001',
  String? authenticatedUserId,
  int issuedAtMillis = 1000,
  int? expiresAtMillis,
  String challengeId = _challengeId,
}) => <String, Object?>{
  'schemaVersion': 1,
  'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
  'challengeId': challengeId,
  'platform': 'android',
  'purpose': 'combinedCouponUse',
  'requestFingerprint': 'a' * 64,
  'authenticatedUserId': authenticatedUserId,
  'origin': 'saved',
  'logicalRequestId': logicalRequestId,
  'issuedAtMillis': issuedAtMillis,
  'validFromMillis': issuedAtMillis,
  'expiresAtMillis': expiresAtMillis ?? issuedAtMillis + 120000,
  'challengeBytes': _challengeBytes,
};

Map<String, Object?> result(CustomerBiteSaverCombinedUseRequest request) =>
    <String, Object?>{
      'schemaVersion': 1,
      'restaurantId': request.restaurantId.value,
      'offerId': request.offerId.value,
      'status': 'denied',
      'reason': 'used',
      'redemptionId': null,
      'timerStartedAtMillis': null,
      'timerExpiresAtMillis': null,
      'evaluatedAtMillis': 2001,
    };

String signature() => base64UrlEncode(<int>[
  0x30,
  0x44,
  0x02,
  0x20,
  ...List<int>.filled(32, 1),
  0x02,
  0x20,
  ...List<int>.filled(32, 2),
]).replaceAll('=', '');

void installAvailableAndroidBridge({void Function(MethodCall)? onCall}) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_channel, (call) async {
        onCall?.call(call);
        switch (call.method) {
          case 'getCapability':
            return <String, Object?>{
              'schemaVersion': 1,
              'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
              'platform': 'android',
              'apiLevel': 36,
              'minimumApiLevel': 26,
              'supported': true,
              'credentialState': 'present',
              'integrityAvailable': true,
            };
          case 'createUseProof':
            return <String, Object?>{
              'schemaVersion': 1,
              'kind': 'androidUse',
              'credentialId': _credentialId,
              'possessionSignature': signature(),
            };
          default:
            fail('Unexpected native invocation: ${call.method}');
        }
      });
}

CustomerBiteSaverDeviceProofService proofService() =>
    CustomerBiteSaverDeviceProofService(
      channel: _channel,
      platformResolver: () => CustomerBiteSaverDevicePlatform.android,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  });

  for (final offset in <String, int>{
    'phone clock five seconds slow': 5000,
    'phone clock one day fast': -86400000,
    'normal exact phone clock': 0,
  }.entries) {
    test('${offset.key} accepts a fresh challenge', () async {
      installAvailableAndroidBridge();
      final target = request();
      var elapsed = const Duration(seconds: 20);
      var sends = 0;
      Duration? retention;
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => elapsed,
        expiryTimerFactory: (duration, callback) {
          retention = duration;
          return _ManualTimer(callback);
        },
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            elapsed += const Duration(milliseconds: 250);
            return challenge(
              issuedAtMillis:
                  DateTime.now().millisecondsSinceEpoch + offset.value,
            );
          }
          sends += 1;
          return result(target);
        },
      );
      addTearDown(service.dispose);

      await service.useCoupon(request: target, authenticatedUserId: null);

      expect(sends, 1);
      expect(retention, const Duration(milliseconds: 119749));
    });
  }

  for (final direction in <String>['backward', 'forward']) {
    test(
      'wall clock jumping $direction cannot affect or extend an exact retry',
      () async {
        // The phone wall clock has no input seam in either service or the accepted
        // challenge. Exercise the observable jump through server/phone skew,
        // while independently advancing the sole elapsed clock input.
        for (final sourcePath in <String>[
          'lib/models/customer_bitesaver_device_usage.dart',
          'lib/services/customer_bitesaver_device_proof_service.dart',
          'lib/services/customer_bitesaver_device_use_service.dart',
        ]) {
          // Removing the wall-clock dependency is part of this regression:
          // no wall timestamp can affect a retained challenge after acceptance.
          expect(
            File(sourcePath).readAsStringSync(),
            isNot(contains('DateTime')),
          );
        }
        var phoneWall = DateTime.now();
        final serverIssuedAt = phoneWall.millisecondsSinceEpoch;
        var elapsed = Duration.zero;
        var issues = 0;
        final payloads = <String>[];
        installAvailableAndroidBridge();
        final target = request();
        final service = CustomerBiteSaverDeviceUseService(
          proofService: proofService(),
          elapsedClock: () => elapsed,
          transport: (name, payload) async {
            if (name ==
                CustomerBiteSaverDeviceProofContract
                    .issueChallengeCallableName) {
              issues += 1;
              return challenge(issuedAtMillis: serverIssuedAt);
            }
            payloads.add(jsonEncode(payload));
            throw const CustomerBiteSaverDeviceUseTransportException(
              code: 'unavailable',
              ambiguous: true,
            );
          },
        );
        addTearDown(service.dispose);
        Future<void> ambiguousUse() => expectLater(
          service.useCoupon(request: target, authenticatedUserId: null),
          throwsA(
            isA<CustomerBiteSaverDeviceUseException>().having(
              (error) => error.kind,
              'kind',
              CustomerBiteSaverDeviceUseFailureKind.ambiguous,
            ),
          ),
        );

        await ambiguousUse();
        phoneWall = direction == 'backward'
            ? phoneWall.subtract(const Duration(days: 2))
            : phoneWall.add(const Duration(days: 2));
        expect(
          (phoneWall.millisecondsSinceEpoch - serverIssuedAt).abs(),
          172800000,
        );
        elapsed = const Duration(milliseconds: 119998);
        await ambiguousUse();
        expect(issues, 1);
        expect(payloads[1], payloads[0]);

        elapsed += const Duration(milliseconds: 1);
        await ambiguousUse();
        expect(issues, 2);
      },
    );
  }

  for (final elapsedInProof in <int>[8, 9]) {
    test(
      'near-boundary challenge counts request and proof elapsed ($elapsedInProof ms)',
      () async {
        var elapsed = Duration.zero;
        var sends = 0;
        installAvailableAndroidBridge(
          onCall: (call) {
            if (call.method == 'createUseProof') {
              elapsed += Duration(milliseconds: elapsedInProof);
            }
          },
        );
        final target = request();
        final service = CustomerBiteSaverDeviceUseService(
          proofService: proofService(),
          elapsedClock: () => elapsed,
          transport: (name, payload) async {
            if (name ==
                CustomerBiteSaverDeviceProofContract
                    .issueChallengeCallableName) {
              elapsed += const Duration(milliseconds: 119990);
              return challenge();
            }
            sends += 1;
            return result(target);
          },
        );
        addTearDown(service.dispose);

        final operation = service.useCoupon(
          request: target,
          authenticatedUserId: null,
        );
        if (elapsedInProof == 8) {
          await operation;
          expect(sends, 1);
        } else {
          await expectLater(
            operation,
            throwsA(
              isA<CustomerBiteSaverDeviceUseException>().having(
                (error) => error.code,
                'code',
                'device-use-challenge-expired',
              ),
            ),
          );
          expect(sends, 0);
        }
      },
    );
  }

  test(
    'exhausted challenge response never invokes native proof or sends',
    () async {
      var elapsed = Duration.zero;
      var nativeProofs = 0;
      installAvailableAndroidBridge(
        onCall: (call) {
          if (call.method == 'createUseProof') nativeProofs += 1;
        },
      );
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => elapsed,
        transport: (name, payload) async {
          expect(
            name,
            CustomerBiteSaverDeviceProofContract.issueChallengeCallableName,
          );
          elapsed = const Duration(milliseconds: 119999);
          return challenge();
        },
      );
      addTearDown(service.dispose);
      await expectLater(
        service.useCoupon(request: request(), authenticatedUserId: null),
        throwsA(
          isA<CustomerBiteSaverDeviceUseException>().having(
            (error) => error.code,
            'code',
            'device-use-invalid-challenge',
          ),
        ),
      );
      expect(nativeProofs, 0);
    },
  );

  test(
    'send-boundary check rejects expiry after pending timer creation',
    () async {
      var elapsed = Duration.zero;
      var sends = 0;
      installAvailableAndroidBridge();
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => elapsed,
        expiryTimerFactory: (duration, callback) {
          elapsed += duration;
          return _ManualTimer(callback);
        },
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            return challenge();
          }
          sends += 1;
          fail('The second check must stop this expired send.');
        },
      );
      addTearDown(service.dispose);
      await expectLater(
        service.useCoupon(request: request(), authenticatedUserId: null),
        throwsA(
          isA<CustomerBiteSaverDeviceUseException>().having(
            (error) => error.code,
            'code',
            'device-use-challenge-expired',
          ),
        ),
      );
      expect(sends, 0);
    },
  );

  test(
    'stale expiry callback cannot clear a newer ambiguous operation',
    () async {
      var issues = 0;
      final timers = <_ManualTimer>[];
      installAvailableAndroidBridge();
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => Duration.zero,
        expiryTimerFactory: (duration, callback) {
          final timer = _ManualTimer(callback);
          timers.add(timer);
          return timer;
        },
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            issues += 1;
            final useRequest = payload['request']! as Map<String, Object?>;
            return challenge(
              logicalRequestId: useRequest['logicalRequestId']! as String,
            );
          }
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        },
      );
      addTearDown(service.dispose);
      Future<void> ambiguousUse(CustomerBiteSaverCombinedUseRequest target) =>
          expectLater(
            service.useCoupon(request: target, authenticatedUserId: null),
            throwsA(isA<CustomerBiteSaverDeviceUseException>()),
          );
      await ambiguousUse(request());
      final newer = request(logicalRequestId: 'device-use-request-0002');
      await ambiguousUse(newer);
      expect(timers.first.isActive, isFalse);
      timers.first.fireStaleCallback();
      await ambiguousUse(newer);
      expect(issues, 2);
      expect(timers.last.isActive, isTrue);
    },
  );

  test(
    'exact retry rechecks elapsed expiry immediately before transport',
    () async {
      var elapsed = Duration.zero;
      var expireOnNextRead = false;
      var readsAfterRetry = 0;
      var sends = 0;
      installAvailableAndroidBridge();
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () {
          if (expireOnNextRead && ++readsAfterRetry == 2) {
            elapsed = const Duration(milliseconds: 119999);
          }
          return elapsed;
        },
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            return challenge();
          }
          sends += 1;
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        },
      );
      addTearDown(service.dispose);
      final target = request();
      await expectLater(
        service.useCoupon(request: target, authenticatedUserId: null),
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      elapsed = const Duration(milliseconds: 119998);
      expireOnNextRead = true;
      await expectLater(
        service.useCoupon(request: target, authenticatedUserId: null),
        throwsA(
          isA<CustomerBiteSaverDeviceUseException>().having(
            (error) => error.code,
            'code',
            'device-use-challenge-expired',
          ),
        ),
      );
      expect(sends, 1);
    },
  );

  test('identical ambiguous retry reuses exact challenge and proof', () async {
    var nowMillis = 2000;
    var nativeUseCalls = 0;
    installAvailableAndroidBridge(
      onCall: (call) {
        if (call.method == 'createUseProof') nativeUseCalls += 1;
      },
    );
    final payloads = <String>[];
    var issueCalls = 0;
    var useCalls = 0;
    final target = request();
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => Duration(milliseconds: nowMillis),
      transport: (name, payload) async {
        if (name ==
            CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
          issueCalls += 1;
          return challenge();
        }
        useCalls += 1;
        payloads.add(jsonEncode(payload));
        if (useCalls == 1) {
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        }
        return result(target);
      },
    );

    await expectLater(
      service.useCoupon(request: target, authenticatedUserId: null),
      throwsA(
        isA<CustomerBiteSaverDeviceUseException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverDeviceUseFailureKind.ambiguous,
        ),
      ),
    );
    final recovered = await service.useCoupon(
      request: target,
      authenticatedUserId: null,
    );

    expect(recovered.status, CustomerBiteSaverDeviceUseStatus.denied);
    expect(issueCalls, 1);
    expect(nativeUseCalls, 1);
    expect(useCalls, 2);
    expect(payloads[1], payloads[0]);
    nowMillis += 1;
  });

  test(
    'changed auth binding discards an ambiguous proof and reacquires',
    () async {
      var nativeUseCalls = 0;
      installAvailableAndroidBridge(
        onCall: (call) {
          if (call.method == 'createUseProof') nativeUseCalls += 1;
        },
      );
      var issueCalls = 0;
      var useCalls = 0;
      final target = request();
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => const Duration(milliseconds: 2000),
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            issueCalls += 1;
            return challenge(
              authenticatedUserId: issueCalls == 1 ? null : 'guest',
            );
          }
          useCalls += 1;
          if (useCalls == 1) {
            throw const CustomerBiteSaverDeviceUseTransportException(
              code: 'deadline-exceeded',
              ambiguous: true,
            );
          }
          return result(target);
        },
      );

      await expectLater(
        service.useCoupon(request: target, authenticatedUserId: null),
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      await service.useCoupon(request: target, authenticatedUserId: 'guest');

      expect(issueCalls, 2);
      expect(nativeUseCalls, 2);
      expect(useCalls, 2);
    },
  );

  test('missing native bridge is translated to the typed use error', () async {
    final target = request();
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => const Duration(milliseconds: 2000),
      transport: (name, payload) async {
        if (name ==
            CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
          return challenge();
        }
        fail('Use must not run without a native bridge.');
      },
    );

    await expectLater(
      service.useCoupon(request: target, authenticatedUserId: null),
      throwsA(
        isA<CustomerBiteSaverDeviceUseException>()
            .having(
              (error) => error.kind,
              'kind',
              CustomerBiteSaverDeviceUseFailureKind.unsupported,
            )
            .having(
              (error) => error.code,
              'code',
              'device-proof-native-bridge-unavailable',
            ),
      ),
    );
  });

  test('API 24/25 rejection occurs before any server mutation', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (call) async {
          expect(call.method, 'getCapability');
          return <String, Object?>{
            'schemaVersion': 1,
            'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
            'platform': 'android',
            'apiLevel': 25,
            'minimumApiLevel': 26,
            'supported': false,
            'credentialState': 'unavailable',
            'integrityAvailable': false,
          };
        });
    var transportCalls = 0;
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => const Duration(milliseconds: 2000),
      transport: (name, payload) async {
        transportCalls += 1;
        fail('Unsupported API levels must not issue a server challenge.');
      },
    );

    await expectLater(
      service.useCoupon(request: request(), authenticatedUserId: null),
      throwsA(
        isA<CustomerBiteSaverDeviceUseException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverDeviceUseFailureKind.unsupported,
        ),
      ),
    );
    expect(transportCalls, 0);
  });

  test('explicit recovery re-enrolls a locally present credential', () async {
    final publicKeySpki = List<int>.generate(91, (index) => index);
    final recoveryCredentialId =
        CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
          platform: CustomerBiteSaverDevicePlatform.android,
          publicKeySha256: Uint8List.fromList(
            sha256.convert(publicKeySpki).bytes,
          ),
        );
    final nativeCalls = <String>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (call) async {
          nativeCalls.add(call.method);
          if (call.method == 'getCapability') {
            return <String, Object?>{
              'schemaVersion': 1,
              'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
              'platform': 'android',
              'apiLevel': 36,
              'minimumApiLevel': 26,
              'supported': true,
              'credentialState': 'present',
              'integrityAvailable': true,
            };
          }
          if (call.method == 'createEnrollmentProof') {
            return <String, Object?>{
              'schemaVersion': 1,
              'kind': 'androidEnrollment',
              'credentialId': recoveryCredentialId,
              'installationPublicKeySpki': base64UrlEncode(
                publicKeySpki,
              ).replaceAll('=', ''),
              'androidSsaid': '0123456789abcdef',
              'possessionSignature': signature(),
              'integrityToken': 'synthetic-integrity-token',
            };
          }
          fail('Unexpected native invocation: ${call.method}');
        });
    final target = request();
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => const Duration(milliseconds: 2000),
      transport: (name, payload) async =>
          name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName
          ? challenge()
          : result(target),
    );

    await service.useCoupon(
      request: target,
      authenticatedUserId: null,
      forceEnrollmentOrRecovery: true,
    );

    expect(nativeCalls, <String>['getCapability', 'createEnrollmentProof']);
  });

  test('expired ambiguous proof is never reused', () async {
    var nowMillis = 2000;
    var issueCalls = 0;
    var nativeUseCalls = 0;
    var useCalls = 0;
    installAvailableAndroidBridge(
      onCall: (call) {
        if (call.method == 'createUseProof') nativeUseCalls += 1;
      },
    );
    final target = request();
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => Duration(milliseconds: nowMillis),
      transport: (name, payload) async {
        if (name ==
            CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
          issueCalls += 1;
          return challenge(expiresAtMillis: issueCalls == 1 ? 3000 : 121000);
        }
        useCalls += 1;
        if (useCalls == 1) {
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        }
        return result(target);
      },
    );

    await expectLater(
      service.useCoupon(request: target, authenticatedUserId: null),
      throwsA(isA<CustomerBiteSaverDeviceUseException>()),
    );
    nowMillis = 4000;
    await service.useCoupon(request: target, authenticatedUserId: null);

    expect(issueCalls, 2);
    expect(nativeUseCalls, 2);
  });

  test(
    'expiry timer releases an ambiguous proof without another call',
    () async {
      var issueCalls = 0;
      var nativeUseCalls = 0;
      var useCalls = 0;
      final timers = <_ManualTimer>[];
      installAvailableAndroidBridge(
        onCall: (call) {
          if (call.method == 'createUseProof') nativeUseCalls += 1;
        },
      );
      final target = request();
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => const Duration(milliseconds: 2000),
        expiryTimerFactory: (duration, callback) {
          expect(duration, const Duration(milliseconds: 1999));
          final timer = _ManualTimer(callback);
          timers.add(timer);
          return timer;
        },
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            issueCalls += 1;
            return challenge(expiresAtMillis: 3000);
          }
          useCalls += 1;
          if (useCalls == 1) {
            throw const CustomerBiteSaverDeviceUseTransportException(
              code: 'unavailable',
              ambiguous: true,
            );
          }
          return result(target);
        },
      );

      await expectLater(
        service.useCoupon(request: target, authenticatedUserId: null),
        throwsA(isA<CustomerBiteSaverDeviceUseException>()),
      );
      expect(timers, hasLength(1));
      timers.single.fire();

      await service.useCoupon(request: target, authenticatedUserId: null);

      expect(issueCalls, 2);
      expect(nativeUseCalls, 2);
      expect(useCalls, 2);
      expect(timers, hasLength(2));
      expect(timers.last.isActive, isFalse);
    },
  );

  test('expiry timer fences an in-flight submission', () async {
    var issueCalls = 0;
    var useCalls = 0;
    final timers = <_ManualTimer>[];
    final firstUse = Completer<Object?>();
    installAvailableAndroidBridge();
    final target = request();
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => const Duration(milliseconds: 2000),
      expiryTimerFactory: (duration, callback) {
        final timer = _ManualTimer(callback);
        timers.add(timer);
        return timer;
      },
      transport: (name, payload) async {
        if (name ==
            CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
          issueCalls += 1;
          return challenge(expiresAtMillis: 3000);
        }
        useCalls += 1;
        return useCalls == 1 ? firstUse.future : result(target);
      },
    );

    final expiredFuture = service.useCoupon(
      request: target,
      authenticatedUserId: null,
    );
    while (timers.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    timers.single.fire();
    firstUse.complete(result(target));

    await expectLater(
      expiredFuture,
      throwsA(
        isA<CustomerBiteSaverDeviceUseException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverDeviceUseFailureKind.stale,
        ),
      ),
    );
    await service.useCoupon(request: target, authenticatedUserId: null);

    expect(issueCalls, 2);
    expect(useCalls, 2);
  });

  test('late stale rejection cannot clear a newer ambiguous proof', () async {
    var issueCalls = 0;
    var nativeUseCalls = 0;
    var useCalls = 0;
    final timers = <_ManualTimer>[];
    final oldUse = Completer<Object?>();
    final currentUse = Completer<Object?>();
    installAvailableAndroidBridge(
      onCall: (call) {
        if (call.method == 'createUseProof') nativeUseCalls += 1;
      },
    );
    final target = request();
    final service = CustomerBiteSaverDeviceUseService(
      proofService: proofService(),
      elapsedClock: () => const Duration(milliseconds: 2000),
      expiryTimerFactory: (duration, callback) {
        final timer = _ManualTimer(callback);
        timers.add(timer);
        return timer;
      },
      transport: (name, payload) async {
        if (name ==
            CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
          issueCalls += 1;
          return challenge(expiresAtMillis: 3000);
        }
        useCalls += 1;
        if (useCalls == 1) return oldUse.future;
        if (useCalls == 2) return currentUse.future;
        return result(target);
      },
    );

    final oldFuture = service.useCoupon(
      request: target,
      authenticatedUserId: null,
    );
    while (timers.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    timers.single.fire();
    final newFuture = service.useCoupon(
      request: target,
      authenticatedUserId: null,
    );
    while (timers.length < 2) {
      await Future<void>.delayed(Duration.zero);
    }

    final oldExpectation = expectLater(
      oldFuture,
      throwsA(
        isA<CustomerBiteSaverDeviceUseException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverDeviceUseFailureKind.stale,
        ),
      ),
    );
    oldUse.completeError(
      const CustomerBiteSaverDeviceUseTransportException(
        code: 'permission-denied',
        ambiguous: false,
      ),
    );
    await oldExpectation;
    expect(timers.last.isActive, isTrue);

    final newExpectation = expectLater(
      newFuture,
      throwsA(
        isA<CustomerBiteSaverDeviceUseException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverDeviceUseFailureKind.ambiguous,
        ),
      ),
    );
    currentUse.completeError(
      const CustomerBiteSaverDeviceUseTransportException(
        code: 'unavailable',
        ambiguous: true,
      ),
    );
    await newExpectation;
    await service.useCoupon(request: target, authenticatedUserId: null);

    expect(issueCalls, 2);
    expect(nativeUseCalls, 2);
    expect(useCalls, 3);
    expect(timers, hasLength(2));
    expect(timers.last.isActive, isFalse);
  });

  test(
    'proof crossing its elapsed deadline is discarded before submission',
    () async {
      var nowMillis = 2000;
      var useCalls = 0;
      installAvailableAndroidBridge(
        onCall: (call) {
          if (call.method == 'createUseProof') nowMillis = 4000;
        },
      );
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => Duration(milliseconds: nowMillis),
        transport: (name, payload) async {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            return challenge(expiresAtMillis: 3000);
          }
          useCalls += 1;
          fail('An expired proof must never be submitted.');
        },
      );

      await expectLater(
        service.useCoupon(request: request(), authenticatedUserId: null),
        throwsA(
          isA<CustomerBiteSaverDeviceUseException>()
              .having(
                (error) => error.kind,
                'kind',
                CustomerBiteSaverDeviceUseFailureKind.stale,
              )
              .having(
                (error) => error.code,
                'code',
                'device-use-challenge-expired',
              ),
        ),
      );
      expect(useCalls, 0);
    },
  );

  test(
    'cancellation fences stale challenge work before native proof',
    () async {
      var nativeCalls = 0;
      installAvailableAndroidBridge(
        onCall: (call) {
          if (call.method == 'createUseProof' ||
              call.method == 'createEnrollmentProof') {
            nativeCalls += 1;
          }
        },
      );
      final target = request();
      final challengeCompleter = Completer<Object?>();
      final service = CustomerBiteSaverDeviceUseService(
        proofService: proofService(),
        elapsedClock: () => const Duration(milliseconds: 2000),
        transport: (name, payload) {
          if (name ==
              CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
            return challengeCompleter.future;
          }
          fail('Use must not run after cancellation.');
        },
      );

      final future = service.useCoupon(
        request: target,
        authenticatedUserId: null,
      );
      service.cancel();
      challengeCompleter.complete(challenge());

      await expectLater(
        future,
        throwsA(
          isA<CustomerBiteSaverDeviceUseException>().having(
            (error) => error.kind,
            'kind',
            CustomerBiteSaverDeviceUseFailureKind.stale,
          ),
        ),
      );
      expect(nativeCalls, 0);
    },
  );

  test('foundation remains unwired from initialization and coordinators', () {
    for (final path in <String>[
      'lib/main.dart',
      'lib/services/customer_bitesaver_search_coordinator.dart',
      'lib/services/customer_bitesaver_saved_coordinator.dart',
    ]) {
      final source = File(path).readAsStringSync();
      expect(
        source,
        isNot(contains('customer_bitesaver_device_proof_service')),
      );
      expect(source, isNot(contains('CustomerBiteSaverDeviceUseService')));
    }
  });
}
