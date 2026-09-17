package com.colesmart.bitestar

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager

internal sealed interface BiteSaverIntegrityTokenResult {
    data class Success(val token: String) : BiteSaverIntegrityTokenResult

    data object Failure : BiteSaverIntegrityTokenResult
}

internal fun interface BiteSaverPlayIntegrityTokenClient {
    fun requestEnrollmentToken(
        cloudProjectNumber: Long,
        requestHash: String,
        callback: (BiteSaverIntegrityTokenResult) -> Unit,
    )
}

/** Standard Play Integrity is invoked only from explicit enrollment/recovery. */
internal class BiteSaverStandardPlayIntegrityClient(
    context: Context,
) : BiteSaverPlayIntegrityTokenClient {
    private val applicationContext = context.applicationContext

    override fun requestEnrollmentToken(
        cloudProjectNumber: Long,
        requestHash: String,
        callback: (BiteSaverIntegrityTokenResult) -> Unit,
    ) {
        if (
            cloudProjectNumber <= 0L ||
            requestHash.length != SHA256_BASE64_URL_LENGTH ||
            requestHash.any { !it.isLetterOrDigit() && it != '-' && it != '_' }
        ) {
            callback(BiteSaverIntegrityTokenResult.Failure)
            return
        }

        val manager = IntegrityManagerFactory.createStandard(applicationContext)
        val prepareRequest =
            StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
                .setCloudProjectNumber(cloudProjectNumber)
                .build()
        manager.prepareIntegrityToken(prepareRequest)
            .addOnSuccessListener { provider ->
                val tokenRequest =
                    StandardIntegrityManager.StandardIntegrityTokenRequest.builder()
                        .setRequestHash(requestHash)
                        .build()
                provider.request(tokenRequest)
                    .addOnSuccessListener { response ->
                        val token = response.token()
                        if (validToken(token)) {
                            callback(BiteSaverIntegrityTokenResult.Success(token))
                        } else {
                            callback(BiteSaverIntegrityTokenResult.Failure)
                        }
                    }
                    .addOnFailureListener {
                        callback(BiteSaverIntegrityTokenResult.Failure)
                    }
            }
            .addOnFailureListener {
                callback(BiteSaverIntegrityTokenResult.Failure)
            }
    }

    private fun validToken(value: String): Boolean =
        value.isNotEmpty() &&
            value.length <= MAX_INTEGRITY_TOKEN_LENGTH &&
            value.all {
                it in 'A'..'Z' ||
                    it in 'a'..'z' ||
                    it in '0'..'9' ||
                    it == '.' ||
                    it == '_' ||
                    it == '~' ||
                    it == '-'
            }

    private companion object {
        const val SHA256_BASE64_URL_LENGTH = 43
        const val MAX_INTEGRITY_TOKEN_LENGTH = 32_768
    }
}
