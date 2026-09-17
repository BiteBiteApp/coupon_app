import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../models/customer_bitesaver_device_usage.dart';

typedef CustomerBiteSaverDevicePlatformResolver =
    CustomerBiteSaverDevicePlatform? Function();

enum CustomerBiteSaverDeviceProofFailureKind {
  unsupported,
  unavailable,
  missingCredential,
  corruptCredential,
  invalidProtocol,
  native,
}

final class CustomerBiteSaverDeviceProofException implements Exception {
  const CustomerBiteSaverDeviceProofException({
    required this.kind,
    required this.code,
    this.cause,
  });

  final CustomerBiteSaverDeviceProofFailureKind kind;
  final String code;
  final Object? cause;

  @override
  String toString() => 'CustomerBiteSaverDeviceProofException($code)';
}

final class CustomerBiteSaverDeviceProofService {
  CustomerBiteSaverDeviceProofService({
    MethodChannel? channel,
    CustomerBiteSaverDevicePlatformResolver? platformResolver,
    this.androidCloudProjectNumber = 253983587346,
  }) : _channel =
           channel ??
           const MethodChannel(
             CustomerBiteSaverDeviceProofContract.channelName,
           ),
       _platformResolver = platformResolver ?? _defaultPlatform {
    if (androidCloudProjectNumber <= 0) {
      throw ArgumentError.value(
        androidCloudProjectNumber,
        'androidCloudProjectNumber',
      );
    }
  }

  static const String capabilityMethod = 'getCapability';
  static const String enrollmentMethod = 'createEnrollmentProof';
  static const String useMethod = 'createUseProof';
  static const String resetMethod = 'resetCredential';

  final MethodChannel _channel;
  final CustomerBiteSaverDevicePlatformResolver _platformResolver;
  final int androidCloudProjectNumber;

  CustomerBiteSaverDevicePlatform get platform => _requiredPlatform;

