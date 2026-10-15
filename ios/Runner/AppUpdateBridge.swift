import Flutter
import StoreKit
import UIKit

@MainActor
final class AppUpdateBridge {
  private static weak var current: AppUpdateBridge?
  private static var externalEntry = false
  private let channel: FlutterMethodChannel
  private let handoff = AppUpdateHandoffState()
  private var pending: FlutterResult?
  private var launchStarted = false
  private var launchDeadline: DispatchWorkItem?

  init(binaryMessenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "com.colesmart.bitestar/app_update", binaryMessenger: binaryMessenger)
    Self.current = self
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else { result(nil); return }
      switch call.method {
      case "snapshot":
        Task { result(await self.snapshot()) }
      case "open":
        self.open(call.arguments as? [String: Any], result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  static func interrupt() {
    externalEntry = true // Survives a cold URL arriving before engine creation.
    current?.channel.invokeMethod("externalEntry", arguments: nil)
    current?.finish("failed")
  }

  static func willResignActive() {
    guard let bridge = current, bridge.launchStarted else { return }
    bridge.handoff.leave()
  }

  static func didBecomeActive() {
    current?.finish("returned", requireReturn: true)
  }

  private func snapshot() async -> [String: Any]? {
    #if DEBUG || targetEnvironment(simulator)
    return nil
    #else
    guard #available(iOS 16.0, *), !Self.externalEntry,
          Bundle.main.bundleIdentifier == "com.colesmart.bitestar",
          let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
          let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String else { return nil }
    do {
      guard case .verified(let transaction) = try await AppTransaction.shared,
            transaction.environment == .production,
            transaction.bundleID == "com.colesmart.bitestar",
            let appID = transaction.appID, appID > 0,
            // iOS receipts identify the installed CFBundleVersion (build),
            // while Apple's public listing uses CFBundleShortVersionString.
            transaction.appVersion == build,
            AppUpdateInstallation.belongsToDevice(nonce: transaction.deviceVerificationNonce,
              device: AppStore.deviceVerificationID, digest: transaction.deviceVerification),
            let storefront = await Storefront.current,
            let country = AppUpdateInstallation.country(alpha3: storefront.countryCode),
            !Self.externalEntry else { return nil }
      var info = utsname()
      guard uname(&info) == 0 else { return nil }
      let machine = withUnsafePointer(to: &info.machine) {
        $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
      }
      return ["publicInstallation": true, "externalEntry": false,
              "bundleId": transaction.bundleID, "appleId": String(appID),
              "installedVersion": version, "country": country,
              "device": machine, "osVersion": UIDevice.current.systemVersion]
    } catch { return nil }
    #endif
  }

  private func open(_ args: [String: Any]?, result: @escaping FlutterResult) {
    guard handoff.begin() else { result("failed"); return }
    let attempt = handoff.generation
    pending = result
    // Covers a stalled StoreKit read or a launch which never leaves the app.
    // Once away, completion waits for a real return; opening is not installation.
    let deadline = DispatchWorkItem { [weak self] in
      guard let self, self.handoff.generation == attempt, !self.handoff.leftApp else { return }
      self.finish("failed")
    }
    launchDeadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: deadline)
    Task {
      let facts = await snapshot()
      guard handoff.generation == attempt, handoff.waiting else { return }
      guard let facts,
            UIApplication.shared.applicationState == .active,
            let id = args?["appleId"] as? String, id == facts["appleId"] as? String,
            let country = args?["country"] as? String, country == facts["country"] as? String,
            let url = URL(string: "https://apps.apple.com/\(country.lowercased())/app/id\(id)") else {
        finish("failed")
        return
      }
      launchStarted = true
      UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { [weak self] opened in
        guard let self, self.handoff.generation == attempt else { return }
        if !opened { self.finish("failed") }
      }
    }
  }

  private func finish(_ value: String, requireReturn: Bool = false) {
    guard handoff.finish(requireReturn: requireReturn) else { return }
    launchDeadline?.cancel()
    launchDeadline = nil
    launchStarted = false
    let result = pending
    pending = nil
    result?(value)
  }
}
