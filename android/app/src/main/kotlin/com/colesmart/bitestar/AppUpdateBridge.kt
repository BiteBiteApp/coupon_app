package com.colesmart.bitestar

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/** Play owns eligibility, installation and its consent UI. No custom installer. */
class AppUpdateBridge(private val activity: Activity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "com.colesmart.bitestar/app_update")
    private val manager = AppUpdateManagerFactory.create(activity)
    private val handler = Handler(Looper.getMainLooper())
    private var availabilityTimeout: Runnable? = null
    private var externalEntry = false
    private var pending: MethodChannel.Result? = null

    init {
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "check" -> check(result)
                "open" -> open(call.argument<Number>("build")?.toInt(), result)
                else -> result.notImplemented()
            }
        }
    }

    fun onNewIntent(intent: Intent) {
        if (!AppUpdateEligibility.ordinaryLaunch(intent.action, intent.categories, false)) {
            externalEntry = true
            channel.invokeMethod("externalEntry", null)
        }
    }

    private fun supported(): Boolean {
        if (!AppUpdateEligibility.ordinaryLaunch(
                activity.intent?.action, activity.intent?.categories, externalEntry)) return false
        if (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) return false
        @Suppress("DEPRECATION")
        val installer = if (Build.VERSION.SDK_INT >= 30) {
            activity.packageManager.getInstallSourceInfo(activity.packageName).installingPackageName
        } else activity.packageManager.getInstallerPackageName(activity.packageName)
        return activity.packageName == "com.colesmart.bitestar" && installer == "com.android.vending"
    }

    private fun installed(): Long {
        @Suppress("DEPRECATION")
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }

    private fun check(result: MethodChannel.Result) {
        try {
            if (!supported()) { result.success(null); return }
            val current = installed()
            manager.appUpdateInfo.addOnSuccessListener { info ->
                val eligible = supported() && AppUpdateEligibility.obtainable(
                    current, info.availableVersionCode(), info.updateAvailability(),
                    info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
                )
                result.success(mapOf(
                    "eligible" to eligible, "package" to activity.packageName,
                    "installed" to current, "available" to info.availableVersionCode(),
                    "priority" to info.updatePriority(),
                    "inProgress" to (info.updateAvailability() ==
                        UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS),
                ))
            }.addOnFailureListener { result.success(null) }
        } catch (_: Exception) { result.success(null) }
    }

    private fun open(build: Int?, result: MethodChannel.Result) {
        try {
            if (pending != null || build == null || !supported()) {
                result.success("failed"); return
            }
            pending = result
            availabilityTimeout = Runnable { if (pending === result) finish("failed") }
            handler.postDelayed(availabilityTimeout!!, 5000)
            manager.appUpdateInfo.addOnSuccessListener { info ->
                if (pending !== result) return@addOnSuccessListener
                availabilityTimeout?.let { handler.removeCallbacks(it) }
                availabilityTimeout = null
                try {
                    if (!supported() || info.availableVersionCode() != build ||
                        !AppUpdateEligibility.obtainable(installed(), build,
                            info.updateAvailability(), info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))) {
                        finish("failed"); return@addOnSuccessListener
                    }
                    val started = manager.startUpdateFlowForResult(
                        info, activity,
                        AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(), REQUEST_CODE,
                    )
                    if (!started) finish("failed")
                } catch (_: Exception) { finish("failed") }
            }.addOnFailureListener { if (pending === result) finish("failed") }
        } catch (_: Exception) {
            if (pending === result) finish("failed") else result.success("failed")
        }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int): Boolean {
        if (requestCode != REQUEST_CODE) return false
        finish(when (resultCode) {
            Activity.RESULT_OK -> "returned"
            Activity.RESULT_CANCELED -> "cancelled"
            else -> "failed"
        })
        return true
    }

    private fun finish(value: String) {
        availabilityTimeout?.let { handler.removeCallbacks(it) }
        availabilityTimeout = null
        val result = pending
        pending = null
        result?.success(value)
    }

    fun dispose() {
        finish("failed")
        channel.setMethodCallHandler(null)
    }

    companion object { private const val REQUEST_CODE = 4111 }
}
