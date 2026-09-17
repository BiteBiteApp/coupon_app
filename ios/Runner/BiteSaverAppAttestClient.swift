@preconcurrency import DeviceCheck
import Foundation
import Security

enum BiteSaverAppAttestError: Error, Equatable {
  case unsupported
  case invalidInput
  case invalidKey
  case serverUnavailable
  case providerFailure
  case operationInProgress
  case operationSuperseded
  case localStateMissing
  case localStateCorrupt
  case localStateUnavailable

  var stableCode: String {
    switch self {
    case .unsupported:
      return "unsupported-app-attest"
    case .invalidInput:
      return "invalid-request"
    case .invalidKey:
      return "corrupt-credential"
    case .serverUnavailable:
      return "provider-unavailable"
    case .providerFailure:
      return "provider-failed"
    case .operationInProgress:
      return "operation-in-progress"
    case .operationSuperseded:
      return "operation-superseded"
    case .localStateMissing:
      return "missing-credential"
    case .localStateCorrupt:
      return "corrupt-credential"
    case .localStateUnavailable:
      return "credential-unavailable"
    }
  }
}

struct BiteSaverAppAttestOutput: Equatable {
  let keyId: String
  let object: Data
}

protocol BiteSaverAppAttestServicing: AnyObject {
  var isSupported: Bool { get }

  func generateKey(completionHandler: @escaping @Sendable (String?, Error?) -> Void)

  func attestKey(
    _ keyId: String,
    clientDataHash: Data,
    completionHandler: @escaping @Sendable (Data?, Error?) -> Void
  )

  func generateAssertion(
    _ keyId: String,
    clientDataHash: Data,
    completionHandler: @escaping @Sendable (Data?, Error?) -> Void
  )
}

extension DCAppAttestService: BiteSaverAppAttestServicing {}

private struct BiteSaverAppAttestKeyRecord: Codable, Equatable {
  enum State: String, Codable {
    case pendingAttestation
    case active
  }

  let schemaVersion: Int
  let keyId: String
  let state: State
  let pendingClientDataHash: Data?

  func validate() throws {
    guard schemaVersion == 1,
      !keyId.isEmpty,
      keyId.utf8.count <= 512,
      keyId.unicodeScalars.allSatisfy({ scalar in
        scalar.isASCII && scalar.value >= 0x21 && scalar.value <= 0x7e
      })
    else {
      throw BiteSaverAppAttestError.localStateCorrupt
    }
    switch state {
    case .pendingAttestation:
      guard pendingClientDataHash == nil || pendingClientDataHash?.count == 32 else {
        throw BiteSaverAppAttestError.localStateCorrupt
      }
    case .active:
      guard pendingClientDataHash == nil else {
        throw BiteSaverAppAttestError.localStateCorrupt
      }
    }
  }
}

protocol BiteSaverAppAttestKeyStoring: AnyObject {
  func read() throws -> (keyId: String, isPending: Bool, pendingHash: Data?)
  func savePending(keyId: String, clientDataHash: Data) throws
  func activatePending(keyId: String, clientDataHash: Data) throws
  func reset() throws
}

/// Persists only the opaque App Attest key identifier and retry state. Apple
/// retains the corresponding private key. This item never synchronizes and is
/// intentionally lost with this device's app Keychain state.
final class BiteSaverAppAttestKeyStore: BiteSaverAppAttestKeyStoring {
  static let service = "com.colesmart.bitestar.bitesaver.app-attest-key.v1"
  static let account = "current"
  private static let accessLock = NSLock()

  func read() throws -> (keyId: String, isPending: Bool, pendingHash: Data?) {
    Self.accessLock.lock()
    defer { Self.accessLock.unlock() }
    return try readUnlocked()
  }

  private func readUnlocked() throws -> (keyId: String, isPending: Bool, pendingHash: Data?) {
    var query = baseQuery()
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      throw BiteSaverAppAttestError.localStateMissing
    }
    guard status == errSecSuccess else {
      throw BiteSaverAppAttestError.localStateUnavailable
    }
    guard let data = item as? Data else {
      throw BiteSaverAppAttestError.localStateCorrupt
    }

