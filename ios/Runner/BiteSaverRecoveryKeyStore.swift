import CryptoKit
import Foundation
import Security

enum BiteSaverRecoveryKeyState: Equatable {
  case missing
  case available(publicKeyX963: Data)
  case corrupt
  case unavailable
}

enum BiteSaverRecoveryKeyStoreError: Error, Equatable {
  case missing
  case corrupt
  case invalidDigest
  case keychainFailure(OSStatus)
  case signingFailure

  var stableCode: String {
    switch self {
    case .missing:
      return "missing-credential"
    case .corrupt:
      return "corrupt-credential"
    case .invalidDigest:
      return "invalid-request"
    case .keychainFailure:
      return "credential-unavailable"
    case .signingFailure:
      return "signing-failed"
    }
  }
}

/// Owns the local iOS recovery credential (Kd).
///
/// The private key is a P-256 Keychain key. It is never returned by this type.
/// Its public representation is the canonical uncompressed ANSI X9.63 form:
/// `0x04 || X(32) || Y(32)`.
final class BiteSaverRecoveryKeyStore {
  static let defaultApplicationTag = Data(
    "com.colesmart.bitestar.bitesaver.recovery-key.v1".utf8
  )

  private let applicationTag: Data

  init(applicationTag: Data = BiteSaverRecoveryKeyStore.defaultApplicationTag) {
    self.applicationTag = applicationTag
  }

  func state() -> BiteSaverRecoveryKeyState {
    do {
      let key = try loadPrivateKey()
      return .available(publicKeyX963: try canonicalPublicKey(for: key))
    } catch BiteSaverRecoveryKeyStoreError.missing {
      return .missing
    } catch BiteSaverRecoveryKeyStoreError.corrupt {
      return .corrupt
    } catch {
      return .unavailable
    }
  }

  /// Creates Kd only for an explicit enrollment/recovery request.
  func ensurePublicKey() throws -> Data {
    do {
      return try canonicalPublicKey(for: loadPrivateKey())
    } catch BiteSaverRecoveryKeyStoreError.missing {
      let key = try createPrivateKey()
      return try canonicalPublicKey(for: key)
    }
  }

  func existingPublicKey() throws -> Data {
    try canonicalPublicKey(for: loadPrivateKey())
  }

  /// Signs a caller-constructed SHA-256 digest. This API is intentionally
  /// internal; the Flutter bridge only invokes it for validated proof records.
  func signSHA256Digest(_ digest: Data) throws -> Data {
    guard digest.count == SHA256.byteCount else {
      throw BiteSaverRecoveryKeyStoreError.invalidDigest
    }

    let privateKey = try loadPrivateKey()
    let algorithm = SecKeyAlgorithm.ecdsaSignatureDigestX962SHA256
    guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
      throw BiteSaverRecoveryKeyStoreError.corrupt
    }

    var error: Unmanaged<CFError>?
    guard
      let signature = SecKeyCreateSignature(
        privateKey,
        algorithm,
        digest as CFData,
        &error
      ) as Data?
    else {
      _ = error?.takeRetainedValue()
      throw BiteSaverRecoveryKeyStoreError.signingFailure
    }
    return signature
  }

  /// Removes only this feature's local recovery key. The bridge separately
  /// removes the locally remembered App Attest key identifier.
  func reset() throws {
    let status = SecItemDelete(keyQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw BiteSaverRecoveryKeyStoreError.keychainFailure(status)
    }
  }

  static func privateKeyAttributes(applicationTag: Data) -> [CFString: Any] {
    [
      kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits: 256,
      kSecPrivateKeyAttrs: [
        kSecAttrIsPermanent: true,
        kSecAttrApplicationTag: applicationTag,
        kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecAttrSynchronizable: false,
      ] as [CFString: Any],
    ]
  }

  private func createPrivateKey() throws -> SecKey {
    var error: Unmanaged<CFError>?
    if let key = SecKeyCreateRandomKey(
      Self.privateKeyAttributes(applicationTag: applicationTag) as CFDictionary,
      &error
    ) {
      return key
    }

    let creationError = error?.takeRetainedValue() as Error?
    let status = (creationError as NSError?)?.code
    if status == Int(errSecDuplicateItem) {
      // Another explicit request may have won the creation race.
      return try loadPrivateKey()
    }
    throw BiteSaverRecoveryKeyStoreError.keychainFailure(
      status.map(OSStatus.init) ?? errSecInternalError
    )
  }

  private func loadPrivateKey() throws -> SecKey {
    var item: CFTypeRef?
    var query = keyQuery()
    query[kSecReturnRef] = true
    query[kSecMatchLimit] = kSecMatchLimitOne

    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      throw BiteSaverRecoveryKeyStoreError.missing
    }
    guard status == errSecSuccess else {
      throw BiteSaverRecoveryKeyStoreError.keychainFailure(status)
    }
    guard let item, CFGetTypeID(item) == SecKeyGetTypeID() else {
      throw BiteSaverRecoveryKeyStoreError.corrupt
    }
    return unsafeBitCast(item, to: SecKey.self)
  }

  private func canonicalPublicKey(for privateKey: SecKey) throws -> Data {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw BiteSaverRecoveryKeyStoreError.corrupt
    }
    var error: Unmanaged<CFError>?
    guard let external = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      _ = error?.takeRetainedValue()
      throw BiteSaverRecoveryKeyStoreError.corrupt
    }
    guard external.count == 65, external.first == 0x04 else {
      throw BiteSaverRecoveryKeyStoreError.corrupt
    }
    do {
      _ = try P256.Signing.PublicKey(x963Representation: external)
    } catch {
      throw BiteSaverRecoveryKeyStoreError.corrupt
    }
    return external
  }

  private func keyQuery() -> [CFString: Any] {
    [
      kSecClass: kSecClassKey,
      kSecAttrApplicationTag: applicationTag,
      kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrSynchronizable: false,
    ]
  }
}
