import CryptoKit
import DeviceCheck
import Flutter
import Security
import XCTest

@testable import Runner

final class RunnerTests: XCTestCase {
  func testCanonicalTranscriptMatchesSharedGoldenVector() throws {
    let challenge = Data((0..<32).map(UInt8.init))
    let androidKeyHash = Data((0x20..<0x40).map(UInt8.init))
    let credentialId = try BiteSaverDeviceProofTranscript.credentialId(
      platform: "android",
      publicKeySha256: androidKeyHash
    )
    XCTAssertEqual(
      credentialId,
      "bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI"
    )

    let transcript = BiteSaverDeviceProofTranscript(
      protocolVersion: BiteSaverDeviceProofTranscript.protocolVersion,
      proofKind: .androidEnrollment,
      platform: "android",
      purpose: BiteSaverDeviceProofTranscript.purpose,
      challengeId: "bsdc_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      challengeBytes: challenge,
      requestFingerprint: challenge,
      authenticatedUserId: nil,
      origin: "discovery",
      logicalRequestId: "device-use-request-0001",
      issuedAtMillis: 1_789_617_600_000,
      validFromMillis: 1_789_617_600_000,
      expiresAtMillis: 1_789_617_720_000,
      credentialId: credentialId,
      androidInstallationPublicKeySha256: androidKeyHash,
      androidSsaidUtf8: Data("0123456789abcdef".utf8),
      iosRecoveryPublicKeyX963: nil,
      iosAppAttestKeyId: nil
    )

    let encoded = try transcript.encode()
    XCTAssertEqual(encoded.count, 441)
    XCTAssertEqual(
      hex(try transcript.sha256()),
      "958ae8084cbc061695525386fbbcd3eabbdfd566ab11fc422e72381992cb5b17"
    )
    XCTAssertEqual(
      BiteSaverBase64URL.encode(try transcript.sha256()),
      "lYroCEy8BhaVUlOG-7zT6rvf1WarEfxCLnI4GZLLWxc"
    )
  }

  func testAssertionEnvelopeHashIsFrozen() throws {
    let transcriptHash = try XCTUnwrap(
      Data(
        hexadecimal:
          "958ae8084cbc061695525386fbbcd3eabbdfd566ab11fc422e72381992cb5b17"
      ))
    let derSignature = try XCTUnwrap(
      Data(
        hexadecimal:
          "304402200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
          + "02202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40"
      ))
    let hash = try BiteSaverDeviceProofTranscript.assertionClientDataHash(
      transcriptSha256: transcriptHash,
      possessionSignatureDER: derSignature
    )
    XCTAssertEqual(
      try BiteSaverDeviceProofTranscript.assertionEnvelope(
        transcriptSha256: transcriptHash,
        possessionSignatureDER: derSignature
      ).count,
      153
    )
    XCTAssertEqual(
      hex(hash),
      "956ea8ac7ede8f18c83f9c8e81105d9d3a72b870ba5210cad2e28942b0041329"
    )
    XCTAssertEqual(BiteSaverBase64URL.encode(hash), "lW6orH7ejxjIP5yOgRBdnTpyuHC6UhDK0uKJQrAEEyk")
  }

  func testBase64UrlRejectsPaddingAndNonCanonicalInput() throws {
    let bytes = Data((0..<32).map(UInt8.init))
    let encoded = BiteSaverBase64URL.encode(bytes)
    XCTAssertEqual(try BiteSaverBase64URL.decodeCanonical(encoded, maximumBytes: 32), bytes)
    XCTAssertThrowsError(try BiteSaverBase64URL.decodeCanonical(encoded + "=", maximumBytes: 32))
    XCTAssertThrowsError(try BiteSaverBase64URL.decodeCanonical("AA+_", maximumBytes: 32))
    XCTAssertEqual(
      try BiteSaverBase64URL.canonicalAppAttestKeyId(bytes.base64EncodedString()),
      encoded
    )
    XCTAssertThrowsError(
      try BiteSaverBase64URL.canonicalAppAttestKeyId(
        Data(repeating: 0, count: 16).base64EncodedString()
      )
    )
  }

