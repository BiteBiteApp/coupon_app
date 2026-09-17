import CoreFoundation
import CryptoKit
import Flutter
import Foundation

private struct BiteSaverProofRequest {
  static let keys: Set<String> = [
    "schemaVersion",
    "protocolVersion",
    "platform",
    "purpose",
    "challengeId",
    "challengeBytes",
    "requestFingerprint",
    "authenticatedUserId",
    "origin",
    "logicalRequestId",
    "issuedAtMillis",
    "validFromMillis",
    "expiresAtMillis",
  ]

  let challengeId: String
  let challengeBytes: Data
  let requestFingerprint: Data
  let authenticatedUserId: String?
  let origin: String
  let logicalRequestId: String
  let issuedAtMillis: UInt64
  let validFromMillis: UInt64
  let expiresAtMillis: UInt64

  init(arguments: Any?) throws {
    guard let arguments = arguments as? [String: Any],
      Set(arguments.keys) == Self.keys
    else {
      throw BiteSaverDeviceProofContractError.invalidField("arguments")
    }
    guard try Self.integer(arguments["schemaVersion"], field: "schemaVersion") == 1,
      try Self.string(arguments["protocolVersion"], field: "protocolVersion", maximumBytes: 64)
        == BiteSaverDeviceProofTranscript.protocolVersion,
      try Self.string(arguments["platform"], field: "platform", maximumBytes: 16) == "ios",
      try Self.string(arguments["purpose"], field: "purpose", maximumBytes: 64)
        == BiteSaverDeviceProofTranscript.purpose
    else {
      throw BiteSaverDeviceProofContractError.invalidBinding
    }

    challengeId = try Self.string(
      arguments["challengeId"],
      field: "challengeId",
      maximumBytes: 64
    )
    let challengeString = try Self.string(
      arguments["challengeBytes"],
      field: "challengeBytes",
      maximumBytes: 43
    )
    challengeBytes = try BiteSaverBase64URL.decodeCanonical(
      challengeString,
      maximumBytes: 32
    )
    guard challengeBytes.count == 32 else {
      throw BiteSaverDeviceProofContractError.invalidField("challengeBytes")
    }

    requestFingerprint = try Self.lowercaseHexData(
      arguments["requestFingerprint"],
      field: "requestFingerprint",
      byteCount: 32
    )

    let authValue = arguments["authenticatedUserId"]
    if authValue is NSNull {
      authenticatedUserId = nil
    } else {
      guard let userId = authValue as? String, userId.utf8.count <= 128 else {
        throw BiteSaverDeviceProofContractError.invalidField("authenticatedUserId")
      }
      authenticatedUserId = userId
    }

    origin = try Self.string(arguments["origin"], field: "origin", maximumBytes: 16)
    logicalRequestId = try Self.string(
      arguments["logicalRequestId"],
      field: "logicalRequestId",
      maximumBytes: 128
    )
    issuedAtMillis = try Self.integer(arguments["issuedAtMillis"], field: "issuedAtMillis")
    validFromMillis = try Self.integer(
      arguments["validFromMillis"],
      field: "validFromMillis"
    )
    expiresAtMillis = try Self.integer(arguments["expiresAtMillis"], field: "expiresAtMillis")

    try BiteSaverDeviceProofTranscript.validateChallengeBinding(
      challengeId: challengeId,
      challengeBytes: challengeBytes
    )
    if let authenticatedUserId {
      try BiteSaverDeviceProofTranscript.validateAuthenticatedUserId(authenticatedUserId)
    }
    guard origin == "discovery" || origin == "saved" else {
      throw BiteSaverDeviceProofContractError.invalidField("origin")
    }
    try BiteSaverDeviceProofTranscript.validateLogicalRequestId(logicalRequestId)
    try BiteSaverDeviceProofTranscript.validateChallengeTimes(
      issuedAtMillis: issuedAtMillis,
      validFromMillis: validFromMillis,
      expiresAtMillis: expiresAtMillis
    )
  }

