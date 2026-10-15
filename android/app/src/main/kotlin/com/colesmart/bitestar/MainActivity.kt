package com.colesmart.bitestar

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var appUpdateBridge: AppUpdateBridge? = null
    private var biteSaverDeviceProofBridge: BiteSaverDeviceProofBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        appUpdateBridge = AppUpdateBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        biteSaverDeviceProofBridge =
            BiteSaverDeviceProofBridge(
                applicationContext,
                flutterEngine.dartExecutor.binaryMessenger,
            )
    }

    override fun onNewIntent(intent: Intent) {
        appUpdateBridge?.onNewIntent(intent)
        super.onNewIntent(intent)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (appUpdateBridge?.onActivityResult(requestCode, resultCode) == true) return
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        appUpdateBridge?.dispose()
        appUpdateBridge = null
        biteSaverDeviceProofBridge?.dispose()
        biteSaverDeviceProofBridge = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