  func testFrozenBindingValidationRejectsPaddedAndOversizedValues() throws {
    XCTAssertNoThrow(try BiteSaverDeviceProofTranscript.validateAuthenticatedUserId("café_user"))
    XCTAssertNoThrow(try BiteSaverDeviceProofTranscript.validateAuthenticatedUserId("user name"))
    for invalid in [
      "", " user", "user ", ".", "..", "a/b", "__reserved__", "line\nfeed",
      "delete\u{7f}", String(repeating: "a", count: 129),
    ] {
      XCTAssertThrowsError(
        try BiteSaverDeviceProofTranscript.validateAuthenticatedUserId(invalid),
        "UID should fail: \(invalid.debugDescription)"
      )
    }

    let challenge = Data((0..<32).map(UInt8.init))
    XCTAssertNoThrow(
      try BiteSaverDeviceProofTranscript.validateChallengeBinding(
        challengeId: "bsdc_" + BiteSaverBase64URL.encode(challenge),
        challengeBytes: challenge
      )
    )
    XCTAssertThrowsError(
      try BiteSaverDeviceProofTranscript.validateChallengeBinding(
        challengeId: "bsdc_" + BiteSaverBase64URL.encode(Data(repeating: 0xff, count: 32)),
        challengeBytes: challenge
      )
    )

    XCTAssertNoThrow(
      try BiteSaverDeviceProofTranscript.validateLogicalRequestId("request_id-00001")
    )
    XCTAssertThrowsError(
      try BiteSaverDeviceProofTranscript.validateLogicalRequestId("too-short")
    )
    XCTAssertThrowsError(
      try BiteSaverDeviceProofTranscript.validateLogicalRequestId("request.id-is-not-allowed")
    )
    XCTAssertNoThrow(
      try BiteSaverDeviceProofTranscript.validateChallengeTimes(
        issuedAtMillis: 1_000,
        validFromMillis: 1_000,
        expiresAtMillis: 121_000
      )
    )
    XCTAssertThrowsError(
      try BiteSaverDeviceProofTranscript.validateChallengeTimes(
        issuedAtMillis: 1_000,
        validFromMillis: 1_000,
        expiresAtMillis: 121_001
      )
    )
  }

  func testRecoveryKeyAttributesAreThisDeviceOnlyAndNonSynchronizing() {
    let attributes = BiteSaverRecoveryKeyStore.privateKeyAttributes(
      applicationTag: Data("unit-test".utf8)
    )
    let privateAttributes = attributes[kSecPrivateKeyAttrs] as? [CFString: Any]
    XCTAssertEqual(
      privateAttributes?[kSecAttrAccessible] as? String,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String
    )
    XCTAssertEqual(privateAttributes?[kSecAttrSynchronizable] as? Bool, false)
    XCTAssertNil(privateAttributes?[kSecAttrAccessControl])
  }

  func testAppAttestMetadataAttributesAreThisDeviceOnlyAndNonSynchronizing() {
    let attributes = BiteSaverAppAttestKeyStore.addAttributes(encodedRecord: Data([1]))
    XCTAssertEqual(
      attributes[kSecAttrAccessible] as? String,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String
    )
    XCTAssertEqual(attributes[kSecAttrSynchronizable] as? Bool, false)
    XCTAssertNil(attributes[kSecAttrAccessControl])
  }

  func testRecoveryKeyCreateReadAndSignDigest() throws {
    let tag = Data("com.colesmart.bitestar.tests.\(UUID().uuidString)".utf8)
    let store = BiteSaverRecoveryKeyStore(applicationTag: tag)
    defer { try? store.reset() }

    XCTAssertEqual(store.state(), .missing)
    let publicKey = try store.ensurePublicKey()
    XCTAssertEqual(publicKey.count, 65)
    XCTAssertEqual(publicKey.first, 0x04)
    XCTAssertEqual(try store.existingPublicKey(), publicKey)

    let digest = Data(SHA256.hash(data: Data("proof transcript".utf8)))
    let signature = try store.signSHA256Digest(digest)
    let attributes: [CFString: Any] = [
      kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass: kSecAttrKeyClassPublic,
      kSecAttrKeySizeInBits: 256,
    ]
    var error: Unmanaged<CFError>?
    let verifyingKey = SecKeyCreateWithData(publicKey as CFData, attributes as CFDictionary, &error)
    XCTAssertNotNil(verifyingKey)
    XCTAssertTrue(
      SecKeyVerifySignature(
        try XCTUnwrap(verifyingKey),
        .ecdsaSignatureDigestX962SHA256,
        digest as CFData,
        signature as CFData,
        &error
      )
    )
  }

