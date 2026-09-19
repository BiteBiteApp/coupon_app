import 'dart:convert';

import 'package:coupon_app/models/customer_bitesaver_device_usage.dart';
import 'package:coupon_app/services/customer_bitesaver_device_proof_service.dart';
import 'package:coupon_app/services/customer_bitesaver_device_use_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Exercises the production device-use sequence with an enrolled native mock.
final class CustomerBiteSaverDeviceUseFixture {
  CustomerBiteSaverDeviceUseFixture({
    this.authenticatedUserId = 'owner-a',
    this.evaluatedAtMillis = 1_789_560_000_000,
  }) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (call) async {
          if (call.method == 'getTimeContext') {
            timeContextReads += 1;
            return {'timeZone': timeZone, 'utcOffsetMinutes': utcOffsetMinutes};
          }
          await _stage(call.method == 'getCapability' ? 'capability' : 'proof');
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
          if (call.method == 'createUseProof') {
            return <String, Object?>{
              'schemaVersion': 1,
              'kind': 'androidUse',
              'credentialId':
                  'bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI',
              'possessionSignature': base64UrlEncode(<int>[
                0x30,
                0x44,
                0x02,
                0x20,
                ...List<int>.filled(32, 1),
                0x02,
                0x20,
                ...List<int>.filled(32, 2),
              ]).replaceAll('=', ''),
            };
          }
          throw StateError('Unexpected native method: ${call.method}');
        });
    proofService = CustomerBiteSaverDeviceProofService(
      channel: _channel,
      platformResolver: () => CustomerBiteSaverDevicePlatform.android,
    );
    transport = (name, payload) async {
      requests.add(payload);
      if (payload['operation'] == 'admitChallenge') {
        await _stage('admission');
        return <String, Object?>{
          'schemaVersion': 1,
          'admissionHandle': 'bsda_${'a' * 43}',
          'permit': _challengeBytes,
          'expiresAtMillis': evaluatedAtMillis + 120000,
        };
      }
      final request = payload['request']! as Map<String, Object?>;
      if (name ==
          CustomerBiteSaverDeviceProofContract.issueChallengeCallableName) {
        await _stage('challenge');
        final origin = request['origin']! as Map<String, Object?>;
        return <String, Object?>{
          'schemaVersion': 1,
          'protocolVersion': 'bitestar.bitesaver-device-proof.v1',
          'challengeId': 'bsdc_$_challengeBytes',
          'platform': 'android',
          'purpose': 'combinedCouponUse',
          'requestFingerprint': 'a' * 64,
          'authenticatedUserId': authenticatedUserId,
          'origin': origin['kind'],
          'logicalRequestId': request['logicalRequestId'],
          'issuedAtMillis': evaluatedAtMillis,
          'validFromMillis': evaluatedAtMillis,
          'expiresAtMillis': evaluatedAtMillis + 120000,
          'challengeBytes': _challengeBytes,
        };
      }
      if (name != CustomerBiteSaverDeviceProofContract.useCouponCallableName) {
        throw StateError('Unexpected callable: $name');
      }
      submissions.add(payload);
      await _stage('use');
      final timed = status == 'started' || status == 'active';
      return <String, Object?>{
        'schemaVersion': 1,
        'restaurantId': request['restaurantId'],
        'offerId': request['offerId'],
        'status': status,
        'reason': status == 'denied' || status == 'active'
            ? 'used'
            : 'available',
        'redemptionId': timed ? 'bsrd_${'D' * 43}' : null,
        'timerStartedAtMillis': timed ? evaluatedAtMillis : null,
        'timerExpiresAtMillis': timed ? evaluatedAtMillis + 300000 : null,
        'evaluatedAtMillis': evaluatedAtMillis,
      };
    };
    service = CustomerBiteSaverDeviceUseService(
      proofService: proofService,
      elapsedClock: () => Duration.zero,
      transport: transport,
    );
  }

  static const _channel = MethodChannel('test/bitesaver-device-use-fixture');
  static const _challengeBytes = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  final String? authenticatedUserId;
  final int evaluatedAtMillis;
  late final CustomerBiteSaverDeviceUseService service;
  late final CustomerBiteSaverDeviceProofService proofService;
  late final CustomerBiteSaverDeviceUseTransport transport;
  String timeZone = 'America/New_York';
  int utcOffsetMinutes = -240;
  int timeContextReads = 0;
  String status = 'started';
  Future<void> Function(String)? beforeStage;
  final List<String> stages = <String>[];
  final List<Map<String, Object?>> requests = <Map<String, Object?>>[];
  final List<Map<String, Object?>> submissions = <Map<String, Object?>>[];

  Future<void> _stage(String name) async {
    stages.add(name);
    await beforeStage?.call(name);
  }

  void dispose() {
    service.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
  }
}
