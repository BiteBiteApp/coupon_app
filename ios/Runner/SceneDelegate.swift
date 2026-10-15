import Flutter
import UIKit

class SceneDelegate: FlutterSceneDelegate {
  override func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
                      options connectionOptions: UIScene.ConnectionOptions) {
    if !connectionOptions.urlContexts.isEmpty || !connectionOptions.userActivities.isEmpty {
      AppUpdateBridge.interrupt()
    }
    super.scene(scene, willConnectTo: session, options: connectionOptions)
  }

  override func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    AppUpdateBridge.interrupt()
    super.scene(scene, openURLContexts: URLContexts)
  }

  override func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    AppUpdateBridge.interrupt()
    super.scene(scene, continue: userActivity)
  }

  override func sceneWillResignActive(_ scene: UIScene) {
    AppUpdateBridge.willResignActive()
    super.sceneWillResignActive(scene)
  }

  override func sceneDidBecomeActive(_ scene: UIScene) {
    super.sceneDidBecomeActive(scene)
    AppUpdateBridge.didBecomeActive()
  }
}