  func testAppAttestAdapterAttestsThenAssertsWithoutRealProviderCall() throws {
    let provider = FakeAppAttestService()
    let keyStore = MemoryAppAttestKeyStore()
    let client = BiteSaverAppAttestClient(service: provider, keyStore: keyStore)
    let expectedHash = Data(repeating: 0x5a, count: 32)

    var attestation: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAttestation(
      clientDataHashForKeyId: { keyId in
        XCTAssertEqual(keyId, provider.providerKeyId)
        return expectedHash
      },
      completion: { attestation = $0 }
    )
    XCTAssertEqual(try attestation?.get().object, provider.attestationObject)
    XCTAssertEqual(provider.lastAttestationHash, expectedHash)
    XCTAssertEqual(try client.currentKeyId(), provider.providerKeyId)

    var assertion: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAssertion(clientDataHash: expectedHash) { assertion = $0 }
    XCTAssertEqual(try assertion?.get().object, provider.assertionObject)
    XCTAssertEqual(provider.lastAssertionHash, expectedHash)
  }

  func testAppAttestAdapterReturnsTypedUnsupportedError() {
    let provider = FakeAppAttestService()
    provider.isSupported = false
    let client = BiteSaverAppAttestClient(
      service: provider,
      keyStore: MemoryAppAttestKeyStore()
    )
    var response: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAssertion(clientDataHash: Data(repeating: 0, count: 32)) { response = $0 }
    guard case .failure(.unsupported)? = response else {
      return XCTFail("Expected the stable unsupported result")
    }
  }

  func testConcurrentEnrollmentCannotCompleteOutOfOrder() throws {
    let provider = DeferredAppAttestService()
    let keyStore = MemoryAppAttestKeyStore()
    let client = BiteSaverAppAttestClient(service: provider, keyStore: keyStore)
    let expectedHash = Data(repeating: 0x7a, count: 32)

    var first: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAttestation(
      clientDataHashForKeyId: { _ in expectedHash },
      completion: { first = $0 }
    )
    XCTAssertNil(first)
    XCTAssertEqual(provider.generateKeyCallCount, 1)
    XCTAssertEqual(provider.attestCallCount, 1)

    var overlapping: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAttestation(
      clientDataHashForKeyId: { _ in Data(repeating: 0x6b, count: 32) },
      completion: { overlapping = $0 }
    )
    guard case .failure(.operationInProgress)? = overlapping else {
      return XCTFail("Expected the overlapping enrollment to be rejected")
    }
    XCTAssertEqual(provider.generateKeyCallCount, 1)
    XCTAssertEqual(provider.attestCallCount, 1)

    provider.completeAttestation()
    XCTAssertEqual(try first?.get().keyId, provider.providerKeyId)
    XCTAssertEqual(try client.currentKeyId(), provider.providerKeyId)
  }

  func testLateAttestationCannotActivateSupersedingPendingKey() throws {
    let provider = DeferredAppAttestService()
    let keyStore = MemoryAppAttestKeyStore()
    let client = BiteSaverAppAttestClient(service: provider, keyStore: keyStore)
    let firstHash = Data(repeating: 0x11, count: 32)
    let newerHash = Data(repeating: 0x22, count: 32)
    let newerKeyId = Data(repeating: 0x44, count: 32).base64EncodedString()

    var response: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAttestation(
      clientDataHashForKeyId: { _ in firstHash },
      completion: { response = $0 }
    )
    keyStore.savePending(keyId: newerKeyId, clientDataHash: newerHash)

    provider.completeAttestation()
    guard case .failure(.operationSuperseded)? = response else {
      return XCTFail("Expected the stale attestation callback to be fenced")
    }
    let record = try keyStore.read()
    XCTAssertTrue(record.isPending)
    XCTAssertEqual(record.keyId, newerKeyId)
    XCTAssertEqual(record.pendingHash, newerHash)
  }

