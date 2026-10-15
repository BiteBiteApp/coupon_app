import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var appUpdateBridge: AppUpdateBridge?
  private var biteSaverDeviceProofBridge: BiteSaverDeviceProofBridge?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    appUpdateBridge = AppUpdateBridge(binaryMessenger: engineBridge.applicationRegistrar.messenger())
    biteSaverDeviceProofBridge = BiteSaverDeviceProofBridge(
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
  }
}
