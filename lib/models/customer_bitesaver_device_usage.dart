import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'customer_bitesaver_favorite.dart';
import 'customer_bitesaver_search.dart';

const int _maximumSafeJsonInteger = 9007199254740991;

/// A process-local monotonic reading, never a Unix/phone wall timestamp.
typedef CustomerBiteSaverDeviceElapsedClock = Duration Function();

final class CustomerBiteSaverDeviceProtocolException extends FormatException {
  const CustomerBiteSaverDeviceProtocolException([
    this.code = 'invalid-device-proof-protocol',
  ]) : super('The BiteSaver device-proof message is invalid.');

  final String code;
}

abstract final class CustomerBiteSaverDeviceProofContract {
  static final Stopwatch _elapsedClock = Stopwatch()..start();

  static Duration monotonicElapsed() => _elapsedClock.elapsed;

  static const int schemaVersion = 1;
  static const String protocolVersion = 'bitestar.bitesaver-device-proof.v1';
  static const String purpose = 'combinedCouponUse';
  static const String channelName =
      'com.colesmart.bitestar/bitesaver_device_proof';
  static const String issueChallengeCallableName =
      'issueCustomerBiteSaverDeviceUseChallenge';
  static const String useCouponCallableName = 'useCustomerBiteSaverCoupon';
  static const int challengeByteLength = 32;
  static const int requestFingerprintByteLength = 32;
  static const int challengeLifetimeMilliseconds = 120000;
  static const String transcriptHeader =
      'BiteStar/BiteSaver/DeviceProofTranscript/v1\x00';
  static const String credentialIdHeader =
      'BiteStar/BiteSaver/CredentialId/v1\x00';
  static const String assertionHeader =
      'BiteStar/BiteSaver/DeviceProofAssertion/v1\x00';

  static bool isValidAuthenticatedUserId(String value) {
    if (!_wellFormedUtf16(value) ||
        value.isEmpty ||
        utf8.encode(value).length > 128 ||
        value.trim() != value ||
        value.contains('/') ||
        value == '.' ||
        value == '..' ||
        RegExp(r'^__.*__$').hasMatch(value)) {
      return false;
    }
    return !value.runes.any((rune) => rune <= 0x1f || rune == 0x7f);
  }
}

enum CustomerBiteSaverDevicePlatform { android, ios }

enum CustomerBiteSaverDeviceUseOrigin { discovery, saved }

enum CustomerBiteSaverDeviceProofKind {
  androidEnrollment,
  androidUse,
  iosEnrollment,
  iosUse,
}

enum CustomerBiteSaverDeviceCredentialState {
  available,
  missing,
  corrupt,
  unavailable,
  error,
}

enum CustomerBiteSaverDeviceUseStatus { started, active, unlimited, denied }