  func testInterruptedPendingEnrollmentIsRetriedWithoutGeneratingAnotherKey() throws {
    let provider = FakeAppAttestService()
    let keyStore = MemoryAppAttestKeyStore()
    let expectedHash = Data(repeating: 0x5c, count: 32)
    keyStore.savePending(keyId: provider.providerKeyId, clientDataHash: expectedHash)
    let client = BiteSaverAppAttestClient(service: provider, keyStore: keyStore)

    var response: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAttestation(
      clientDataHashForKeyId: { keyId in
        XCTAssertEqual(keyId, provider.providerKeyId)
        return expectedHash
      },
      completion: { response = $0 }
    )

    XCTAssertEqual(try response?.get().object, provider.attestationObject)
    XCTAssertEqual(provider.generateKeyCallCount, 0)
    XCTAssertEqual(provider.attestCallCount, 1)
    XCTAssertEqual(try client.currentKeyId(), provider.providerKeyId)
  }

  func testOversizedAssertionObjectFailsClosed() throws {
    let provider = FakeAppAttestService()
    provider.assertionObject = Data(repeating: 0xa5, count: 16_385)
    let keyStore = MemoryAppAttestKeyStore()
    let hash = Data(repeating: 0x33, count: 32)
    keyStore.savePending(keyId: provider.providerKeyId, clientDataHash: hash)
    try keyStore.activatePending(keyId: provider.providerKeyId, clientDataHash: hash)
    let client = BiteSaverAppAttestClient(service: provider, keyStore: keyStore)

    var response: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>?
    client.createAssertion(clientDataHash: hash) { response = $0 }
    guard case .failure(.providerFailure)? = response else {
      return XCTFail("Expected an oversized assertion to fail closed")
    }
  }

  func testProviderErrorsAreSanitized() {
    let raw = NSError(
      domain: DCErrorDomain,
      code: DCError.invalidKey.rawValue,
      userInfo: [NSLocalizedDescriptionKey: "sensitive provider detail"]
    )
    let mapped = BiteSaverAppAttestClient.mapProviderError(raw)
    XCTAssertEqual(mapped, .invalidKey)
    XCTAssertEqual(mapped.stableCode, "corrupt-credential")
    XCTAssertFalse(mapped.stableCode.contains("sensitive"))
  }

  func testBridgeRealCodecAcceptsIntegerZeroOneAndLargeChallengeTimes() throws {
    let validIssuedTimes: [Int64] = [0, 1, 1_789_617_600_000, 9_007_199_254_620_991]
    for issuedAt in validIssuedTimes {
      let messenger = TestProofMessenger()
      let store = makeBridgeRecoveryStore()
      defer { try? store.reset() }
      let provider = FakeAppAttestService()
      let bridge = BiteSaverDeviceProofBridge(
        binaryMessenger: messenger,
        recoveryKeyStore: store,
        appAttestClient: BiteSaverAppAttestClient(
          service: provider,
          keyStore: MemoryAppAttestKeyStore()
        )
      )
      let request = bridgeProofArguments(issuedAtMillis: issuedAt)
      let wire = FlutterStandardMethodCodec.sharedInstance().encode(
        FlutterMethodCall(methodName: "createEnrollmentProof", arguments: request)
      )
      let decoded = FlutterStandardMethodCodec.sharedInstance().decodeMethodCall(wire)
      let decodedArguments = try XCTUnwrap(decoded.arguments as? [String: Any])
      let decodedInteger = try XCTUnwrap(decodedArguments["issuedAtMillis"] as? NSNumber)
      XCTAssertNotEqual(CFGetTypeID(decodedInteger), CFBooleanGetTypeID())
      XCTAssertEqual(decodedInteger.int64Value, issuedAt)

      let enrollment = try invokeBridge(
        messenger,
        method: "createEnrollmentProof",
        arguments: request
      )
      XCTAssertEqual(
        (enrollment as? [String: Any])?["kind"] as? String,
        BiteSaverDeviceProofKind.iosEnrollment.rawValue,
        "Integer \(issuedAt) must survive the real Flutter codec: \(enrollment)"
      )
      let use = try invokeBridge(messenger, method: "createUseProof", arguments: request)
      XCTAssertEqual(
        (use as? [String: Any])?["kind"] as? String,
        BiteSaverDeviceProofKind.iosUse.rawValue
      )
      XCTAssertEqual(provider.generateKeyCallCount, 1)
      XCTAssertEqual(provider.attestCallCount, 1)
      XCTAssertNotNil(provider.lastAssertionHash)
      withExtendedLifetime(bridge) {}
    }
  }

