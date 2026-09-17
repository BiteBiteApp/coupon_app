import CryptoKit
import Foundation

enum BiteSaverDeviceProofContractError: Error, Equatable {
  case invalidField(String)
  case invalidEncoding(String)
  case invalidBinding

  var stableCode: String {
    switch self {
    case .invalidField, .invalidEncoding:
      return "invalid-request"
    case .invalidBinding:
      return "invalid-request"
    }
  }
}

enum BiteSaverDeviceProofKind: String {
  case androidEnrollment
  case androidUse
  case iosEnrollment
  case iosUse

  var platform: String {
    switch self {
    case .androidEnrollment, .androidUse:
      return "android"
    case .iosEnrollment, .iosUse:
      return "ios"
    }
  }
}

struct BiteSaverDeviceProofTranscript: Equatable {
  static let schemaVersion: UInt32 = 1
  static let protocolVersion = "bitestar.bitesaver-device-proof.v1"
  static let purpose = "combinedCouponUse"
  static let transcriptHeader = Data("BiteStar/BiteSaver/DeviceProofTranscript/v1\0".utf8)
  static let assertionHeader = Data("BiteStar/BiteSaver/DeviceProofAssertion/v1\0".utf8)
  static let credentialIdHeader = Data("BiteStar/BiteSaver/CredentialId/v1\0".utf8)

  let protocolVersion: String
  let proofKind: BiteSaverDeviceProofKind
  let platform: String
  let purpose: String
  let challengeId: String
  let challengeBytes: Data
  let requestFingerprint: Data
  let authenticatedUserId: String?
  let origin: String
  let logicalRequestId: String
  let issuedAtMillis: UInt64
  let validFromMillis: UInt64
  let expiresAtMillis: UInt64
  let credentialId: String
  let androidInstallationPublicKeySha256: Data?
  let androidSsaidUtf8: Data?
  let iosRecoveryPublicKeyX963: Data?
  let iosAppAttestKeyId: String?

  func encode() throws -> Data {
    try validate()

    var output = Self.transcriptHeader
    output.appendUInt32(Self.schemaVersion)
    try output.appendText(protocolVersion, field: "protocolVersion")
    try output.appendText(proofKind.rawValue, field: "proofKind")
    try output.appendText(platform, field: "platform")
    try output.appendText(purpose, field: "purpose")
    try output.appendText(challengeId, field: "challengeId")
    try output.appendBytes(challengeBytes, field: "challengeBytes")
    try output.appendBytes(requestFingerprint, field: "requestFingerprint")
    try output.appendNullableText(authenticatedUserId, field: "authenticatedUserId")
    try output.appendText(origin, field: "origin")
    try output.appendText(logicalRequestId, field: "logicalRequestId")
    output.appendUInt64(issuedAtMillis)
    output.appendUInt64(validFromMillis)
    output.appendUInt64(expiresAtMillis)
    try output.appendNullableText(credentialId, field: "credentialId")
    try output.appendNullableBytes(
      androidInstallationPublicKeySha256,
      field: "androidInstallationPublicKeySha256"
    )
    try output.appendNullableBytes(androidSsaidUtf8, field: "androidSsaidUtf8")
    try output.appendNullableBytes(iosRecoveryPublicKeyX963, field: "iosRecoveryPublicKeyX963")
    try output.appendNullableText(iosAppAttestKeyId, field: "iosAppAttestKeyId")
    return output
  }

  func sha256() throws -> Data {
    Data(SHA256.hash(data: try encode()))
  }