Map<String, Object?> _record(Object? value) {
  if (value is! Map) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

void _exactKeys(Map<String, Object?> value, Set<String> expected) {
  if (value.length != expected.length ||
      value.keys.any((key) => !expected.contains(key))) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
}

bool _wellFormedUtf16(String value) {
  final units = value.codeUnits;
  for (var index = 0; index < units.length; index += 1) {
    final unit = units[index];
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= units.length) return false;
      final trailing = units[index + 1];
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

String _string(
  Object? value, {
  required int maximumLength,
  int minimumLength = 1,
  RegExp? pattern,
  bool rejectPadding = false,
}) {
  if (value is! String ||
      !_wellFormedUtf16(value) ||
      value.length < minimumLength ||
      value.length > maximumLength ||
      (rejectPadding && value.trim() != value) ||
      (pattern != null && pattern.matchAsPrefix(value)?.end != value.length)) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  return value;
}

int _safeInteger(Object? value, {int minimum = 0, int? maximum}) {
  if (value is! int ||
      value < minimum ||
      value > (maximum ?? _maximumSafeJsonInteger)) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  return value;
}

bool _boolean(Object? value) {
  if (value is! bool) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  return value;
}

final RegExp _base64UrlPattern = RegExp(r'^[A-Za-z0-9_-]+$');
final RegExp _fingerprintPattern = RegExp(r'^[0-9a-f]{64}$');
final RegExp _challengeIdPattern = RegExp(r'^bsdc_[A-Za-z0-9_-]{43}$');
final RegExp _credentialIdPattern = RegExp(r'^bsic_[A-Za-z0-9_-]{43}$');
final RegExp _integrityTokenPattern = RegExp(r'^[A-Za-z0-9._~-]+$');
final RegExp _logicalRequestIdPattern = RegExp(r'^[A-Za-z0-9_-]{16,128}$');
final RegExp _sessionIdPattern = RegExp(r'^bss_[A-Za-z0-9_-]{43}$');
final RegExp _redemptionIdPattern = RegExp(r'^bsrd_[A-Za-z0-9_-]{43}$');

Uint8List _decodeBase64Url(
  Object? value, {
  required int maximumEncodedLength,
  int? exactByteLength,
  int minimumByteLength = 1,
  int? maximumByteLength,
}) {
  final encoded = _string(
    value,
    maximumLength: maximumEncodedLength,
    pattern: _base64UrlPattern,
  );
  if (encoded.contains('=') || encoded.length % 4 == 1) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  try {
    final decoded = Uint8List.fromList(
      base64Url.decode(base64Url.normalize(encoded)),
    );
    if (decoded.length < minimumByteLength ||
        (maximumByteLength != null && decoded.length > maximumByteLength) ||
        (exactByteLength != null && decoded.length != exactByteLength) ||
        _base64UrlNoPadding(decoded) != encoded) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    return decoded;
  } on FormatException {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
}

String _base64UrlNoPadding(List<int> value) =>
    base64UrlEncode(value).replaceAll('=', '');

Uint8List _decodeFingerprint(String value) {
  _string(value, maximumLength: 64, pattern: _fingerprintPattern);
  final result = Uint8List(
    CustomerBiteSaverDeviceProofContract.requestFingerprintByteLength,
  );
  for (var index = 0; index < result.length; index += 1) {
    result[index] = int.parse(
      value.substring(index * 2, index * 2 + 2),
      radix: 16,
    );
  }
  return result;
}

CustomerBiteSaverDevicePlatform _platform(Object? value) => switch (value) {
  'android' => CustomerBiteSaverDevicePlatform.android,
  'ios' => CustomerBiteSaverDevicePlatform.ios,
  _ => throw const CustomerBiteSaverDeviceProtocolException(),
};

CustomerBiteSaverDeviceUseOrigin _origin(Object? value) => switch (value) {
  'discovery' => CustomerBiteSaverDeviceUseOrigin.discovery,
  'saved' => CustomerBiteSaverDeviceUseOrigin.saved,
  _ => throw const CustomerBiteSaverDeviceProtocolException(),
};

String? _authenticatedUserId(Object? value) {
  if (value == null) return null;
  if (value is! String ||
      !CustomerBiteSaverDeviceProofContract.isValidAuthenticatedUserId(value)) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  return value;
}

sealed class CustomerBiteSaverCombinedUseAuthority {
  const CustomerBiteSaverCombinedUseAuthority();

  CustomerBiteSaverDeviceUseOrigin get kind;
  Map<String, Object?> toJson();
}

final class CustomerBiteSaverDiscoveryUseAuthority
    extends CustomerBiteSaverCombinedUseAuthority {
  CustomerBiteSaverDiscoveryUseAuthority({
    required String clientInstanceId,
    required String sessionId,
    required String capability,
    required String criteriaFingerprint,
    required String offerOccurrence,
    required int? guestStateRevision,
  }) : clientInstanceId = _string(
         clientInstanceId,
         maximumLength: 128,
         minimumLength: 16,
         pattern: _logicalRequestIdPattern,
       ),
       sessionId = _string(
         sessionId,
         maximumLength: 47,
         pattern: _sessionIdPattern,
       ),
       capability = _string(capability, maximumLength: 32768),
       criteriaFingerprint = _string(
         criteriaFingerprint,
         maximumLength: 64,
         pattern: _fingerprintPattern,
       ),
       offerOccurrence = _string(offerOccurrence, maximumLength: 32768),
       guestStateRevision = guestStateRevision == null
           ? null
           : _safeInteger(guestStateRevision);

  @override
  CustomerBiteSaverDeviceUseOrigin get kind =>
      CustomerBiteSaverDeviceUseOrigin.discovery;

  final String clientInstanceId;
  final String sessionId;
  final String capability;
  final String criteriaFingerprint;
  final String offerOccurrence;
  final int? guestStateRevision;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': kind.name,
    'clientInstanceId': clientInstanceId,
    'sessionId': sessionId,
    'capability': capability,
    'criteriaFingerprint': criteriaFingerprint,
    'offerOccurrence': offerOccurrence,
    'guestStateRevision': guestStateRevision,
  };
}

final class CustomerBiteSaverSavedUseAuthority
    extends CustomerBiteSaverCombinedUseAuthority {
  CustomerBiteSaverSavedUseAuthority({required String accessToken})
    : accessToken = _string(accessToken, maximumLength: 32768);

  @override
  CustomerBiteSaverDeviceUseOrigin get kind =>
      CustomerBiteSaverDeviceUseOrigin.saved;

  final String accessToken;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': kind.name,
    'accessToken': accessToken,
  };
}

final class CustomerBiteSaverCombinedUseRequest {
  CustomerBiteSaverCombinedUseRequest({
    required String logicalRequestId,
    required this.restaurantId,
    required this.offerId,
    required String timeZone,
    required int utcOffsetMinutes,
    required this.currentCoordinates,
    required this.origin,
  }) : logicalRequestId = _string(
         logicalRequestId,
         maximumLength: 128,
         minimumLength: 16,
         pattern: _logicalRequestIdPattern,
       ),
       timeZone = _string(timeZone, maximumLength: 100, rejectPadding: true),
       utcOffsetMinutes = _safeInteger(
         utcOffsetMinutes,
         minimum: -840,
         maximum: 840,
       );

  final String logicalRequestId;
  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final String timeZone;
  final int utcOffsetMinutes;
  final CustomerBiteSaverCoordinates? currentCoordinates;
  final CustomerBiteSaverCombinedUseAuthority origin;

  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
    'logicalRequestId': logicalRequestId,
    'restaurantId': restaurantId.value,
    'offerId': offerId.value,
    'timeZone': timeZone,
    'utcOffsetMinutes': utcOffsetMinutes,
    'currentCoordinates': currentCoordinates?.toJson(),
    'origin': origin.toJson(),
  };

  /// Local stale-work key only. It is not a cryptographic fingerprint and is
  /// never sent as server authority.
  String get localFenceKey => jsonEncode(toJson());
}