    do {
      let record = try JSONDecoder().decode(BiteSaverAppAttestKeyRecord.self, from: data)
      try record.validate()
      return (
        keyId: record.keyId,
        isPending: record.state == .pendingAttestation,
        pendingHash: record.pendingClientDataHash
      )
    } catch let error as BiteSaverAppAttestError {
      throw error
    } catch {
      throw BiteSaverAppAttestError.localStateCorrupt
    }
  }

  func savePending(keyId: String, clientDataHash: Data) throws {
    Self.accessLock.lock()
    defer { Self.accessLock.unlock() }
    try saveUnlocked(
      BiteSaverAppAttestKeyRecord(
        schemaVersion: 1,
        keyId: keyId,
        state: .pendingAttestation,
        pendingClientDataHash: clientDataHash
      )
    )
  }

  /// Activates only the exact pending key/hash pair that produced the
  /// attestation response. A late callback can therefore never replace a
  /// newer pending or active key record.
  func activatePending(keyId: String, clientDataHash: Data) throws {
    Self.accessLock.lock()
    defer { Self.accessLock.unlock() }
    let current = try readUnlocked()
    guard current.isPending,
      current.keyId == keyId,
      current.pendingHash == clientDataHash
    else {
      throw BiteSaverAppAttestError.operationSuperseded
    }
    try saveUnlocked(
      BiteSaverAppAttestKeyRecord(
        schemaVersion: 1,
        keyId: keyId,
        state: .active,
        pendingClientDataHash: nil
      )
    )
  }

  func reset() throws {
    Self.accessLock.lock()
    defer { Self.accessLock.unlock() }
    let status = SecItemDelete(baseQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw BiteSaverAppAttestError.localStateUnavailable
    }
  }

  static func addAttributes(encodedRecord: Data) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAttrSynchronizable: false,
      kSecValueData: encodedRecord,
    ]
  }

  private func saveUnlocked(_ record: BiteSaverAppAttestKeyRecord) throws {
    try record.validate()
    let encoded: Data
    do {
      encoded = try JSONEncoder().encode(record)
    } catch {
      throw BiteSaverAppAttestError.localStateCorrupt
    }

    let updateStatus = SecItemUpdate(
      baseQuery() as CFDictionary,
      [kSecValueData: encoded] as CFDictionary
    )
    if updateStatus == errSecSuccess {
      return
    }
    guard updateStatus == errSecItemNotFound else {
      throw BiteSaverAppAttestError.localStateUnavailable
    }
    let addStatus = SecItemAdd(Self.addAttributes(encodedRecord: encoded) as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw BiteSaverAppAttestError.localStateUnavailable
    }
  }

  private func baseQuery() -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: Self.service,
      kSecAttrAccount: Self.account,
      kSecAttrSynchronizable: false,
    ]
  }
}

/// Narrow adapter around DCAppAttestService. It never performs provider work
/// unless an explicit enrollment or coupon-use bridge call reaches it.
final class BiteSaverAppAttestClient {
  private let service: BiteSaverAppAttestServicing
  private let keyStore: BiteSaverAppAttestKeyStoring
  private let operationLock = NSLock()
  private var activeOperationToken: UUID?

  init(
    service: BiteSaverAppAttestServicing = DCAppAttestService.shared,
    keyStore: BiteSaverAppAttestKeyStoring = BiteSaverAppAttestKeyStore()
  ) {
    self.service = service
    self.keyStore = keyStore
  }

  var isSupported: Bool { service.isSupported }

