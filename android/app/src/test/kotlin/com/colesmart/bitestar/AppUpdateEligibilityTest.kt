package com.colesmart.bitestar

import com.google.android.play.core.install.model.UpdateAvailability
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateEligibilityTest {
    @Test fun onlyOrdinaryLauncherEntryIsEligible() {
        val launcher = setOf("android.intent.category.LAUNCHER")
        assertTrue(AppUpdateEligibility.ordinaryLaunch("android.intent.action.MAIN", launcher, false))
        assertFalse(AppUpdateEligibility.ordinaryLaunch("android.intent.action.VIEW", launcher, false))
        assertFalse(AppUpdateEligibility.ordinaryLaunch(null, launcher, false))
        assertFalse(AppUpdateEligibility.ordinaryLaunch("android.intent.action.MAIN", null, false))
        assertFalse(AppUpdateEligibility.ordinaryLaunch("android.intent.action.MAIN", launcher, true))
    }

    @Test fun availableUpdateRequiresAllowedFlowAndHigherBuild() {
        assertTrue(AppUpdateEligibility.obtainable(9, 10, UpdateAvailability.UPDATE_AVAILABLE, true))
        assertFalse(AppUpdateEligibility.obtainable(9, 10, UpdateAvailability.UPDATE_AVAILABLE, false))
        assertFalse(AppUpdateEligibility.obtainable(10, 10, UpdateAvailability.UPDATE_AVAILABLE, true))
        assertFalse(AppUpdateEligibility.obtainable(11, 10, UpdateAvailability.UPDATE_AVAILABLE, true))
        assertFalse(AppUpdateEligibility.obtainable(0, 10, UpdateAvailability.UPDATE_AVAILABLE, true))
        assertFalse(AppUpdateEligibility.obtainable(9, 10, UpdateAvailability.UNKNOWN, true))
        assertFalse(AppUpdateEligibility.obtainable(9, 10, UpdateAvailability.UPDATE_NOT_AVAILABLE, true))
    }

    @Test fun acceptedInterruptedUpdateCanResumeWithoutOfferingNewSnoozes() {
        assertTrue(AppUpdateEligibility.obtainable(9, 10,
            UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS, false))
        assertFalse(AppUpdateEligibility.obtainable(10, 10,
            UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS, true))
    }
}