final class CustomerBiteSaverDeviceChallenge {
  CustomerBiteSaverDeviceChallenge._({
    required this.challengeId,
    required this.platform,
    required this.requestFingerprint,
    required this.authenticatedUserId,
    required this.origin,
    required this.logicalRequestId,
    required this.issuedAtMillis,
    required this.validFromMillis,
    required this.expiresAtMillis,
    required this.challengeBytes,
    required CustomerBiteSaverDeviceElapsedClock elapsedClock,
    required Duration receivedAtElapsed,
    required Duration localLifetimeAtReceipt,
  }) : _elapsedClock = elapsedClock,
       _receivedAtElapsed = receivedAtElapsed,
       _localLifetimeAtReceipt = localLifetimeAtReceipt;

  /// Accept a fresh challenge response using the same monotonic clock sampled
  /// immediately before its request. Subtracting the entire round trip is
  /// conservative: the server issued this challenge after that request began.
  /// The extra millisecond covers the server timestamp's millisecond rounding.
  /// Server timestamps remain unchanged and are authoritative at verification.
  factory CustomerBiteSaverDeviceChallenge.fromJson(
    Object? value, {
    required Duration requestStartedAtElapsed,
    CustomerBiteSaverDeviceElapsedClock? elapsedClock,
  }) {
    final clock =
        elapsedClock ?? CustomerBiteSaverDeviceProofContract.monotonicElapsed;
    final receivedAtElapsed = clock();
    if (requestStartedAtElapsed.isNegative ||
        receivedAtElapsed < requestStartedAtElapsed) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final data = _record(value);
    _exactKeys(data, const <String>{
      'schemaVersion',
      'protocolVersion',
      'challengeId',
      'platform',
      'purpose',
      'requestFingerprint',
      'authenticatedUserId',
      'origin',
      'logicalRequestId',
      'issuedAtMillis',
      'validFromMillis',
      'expiresAtMillis',
      'challengeBytes',
    });
    if (data['schemaVersion'] !=
            CustomerBiteSaverDeviceProofContract.schemaVersion ||
        data['protocolVersion'] !=
            CustomerBiteSaverDeviceProofContract.protocolVersion ||
        data['purpose'] != CustomerBiteSaverDeviceProofContract.purpose) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final issuedAtMillis = _safeInteger(data['issuedAtMillis']);
    final validFromMillis = _safeInteger(data['validFromMillis']);
    final expiresAtMillis = _safeInteger(data['expiresAtMillis']);
    if (validFromMillis < issuedAtMillis ||
        expiresAtMillis <= validFromMillis ||
        expiresAtMillis - issuedAtMillis >
            CustomerBiteSaverDeviceProofContract
                .challengeLifetimeMilliseconds) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final requestFingerprint = _string(
      data['requestFingerprint'],
      maximumLength: 64,
      pattern: _fingerprintPattern,
    );
    final challengeBytes = _decodeBase64Url(
      data['challengeBytes'],
      maximumEncodedLength: 43,
      exactByteLength: CustomerBiteSaverDeviceProofContract.challengeByteLength,
    );
    final challengeId = _string(
      data['challengeId'],
      maximumLength: 48,
      pattern: _challengeIdPattern,
    );
    if (challengeId != 'bsdc_${_base64UrlNoPadding(challengeBytes)}') {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    return CustomerBiteSaverDeviceChallenge._(
      challengeId: challengeId,
      platform: _platform(data['platform']),
      requestFingerprint: requestFingerprint,
      authenticatedUserId: _authenticatedUserId(data['authenticatedUserId']),
      origin: _origin(data['origin']),
      logicalRequestId: _string(
        data['logicalRequestId'],
        maximumLength: 128,
        minimumLength: 16,
        pattern: _logicalRequestIdPattern,
      ),
      issuedAtMillis: issuedAtMillis,
      validFromMillis: validFromMillis,
      expiresAtMillis: expiresAtMillis,
      challengeBytes: challengeBytes,
      elapsedClock: clock,
      receivedAtElapsed: receivedAtElapsed,
      localLifetimeAtReceipt:
          Duration(milliseconds: expiresAtMillis - issuedAtMillis) -
          (receivedAtElapsed - requestStartedAtElapsed) -
          const Duration(milliseconds: 1),
    );
  }

  final String challengeId;
  final CustomerBiteSaverDevicePlatform platform;
  final String requestFingerprint;
  final String? authenticatedUserId;
  final CustomerBiteSaverDeviceUseOrigin origin;
  final String logicalRequestId;
  final int issuedAtMillis;
  final int validFromMillis;
  final int expiresAtMillis;
  final Uint8List challengeBytes;
  final CustomerBiteSaverDeviceElapsedClock _elapsedClock;
  final Duration _receivedAtElapsed;
  final Duration _localLifetimeAtReceipt;

  Duration get remainingLocalLifetime {
    final age = _elapsedClock() - _receivedAtElapsed;
    if (age.isNegative) return Duration.zero;
    final remaining = _localLifetimeAtReceipt - age;
    return remaining > Duration.zero ? remaining : Duration.zero;
  }

  bool get isLocallyUsable => remainingLocalLifetime > Duration.zero;

  Map<String, Object?> toNativeArguments() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
    'protocolVersion': CustomerBiteSaverDeviceProofContract.protocolVersion,
    'platform': platform.name,
    'purpose': CustomerBiteSaverDeviceProofContract.purpose,
    'challengeId': challengeId,
    'challengeBytes': _base64UrlNoPadding(challengeBytes),
    'requestFingerprint': requestFingerprint,
    'authenticatedUserId': authenticatedUserId,
    'origin': origin.name,
    'logicalRequestId': logicalRequestId,
    'issuedAtMillis': issuedAtMillis,
    'validFromMillis': validFromMillis,
    'expiresAtMillis': expiresAtMillis,
  };
}

