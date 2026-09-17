import 'dart:convert';
import 'dart:typed_data';

import 'package:coupon_app/models/customer_bitesaver_device_usage.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

const String _challengeId = 'bsdc_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _challengeBytes = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _credentialId = 'bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI';

Map<String, Object?> challengeJson({
  String platform = 'android',
  String? authenticatedUserId,
}) => <String, Object?>{
  'schemaVersion': 1,
  'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
  'challengeId': _challengeId,
  'platform': platform,
  'purpose': 'combinedCouponUse',
  'requestFingerprint':
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  'authenticatedUserId': authenticatedUserId,
  'origin': 'discovery',
  'logicalRequestId': 'device-use-request-0001',
  'issuedAtMillis': 1789617600000,
  'validFromMillis': 1789617600000,
  'expiresAtMillis': 1789617720000,
  'challengeBytes': _challengeBytes,
};

void main() {
  group('canonical device-proof transcript', () {
    test('matches the frozen cross-language Android enrollment vector', () {
      final publicKeyHash = Uint8List.fromList(
        List<int>.generate(32, (index) => 0x20 + index),
      );
      expect(
        CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
          platform: CustomerBiteSaverDevicePlatform.android,
          publicKeySha256: publicKeyHash,
        ),
        _credentialId,
      );

      final transcript = CustomerBiteSaverDeviceProofTranscript(
        proofKind: CustomerBiteSaverDeviceProofKind.androidEnrollment,
        platform: CustomerBiteSaverDevicePlatform.android,
        challengeId: _challengeId,
        challengeBytes: Uint8List.fromList(
          List<int>.generate(32, (index) => index),
        ),
        requestFingerprint:
            '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
        authenticatedUserId: null,
        origin: CustomerBiteSaverDeviceUseOrigin.discovery,
        logicalRequestId: 'device-use-request-0001',
        issuedAtMillis: 1789617600000,
        validFromMillis: 1789617600000,
        expiresAtMillis: 1789617720000,
        credentialId: _credentialId,
        androidInstallationPublicKeySha256: publicKeyHash,
        androidSsaidUtf8: Uint8List.fromList(utf8.encode('0123456789abcdef')),
        iosRecoveryPublicKeyX963: null,
        iosAppAttestKeyId: null,
      );

      expect(transcript.encode(), hasLength(441));
      expect(
        transcript.sha256Hex,
        '958ae8084cbc061695525386fbbcd3eabbdfd566ab11fc422e72381992cb5b17',
      );
      expect(
        transcript.sha256Base64Url,
        'lYroCEy8BhaVUlOG-7zT6rvf1WarEfxCLnI4GZLLWxc',
      );
    });

    test('matches the frozen iOS assertion-envelope vector', () {
      Uint8List decodeHex(String value) => Uint8List.fromList(
        List<int>.generate(
          value.length ~/ 2,
          (index) =>
              int.parse(value.substring(index * 2, index * 2 + 2), radix: 16),
        ),
      );

      final digest = CustomerBiteSaverDeviceProofTranscript.iosAssertionClientDataHash(
        transcriptSha256: decodeHex(
          '958ae8084cbc061695525386fbbcd3eabbdfd566ab11fc422e72381992cb5b17',
        ),
        possessionSignatureDer: decodeHex(
          '304402200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
          '02202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40',
        ),
      );

      expect(
        digest.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join(),
        '956ea8ac7ede8f18c83f9c8e81105d9d3a72b870ba5210cad2e28942b0041329',
      );
      expect(
        base64UrlEncode(digest).replaceAll('=', ''),
        'lW6orH7ejxjIP5yOgRBdnTpyuHC6UhDK0uKJQrAEEyk',
      );
    });

    test('rejects proof-kind field combinations that can be confused', () {
      expect(
        () => CustomerBiteSaverDeviceProofTranscript(
          proofKind: CustomerBiteSaverDeviceProofKind.androidUse,
          platform: CustomerBiteSaverDevicePlatform.android,
          challengeId: _challengeId,
          challengeBytes: Uint8List(32),
          requestFingerprint: '0' * 64,
          authenticatedUserId: null,
          origin: CustomerBiteSaverDeviceUseOrigin.saved,
          logicalRequestId: 'device-use-request-0001',
          issuedAtMillis: 1,
          validFromMillis: 1,
          expiresAtMillis: 2,
          credentialId: _credentialId,
          androidInstallationPublicKeySha256: Uint8List(32),
          androidSsaidUtf8: Uint8List.fromList(utf8.encode('raw-id-canary')),
          iosRecoveryPublicKeyX963: null,
          iosAppAttestKeyId: null,
        ),
        throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
      );
    });

    test('rejects noncanonical transcript bindings independently', () {
      final challengeBytes = Uint8List.fromList(
        List<int>.generate(32, (index) => index),
      );
      final publicKeyHash = Uint8List.fromList(
        List<int>.generate(32, (index) => 0x20 + index),
      );

      CustomerBiteSaverDeviceProofTranscript androidTranscript({
        String challengeId = _challengeId,
        int expiresAtMillis = 1789617720000,
        String credentialId = _credentialId,
        String ssaid = '0123456789abcdef',
      }) => CustomerBiteSaverDeviceProofTranscript(
        proofKind: CustomerBiteSaverDeviceProofKind.androidEnrollment,
        platform: CustomerBiteSaverDevicePlatform.android,
        challengeId: challengeId,
        challengeBytes: challengeBytes,
        requestFingerprint: '0' * 64,
        authenticatedUserId: null,
        origin: CustomerBiteSaverDeviceUseOrigin.discovery,
        logicalRequestId: 'device-use-request-0001',
        issuedAtMillis: 1789617600000,
        validFromMillis: 1789617600000,
        expiresAtMillis: expiresAtMillis,
        credentialId: credentialId,
        androidInstallationPublicKeySha256: publicKeyHash,
        androidSsaidUtf8: Uint8List.fromList(utf8.encode(ssaid)),
        iosRecoveryPublicKeyX963: null,
        iosAppAttestKeyId: null,
      );

      for (final factory in <void Function()>[
        () => androidTranscript(challengeId: 'bsdc_${'A' * 43}'),
        () => androidTranscript(expiresAtMillis: 1789617720001),
        () => androidTranscript(ssaid: '0123456789abcdeG'),
        () => androidTranscript(credentialId: 'bsic_${'A' * 43}'),
      ]) {
        expect(
          factory,
          throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
        );
      }

      final recoveryKey = Uint8List.fromList(<int>[
        0x04,
        ...List<int>.generate(64, (index) => index + 1),
      ]);
      final recoveryHash = Uint8List.fromList(
        sha256.convert(recoveryKey).bytes,
      );
      expect(
        () => CustomerBiteSaverDeviceProofTranscript(
          proofKind: CustomerBiteSaverDeviceProofKind.iosEnrollment,
          platform: CustomerBiteSaverDevicePlatform.ios,
          challengeId: _challengeId,
          challengeBytes: challengeBytes,
          requestFingerprint: '0' * 64,
          authenticatedUserId: null,
          origin: CustomerBiteSaverDeviceUseOrigin.discovery,
          logicalRequestId: 'device-use-request-0001',
          issuedAtMillis: 1789617600000,
          validFromMillis: 1789617600000,
          expiresAtMillis: 1789617720000,
          credentialId:
              CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
                platform: CustomerBiteSaverDevicePlatform.ios,
                publicKeySha256: recoveryHash,
              ),
          androidInstallationPublicKeySha256: null,
          androidSsaidUtf8: null,
          iosRecoveryPublicKeyX963: recoveryKey,
          iosAppAttestKeyId: 'AQ',
        ),
        throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
      );
    });
  });

  group('strict device-proof codecs', () {
    test(
      'local lifetime subtracts request elapsed and never changes server times',
      () {
        var elapsed = const Duration(seconds: 12);
        final original = challengeJson();
        final challenge = CustomerBiteSaverDeviceChallenge.fromJson(
          original,
          requestStartedAtElapsed: const Duration(seconds: 10),
          elapsedClock: () => elapsed,
        );

        expect(
          challenge.remainingLocalLifetime,
          const Duration(milliseconds: 117999),
        );
        expect(challenge.toNativeArguments(), original);
        elapsed += const Duration(milliseconds: 117998);
        expect(challenge.isLocallyUsable, isTrue);
        elapsed += const Duration(milliseconds: 1);
        expect(challenge.isLocallyUsable, isFalse);
        expect(challenge.remainingLocalLifetime, Duration.zero);
        expect(challenge.toNativeArguments(), original);
      },
    );

    test('response at or beyond its elapsed budget is already unusable', () {
      for (final elapsed in <Duration>[
        const Duration(milliseconds: 119999),
        const Duration(seconds: 120),
        const Duration(days: 1),
      ]) {
        final challenge = CustomerBiteSaverDeviceChallenge.fromJson(
          challengeJson(),
          requestStartedAtElapsed: Duration.zero,
          elapsedClock: () => elapsed,
        );
        expect(challenge.isLocallyUsable, isFalse);
      }
    });

    test(
      'invalid elapsed samples fail closed without extending a challenge',
      () {
        expect(
          () => CustomerBiteSaverDeviceChallenge.fromJson(
            challengeJson(),
            requestStartedAtElapsed: const Duration(seconds: 1),
            elapsedClock: () => Duration.zero,
          ),
          throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
        );
        var elapsed = const Duration(seconds: 2);
        final challenge = CustomerBiteSaverDeviceChallenge.fromJson(
          challengeJson(),
          requestStartedAtElapsed: Duration.zero,
          elapsedClock: () => elapsed,
        );
        elapsed = const Duration(seconds: 1);
        expect(challenge.isLocallyUsable, isFalse);
      },
    );

    test('parses a bounded challenge and emits exact native arguments', () {
      final challenge = CustomerBiteSaverDeviceChallenge.fromJson(
        challengeJson(),
        requestStartedAtElapsed: Duration.zero,
        elapsedClock: () => Duration.zero,
      );

      expect(challenge.platform, CustomerBiteSaverDevicePlatform.android);
      expect(challenge.challengeBytes, hasLength(32));
      expect(challenge.isLocallyUsable, isTrue);
      expect(
        challenge.remainingLocalLifetime,
        const Duration(milliseconds: 119999),
      );
      expect(challenge.toNativeArguments().keys, <String>{
        'schemaVersion',
        'protocolVersion',
        'platform',
        'purpose',
        'challengeId',
        'challengeBytes',
        'requestFingerprint',
        'authenticatedUserId',
        'origin',
        'logicalRequestId',
        'issuedAtMillis',
        'validFromMillis',
        'expiresAtMillis',
      });
    });

    test('rejects unknown fields, padded IDs, malformed bytes, and expiry', () {
      final unknown = <String, Object?>{...challengeJson(), 'unexpected': true};
      final paddedUid = <String, Object?>{
        ...challengeJson(),
        'authenticatedUserId': ' user ',
      };
      final paddedBytes = <String, Object?>{
        ...challengeJson(),
        'challengeBytes': '$_challengeBytes=',
      };
      final overlongLifetime = <String, Object?>{
        ...challengeJson(),
        'expiresAtMillis': 1789617720001,
      };
      final mismatchedChallengeId = <String, Object?>{
        ...challengeJson(),
        'challengeId': 'bsdc_${'A' * 43}',
      };

      for (final value in <Object?>[
        unknown,
        paddedUid,
        paddedBytes,
        overlongLifetime,
        mismatchedChallengeId,
      ]) {
        expect(
          () => CustomerBiteSaverDeviceChallenge.fromJson(
            value,
            requestStartedAtElapsed: Duration.zero,
            elapsedClock: () => Duration.zero,
          ),
          throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
        );
      }
    });

    test(
      'accepts internal UID spaces but requires a 32-byte App Attest key ID',
      () {
        expect(
          CustomerBiteSaverDeviceChallenge.fromJson(
            challengeJson(authenticatedUserId: 'customer user'),
            requestStartedAtElapsed: Duration.zero,
            elapsedClock: () => Duration.zero,
          ).authenticatedUserId,
          'customer user',
        );

        final signature = base64UrlEncode(<int>[
          0x30,
          0x44,
          0x02,
          0x20,
          ...List<int>.filled(32, 1),
          0x02,
          0x20,
          ...List<int>.filled(32, 2),
        ]).replaceAll('=', '');
        final shortKeyId = base64UrlEncode(
          List<int>.filled(16, 2),
        ).replaceAll('=', '');
        final recoveryKeyBytes = <int>[0x04, ...List<int>.filled(64, 3)];
        final recoveryKey = base64UrlEncode(
          recoveryKeyBytes,
        ).replaceAll('=', '');
        final iosCredentialId =
            CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
              platform: CustomerBiteSaverDevicePlatform.ios,
              publicKeySha256: Uint8List.fromList(
                sha256.convert(recoveryKeyBytes).bytes,
              ),
            );
        expect(
          () => CustomerBiteSaverDeviceProof.fromNativeResult(<String, Object?>{
            'schemaVersion': 1,
            'kind': 'iosEnrollment',
            'credentialId': iosCredentialId,
            'recoveryPublicKeyX963': recoveryKey,
            'appAttestKeyId': shortKeyId,
            'possessionSignature': signature,
            'attestationObject': 'AQ',
          }),
          throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
        );
      },
    );

    test('accepts only exact Android proof unions', () {
      final signature = base64UrlEncode(<int>[
        0x30,
        0x44,
        0x02,
        0x20,
        ...List<int>.filled(32, 1),
        0x02,
        0x20,
        ...List<int>.filled(32, 2),
      ]).replaceAll('=', '');
      final spkiBytes = List<int>.generate(91, (index) => index);
      final spki = base64UrlEncode(spkiBytes).replaceAll('=', '');
      final credentialId =
          CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
            platform: CustomerBiteSaverDevicePlatform.android,
            publicKeySha256: Uint8List.fromList(
              sha256.convert(spkiBytes).bytes,
            ),
          );
      final proof =
          CustomerBiteSaverDeviceProof.fromNativeResult(<String, Object?>{
            'schemaVersion': 1,
            'kind': 'androidEnrollment',
            'credentialId': credentialId,
            'installationPublicKeySpki': spki,
            'androidSsaid': '0123456789abcdef',
            'possessionSignature': signature,
            'integrityToken': 'synthetic-token',
          });

      expect(proof.kind, CustomerBiteSaverDeviceProofKind.androidEnrollment);
      expect(proof.toJson(), isNot(contains('requestFingerprint')));
      expect(
        () => CustomerBiteSaverDeviceProof.fromNativeResult(<String, Object?>{
          ...proof.toJson(),
          'transcriptHash': 'leak',
        }),
        throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
      );
      expect(
        () => CustomerBiteSaverDeviceProof.fromNativeResult(<String, Object?>{
          ...proof.toJson(),
          'installationPublicKeySpki': base64UrlEncode(
            List<int>.filled(161, 1),
          ).replaceAll('=', ''),
        }),
        throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
      );
    });

    test('rejects malformed result state combinations', () {
      final valid = <String, Object?>{
        'schemaVersion': 1,
        'restaurantId': 'bsr_${'r' * 43}',
        'offerId': 'bso_${'o' * 43}',
        'status': 'denied',
        'reason': 'used',
        'redemptionId': null,
        'timerStartedAtMillis': null,
        'timerExpiresAtMillis': null,
        'evaluatedAtMillis': 1789617600100,
      };
      expect(
        CustomerBiteSaverDeviceUseResult.fromJson(valid).status,
        CustomerBiteSaverDeviceUseStatus.denied,
      );
      expect(
        () => CustomerBiteSaverDeviceUseResult.fromJson(<String, Object?>{
          ...valid,
          'reason': 'available',
        }),
        throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
      );
      expect(
        () => CustomerBiteSaverDeviceUseResult.fromJson(<String, Object?>{
          ...valid,
          'status': 'active',
          'reason': 'available',
          'redemptionId': 'bsrd_${'d' * 43}',
          'timerStartedAtMillis': 1000,
          'timerExpiresAtMillis': 2000,
        }),
        throwsA(isA<CustomerBiteSaverDeviceProtocolException>()),
      );
    });
  });
}