  private func validate() throws {
    guard protocolVersion == Self.protocolVersion,
      purpose == Self.purpose,
      platform == proofKind.platform
    else {
      throw BiteSaverDeviceProofContractError.invalidBinding
    }
    guard challengeBytes.count == 32, requestFingerprint.count == 32 else {
      throw BiteSaverDeviceProofContractError.invalidField("binaryLength")
    }
    try Self.validateChallengeBinding(challengeId: challengeId, challengeBytes: challengeBytes)
    if let authenticatedUserId {
      try Self.validateAuthenticatedUserId(authenticatedUserId)
    }
    guard origin == "discovery" || origin == "saved" else {
      throw BiteSaverDeviceProofContractError.invalidField("origin")
    }
    try Self.validateLogicalRequestId(logicalRequestId)
    try Self.validateChallengeTimes(
      issuedAtMillis: issuedAtMillis,
      validFromMillis: validFromMillis,
      expiresAtMillis: expiresAtMillis
    )

    switch proofKind {
    case .androidEnrollment:
      guard let keyHash = androidInstallationPublicKeySha256,
        keyHash.count == 32,
        let ssaid = androidSsaidUtf8,
        ssaid.count == 16,
        ssaid.allSatisfy({ byte in
          (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66)
        }),
        iosRecoveryPublicKeyX963 == nil,
        iosAppAttestKeyId == nil
      else {
        throw BiteSaverDeviceProofContractError.invalidBinding
      }
      try validateCredentialId(publicKeySha256: keyHash)
    case .androidUse:
      guard let keyHash = androidInstallationPublicKeySha256,
        keyHash.count == 32,
        androidSsaidUtf8 == nil,
        iosRecoveryPublicKeyX963 == nil,
        iosAppAttestKeyId == nil
      else {
        throw BiteSaverDeviceProofContractError.invalidBinding
      }
      try validateCredentialId(publicKeySha256: keyHash)
    case .iosEnrollment, .iosUse:
      guard androidInstallationPublicKeySha256 == nil,
        androidSsaidUtf8 == nil,
        let recoveryKey = iosRecoveryPublicKeyX963,
        Self.isCanonicalP256X963PublicKey(recoveryKey),
        let appAttestKeyId = iosAppAttestKeyId,
        (try? BiteSaverBase64URL.decodeCanonical(appAttestKeyId, maximumBytes: 32).count) == 32
      else {
        throw BiteSaverDeviceProofContractError.invalidBinding
      }
      try validateCredentialId(
        publicKeySha256: Data(SHA256.hash(data: recoveryKey))
      )
    }
  }

  private func validateCredentialId(publicKeySha256: Data) throws {
    let expected = try Self.credentialId(
      platform: platform,
      publicKeySha256: publicKeySha256
    )
    guard credentialId == expected else {
      throw BiteSaverDeviceProofContractError.invalidBinding
    }
  }

  static func credentialId(platform: String, publicKeySha256: Data) throws -> String {
    guard platform == "android" || platform == "ios", publicKeySha256.count == 32 else {
      throw BiteSaverDeviceProofContractError.invalidField("credentialIdInput")
    }
    var input = credentialIdHeader
    try input.appendBytes(Data(platform.utf8), field: "credentialPlatform")
    try input.appendBytes(publicKeySha256, field: "credentialPublicKeySha256")
    return "bsic_" + BiteSaverBase64URL.encode(Data(SHA256.hash(data: input)))
  }

  static func assertionClientDataHash(
    transcriptSha256: Data,
    possessionSignatureDER: Data
  ) throws -> Data {
    Data(
      SHA256.hash(
        data: try assertionEnvelope(
          transcriptSha256: transcriptSha256,
          possessionSignatureDER: possessionSignatureDER
        )))
  }

  static func assertionEnvelope(
    transcriptSha256: Data,
    possessionSignatureDER: Data
  ) throws -> Data {
    guard transcriptSha256.count == 32 else {
      throw BiteSaverDeviceProofContractError.invalidField("assertionEnvelope")
    }
    try validatePossessionSignatureDER(possessionSignatureDER)
    var envelope = assertionHeader
    try envelope.appendBytes(transcriptSha256, field: "transcriptSha256")
    try envelope.appendBytes(possessionSignatureDER, field: "possessionSignature")
    return envelope
  }

  static func validatePossessionSignatureDER(_ signature: Data) throws {
    guard signature.count >= 64, signature.count <= 80, signature.first == 0x30 else {
      throw BiteSaverDeviceProofContractError.invalidField("possessionSignature")
    }
    do {
      _ = try P256.Signing.ECDSASignature(derRepresentation: signature)
    } catch {
      throw BiteSaverDeviceProofContractError.invalidEncoding("possessionSignature")
    }
  }

  static func validateChallengeId(_ value: String) throws {
    guard value.hasPrefix("bsdc_") else {
      throw BiteSaverDeviceProofContractError.invalidField("challengeId")
    }
    let suffix = String(value.dropFirst(5))
    guard (try? BiteSaverBase64URL.decodeCanonical(suffix, maximumBytes: 32).count) == 32 else {
      throw BiteSaverDeviceProofContractError.invalidField("challengeId")
    }
  }

  static func validateChallengeBinding(challengeId: String, challengeBytes: Data) throws {
    try validateChallengeId(challengeId)
    guard challengeBytes.count == 32,
      challengeId == "bsdc_" + BiteSaverBase64URL.encode(challengeBytes)
    else {
      throw BiteSaverDeviceProofContractError.invalidBinding
    }
  }