final class CustomerBiteSaverDeviceCapability {
  const CustomerBiteSaverDeviceCapability._({
    required this.platform,
    required this.supported,
    required this.credentialState,
    required this.providerAvailable,
    required this.androidApiLevel,
  });

  factory CustomerBiteSaverDeviceCapability.fromJson(Object? value) {
    final data = _record(value);
    if (data['schemaVersion'] !=
            CustomerBiteSaverDeviceProofContract.schemaVersion ||
        data['protocolVersion'] !=
            CustomerBiteSaverDeviceProofContract.protocolVersion) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final platform = _platform(data['platform']);
    switch (platform) {
      case CustomerBiteSaverDevicePlatform.android:
        _exactKeys(data, const <String>{
          'schemaVersion',
          'protocolVersion',
          'platform',
          'apiLevel',
          'minimumApiLevel',
          'supported',
          'credentialState',
          'integrityAvailable',
        });
        if (data['minimumApiLevel'] != 26) {
          throw const CustomerBiteSaverDeviceProtocolException();
        }
        final state = switch (data['credentialState']) {
          'present' => CustomerBiteSaverDeviceCredentialState.available,
          'missing' => CustomerBiteSaverDeviceCredentialState.missing,
          'corrupt' => CustomerBiteSaverDeviceCredentialState.corrupt,
          'unavailable' => CustomerBiteSaverDeviceCredentialState.unavailable,
          'error' => CustomerBiteSaverDeviceCredentialState.error,
          _ => throw const CustomerBiteSaverDeviceProtocolException(),
        };
        return CustomerBiteSaverDeviceCapability._(
          platform: platform,
          supported: _boolean(data['supported']),
          credentialState: state,
          providerAvailable: _boolean(data['integrityAvailable']),
          androidApiLevel: _safeInteger(
            data['apiLevel'],
            minimum: 1,
            maximum: 1000,
          ),
        );
      case CustomerBiteSaverDevicePlatform.ios:
        _exactKeys(data, const <String>{
          'schemaVersion',
          'protocolVersion',
          'platform',
          'appAttestSupported',
          'recoveryKeyState',
          'supported',
        });
        final state = switch (data['recoveryKeyState']) {
          'available' => CustomerBiteSaverDeviceCredentialState.available,
          'missing' => CustomerBiteSaverDeviceCredentialState.missing,
          'corrupt' => CustomerBiteSaverDeviceCredentialState.corrupt,
          'unavailable' => CustomerBiteSaverDeviceCredentialState.unavailable,
          _ => throw const CustomerBiteSaverDeviceProtocolException(),
        };
        return CustomerBiteSaverDeviceCapability._(
          platform: platform,
          supported: _boolean(data['supported']),
          credentialState: state,
          providerAvailable: _boolean(data['appAttestSupported']),
          androidApiLevel: null,
        );
    }
  }

  final CustomerBiteSaverDevicePlatform platform;
  final bool supported;
  final CustomerBiteSaverDeviceCredentialState credentialState;
  final bool providerAvailable;
  final int? androidApiLevel;
}

sealed class CustomerBiteSaverDeviceProof {
  const CustomerBiteSaverDeviceProof({required this.credentialId});

  factory CustomerBiteSaverDeviceProof.fromNativeResult(Object? value) {
    final data = _record(value);
    if (data['schemaVersion'] !=
        CustomerBiteSaverDeviceProofContract.schemaVersion) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    return switch (data['kind']) {
      'androidEnrollment' => CustomerBiteSaverAndroidEnrollmentProof._parse(
        data,
      ),
      'androidUse' => CustomerBiteSaverAndroidUseProof._parse(data),
      'iosEnrollment' => CustomerBiteSaverIosEnrollmentProof._parse(data),
      'iosUse' => CustomerBiteSaverIosUseProof._parse(data),
      _ => throw const CustomerBiteSaverDeviceProtocolException(),
    };
  }

  final String credentialId;
  CustomerBiteSaverDeviceProofKind get kind;
  Map<String, Object?> toJson();
}

String _credentialId(Object? value) =>
    _string(value, maximumLength: 48, pattern: _credentialIdPattern);

String _base64UrlField(
  Object? value, {
  required int maximumEncodedLength,
  int? exactByteLength,
  int minimumByteLength = 1,
  int? maximumByteLength,
}) {
  final bytes = _decodeBase64Url(
    value,
    maximumEncodedLength: maximumEncodedLength,
    exactByteLength: exactByteLength,
    minimumByteLength: minimumByteLength,
    maximumByteLength: maximumByteLength,
  );
  return _base64UrlNoPadding(bytes);
}

String _derSignature(Object? value) {
  final encoded = _base64UrlField(
    value,
    maximumEncodedLength: 108,
    minimumByteLength: 64,
  );
  final decoded = _decodeBase64Url(
    encoded,
    maximumEncodedLength: 108,
    minimumByteLength: 64,
  );
  if (!_isCanonicalP256DerSignature(decoded)) {
    throw const CustomerBiteSaverDeviceProtocolException();
  }
  return encoded;
}

