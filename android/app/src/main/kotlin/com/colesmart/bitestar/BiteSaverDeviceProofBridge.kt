package com.colesmart.bitestar

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

internal class BiteSaverDeviceProofBridge(
    context: Context,
    messenger: BinaryMessenger,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
    private val credentialStore: BiteSaverAndroidCredentialStore =
        BiteSaverAndroidCredentialStore(),
    private val androidIdSource: BiteSaverAndroidIdSource =
        BiteSaverSettingsAndroidIdSource(context.contentResolver),
    private val integrityClient: BiteSaverPlayIntegrityTokenClient =
        BiteSaverStandardPlayIntegrityClient(context),
) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, CHANNEL_NAME)
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val disposed = AtomicBoolean(false)
    private val enrollmentInFlight = AtomicBoolean(false)

    init {
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (disposed.get()) {
            error(result, "native-unavailable")
            return
        }
        when (call.method) {
            "getCapability" -> getCapability(call.arguments, result)
            "createEnrollmentProof" -> createEnrollmentProof(call.arguments, result)
            "createUseProof" -> createUseProof(call.arguments, result)
            "resetCredential" -> resetCredential(call.arguments, result)
            else -> result.notImplemented()
        }
    }

    fun dispose() {
        if (disposed.compareAndSet(false, true)) {
            channel.setMethodCallHandler(null)
            worker.shutdownNow()
        }
    }

    private fun getCapability(arguments: Any?, result: MethodChannel.Result) {
        if (arguments != null) {
            error(result, "invalid-request")
            return
        }
        if (!BiteSaverDeviceProofAvailability.isSupported(sdkInt)) {
            result.success(
                mapOf(
                    "schemaVersion" to BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION,
                    "protocolVersion" to BITE_SAVER_DEVICE_PROOF_PROTOCOL,
                    "platform" to BITE_SAVER_DEVICE_PROOF_PLATFORM,
                    "apiLevel" to sdkInt,
                    "minimumApiLevel" to BITE_SAVER_DEVICE_PROOF_MINIMUM_API_LEVEL,
                    "supported" to false,
                    "credentialState" to "unavailable",
                    "integrityAvailable" to false,
                ),
            )
            return
        }
        execute(result) {
            val state = credentialStore.state()
            success(
                result,
                mapOf(
                    "schemaVersion" to BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION,
                    "protocolVersion" to BITE_SAVER_DEVICE_PROOF_PROTOCOL,
                    "platform" to BITE_SAVER_DEVICE_PROOF_PLATFORM,
                    "apiLevel" to sdkInt,
                    "minimumApiLevel" to BITE_SAVER_DEVICE_PROOF_MINIMUM_API_LEVEL,
                    "supported" to true,
                    "credentialState" to state.wireValue,
                    // This reports that the direct Standard Integrity adapter is
                    // available. Remote provider qualification remains deferred.
                    "integrityAvailable" to true,
                ),
            )
        }
    }

    private fun createEnrollmentProof(arguments: Any?, result: MethodChannel.Result) {
        if (!requireSupported(result)) {
            return
        }
        val request =
            try {
                BiteSaverDeviceProofRequestParser.parseEnrollment(arguments)
            } catch (error: BiteSaverDeviceContractException) {
                error(result, error.stableCode)
                return
            }
        if (!enrollmentInFlight.compareAndSet(false, true)) {
            error(result, "operation-in-progress")
            return
        }

        execute(
            result,
            onFailure = { enrollmentInFlight.set(false) },
        ) {
            val credential = credentialStore.ensureCredential()
            val androidSsaid = androidIdSource.readForEnrollment()
            val transcript =
                BiteSaverCanonicalTranscript.encode(
                    BiteSaverAndroidTranscriptInput(
                        proofKind = BiteSaverAndroidProofKind.ENROLLMENT,
                        challenge = request.challenge,
                        credentialId = credential.credentialId,
                        installationPublicKeySha256 = credential.publicKeySha256,
                        androidSsaid = androidSsaid,
                    ),
                )
            val signature: ByteArray
            val requestHash: String
            try {
                signature = credentialStore.signCanonicalTranscript(transcript)
                requestHash =
                    BiteSaverDeviceEncoding.base64Url(
                        BiteSaverCanonicalTranscript.sha256(transcript),
                    )
            } finally {
                transcript.fill(0)
            }
            val publicResult =
                mapOf(
                    "schemaVersion" to BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION,
                    "kind" to BiteSaverAndroidProofKind.ENROLLMENT.wireValue,
                    "credentialId" to credential.credentialId,
                    "installationPublicKeySpki" to
                        BiteSaverDeviceEncoding.base64Url(credential.publicKeySpki),
                    "androidSsaid" to androidSsaid,
                    "possessionSignature" to BiteSaverDeviceEncoding.base64Url(signature),
                )
            mainHandler.post {
                if (disposed.get()) {
                    enrollmentInFlight.set(false)
                    return@post
                }
                try {
                    integrityClient.requestEnrollmentToken(
                        request.cloudProjectNumber,
                        requestHash,
                    ) { tokenResult ->
                        enrollmentInFlight.set(false)
                        when (tokenResult) {
                            is BiteSaverIntegrityTokenResult.Success -> {
                                success(
                                    result,
                                    publicResult + ("integrityToken" to tokenResult.token),
                                )
                            }
                            BiteSaverIntegrityTokenResult.Failure -> {
                                error(result, "provider-unavailable")
                            }
                        }
                    }
                } catch (_: Exception) {
                    enrollmentInFlight.set(false)
                    error(result, "provider-unavailable")
                }
            }
        }
    }

    private fun createUseProof(arguments: Any?, result: MethodChannel.Result) {
        if (!requireSupported(result)) {
            return
        }
        val challenge =
            try {
                BiteSaverDeviceProofRequestParser.parseUse(arguments)
            } catch (error: BiteSaverDeviceContractException) {
                error(result, error.stableCode)
                return
            }
        execute(result) {
            val credential = credentialStore.requireCredential()
            val transcript =
                BiteSaverCanonicalTranscript.encode(
                    BiteSaverAndroidTranscriptInput(
                        proofKind = BiteSaverAndroidProofKind.USE,
                        challenge = challenge,
                        credentialId = credential.credentialId,
                        installationPublicKeySha256 = credential.publicKeySha256,
                        androidSsaid = null,
                    ),
                )
            val signature =
                try {
                    credentialStore.signCanonicalTranscript(transcript)
                } finally {
                    transcript.fill(0)
                }
            success(
                result,
                mapOf(
                    "schemaVersion" to BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION,
                    "kind" to BiteSaverAndroidProofKind.USE.wireValue,
                    "credentialId" to credential.credentialId,
                    "possessionSignature" to BiteSaverDeviceEncoding.base64Url(signature),
                ),
            )
        }
    }

    private fun resetCredential(arguments: Any?, result: MethodChannel.Result) {
        if (!requireSupported(result)) {
            return
        }
        try {
            BiteSaverDeviceProofRequestParser.parseReset(arguments)
        } catch (error: BiteSaverDeviceContractException) {
            error(result, error.stableCode)
            return
        }
        if (enrollmentInFlight.get()) {
            error(result, "operation-in-progress")
            return
        }
        execute(result) {
            credentialStore.resetCredential()
            success(
                result,
                mapOf(
                    "schemaVersion" to BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION,
                    "reset" to true,
                ),
            )
        }
    }

    private fun requireSupported(result: MethodChannel.Result): Boolean {
        if (BiteSaverDeviceProofAvailability.isSupported(sdkInt)) {
            return true
        }
        error(result, "unsupported-api")
        return false
    }

    private fun execute(
        result: MethodChannel.Result,
        onFailure: () -> Unit = {},
        operation: () -> Unit,
    ) {
        try {
            worker.execute {
                if (disposed.get()) {
                    onFailure()
                    return@execute
                }
                try {
                    operation()
                } catch (error: BiteSaverDeviceNativeException) {
                    onFailure()
                    error(result, error.stableCode)
                } catch (error: BiteSaverDeviceContractException) {
                    onFailure()
                    error(result, error.stableCode)
                } catch (_: Exception) {
                    onFailure()
                    error(result, "native-unavailable")
                }
            }
        } catch (_: RejectedExecutionException) {
            onFailure()
            error(result, "native-unavailable")
        }
    }

    private fun success(result: MethodChannel.Result, value: Any) {
        if (disposed.get()) {
            return
        }
        mainHandler.post {
            if (!disposed.get()) {
                result.success(value)
            }
        }
    }

    private fun error(result: MethodChannel.Result, stableCode: String) {
        if (disposed.get()) {
            return
        }
        mainHandler.post {
            if (!disposed.get()) {
                result.error(
                    stableCode,
                    "The BiteSaver device-proof operation could not be completed.",
                    mapOf(
                        "schemaVersion" to BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION,
                        "reason" to stableCode,
                    ),
                )
            }
        }
    }

    private companion object {
        const val CHANNEL_NAME = "com.colesmart.bitestar/bitesaver_device_proof"
    }
}
