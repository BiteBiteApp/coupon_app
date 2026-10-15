import Foundation
import CryptoKit

/// Local facts only. No account identifier, receipt or device identifier crosses
/// the Flutter channel; only the public app identity and compatibility facts do.
enum AppUpdateInstallation {
  @available(iOS 16.0, *)
  static func country(alpha3: String) -> String? {
    guard alpha3.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil else { return nil }
    // Foundation canonicalizes ISO alpha-3 aliases. This is derived from the
    // StoreKit storefront, NEVER Locale.current, language, GPS or a US fallback.
    let code = Locale(identifier: "und_" + alpha3).region?.identifier
    guard let code, code.count == 2, Locale.Region.isoRegions.contains(Locale.Region(code)) else { return nil }
    return code
  }

  static func belongsToDevice(nonce: UUID, device: UUID?, digest: Data) -> Bool {
    guard let device else { return false }
    let input = nonce.uuidString.lowercased() + device.uuidString.lowercased()
    return Data(SHA384.hash(data: Data(input.utf8))) == digest
  }
}

/// Completes each handoff at most once, including duplicate scene callbacks.
final class AppUpdateHandoffState {
  private(set) var generation = 0
  private(set) var waiting = false
  private(set) var leftApp = false
  func begin() -> Bool {
    guard !waiting else { return false }
    generation += 1
    waiting = true
    leftApp = false
    return true
  }
  func leave() { if waiting { leftApp = true } }
  func finish(requireReturn: Bool = false) -> Bool {
    guard waiting, !requireReturn || leftApp else { return false }
    waiting = false
    leftApp = false
    return true
  }
}