bool _isCanonicalP256DerSignature(List<int> value) {
  if (value.length < 64 ||
      value.length > 80 ||
      value.first != 0x30 ||
      value[1] != value.length - 2) {
    return false;
  }
  var offset = 2;
  for (var component = 0; component < 2; component += 1) {
    if (offset + 2 > value.length || value[offset] != 0x02) return false;
    final length = value[offset + 1];
    offset += 2;
    if (length < 1 || length > 33 || offset + length > value.length) {
      return false;
    }
    final first = value[offset];
    if ((first & 0x80) != 0 ||
        (length > 1 && first == 0 && (value[offset + 1] & 0x80) == 0)) {
      return false;
    }
    offset += length;
  }
  return offset == value.length;
}

final class CustomerBiteSaverAndroidEnrollmentProof
    extends CustomerBiteSaverDeviceProof {
  const CustomerBiteSaverAndroidEnrollmentProof._({
    required super.credentialId,
    required this.installationPublicKeySpki,
    required this.androidSsaid,
    required this.possessionSignature,
    required this.integrityToken,
  });

  factory CustomerBiteSaverAndroidEnrollmentProof._parse(
    Map<String, Object?> data,
  ) {
    _exactKeys(data, const <String>{
      'schemaVersion',
      'kind',
      'credentialId',
      'installationPublicKeySpki',
      'androidSsaid',
      'possessionSignature',
      'integrityToken',
    });
    final credentialId = _credentialId(data['credentialId']);
    final installationPublicKeySpki = _decodeBase64Url(
      data['installationPublicKeySpki'],
      maximumEncodedLength: 256,
      minimumByteLength: 80,
      maximumByteLength: 160,
    );
    final publicKeyHash = Uint8List.fromList(
      sha256.convert(installationPublicKeySpki).bytes,
    );
    if (credentialId !=
        CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
          platform: CustomerBiteSaverDevicePlatform.android,
          publicKeySha256: publicKeyHash,
        )) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    return CustomerBiteSaverAndroidEnrollmentProof._(
      credentialId: credentialId,
      installationPublicKeySpki: _base64UrlNoPadding(installationPublicKeySpki),
      androidSsaid: _string(
        data['androidSsaid'],
        maximumLength: 16,
        minimumLength: 16,
        pattern: RegExp(r'^[0-9a-f]{16}$'),
      ),
      possessionSignature: _derSignature(data['possessionSignature']),
      integrityToken: _string(
        data['integrityToken'],
        maximumLength: 32768,
        pattern: _integrityTokenPattern,
        rejectPadding: true,
      ),
    );
  }

  @override
  CustomerBiteSaverDeviceProofKind get kind =>
      CustomerBiteSaverDeviceProofKind.androidEnrollment;
  final String installationPublicKeySpki;
  final String androidSsaid;
  final String possessionSignature;
  final String integrityToken;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
    'kind': kind.name,
    'credentialId': credentialId,
    'installationPublicKeySpki': installationPublicKeySpki,
    'androidSsaid': androidSsaid,
    'possessionSignature': possessionSignature,
    'integrityToken': integrityToken,
  };
}

final class CustomerBiteSaverAndroidUseProof
    extends CustomerBiteSaverDeviceProof {
  const CustomerBiteSaverAndroidUseProof._({
    required super.credentialId,
    required this.possessionSignature,
  });

  factory CustomerBiteSaverAndroidUseProof._parse(Map<String, Object?> data) {
    _exactKeys(data, const <String>{
      'schemaVersion',
      'kind',
      'credentialId',
      'possessionSignature',
    });
    return CustomerBiteSaverAndroidUseProof._(
      credentialId: _credentialId(data['credentialId']),
      possessionSignature: _derSignature(data['possessionSignature']),
    );
  }

  @override
  CustomerBiteSaverDeviceProofKind get kind =>
      CustomerBiteSaverDeviceProofKind.androidUse;
  final String possessionSignature;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
    'kind': kind.name,
    'credentialId': credentialId,
    'possessionSignature': possessionSignature,
  };
}

final class CustomerBiteSaverIosEnrollmentProof
    extends CustomerBiteSaverDeviceProof {
  const CustomerBiteSaverIosEnrollmentProof._({
    required super.credentialId,
    required this.recoveryPublicKeyX963,
    required this.appAttestKeyId,
    required this.possessionSignature,
    required this.attestationObject,
  });

  factory CustomerBiteSaverIosEnrollmentProof._parse(
    Map<String, Object?> data,
  ) {
    _exactKeys(data, const <String>{
      'schemaVersion',
      'kind',
      'credentialId',
      'recoveryPublicKeyX963',
      'appAttestKeyId',
      'possessionSignature',
      'attestationObject',
    });
    final recoveryPublicKey = _decodeBase64Url(
      data['recoveryPublicKeyX963'],
      maximumEncodedLength: 87,
      exactByteLength: 65,
    );
    if (recoveryPublicKey.first != 0x04) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final credentialId = _credentialId(data['credentialId']);
    final recoveryKeyHash = Uint8List.fromList(
      sha256.convert(recoveryPublicKey).bytes,
    );
    if (credentialId !=
        CustomerBiteSaverDeviceProofTranscript.credentialIdForPublicKeyHash(
          platform: CustomerBiteSaverDevicePlatform.ios,
          publicKeySha256: recoveryKeyHash,
        )) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    return CustomerBiteSaverIosEnrollmentProof._(
      credentialId: credentialId,
      recoveryPublicKeyX963: _base64UrlNoPadding(recoveryPublicKey),
      appAttestKeyId: _base64UrlField(
        data['appAttestKeyId'],
        maximumEncodedLength: 43,
        exactByteLength: 32,
      ),
      possessionSignature: _derSignature(data['possessionSignature']),
      attestationObject: _base64UrlField(
        data['attestationObject'],
        maximumEncodedLength: 87384,
        minimumByteLength: 1,
        maximumByteLength: 65536,
      ),
    );
  }

  @override
  CustomerBiteSaverDeviceProofKind get kind =>
      CustomerBiteSaverDeviceProofKind.iosEnrollment;
  final String recoveryPublicKeyX963;
  final String appAttestKeyId;
  final String possessionSignature;
  final String attestationObject;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
    'kind': kind.name,
    'credentialId': credentialId,
    'recoveryPublicKeyX963': recoveryPublicKeyX963,
    'appAttestKeyId': appAttestKeyId,
    'possessionSignature': possessionSignature,
    'attestationObject': attestationObject,
  };
}