  static CustomerBiteSaverDevicePlatform? _defaultPlatform() {
    if (kIsWeb) return null;
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => CustomerBiteSaverDevicePlatform.android,
      TargetPlatform.iOS => CustomerBiteSaverDevicePlatform.ios,
      _ => null,
    };
  }

  CustomerBiteSaverDevicePlatform get _requiredPlatform {
    final platform = _platformResolver();
    if (platform == null) {
      throw const CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.unsupported,
        code: 'device-proof-unsupported-platform',
      );
    }
    return platform;
  }

  Future<CustomerBiteSaverDeviceCapability> getCapability() async {
    final expectedPlatform = _requiredPlatform;
    final value = await _invoke(capabilityMethod, null);
    try {
      final capability = CustomerBiteSaverDeviceCapability.fromJson(value);
      if (capability.platform != expectedPlatform) {
        throw const CustomerBiteSaverDeviceProtocolException();
      }
      return capability;
    } on CustomerBiteSaverDeviceProtocolException catch (error) {
      throw CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.invalidProtocol,
        code: 'device-proof-invalid-native-response',
        cause: error,
      );
    }
  }

  Future<CustomerBiteSaverDeviceProof> createEnrollmentProof(
    CustomerBiteSaverDeviceChallenge challenge,
  ) async {
    final platform = _corroborateChallenge(challenge);
    final arguments = challenge.toNativeArguments();
    if (platform == CustomerBiteSaverDevicePlatform.android) {
      arguments['cloudProjectNumber'] = androidCloudProjectNumber;
    }
    final value = await _invoke(enrollmentMethod, arguments);
    return _parseProof(
      value,
      expectedKind: platform == CustomerBiteSaverDevicePlatform.android
          ? CustomerBiteSaverDeviceProofKind.androidEnrollment
          : CustomerBiteSaverDeviceProofKind.iosEnrollment,
    );
  }

  Future<CustomerBiteSaverDeviceProof> createUseProof(
    CustomerBiteSaverDeviceChallenge challenge,
  ) async {
    final platform = _corroborateChallenge(challenge);
    final value = await _invoke(useMethod, challenge.toNativeArguments());
    return _parseProof(
      value,
      expectedKind: platform == CustomerBiteSaverDevicePlatform.android
          ? CustomerBiteSaverDeviceProofKind.androidUse
          : CustomerBiteSaverDeviceProofKind.iosUse,
    );
  }

  Future<void> resetCredentialForServerDirectedReenrollment() async {
    _requiredPlatform;
    final value = await _invoke(resetMethod, <String, Object?>{
      'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
      'protocolVersion': CustomerBiteSaverDeviceProofContract.protocolVersion,
      'platform': _requiredPlatform.name,
      'reason': 'serverDirectedReenrollment',
    });
    try {
      final data = Map<String, Object?>.from(value! as Map);
      if (data.length != 2 ||
          data['schemaVersion'] !=
              CustomerBiteSaverDeviceProofContract.schemaVersion ||
          data['reset'] != true) {
        throw const CustomerBiteSaverDeviceProtocolException();
      }
    } catch (error) {
      throw CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.invalidProtocol,
        code: 'device-proof-invalid-native-response',
        cause: error,
      );
    }
  }

  CustomerBiteSaverDevicePlatform _corroborateChallenge(
    CustomerBiteSaverDeviceChallenge challenge,
  ) {
    final platform = _requiredPlatform;
    if (challenge.platform != platform) {
      throw const CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.invalidProtocol,
        code: 'device-proof-platform-mismatch',
      );
    }
    if (!challenge.isLocallyUsable) {
      throw const CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.invalidProtocol,
        code: 'device-proof-challenge-expired',
      );
    }
    return platform;
  }

  CustomerBiteSaverDeviceProof _parseProof(
    Object? value, {
    required CustomerBiteSaverDeviceProofKind expectedKind,
  }) {
    try {
      final proof = CustomerBiteSaverDeviceProof.fromNativeResult(value);
      if (proof.kind != expectedKind) {
        throw const CustomerBiteSaverDeviceProtocolException();
      }
      return proof;
    } on CustomerBiteSaverDeviceProtocolException catch (error) {
      throw CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.invalidProtocol,
        code: 'device-proof-invalid-native-response',
        cause: error,
      );
    }
  }

  Future<Object?> _invoke(String method, Object? arguments) async {
    try {
      return await _channel.invokeMethod<Object?>(method, arguments);
    } on MissingPluginException catch (error) {
      throw CustomerBiteSaverDeviceProofException(
        kind: CustomerBiteSaverDeviceProofFailureKind.unsupported,
        code: 'device-proof-native-bridge-unavailable',
        cause: error,
      );
    } on PlatformException catch (error) {
      throw CustomerBiteSaverDeviceProofException(
        kind: _failureKind(error.code),
        code: _sanitizedNativeCode(error.code),
        cause: error,
      );
    }
  }

  static CustomerBiteSaverDeviceProofFailureKind _failureKind(String code) {
    if (code == 'unsupported' || code.startsWith('unsupported-')) {
      return CustomerBiteSaverDeviceProofFailureKind.unsupported;
    }
    if (code == 'missing-credential') {
      return CustomerBiteSaverDeviceProofFailureKind.missingCredential;
    }
    if (code == 'corrupt-credential') {
      return CustomerBiteSaverDeviceProofFailureKind.corruptCredential;
    }
    if (code == 'provider-unavailable') {
      return CustomerBiteSaverDeviceProofFailureKind.unavailable;
    }
    if (code == 'operation-in-progress' || code == 'operation-superseded') {
      return CustomerBiteSaverDeviceProofFailureKind.unavailable;
    }
    return CustomerBiteSaverDeviceProofFailureKind.native;
  }

  static String _sanitizedNativeCode(String value) {
    if (RegExp(r'^[a-z0-9-]{1,64}$').hasMatch(value)) {
      return 'device-proof-native-$value';
    }
    return 'device-proof-native-failure';
  }
}