  func testBridgeRealCodecRejectsBooleanFractionalNegativeAndOutOfRangeNumbers() throws {
    let messenger = TestProofMessenger()
    let store = makeBridgeRecoveryStore()
    defer { try? store.reset() }
    let provider = FakeAppAttestService()
    let bridge = BiteSaverDeviceProofBridge(
      binaryMessenger: messenger,
      recoveryKeyStore: store,
      appAttestClient: BiteSaverAppAttestClient(
        service: provider,
        keyStore: MemoryAppAttestKeyStore()
      )
    )
    let invalidNumbers: [NSNumber] = [
      NSNumber(value: true), NSNumber(value: false), NSNumber(value: 1.5),
      NSNumber(value: -1), NSNumber(value: Int64(9_007_199_254_740_992)),
      NSNumber(value: Int64.max),
    ]
    for method in ["createEnrollmentProof", "createUseProof"] {
      for field in ["schemaVersion", "issuedAtMillis", "validFromMillis", "expiresAtMillis"] {
        for number in invalidNumbers {
          var arguments = bridgeProofArguments()
          arguments[field] = number
          let response = try invokeBridge(messenger, method: method, arguments: arguments)
          XCTAssertEqual(
            (response as? FlutterError)?.code,
            "invalid-request",
            "\(method) must reject \(field)=\(number)"
          )
        }
      }
    }
    XCTAssertEqual(store.state(), .missing)
    XCTAssertEqual(provider.generateKeyCallCount, 0)
    XCTAssertEqual(provider.attestCallCount, 0)
    XCTAssertNil(provider.lastAssertionHash)
    withExtendedLifetime(bridge) {}
  }

  func testBridgeRealCodecResetRequiresIntegerSchemaOne() throws {
    let messenger = TestProofMessenger()
    let store = makeBridgeRecoveryStore()
    defer { try? store.reset() }
    let publicKey = try store.ensurePublicKey()
    let provider = FakeAppAttestService()
    let appAttestStore = MemoryAppAttestKeyStore()
    appAttestStore.savePending(
      keyId: provider.providerKeyId,
      clientDataHash: Data(repeating: 0, count: 32)
    )
    let bridge = BiteSaverDeviceProofBridge(
      binaryMessenger: messenger,
      recoveryKeyStore: store,
      appAttestClient: BiteSaverAppAttestClient(service: provider, keyStore: appAttestStore)
    )
    var arguments: [String: Any] = [
      "schemaVersion": 1,
      "protocolVersion": BiteSaverDeviceProofTranscript.protocolVersion,
      "platform": "ios",
      "reason": "serverDirectedReenrollment",
    ]
    let rejectedSchemaVersions: [NSNumber] = [
      NSNumber(value: 0), NSNumber(value: 2), NSNumber(value: Int64(1_789_617_600_000)),
      NSNumber(value: true), NSNumber(value: false), NSNumber(value: 1.5),
      NSNumber(value: -1), NSNumber(value: Int64(9_007_199_254_740_992)),
    ]
    for version in rejectedSchemaVersions {
      arguments["schemaVersion"] = version
      let response = try invokeBridge(messenger, method: "resetCredential", arguments: arguments)
      XCTAssertEqual((response as? FlutterError)?.code, "invalid-request")
      XCTAssertEqual(store.state(), .available(publicKeyX963: publicKey))
      XCTAssertNoThrow(try appAttestStore.read())
    }
    arguments["schemaVersion"] = 1
    let response = try invokeBridge(messenger, method: "resetCredential", arguments: arguments)
    XCTAssertEqual((response as? [String: Any])?["reset"] as? Bool, true)
    XCTAssertEqual(store.state(), .missing)
    XCTAssertThrowsError(try appAttestStore.read())
    XCTAssertEqual(provider.generateKeyCallCount, 0)
    XCTAssertEqual(provider.attestCallCount, 0)
    XCTAssertNil(provider.lastAssertionHash)
    withExtendedLifetime(bridge) {}
  }