  func transcript(
    kind: BiteSaverDeviceProofKind,
    credentialId: String,
    recoveryPublicKey: Data,
    appAttestKeyId: String
  ) -> BiteSaverDeviceProofTranscript {
    BiteSaverDeviceProofTranscript(
      protocolVersion: BiteSaverDeviceProofTranscript.protocolVersion,
      proofKind: kind,
      platform: "ios",
      purpose: BiteSaverDeviceProofTranscript.purpose,
      challengeId: challengeId,
      challengeBytes: challengeBytes,
      requestFingerprint: requestFingerprint,
      authenticatedUserId: authenticatedUserId,
      origin: origin,
      logicalRequestId: logicalRequestId,
      issuedAtMillis: issuedAtMillis,
      validFromMillis: validFromMillis,
      expiresAtMillis: expiresAtMillis,
      credentialId: credentialId,
      androidInstallationPublicKeySha256: nil,
      androidSsaidUtf8: nil,
      iosRecoveryPublicKeyX963: recoveryPublicKey,
      iosAppAttestKeyId: appAttestKeyId
    )
  }

  private static func string(
    _ value: Any?,
    field: String,
    maximumBytes: Int
  ) throws -> String {
    guard let value = value as? String,
      !value.isEmpty,
      value.utf8.count <= maximumBytes,
      value == value.trimmingCharacters(in: .whitespacesAndNewlines),
      value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
    else {
      throw BiteSaverDeviceProofContractError.invalidField(field)
    }
    return value
  }

  private static func integer(_ value: Any?, field: String) throws -> UInt64 {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else {
      throw BiteSaverDeviceProofContractError.invalidField(field)
    }
    let type = String(cString: number.objCType)
    guard ["c", "s", "i", "l", "q", "C", "S", "I", "L", "Q"].contains(type) else {
      throw BiteSaverDeviceProofContractError.invalidField(field)
    }
    let signed = number.int64Value
    guard signed >= 0, UInt64(signed) <= 9_007_199_254_740_991 else {
      throw BiteSaverDeviceProofContractError.invalidField(field)
    }
    return UInt64(signed)
  }

  private static func lowercaseHexData(
    _ value: Any?,
    field: String,
    byteCount: Int
  ) throws -> Data {
    let string = try self.string(value, field: field, maximumBytes: byteCount * 2)
    guard string.utf8.count == byteCount * 2,
      string.unicodeScalars.allSatisfy({ scalar in
        (scalar.value >= 0x30 && scalar.value <= 0x39)
          || (scalar.value >= 0x61 && scalar.value <= 0x66)
      })
    else {
      throw BiteSaverDeviceProofContractError.invalidEncoding(field)
    }

    var output = Data(capacity: byteCount)
    var index = string.startIndex
    for _ in 0..<byteCount {
      let next = string.index(index, offsetBy: 2)
      guard let byte = UInt8(string[index..<next], radix: 16) else {
        throw BiteSaverDeviceProofContractError.invalidEncoding(field)
      }
      output.append(byte)
      index = next
    }
    return output
  }
}

final class BiteSaverDeviceProofBridge {
  static let channelName = "com.colesmart.bitestar/bitesaver_device_proof"

  private let channel: FlutterMethodChannel
  private let recoveryKeyStore: BiteSaverRecoveryKeyStore
  private let appAttestClient: BiteSaverAppAttestClient
  private let operationLock = NSLock()
  private var activeOperationToken: UUID?

  init(
    binaryMessenger: FlutterBinaryMessenger,
    recoveryKeyStore: BiteSaverRecoveryKeyStore = BiteSaverRecoveryKeyStore(),
    appAttestClient: BiteSaverAppAttestClient = BiteSaverAppAttestClient()
  ) {
    channel = FlutterMethodChannel(
      name: Self.channelName,
      binaryMessenger: binaryMessenger
    )
    self.recoveryKeyStore = recoveryKeyStore
    self.appAttestClient = appAttestClient
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else {
        result(Self.flutterError(code: "native-unavailable"))
        return
      }
      self.handle(call, result: result)
    }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "getCapability":
      handleCapability(arguments: call.arguments, result: result)
    case "createEnrollmentProof":
      guard let operationToken = beginOperation() else {
        result(Self.flutterError(code: "operation-in-progress"))
        return
      }
      handleEnrollment(
        arguments: call.arguments,
        operationToken: operationToken,
        result: result
      )
    case "createUseProof":
      guard let operationToken = beginOperation() else {
        result(Self.flutterError(code: "operation-in-progress"))
        return
      }
      handleUse(
        arguments: call.arguments,
        operationToken: operationToken,
        result: result
      )
    case "resetCredential":
      guard let operationToken = beginOperation() else {
        result(Self.flutterError(code: "operation-in-progress"))
        return
      }
      handleReset(
        arguments: call.arguments,
        operationToken: operationToken,
        result: result
      )
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func handleCapability(arguments: Any?, result: FlutterResult) {
    guard arguments == nil || arguments is NSNull else {
      result(Self.flutterError(code: "invalid-request"))
      return
    }

    let keyState: String
    let keyUsable: Bool
    switch recoveryKeyStore.state() {
    case .missing:
      keyState = "missing"
      keyUsable = true
    case .available:
      keyState = "available"
      keyUsable = true
    case .corrupt:
      keyState = "corrupt"
      keyUsable = false
    case .unavailable:
      keyState = "unavailable"
      keyUsable = false
    }
    let appAttestSupported = appAttestClient.isSupported
    result([
      "schemaVersion": 1,
      "protocolVersion": BiteSaverDeviceProofTranscript.protocolVersion,
      "platform": "ios",
      "supported": appAttestSupported && keyUsable,
      "appAttestSupported": appAttestSupported,
      "recoveryKeyState": keyState,
    ])
  }

