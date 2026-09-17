package com.colesmart.bitestar

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var biteSaverDeviceProofBridge: BiteSaverDeviceProofBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        biteSaverDeviceProofBridge =
            BiteSaverDeviceProofBridge(
                applicationContext,
                flutterEngine.dartExecutor.binaryMessenger,
            )
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        biteSaverDeviceProofBridge?.dispose()
        biteSaverDeviceProofBridge = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
