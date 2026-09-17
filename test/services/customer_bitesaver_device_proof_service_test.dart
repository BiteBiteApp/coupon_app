import 'dart:convert';
import 'package:coupon_app/models/customer_bitesaver_device_usage.dart';
import 'package:coupon_app/services/customer_bitesaver_device_proof_service.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const String _channelName = 'com.colesmart.bitestar/bitesaver_device_proof';
const String _challengeId = 'bsdc_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _challengeBytes = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _credentialId = 'bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI';

CustomerBiteSaverDeviceChallenge challenge({
  String platform = 'android',
  int issuedAtMillis = 1000,
  CustomerBiteSaverDeviceElapsedClock? elapsedClock,
}) => CustomerBiteSaverDeviceChallenge.fromJson(
  <String, Object?>{
    'schemaVersion': 1,
    'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
    'challengeId': _challengeId,
    'platform': platform,
    'purpose': 'combinedCouponUse',
    'requestFingerprint': 'a' * 64,
    'authenticatedUserId': null,
    'origin': 'saved',
    'logicalRequestId': 'device-use-request-0001',
    'issuedAtMillis': issuedAtMillis,
    'validFromMillis': issuedAtMillis,
    'expiresAtMillis': issuedAtMillis + 120000,
    'challengeBytes': _challengeBytes,
  },
  requestStartedAtElapsed: Duration.zero,
  elapsedClock: elapsedClock ?? () => Duration.zero,
);

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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel(_channelName);

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test(
    'direct proof honors the original elapsed deadline on skewed phones',
    () async {
      var nativeCalls = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            nativeCalls += 1;
            return <String, Object?>{
              'schemaVersion': 1,
              'kind': 'androidUse',
              'credentialId': _credentialId,
              'possessionSignature': signature(),
            };
          });
      final service = CustomerBiteSaverDeviceProofService(
        channel: channel,
        platformResolver: () => CustomerBiteSaverDevicePlatform.android,
      );
      for (final serverOffset in <int>[5000, -86400000, 0]) {
        var elapsed = Duration.zero;
        final accepted = challenge(
          issuedAtMillis: DateTime.now().millisecondsSinceEpoch + serverOffset,
          elapsedClock: () => elapsed,
        );
        await service.createUseProof(accepted);
        elapsed = const Duration(milliseconds: 119999);
        await expectLater(
          service.createUseProof(accepted),
          throwsA(
            isA<CustomerBiteSaverDeviceProofException>().having(
              (error) => error.code,
              'code',
              'device-proof-challenge-expired',
            ),
          ),
        );
      }
      expect(nativeCalls, 3);
    },
  );

  test(
    'capability is passive and API 24/25 remains typed unsupported',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
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
      final service = CustomerBiteSaverDeviceProofService(
        channel: channel,
        platformResolver: () => CustomerBiteSaverDevicePlatform.android,
      );

      final capability = await service.getCapability();

      expect(capability.supported, isFalse);
      expect(capability.androidApiLevel, 25);
      expect(calls, hasLength(1));
      expect(calls.single.method, 'getCapability');
      expect(calls.single.arguments, isNull);
    },
  );

  test(
    'ordinary Android proof uses exact challenge args and no SSAID',
    () async {
      late MethodCall invocation;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            invocation = call;
            return <String, Object?>{
              'schemaVersion': 1,
              'kind': 'androidUse',
              'credentialId': _credentialId,
              'possessionSignature': signature(),
            };
          });
      final service = CustomerBiteSaverDeviceProofService(
        channel: channel,
        platformResolver: () => CustomerBiteSaverDevicePlatform.android,
      );

      final proof = await service.createUseProof(challenge());

      expect(proof.kind, CustomerBiteSaverDeviceProofKind.androidUse);
      expect(invocation.method, 'createUseProof');
      final arguments = Map<String, Object?>.from(invocation.arguments as Map);
      expect(arguments, isNot(contains('androidSsaid')));
      expect(arguments, isNot(contains('credentialId')));
      expect(arguments.keys, hasLength(13));
    },
  );

  test(
    'Android enrollment adds only the public Cloud project number',
    () async {
      late MethodCall invocation;
      final publicKeySpki = List<int>.generate(91, (index) => index);
      final credentialId =
          CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
            platform: CustomerBiteSaverDevicePlatform.android,
            publicKeySha256: Uint8List.fromList(
              sha256.convert(publicKeySpki).bytes,
            ),
          );
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            invocation = call;
            return <String, Object?>{
              'schemaVersion': 1,
              'kind': 'androidEnrollment',
              'credentialId': credentialId,
              'installationPublicKeySpki': base64UrlEncode(
                publicKeySpki,
              ).replaceAll('=', ''),
              'androidSsaid': '0123456789abcdef',
              'possessionSignature': signature(),
              'integrityToken': 'synthetic-integrity-token',
            };
          });
      final service = CustomerBiteSaverDeviceProofService(
        channel: channel,
        platformResolver: () => CustomerBiteSaverDevicePlatform.android,
      );

      await service.createEnrollmentProof(challenge());

      expect(invocation.method, 'createEnrollmentProof');
      final arguments = Map<String, Object?>.from(invocation.arguments as Map);
      expect(arguments['cloudProjectNumber'], 253983587346);
      expect(arguments.keys, hasLength(14));
    },
  );

  test('unknown native fields and platform mismatches fail closed', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          return <String, Object?>{
            'schemaVersion': 1,
            'kind': 'androidUse',
            'credentialId': _credentialId,
            'possessionSignature': signature(),
            'privateDeviceRef': 'privacy-canary',
          };
        });
    final service = CustomerBiteSaverDeviceProofService(
      channel: channel,
      platformResolver: () => CustomerBiteSaverDevicePlatform.android,
    );

    await expectLater(
      service.createUseProof(challenge()),
      throwsA(
        isA<CustomerBiteSaverDeviceProofException>().having(
          (error) => error.code,
          'code',
          'device-proof-invalid-native-response',
        ),
      ),
    );
    await expectLater(
      service.createUseProof(challenge(platform: 'ios')),
      throwsA(
        isA<CustomerBiteSaverDeviceProofException>().having(
          (error) => error.code,
          'code',
          'device-proof-platform-mismatch',
        ),
      ),
    );
  });

  test('unsupported desktop/web path never invokes the channel', () async {
    var invoked = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          invoked = true;
          return null;
        });
    final service = CustomerBiteSaverDeviceProofService(
      channel: channel,
      platformResolver: () => null,
    );

    await expectLater(
      service.getCapability(),
      throwsA(
        isA<CustomerBiteSaverDeviceProofException>().having(
          (error) => error.kind,
          'kind',
          CustomerBiteSaverDeviceProofFailureKind.unsupported,
        ),
      ),
    );
    expect(invoked, isFalse);
  });

  test(
    'native operation races are typed as transient unavailability',
    () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            throw PlatformException(code: 'operation-in-progress');
          });
      final service = CustomerBiteSaverDeviceProofService(
        channel: channel,
        platformResolver: () => CustomerBiteSaverDevicePlatform.ios,
      );

      await expectLater(
        service.getCapability(),
        throwsA(
          isA<CustomerBiteSaverDeviceProofException>()
              .having(
                (error) => error.kind,
                'kind',
                CustomerBiteSaverDeviceProofFailureKind.unavailable,
              )
              .having(
                (error) => error.code,
                'code',
                'device-proof-native-operation-in-progress',
              ),
        ),
      );
    },
  );
}