  private func handleEnrollment(
    arguments: Any?,
    operationToken: UUID,
    result: @escaping FlutterResult
  ) {
    do {
      let request = try BiteSaverProofRequest(arguments: arguments)
      let recoveryPublicKey = try recoveryKeyStore.ensurePublicKey()
      let credentialId = try BiteSaverDeviceProofTranscript.credentialId(
        platform: "ios",
        publicKeySha256: Data(SHA256.hash(data: recoveryPublicKey))
      )

      appAttestClient.createAttestation(
        clientDataHashForKeyId: { providerKeyId in
          let canonicalKeyId = try BiteSaverBase64URL.canonicalAppAttestKeyId(providerKeyId)
          return try request.transcript(
            kind: .iosEnrollment,
            credentialId: credentialId,
            recoveryPublicKey: recoveryPublicKey,
            appAttestKeyId: canonicalKeyId
          ).sha256()
        },
        completion: { [weak self] providerResult in
          guard let self else {
            Self.finish(result, value: Self.flutterError(code: "native-unavailable"))
            return
          }
          switch providerResult {
          case .failure(let error):
            self.finishOperation(
              operationToken,
              result: result,
              value: Self.flutterError(code: error.stableCode)
            )
          case .success(let output):
            do {
              let canonicalKeyId = try BiteSaverBase64URL.canonicalAppAttestKeyId(output.keyId)
              let transcript = try request.transcript(
                kind: .iosEnrollment,
                credentialId: credentialId,
                recoveryPublicKey: recoveryPublicKey,
                appAttestKeyId: canonicalKeyId
              ).encode()
              let signature = try self.recoveryKeyStore.signSHA256Digest(
                Data(SHA256.hash(data: transcript))
              )
              try BiteSaverDeviceProofTranscript.validatePossessionSignatureDER(signature)
              self.finishOperation(
                operationToken,
                result: result,
                value: [
                  "schemaVersion": 1,
                  "kind": BiteSaverDeviceProofKind.iosEnrollment.rawValue,
                  "credentialId": credentialId,
                  "recoveryPublicKeyX963": BiteSaverBase64URL.encode(recoveryPublicKey),
                  "appAttestKeyId": canonicalKeyId,
                  "possessionSignature": BiteSaverBase64URL.encode(signature),
                  "attestationObject": BiteSaverBase64URL.encode(output.object),
                ])
            } catch {
              self.finishOperation(
                operationToken,
                result: result,
                value: Self.flutterError(for: error)
              )
            }
          }
        }
      )
    } catch {
      finishOperation(
        operationToken,
        result: result,
        value: Self.flutterError(for: error)
      )
    }
  }