  /// Generates and attests a fresh App Attest key. If Apple reports a
  /// retryable outage, the same pending key and clientDataHash are reused on
  /// the next identical explicit request, per Apple's guidance.
  func createAttestation(
    clientDataHashForKeyId: @escaping (String) throws -> Data,
    completion: @escaping (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void
  ) {
    guard service.isSupported else {
      completion(.failure(.unsupported))
      return
    }
    guard let operationToken = beginOperation() else {
      completion(.failure(.operationInProgress))
      return
    }
    let finish: (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void = {
      [weak self] response in
      self?.finishOperation(
        operationToken,
        response: response,
        completion: completion
      )
    }

    do {
      let pending = try keyStore.read()
      if pending.isPending {
        let hash = try clientDataHashForKeyId(pending.keyId)
        guard hash.count == 32 else {
          finish(.failure(.invalidInput))
          return
        }
        if pending.pendingHash == nil || pending.pendingHash == hash {
          try keyStore.savePending(keyId: pending.keyId, clientDataHash: hash)
          attest(keyId: pending.keyId, clientDataHash: hash, completion: finish)
          return
        }
      }
    } catch BiteSaverAppAttestError.localStateMissing {
      // The first enrollment is expected to have no App Attest key metadata.
    } catch let localError as BiteSaverAppAttestError {
      finish(.failure(localError))
      return
    } catch {
      // Contract-builder failures are sanitized as invalid input.
      finish(.failure(.invalidInput))
      return
    }

    generateAndAttest(
      clientDataHashForKeyId: clientDataHashForKeyId,
      completion: finish
    )
  }

  private func generateAndAttest(
    clientDataHashForKeyId: @escaping (String) throws -> Data,
    completion: @escaping (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void
  ) {
    service.generateKey { [weak self] keyId, error in
      guard let self else { return }
      if let error {
        completion(.failure(Self.mapProviderError(error)))
        return
      }
      guard let keyId, Self.isValidKeyId(keyId) else {
        completion(.failure(.providerFailure))
        return
      }
      let clientDataHash: Data
      do {
        clientDataHash = try clientDataHashForKeyId(keyId)
        guard clientDataHash.count == 32 else {
          completion(.failure(.invalidInput))
          return
        }
        try self.keyStore.savePending(keyId: keyId, clientDataHash: clientDataHash)
      } catch let localError as BiteSaverAppAttestError {
        completion(.failure(localError))
        return
      } catch {
        completion(.failure(.invalidInput))
        return
      }
      self.attest(keyId: keyId, clientDataHash: clientDataHash, completion: completion)
    }
  }

  func createAssertion(
    clientDataHash: Data,
    completion: @escaping (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void
  ) {
    guard service.isSupported else {
      completion(.failure(.unsupported))
      return
    }
    guard clientDataHash.count == 32 else {
      completion(.failure(.invalidInput))
      return
    }
    guard let operationToken = beginOperation() else {
      completion(.failure(.operationInProgress))
      return
    }
    let finish: (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void = {
      [weak self] response in
      self?.finishOperation(
        operationToken,
        response: response,
        completion: completion
      )
    }

    let keyId: String
    do {
      let record = try keyStore.read()
      guard !record.isPending else {
        finish(.failure(.invalidKey))
        return
      }
      keyId = record.keyId
    } catch let localError as BiteSaverAppAttestError {
      finish(.failure(localError))
      return
    } catch {
      finish(.failure(.localStateUnavailable))
      return
    }

    service.generateAssertion(keyId, clientDataHash: clientDataHash) { object, error in
      if let error {
        finish(.failure(Self.mapProviderError(error)))
        return
      }
      guard let object, !object.isEmpty, object.count <= 16_384 else {
        finish(.failure(.providerFailure))
        return
      }
      finish(.success(BiteSaverAppAttestOutput(keyId: keyId, object: object)))
    }
  }

  func currentKeyId() throws -> String {
    let record = try keyStore.read()
    guard !record.isPending else {
      throw BiteSaverAppAttestError.invalidKey
    }
    return record.keyId
  }

  func reset() throws {
    guard let operationToken = beginOperation() else {
      throw BiteSaverAppAttestError.operationInProgress
    }
    defer { cancelOperation(operationToken) }
    try keyStore.reset()
  }

  private func attest(
    keyId: String,
    clientDataHash: Data,
    completion: @escaping (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void
  ) {
    service.attestKey(keyId, clientDataHash: clientDataHash) { [weak self] object, error in
      guard let self else { return }
      if let error {
        completion(.failure(Self.mapProviderError(error)))
        return
      }
      guard let object, !object.isEmpty, object.count <= 65_536 else {
        completion(.failure(.providerFailure))
        return
      }
      do {
        try self.keyStore.activatePending(
          keyId: keyId,
          clientDataHash: clientDataHash
        )
      } catch let localError as BiteSaverAppAttestError {
        completion(.failure(localError))
        return
      } catch {
        completion(.failure(.localStateUnavailable))
        return
      }
      completion(.success(BiteSaverAppAttestOutput(keyId: keyId, object: object)))
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
    response: Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>,
    completion: (Result<BiteSaverAppAttestOutput, BiteSaverAppAttestError>) -> Void
  ) {
    operationLock.lock()
    guard activeOperationToken == token else {
      operationLock.unlock()
      return
    }
    activeOperationToken = nil
    operationLock.unlock()
    completion(response)
  }

  private func cancelOperation(_ token: UUID) {
    operationLock.lock()
    if activeOperationToken == token {
      activeOperationToken = nil
    }
    operationLock.unlock()
  }

  private static func isValidKeyId(_ keyId: String) -> Bool {
    !keyId.isEmpty
      && keyId.utf8.count <= 512
      && keyId.unicodeScalars.allSatisfy { scalar in
        scalar.isASCII && scalar.value >= 0x21 && scalar.value <= 0x7e
      }
  }

  static func mapProviderError(_ error: Error) -> BiteSaverAppAttestError {
    let nsError = error as NSError
    guard nsError.domain == DCErrorDomain else {
      return .providerFailure
    }
    switch nsError.code {
    case DCError.featureUnsupported.rawValue:
      return .unsupported
    case DCError.invalidInput.rawValue:
      return .invalidInput
    case DCError.invalidKey.rawValue:
      return .invalidKey
    case DCError.serverUnavailable.rawValue:
      return .serverUnavailable
    default:
      return .providerFailure
    }
  }
}
