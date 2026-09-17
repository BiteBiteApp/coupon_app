package com.colesmart.bitestar

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

internal class BiteSaverDeviceNativeException(
    val stableCode: String,
) : IllegalStateException("The BiteSaver device-proof operation failed.")

internal data class BiteSaverInstallationCredential(
    val credentialId: String,
    val publicKeySpki: ByteArray,
    val publicKeySha256: ByteArray,
)

internal enum class BiteSaverCredentialState(val wireValue: String) {
    PRESENT("present"),
    MISSING("missing"),
    CORRUPT("corrupt"),
    ERROR("error"),
}

/**
 * Owns the one versioned, non-exportable BiteSaver installation key.
 *
 * All methods are called on the bridge's private worker thread. The private key
 * never leaves AndroidKeyStore and this type signs only a transcript supplied by
 * the narrow device-proof bridge.
 */
internal class BiteSaverAndroidCredentialStore {
    @Synchronized
    fun state(): BiteSaverCredentialState {
        val keyStore =
            try {
                loadKeyStore()
            } catch (_: BiteSaverDeviceNativeException) {
                return BiteSaverCredentialState.ERROR
            }
        val containsCredential =
            try {
                keyStore.containsAlias(KEY_ALIAS)
            } catch (_: Exception) {
                return BiteSaverCredentialState.ERROR
            }
        if (!containsCredential) {
            return BiteSaverCredentialState.MISSING
        }
        return try {
            readCredential(keyStore)
            BiteSaverCredentialState.PRESENT
        } catch (_: BiteSaverDeviceNativeException) {
            BiteSaverCredentialState.CORRUPT
        } catch (_: Exception) {
            BiteSaverCredentialState.ERROR
        }
    }

    @Synchronized
    fun ensureCredential(): BiteSaverInstallationCredential {
        val keyStore = loadKeyStore()
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            generateCredential()
        }
        return readCredential(loadKeyStore())
    }

    @Synchronized
    fun requireCredential(): BiteSaverInstallationCredential {
        val keyStore = loadKeyStore()
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            throw BiteSaverDeviceNativeException("missing-credential")
        }
        return readCredential(keyStore)
    }

    @Synchronized
    fun signCanonicalTranscript(transcript: ByteArray): ByteArray {
        if (transcript.isEmpty() || transcript.size > MAX_TRANSCRIPT_BYTES) {
            throw BiteSaverDeviceNativeException("invalid-request")
        }
        val keyStore = loadKeyStore()
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
            ?: throw BiteSaverDeviceNativeException("missing-credential")
        if (privateKey.algorithm != KeyProperties.KEY_ALGORITHM_EC || privateKey.encoded != null) {
            throw BiteSaverDeviceNativeException("corrupt-credential")
        }
        val signer = Signature.getInstance(SIGNATURE_ALGORITHM)
        signer.initSign(privateKey)
        signer.update(transcript)
        val signature = signer.sign()
        if (!BiteSaverEcdsaDer.isCanonicalP256(signature)) {
            throw BiteSaverDeviceNativeException("credential-operation-failed")
        }
        return signature
    }

    @Synchronized
    fun resetCredential(): Boolean {
        val keyStore = loadKeyStore()
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            return false
        }
        keyStore.deleteEntry(KEY_ALIAS)
        return true
    }

    private fun generateCredential() {
        try {
            val generator =
                KeyPairGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_EC,
                    ANDROID_KEYSTORE,
                )
            generator.initialize(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec(P256_CURVE))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            generator.generateKeyPair()
        } catch (_: Exception) {
            throw BiteSaverDeviceNativeException("credential-create-failed")
        }
    }

    private fun readCredential(keyStore: KeyStore): BiteSaverInstallationCredential {
        try {
            val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
                ?: throw BiteSaverDeviceNativeException("corrupt-credential")
            val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey as? ECPublicKey
                ?: throw BiteSaverDeviceNativeException("corrupt-credential")
            if (
                privateKey.algorithm != KeyProperties.KEY_ALGORITHM_EC ||
                privateKey.encoded != null ||
                publicKey.params.curve.field.fieldSize != 256 ||
                publicKey.params.order.bitLength() != 256
            ) {
                throw BiteSaverDeviceNativeException("corrupt-credential")
            }
            val publicKeySpki = publicKey.encoded
                ?: throw BiteSaverDeviceNativeException("corrupt-credential")
            if (publicKeySpki.isEmpty() || publicKeySpki.size > MAX_PUBLIC_KEY_BYTES) {
                throw BiteSaverDeviceNativeException("corrupt-credential")
            }
            val publicKeySha256 = BiteSaverCanonicalTranscript.sha256(publicKeySpki)
            return BiteSaverInstallationCredential(
                credentialId = BiteSaverCredentialId.fromAndroidPublicKey(publicKeySpki),
                publicKeySpki = publicKeySpki.copyOf(),
                publicKeySha256 = publicKeySha256,
            )
        } catch (error: BiteSaverDeviceNativeException) {
            throw error
        } catch (_: Exception) {
            throw BiteSaverDeviceNativeException("corrupt-credential")
        }
    }

    private fun loadKeyStore(): KeyStore =
        try {
            KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        } catch (_: Exception) {
            throw BiteSaverDeviceNativeException("keystore-unavailable")
        }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "bitestar_bitesaver_installation_signing_key_v1"
        const val P256_CURVE = "secp256r1"
        const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
        const val MAX_PUBLIC_KEY_BYTES = 512
        const val MAX_TRANSCRIPT_BYTES = 4_096
    }
}