  static func validateAuthenticatedUserId(_ value: String) throws {
    guard !value.utf8.isEmpty,
      value.utf8.count <= 128,
      value == value.trimmingCharacters(in: .whitespacesAndNewlines),
      value != ".",
      value != "..",
      !value.contains("/"),
      !(value.hasPrefix("__") && value.hasSuffix("__")),
      value.unicodeScalars.allSatisfy({ scalar in
        scalar.value > 0x1f && scalar.value != 0x7f
      })
    else {
      throw BiteSaverDeviceProofContractError.invalidField("authenticatedUserId")
    }
  }

  static func validateLogicalRequestId(_ value: String) throws {
    guard value.utf8.count >= 16,
      value.utf8.count <= 128,
      value.unicodeScalars.allSatisfy({ scalar in
        (scalar.value >= 0x41 && scalar.value <= 0x5a)
          || (scalar.value >= 0x61 && scalar.value <= 0x7a)
          || (scalar.value >= 0x30 && scalar.value <= 0x39)
          || scalar.value == 0x5f
          || scalar.value == 0x2d
      })
    else {
      throw BiteSaverDeviceProofContractError.invalidField("logicalRequestId")
    }
  }

  static func validateChallengeTimes(
    issuedAtMillis: UInt64,
    validFromMillis: UInt64,
    expiresAtMillis: UInt64
  ) throws {
    guard issuedAtMillis <= validFromMillis,
      validFromMillis < expiresAtMillis,
      expiresAtMillis - issuedAtMillis <= 120_000
    else {
      throw BiteSaverDeviceProofContractError.invalidField("challengeTimes")
    }
  }

  private static func isCanonicalP256X963PublicKey(_ data: Data) -> Bool {
    guard data.count == 65, data.first == 0x04 else { return false }
    return (try? P256.Signing.PublicKey(x963Representation: data)) != nil
  }
}

enum BiteSaverBase64URL {
  static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func decodeCanonical(_ value: String, maximumBytes: Int) throws -> Data {
    guard !value.isEmpty,
      value.utf8.count <= ((maximumBytes + 2) / 3) * 4,
      !value.contains("="),
      value.unicodeScalars.allSatisfy({ scalar in
        (scalar.value >= 0x41 && scalar.value <= 0x5a)
          || (scalar.value >= 0x61 && scalar.value <= 0x7a)
          || (scalar.value >= 0x30 && scalar.value <= 0x39)
          || scalar.value == 0x2d
          || scalar.value == 0x5f
      })
    else {
      throw BiteSaverDeviceProofContractError.invalidEncoding("base64url")
    }

    var standard =
      value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = standard.utf8.count % 4
    guard remainder != 1 else {
      throw BiteSaverDeviceProofContractError.invalidEncoding("base64url")
    }
    if remainder > 0 {
      standard.append(String(repeating: "=", count: 4 - remainder))
    }
    guard let decoded = Data(base64Encoded: standard),
      decoded.count <= maximumBytes,
      encode(decoded) == value
    else {
      throw BiteSaverDeviceProofContractError.invalidEncoding("base64url")
    }
    return decoded
  }

  static func canonicalAppAttestKeyId(_ providerKeyId: String) throws -> String {
    guard providerKeyId.utf8.count <= 512,
      let decoded = Data(base64Encoded: providerKeyId),
      decoded.count == 32,
      decoded.base64EncodedString() == providerKeyId
    else {
      throw BiteSaverDeviceProofContractError.invalidEncoding("appAttestKeyId")
    }
    return encode(decoded)
  }
}

extension Data {
  fileprivate mutating func appendUInt32(_ value: UInt32) {
    var bigEndian = value.bigEndian
    Swift.withUnsafeBytes(of: &bigEndian) { append(contentsOf: $0) }
  }

  fileprivate mutating func appendUInt64(_ value: UInt64) {
    var bigEndian = value.bigEndian
    Swift.withUnsafeBytes(of: &bigEndian) { append(contentsOf: $0) }
  }

  fileprivate mutating func appendText(_ value: String, field: String) throws {
    try appendBytes(Data(value.utf8), field: field)
  }

  fileprivate mutating func appendBytes(_ value: Data, field: String) throws {
    guard value.count <= 65_536 else {
      throw BiteSaverDeviceProofContractError.invalidField(field)
    }
    appendUInt32(UInt32(value.count))
    append(value)
  }

  fileprivate mutating func appendNullableText(_ value: String?, field: String) throws {
    guard let value else {
      append(0)
      return
    }
    append(1)
    try appendText(value, field: field)
  }

  fileprivate mutating func appendNullableBytes(_ value: Data?, field: String) throws {
    guard let value else {
      append(0)
      return
    }
    append(1)
    try appendBytes(value, field: field)
  }
}