final class CustomerBiteSaverIosUseProof extends CustomerBiteSaverDeviceProof {
  const CustomerBiteSaverIosUseProof._({
    required super.credentialId,
    required this.appAttestKeyId,
    required this.possessionSignature,
    required this.assertionObject,
  });

  factory CustomerBiteSaverIosUseProof._parse(Map<String, Object?> data) {
    _exactKeys(data, const <String>{
      'schemaVersion',
      'kind',
      'credentialId',
      'appAttestKeyId',
      'possessionSignature',
      'assertionObject',
    });
    return CustomerBiteSaverIosUseProof._(
      credentialId: _credentialId(data['credentialId']),
      appAttestKeyId: _base64UrlField(
        data['appAttestKeyId'],
        maximumEncodedLength: 43,
        exactByteLength: 32,
      ),
      possessionSignature: _derSignature(data['possessionSignature']),
      assertionObject: _base64UrlField(
        data['assertionObject'],
        maximumEncodedLength: 21848,
        minimumByteLength: 1,
        maximumByteLength: 16384,
      ),
    );
  }

  @override
  CustomerBiteSaverDeviceProofKind get kind =>
      CustomerBiteSaverDeviceProofKind.iosUse;
  final String appAttestKeyId;
  final String possessionSignature;
  final String assertionObject;

  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'schemaVersion': CustomerBiteSaverDeviceProofContract.schemaVersion,
    'kind': kind.name,
    'credentialId': credentialId,
    'appAttestKeyId': appAttestKeyId,
    'possessionSignature': possessionSignature,
    'assertionObject': assertionObject,
  };
}

final class CustomerBiteSaverDeviceUseResult {
  const CustomerBiteSaverDeviceUseResult._({
    required this.restaurantId,
    required this.offerId,
    required this.status,
    required this.reason,
    required this.redemptionId,
    required this.timerStartedAtMillis,
    required this.timerExpiresAtMillis,
    required this.evaluatedAtMillis,
  });

  factory CustomerBiteSaverDeviceUseResult.fromJson(Object? value) {
    final data = _record(value);
    _exactKeys(data, const <String>{
      'schemaVersion',
      'restaurantId',
      'offerId',
      'status',
      'reason',
      'redemptionId',
      'timerStartedAtMillis',
      'timerExpiresAtMillis',
      'evaluatedAtMillis',
    });
    if (data['schemaVersion'] !=
        CustomerBiteSaverDeviceProofContract.schemaVersion) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final status = switch (data['status']) {
      'started' => CustomerBiteSaverDeviceUseStatus.started,
      'active' => CustomerBiteSaverDeviceUseStatus.active,
      'unlimited' => CustomerBiteSaverDeviceUseStatus.unlimited,
      'denied' => CustomerBiteSaverDeviceUseStatus.denied,
      _ => throw const CustomerBiteSaverDeviceProtocolException(),
    };
    const allowedReasons = <String>{
      'available',
      'offerUnavailable',
      'parentUnavailable',
      'inactive',
      'notStarted',
      'expired',
      'wrongDay',
      'outsideTimeWindow',
      'invalidSchedule',
      'typedLocation',
      'outsideProximity',
      'missingFreshLocation',
      'used',
      'usageUnknown',
    };
    final reason = _string(data['reason'], maximumLength: 32);
    if (!allowedReasons.contains(reason)) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final redemptionId = data['redemptionId'] == null
        ? null
        : _string(
            data['redemptionId'],
            maximumLength: 48,
            pattern: _redemptionIdPattern,
          );
    final timerStartedAtMillis = data['timerStartedAtMillis'] == null
        ? null
        : _safeInteger(data['timerStartedAtMillis']);
    final timerExpiresAtMillis = data['timerExpiresAtMillis'] == null
        ? null
        : _safeInteger(data['timerExpiresAtMillis']);
    final timed =
        status == CustomerBiteSaverDeviceUseStatus.started ||
        status == CustomerBiteSaverDeviceUseStatus.active;
    if (timed !=
            (redemptionId != null &&
                timerStartedAtMillis != null &&
                timerExpiresAtMillis != null) ||
        (timed &&
            timerExpiresAtMillis! - timerStartedAtMillis! !=
                CustomerBiteSaverSearchContract.redemptionTimerMilliseconds) ||
        (!timed &&
            (redemptionId != null ||
                timerStartedAtMillis != null ||
                timerExpiresAtMillis != null)) ||
        ((status == CustomerBiteSaverDeviceUseStatus.started ||
                status == CustomerBiteSaverDeviceUseStatus.unlimited) &&
            reason != 'available') ||
        (status == CustomerBiteSaverDeviceUseStatus.denied &&
            reason == 'available')) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    return CustomerBiteSaverDeviceUseResult._(
      restaurantId: CustomerBiteSaverRestaurantId(
        _string(data['restaurantId'], maximumLength: 47),
      ),
      offerId: CustomerBiteSaverOfferId(
        _string(data['offerId'], maximumLength: 47),
      ),
      status: status,
      reason: reason,
      redemptionId: redemptionId,
      timerStartedAtMillis: timerStartedAtMillis,
      timerExpiresAtMillis: timerExpiresAtMillis,
      evaluatedAtMillis: _safeInteger(data['evaluatedAtMillis']),
    );
  }

  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final CustomerBiteSaverDeviceUseStatus status;
  final String reason;
  final String? redemptionId;
  final int? timerStartedAtMillis;
  final int? timerExpiresAtMillis;
  final int evaluatedAtMillis;
}