  private func handleUse(
    arguments: Any?,
    operationToken: UUID,
    result: @escaping FlutterResult
  ) {
    do {
      let request = try BiteSaverProofRequest(arguments: arguments)
      let recoveryPublicKey = try recoveryKeyStore.existingPublicKey()
      let credentialId = try BiteSaverDeviceProofTranscript.credentialId(
        platform: "ios",
        publicKeySha256: Data(SHA256.hash(data: recoveryPublicKey))
      )
      let providerKeyId = try appAttestClient.currentKeyId()
      let canonicalKeyId = try BiteSaverBase64URL.canonicalAppAttestKeyId(providerKeyId)
      let transcript = try request.transcript(
        kind: .iosUse,
        credentialId: credentialId,
        recoveryPublicKey: recoveryPublicKey,
        appAttestKeyId: canonicalKeyId
      ).encode()
      let transcriptHash = Data(SHA256.hash(data: transcript))
      let signature = try recoveryKeyStore.signSHA256Digest(transcriptHash)
      let assertionHash = try BiteSaverDeviceProofTranscript.assertionClientDataHash(
        transcriptSha256: transcriptHash,
        possessionSignatureDER: signature
      )

      appAttestClient.createAssertion(clientDataHash: assertionHash) { [weak self] providerResult in
        guard let self else {
          Self.finish(result, value: Self.flutterError(code: "native-unavailable"))
          return
        }
        switch providerResult {
        case .failure(let error):
          self.finishOperation(
            operationToken,
            result: result,
            value: Self.flutterError(code: error.stableCode)
          )
        case .success(let output):
          do {
            let returnedKeyId = try BiteSaverBase64URL.canonicalAppAttestKeyId(output.keyId)
            guard returnedKeyId == canonicalKeyId else {
              throw BiteSaverDeviceProofContractError.invalidBinding
            }
            self.finishOperation(
              operationToken,
              result: result,
              value: [
                "schemaVersion": 1,
                "kind": BiteSaverDeviceProofKind.iosUse.rawValue,
                "credentialId": credentialId,
                "appAttestKeyId": canonicalKeyId,
                "possessionSignature": BiteSaverBase64URL.encode(signature),
                "assertionObject": BiteSaverBase64URL.encode(output.object),
              ])
          } catch {
            self.finishOperation(
              operationToken,
              result: result,
              value: Self.flutterError(for: error)
            )
          }
        }
      }
    } catch {
      finishOperation(
        operationToken,
        result: result,
        value: Self.flutterError(for: error)
      )
    }
  }

  private func handleReset(
    arguments: Any?,
    operationToken: UUID,
    result: @escaping FlutterResult
  ) {
    let expectedKeys: Set<String> = [
      "schemaVersion", "protocolVersion", "platform", "reason",
    ]
    guard let arguments = arguments as? [String: Any],
      Set(arguments.keys) == expectedKeys,
      Self.isSchemaVersionOne(arguments["schemaVersion"]),
      arguments["protocolVersion"] as? String == BiteSaverDeviceProofTranscript.protocolVersion,
      arguments["platform"] as? String == "ios",
      arguments["reason"] as? String == "serverDirectedReenrollment"
    else {
      finishOperation(
        operationToken,
        result: result,
        value: Self.flutterError(code: "invalid-request")
      )
      return
    }
    do {
      try appAttestClient.reset()
      try recoveryKeyStore.reset()
      finishOperation(
        operationToken,
        result: result,
        value: ["schemaVersion": 1, "reset": true]
      )
    } catch {
      finishOperation(
        operationToken,
        result: result,
        value: Self.flutterError(for: error)
      )
    }
  }

  private func beginOperation() -> UUID? {
    operationLock.lock()
    defer { operationLock.unlock() }
    guard activeOperationToken == nil else { return nil }
    let token = UUID()
    activeOperationToken = token
    return token
  }

  private func finishOperation(
    _ token: UUID,
    result: @escaping FlutterResult,
    value: Any
  ) {
    operationLock.lock()
    guard activeOperationToken == token else {
      operationLock.unlock()
      return
    }
    activeOperationToken = nil
    operationLock.unlock()
    Self.finish(result, value: value)
  }

  private static func finish(_ result: @escaping FlutterResult, value: Any) {
    if Thread.isMainThread {
      result(value)
    } else {
      DispatchQueue.main.async { result(value) }
    }
  }

  private static func isSchemaVersionOne(_ value: Any?) -> Bool {
    guard let number = value as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else { return false }
    let type = String(cString: number.objCType)
    return ["c", "s", "i", "l", "q", "C", "S", "I", "L", "Q"].contains(type)
      && number.int64Value == 1
  }

  private static func flutterError(for error: Error) -> FlutterError {
    if let error = error as? BiteSaverDeviceProofContractError {
      return flutterError(code: error.stableCode)
    }
    if let error = error as? BiteSaverRecoveryKeyStoreError {
      return flutterError(code: error.stableCode)
    }
    if let error = error as? BiteSaverAppAttestError {
      return flutterError(code: error.stableCode)
    }
    return flutterError(code: "native-failure")
  }

  private static func flutterError(code: String) -> FlutterError {
    FlutterError(
      code: code,
      message: "The device proof operation could not be completed.",
      details: nil
    )
  }
}