  func testBridgeRealCodecCapabilityRetainsArgumentAndResponseShape() throws {
    let messenger = TestProofMessenger()
    let store = makeBridgeRecoveryStore()
    defer { try? store.reset() }
    let provider = FakeAppAttestService()
    let bridge = BiteSaverDeviceProofBridge(
      binaryMessenger: messenger,
      recoveryKeyStore: store,
      appAttestClient: BiteSaverAppAttestClient(
        service: provider,
        keyStore: MemoryAppAttestKeyStore()
      )
    )
    for arguments: Any? in [nil, NSNull()] {
      let response = try invokeBridge(messenger, method: "getCapability", arguments: arguments)
      let capability = try XCTUnwrap(response as? [String: Any])
      let version = try XCTUnwrap(capability["schemaVersion"] as? NSNumber)
      XCTAssertEqual(version.int64Value, 1)
      XCTAssertNotEqual(CFGetTypeID(version), CFBooleanGetTypeID())
      XCTAssertEqual(capability["supported"] as? Bool, true)
      XCTAssertEqual(capability["recoveryKeyState"] as? String, "missing")
    }
    for invalid: Any in [0, 1, true, false, 1.5, -1] {
      let response = try invokeBridge(messenger, method: "getCapability", arguments: invalid)
      XCTAssertEqual((response as? FlutterError)?.code, "invalid-request")
    }
    XCTAssertEqual(provider.generateKeyCallCount, 0)
    XCTAssertEqual(provider.attestCallCount, 0)
    XCTAssertNil(provider.lastAssertionHash)
    withExtendedLifetime(bridge) {}
  }

  private func makeBridgeRecoveryStore() -> BiteSaverRecoveryKeyStore {
    BiteSaverRecoveryKeyStore(
      applicationTag: Data("com.colesmart.bitestar.tests.bridge.\(UUID().uuidString)".utf8)
    )
  }

  private func bridgeProofArguments(issuedAtMillis: Int64 = 1_789_617_600_000) -> [String: Any] {
    let challenge = Data((0..<32).map(UInt8.init))
    return [
      "schemaVersion": 1,
      "protocolVersion": BiteSaverDeviceProofTranscript.protocolVersion,
      "platform": "ios",
      "purpose": BiteSaverDeviceProofTranscript.purpose,
      "challengeId": "bsdc_" + BiteSaverBase64URL.encode(challenge),
      "challengeBytes": BiteSaverBase64URL.encode(challenge),
      "requestFingerprint": String(repeating: "ab", count: 32),
      "authenticatedUserId": NSNull(),
      "origin": "discovery",
      "logicalRequestId": "device-use-request-0001",
      "issuedAtMillis": issuedAtMillis,
      "validFromMillis": issuedAtMillis,
      "expiresAtMillis": issuedAtMillis + 120_000,
    ]
  }

  private func invokeBridge(
    _ messenger: TestProofMessenger,
    method: String,
    arguments: Any?
  ) throws -> Any {
    let reply = expectation(description: "Native bridge reply for \(method)")
    let codec = FlutterStandardMethodCodec.sharedInstance()
    let message = codec.encode(FlutterMethodCall(methodName: method, arguments: arguments))
    let handler = try XCTUnwrap(messenger.handler)
    var response: Any?
    handler(message) { data in
      if let data { response = codec.decodeEnvelope(data) }
      reply.fulfill()
    }
    wait(for: [reply], timeout: 5)
    return try XCTUnwrap(response)
  }

  private func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}

private final class TestProofMessenger: NSObject, FlutterBinaryMessenger {
  var handler: FlutterBinaryMessageHandler?

  func send(onChannel channel: String, message: Data?) {}

  func send(onChannel channel: String, message: Data?, binaryReply callback: FlutterBinaryReply?) {}