final class CustomerBiteSaverDeviceProofTranscript {
  CustomerBiteSaverDeviceProofTranscript({
    required this.proofKind,
    required this.platform,
    required String challengeId,
    required Uint8List challengeBytes,
    required String requestFingerprint,
    required String? authenticatedUserId,
    required this.origin,
    required String logicalRequestId,
    required int issuedAtMillis,
    required int validFromMillis,
    required int expiresAtMillis,
    required String credentialId,
    required Uint8List? androidInstallationPublicKeySha256,
    required Uint8List? androidSsaidUtf8,
    required Uint8List? iosRecoveryPublicKeyX963,
    required this.iosAppAttestKeyId,
  }) : challengeId = _string(
         challengeId,
         maximumLength: 48,
         pattern: _challengeIdPattern,
       ),
       challengeBytes = Uint8List.fromList(challengeBytes),
       requestFingerprint = _string(
         requestFingerprint,
         maximumLength: 64,
         pattern: _fingerprintPattern,
       ),
       authenticatedUserId = _authenticatedUserId(authenticatedUserId),
       logicalRequestId = _string(
         logicalRequestId,
         maximumLength: 128,
         minimumLength: 16,
         pattern: _logicalRequestIdPattern,
       ),
       issuedAtMillis = _safeInteger(issuedAtMillis),
       validFromMillis = _safeInteger(validFromMillis),
       expiresAtMillis = _safeInteger(expiresAtMillis),
       credentialId = _credentialId(credentialId),
       androidInstallationPublicKeySha256 =
           androidInstallationPublicKeySha256 == null
           ? null
           : Uint8List.fromList(androidInstallationPublicKeySha256),
       androidSsaidUtf8 = androidSsaidUtf8 == null
           ? null
           : Uint8List.fromList(androidSsaidUtf8),
       iosRecoveryPublicKeyX963 = iosRecoveryPublicKeyX963 == null
           ? null
           : Uint8List.fromList(iosRecoveryPublicKeyX963) {
    _validate();
  }

  final CustomerBiteSaverDeviceProofKind proofKind;
  final CustomerBiteSaverDevicePlatform platform;
  final String challengeId;
  final Uint8List challengeBytes;
  final String requestFingerprint;
  final String? authenticatedUserId;
  final CustomerBiteSaverDeviceUseOrigin origin;
  final String logicalRequestId;
  final int issuedAtMillis;
  final int validFromMillis;
  final int expiresAtMillis;
  final String credentialId;
  final Uint8List? androidInstallationPublicKeySha256;
  final Uint8List? androidSsaidUtf8;
  final Uint8List? iosRecoveryPublicKeyX963;
  final String? iosAppAttestKeyId;

  void _validate() {
    if (challengeBytes.length !=
            CustomerBiteSaverDeviceProofContract.challengeByteLength ||
        challengeId != 'bsdc_${_base64UrlNoPadding(challengeBytes)}' ||
        validFromMillis < issuedAtMillis ||
        expiresAtMillis <= validFromMillis ||
        expiresAtMillis - issuedAtMillis >
            CustomerBiteSaverDeviceProofContract
                .challengeLifetimeMilliseconds) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    late final Uint8List publicKeyHash;
    switch (proofKind) {
      case CustomerBiteSaverDeviceProofKind.androidEnrollment:
        if (platform != CustomerBiteSaverDevicePlatform.android ||
            androidInstallationPublicKeySha256?.length != 32 ||
            !_isCanonicalAndroidSsaid(androidSsaidUtf8) ||
            iosRecoveryPublicKeyX963 != null ||
            iosAppAttestKeyId != null) {
          throw const CustomerBiteSaverDeviceProtocolException();
        }
        publicKeyHash = androidInstallationPublicKeySha256!;
      case CustomerBiteSaverDeviceProofKind.androidUse:
        if (platform != CustomerBiteSaverDevicePlatform.android ||
            androidInstallationPublicKeySha256?.length != 32 ||
            androidSsaidUtf8 != null ||
            iosRecoveryPublicKeyX963 != null ||
            iosAppAttestKeyId != null) {
          throw const CustomerBiteSaverDeviceProtocolException();
        }
        publicKeyHash = androidInstallationPublicKeySha256!;
      case CustomerBiteSaverDeviceProofKind.iosEnrollment:
      case CustomerBiteSaverDeviceProofKind.iosUse:
        if (platform != CustomerBiteSaverDevicePlatform.ios ||
            androidInstallationPublicKeySha256 != null ||
            androidSsaidUtf8 != null ||
            iosRecoveryPublicKeyX963?.length != 65 ||
            iosRecoveryPublicKeyX963!.first != 0x04 ||
            !_isCanonicalAppAttestKeyId(iosAppAttestKeyId)) {
          throw const CustomerBiteSaverDeviceProtocolException();
        }
        publicKeyHash = Uint8List.fromList(
          sha256.convert(iosRecoveryPublicKeyX963!).bytes,
        );
    }
    if (credentialId !=
        credentialIdForPublicKeyHash(
          platform: platform,
          publicKeySha256: publicKeyHash,
        )) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
  }

