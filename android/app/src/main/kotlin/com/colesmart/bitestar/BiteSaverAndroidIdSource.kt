package com.colesmart.bitestar

import android.annotation.SuppressLint
import android.content.ContentResolver
import android.provider.Settings

internal fun interface BiteSaverAndroidIdSource {
    /** Read only during an explicit enrollment/recovery proof operation. */
    fun readForEnrollment(): String
}

internal class BiteSaverSettingsAndroidIdSource(
    private val contentResolver: ContentResolver,
) : BiteSaverAndroidIdSource {
    // This explicit, user-initiated anti-abuse enrollment is the narrow
    // high-value fraud-prevention case for which SSAID was selected. The value
    // is neither logged nor persisted by this native layer.
    @SuppressLint("HardwareIds")
    override fun readForEnrollment(): String {
        val value = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        if (value == null || !ANDROID_SSAID_PATTERN.matches(value)) {
            throw BiteSaverDeviceNativeException("identifier-unavailable")
        }
        return value
    }

    private companion object {
        val ANDROID_SSAID_PATTERN = Regex("^[0-9a-f]{16}$")
    }
}