  func setMessageHandlerOnChannel(
    _ channel: String,
    binaryMessageHandler handler: FlutterBinaryMessageHandler?
  ) -> FlutterBinaryMessengerConnection {
    self.handler = handler
    return 1
  }

  func cleanUpConnection(_ connection: FlutterBinaryMessengerConnection) {
    handler = nil
  }
}

extension Data {
  fileprivate init?(hexadecimal: String) {
    guard hexadecimal.count.isMultiple(of: 2) else { return nil }
    var output = Data(capacity: hexadecimal.count / 2)
    var index = hexadecimal.startIndex
    while index < hexadecimal.endIndex {
      let next = hexadecimal.index(index, offsetBy: 2)
      guard let byte = UInt8(hexadecimal[index..<next], radix: 16) else { return nil }
      output.append(byte)
      index = next
    }
    self = output
  }
}

private final class MemoryAppAttestKeyStore: BiteSaverAppAttestKeyStoring {
  private var value: (keyId: String, isPending: Bool, pendingHash: Data?)?

  func read() throws -> (keyId: String, isPending: Bool, pendingHash: Data?) {
    guard let value else { throw BiteSaverAppAttestError.localStateMissing }
    return value
  }

  func savePending(keyId: String, clientDataHash: Data) {
    value = (keyId, true, clientDataHash)
  }

  func activatePending(keyId: String, clientDataHash: Data) throws {
    guard let current = value,
      current.isPending,
      current.keyId == keyId,
      current.pendingHash == clientDataHash
    else {
      throw BiteSaverAppAttestError.operationSuperseded
    }
    value = (keyId, false, nil)
  }

  func reset() {
    value = nil
  }
}

private final class FakeAppAttestService: BiteSaverAppAttestServicing {
  var isSupported = true
  let providerKeyId = Data((0..<32).map(UInt8.init)).base64EncodedString()
  let attestationObject = Data([0xa1, 0x01, 0x02])
  var assertionObject = Data([0xa2, 0x01, 0x02])
  var lastAttestationHash: Data?
  var lastAssertionHash: Data?
  private(set) var generateKeyCallCount = 0
  private(set) var attestCallCount = 0

  func generateKey(completionHandler: @escaping @Sendable (String?, Error?) -> Void) {
    generateKeyCallCount += 1
    completionHandler(providerKeyId, nil)
  }

  func attestKey(
    _ keyId: String,
    clientDataHash: Data,
    completionHandler: @escaping @Sendable (Data?, Error?) -> Void
  ) {
    attestCallCount += 1
    lastAttestationHash = clientDataHash
    completionHandler(attestationObject, nil)
  }

  func generateAssertion(
    _ keyId: String,
    clientDataHash: Data,
    completionHandler: @escaping @Sendable (Data?, Error?) -> Void
  ) {
    lastAssertionHash = clientDataHash
    completionHandler(assertionObject, nil)
  }
}

private final class DeferredAppAttestService: BiteSaverAppAttestServicing {
  var isSupported = true
  let providerKeyId = Data((0x40..<0x60).map(UInt8.init)).base64EncodedString()
  let attestationObject = Data([0xa1, 0x02, 0x03])
  private(set) var generateKeyCallCount = 0
  private(set) var attestCallCount = 0
  private var attestationCompletion: (@Sendable (Data?, Error?) -> Void)?

  func generateKey(completionHandler: @escaping @Sendable (String?, Error?) -> Void) {
    generateKeyCallCount += 1
    completionHandler(providerKeyId, nil)
  }

  func attestKey(
    _ keyId: String,
    clientDataHash: Data,
    completionHandler: @escaping @Sendable (Data?, Error?) -> Void
  ) {
    attestCallCount += 1
    attestationCompletion = completionHandler
  }

  func generateAssertion(
    _ keyId: String,
    clientDataHash: Data,
    completionHandler: @escaping @Sendable (Data?, Error?) -> Void
  ) {
    completionHandler(nil, NSError(domain: DCErrorDomain, code: DCError.invalidKey.rawValue))
  }

  func completeAttestation() {
    let completion = attestationCompletion
    attestationCompletion = nil
    completion?(attestationObject, nil)
  }
}