  static bool _isCanonicalAndroidSsaid(Uint8List? value) =>
      value != null &&
      value.length == 16 &&
      value.every(
        (byte) =>
            (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66),
      );

  static bool _isCanonicalAppAttestKeyId(String? value) {
    if (value == null) return false;
    try {
      _decodeBase64Url(value, maximumEncodedLength: 43, exactByteLength: 32);
      return true;
    } on CustomerBiteSaverDeviceProtocolException {
      return false;
    }
  }

  Uint8List encode() {
    final writer = _CanonicalWriter();
    writer.rawAscii(CustomerBiteSaverDeviceProofContract.transcriptHeader);
    writer.u32(CustomerBiteSaverDeviceProofContract.schemaVersion);
    writer.text(CustomerBiteSaverDeviceProofContract.protocolVersion);
    writer.text(proofKind.name);
    writer.text(platform.name);
    writer.text(CustomerBiteSaverDeviceProofContract.purpose);
    writer.text(challengeId);
    writer.bytes(challengeBytes);
    writer.bytes(_decodeFingerprint(requestFingerprint));
    writer.nullableText(authenticatedUserId);
    writer.text(origin.name);
    writer.text(logicalRequestId);
    writer.u64(issuedAtMillis);
    writer.u64(validFromMillis);
    writer.u64(expiresAtMillis);
    writer.nullableText(credentialId);
    writer.nullableBytes(androidInstallationPublicKeySha256);
    writer.nullableBytes(androidSsaidUtf8);
    writer.nullableBytes(iosRecoveryPublicKeyX963);
    writer.nullableText(iosAppAttestKeyId);
    return writer.takeBytes();
  }

  Uint8List sha256Bytes() => Uint8List.fromList(sha256.convert(encode()).bytes);

  String get sha256Hex => sha256.convert(encode()).toString();

  String get sha256Base64Url => _base64UrlNoPadding(sha256Bytes());

  static String credentialIdForPublicKeyHash({
    required CustomerBiteSaverDevicePlatform platform,
    required Uint8List publicKeySha256,
  }) {
    if (publicKeySha256.length != 32) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final writer = _CanonicalWriter()
      ..rawAscii(CustomerBiteSaverDeviceProofContract.credentialIdHeader)
      ..bytes(utf8.encode(platform.name))
      ..bytes(publicKeySha256);
    return 'bsic_${_base64UrlNoPadding(sha256.convert(writer.takeBytes()).bytes)}';
  }

  static Uint8List iosAssertionClientDataHash({
    required Uint8List transcriptSha256,
    required Uint8List possessionSignatureDer,
  }) {
    if (transcriptSha256.length != 32 ||
        !_isCanonicalP256DerSignature(possessionSignatureDer)) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final writer = _CanonicalWriter()
      ..rawAscii(CustomerBiteSaverDeviceProofContract.assertionHeader)
      ..bytes(transcriptSha256)
      ..bytes(possessionSignatureDer);
    return Uint8List.fromList(sha256.convert(writer.takeBytes()).bytes);
  }
}

final class _CanonicalWriter {
  final BytesBuilder _builder = BytesBuilder(copy: false);

  void rawAscii(String value) {
    final bytes = ascii.encode(value);
    _builder.add(bytes);
  }

  void u32(int value) {
    if (value < 0 || value > 0xffffffff) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final bytes = ByteData(4)..setUint32(0, value, Endian.big);
    _builder.add(bytes.buffer.asUint8List());
  }

  void u64(int value) {
    if (value < 0 || value > _maximumSafeJsonInteger) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    final bytes = Uint8List(8);
    var remainder = value;
    for (var index = bytes.length - 1; index >= 0; index -= 1) {
      bytes[index] = remainder % 256;
      remainder ~/= 256;
    }
    _builder.add(bytes);
  }

  void text(String value) => bytes(utf8.encode(value));

  void bytes(List<int> value) {
    if (value.length > 0xffffffff) {
      throw const CustomerBiteSaverDeviceProtocolException();
    }
    u32(value.length);
    _builder.add(value);
  }

  void nullableText(String? value) {
    if (value == null) {
      _builder.addByte(0);
      return;
    }
    _builder.addByte(1);
    text(value);
  }

  void nullableBytes(List<int>? value) {
    if (value == null) {
      _builder.addByte(0);
      return;
    }
    _builder.addByte(1);
    bytes(value);
  }

  Uint8List takeBytes() => _builder.takeBytes();
}
