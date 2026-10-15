package com.colesmart.bitestar

import com.google.android.play.core.install.model.UpdateAvailability

/** Pure part of the real adapter's entry/eligibility contract. */
internal object AppUpdateEligibility {
    fun ordinaryLaunch(action: String?, categories: Set<String>?, externalEntry: Boolean) =
        !externalEntry && action == "android.intent.action.MAIN" &&
            categories?.contains("android.intent.category.LAUNCHER") == true

    fun obtainable(installed: Long, available: Int, availability: Int, immediateAllowed: Boolean) =
        installed > 0 && available.toLong() > installed &&
            (availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS ||
                (availability == UpdateAvailability.UPDATE_AVAILABLE && immediateAllowed))
}
