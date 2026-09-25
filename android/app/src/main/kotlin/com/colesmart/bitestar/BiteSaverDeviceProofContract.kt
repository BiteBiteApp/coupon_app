package com.colesmart.bitestar

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

internal const val BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION = 1
internal const val BITE_SAVER_DEVICE_PROOF_PROTOCOL =
    "bitestar.bitesaver-device-proof.v1"
internal const val BITE_SAVER_DEVICE_PROOF_PLATFORM = "android"
internal const val BITE_SAVER_DEVICE_PROOF_PURPOSE = "combinedCouponUse"
internal const val BITE_SAVER_DEVICE_PROOF_MINIMUM_API_LEVEL = 26

private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
private const val MAX_CHALLENGE_LIFETIME_MILLIS = 120_000L
// Firebase Admin's UID/token subject contract counts UTF-16 code units.
private const val MAX_AUTHENTICATED_USER_ID_UNITS = 128
// A well-formed UTF-16 unit needs at most 3 UTF-8 bytes (a pair needs 4).
private const val MAX_AUTHENTICATED_USER_ID_BYTES = MAX_AUTHENTICATED_USER_ID_UNITS * 3
private const val MAX_TEXT_BYTES = 256
private val challengeIdPattern = Regex("^bsdc_[A-Za-z0-9_-]{43}$")
private val logicalRequestIdPattern = Regex("^[A-Za-z0-9_-]{16,128}$")
private val fingerprintPattern = Regex("^[0-9a-f]{64}$")
private val credentialIdPattern = Regex("^bsic_[A-Za-z0-9_-]{43}$")
private val androidSsaidPattern = Regex("^[0-9a-f]{16}$")

internal object BiteSaverDeviceProofAvailability {
    fun isSupported(sdkInt: Int): Boolean =
        sdkInt >= BITE_SAVER_DEVICE_PROOF_MINIMUM_API_LEVEL
}

internal class BiteSaverDeviceContractException(
    val stableCode: String = "invalid-request",
) : IllegalArgumentException("The BiteSaver device-proof request is invalid.")

internal data class BiteSaverDeviceChallenge(
    val challengeId: String,
    val challengeBytes: ByteArray,
    val requestFingerprint: ByteArray,
    val authenticatedUserId: String?,
    val origin: String,
    val logicalRequestId: String,
    val issuedAtMillis: Long,
    val validFromMillis: Long,
    val expiresAtMillis: Long,
)

internal data class BiteSaverAndroidEnrollmentRequest(
    val challenge: BiteSaverDeviceChallenge,
    val cloudProjectNumber: Long,
)

internal object BiteSaverDeviceProofRequestParser {
    private val commonKeys =
        setOf(
            "schemaVersion",
            "protocolVersion",
            "platform",
            "purpose",
            "challengeId",
            "challengeBytes",
            "requestFingerprint",
            "authenticatedUserId",
            "origin",
            "logicalRequestId",
            "issuedAtMillis",
            "validFromMillis",
            "expiresAtMillis",
        )

    fun parseEnrollment(arguments: Any?): BiteSaverAndroidEnrollmentRequest {
        val values = strictMap(arguments, commonKeys + "cloudProjectNumber")
        val projectNumber = strictLong(values["cloudProjectNumber"])
        if (projectNumber <= 0L || projectNumber > MAX_SAFE_INTEGER) {
            invalid()
        }
        return BiteSaverAndroidEnrollmentRequest(
            challenge = parseChallenge(values),
            cloudProjectNumber = projectNumber,
        )
    }

    fun parseUse(arguments: Any?): BiteSaverDeviceChallenge =
        parseChallenge(strictMap(arguments, commonKeys))

    fun parseReset(arguments: Any?) {
        val values =
            strictMap(
                arguments,
                setOf("schemaVersion", "protocolVersion", "platform", "reason"),
            )
        requireProtocol(values)
        if (values["reason"] != "serverDirectedReenrollment") {
            invalid()
        }
    }

    private fun parseChallenge(values: Map<String, Any?>): BiteSaverDeviceChallenge {
        requireProtocol(values)
        if (values["purpose"] != BITE_SAVER_DEVICE_PROOF_PURPOSE) {
            invalid()
        }

        val challengeId = strictString(values["challengeId"], 48)
        if (!challengeIdPattern.matches(challengeId)) {
            invalid()
        }
        val challengeBytes =
            BiteSaverDeviceEncoding.decodeBase64Url(
                strictString(values["challengeBytes"], 43),
                expectedBytes = 32,
            )
        if (challengeId != "bsdc_${BiteSaverDeviceEncoding.base64Url(challengeBytes)}") {
            invalid()
        }
        val requestFingerprintText = strictString(values["requestFingerprint"], 64)
        if (!fingerprintPattern.matches(requestFingerprintText)) {
            invalid()
        }
        val authenticatedUserId =
            when (val raw = values["authenticatedUserId"]) {
                null -> null
                is String -> raw.also(::requireAuthenticatedUserId)
                else -> invalid()
            }
        val origin = strictString(values["origin"], 16)
        if (origin != "discovery" && origin != "saved") {
            invalid()
        }
        val logicalRequestId = strictString(values["logicalRequestId"], 128)
        if (!logicalRequestIdPattern.matches(logicalRequestId)) {
            invalid()
        }
        val issuedAtMillis = strictTimestamp(values["issuedAtMillis"])
        val validFromMillis = strictTimestamp(values["validFromMillis"])
        val expiresAtMillis = strictTimestamp(values["expiresAtMillis"])
        if (
            issuedAtMillis > validFromMillis ||
            validFromMillis >= expiresAtMillis ||
            expiresAtMillis - issuedAtMillis > MAX_CHALLENGE_LIFETIME_MILLIS
        ) {
            invalid()
        }

        return BiteSaverDeviceChallenge(
            challengeId = challengeId,
            challengeBytes = challengeBytes,
            requestFingerprint = BiteSaverDeviceEncoding.decodeLowerHex(requestFingerprintText),
            authenticatedUserId = authenticatedUserId,
            origin = origin,
            logicalRequestId = logicalRequestId,
            issuedAtMillis = issuedAtMillis,
            validFromMillis = validFromMillis,
            expiresAtMillis = expiresAtMillis,
        )
    }

    private fun requireProtocol(values: Map<String, Any?>) {
        if (
            strictLong(values["schemaVersion"]) !=
                BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION.toLong() ||
            values["protocolVersion"] != BITE_SAVER_DEVICE_PROOF_PROTOCOL ||
            values["platform"] != BITE_SAVER_DEVICE_PROOF_PLATFORM
        ) {
            invalid()
        }
    }

    internal fun requireAuthenticatedUserId(value: String) {
        if (
            value.isEmpty() ||
            value.length > MAX_AUTHENTICATED_USER_ID_UNITS ||
            value.trim() != value ||
            value.any { it.code <= 0x1f || it.code == 0x7f } ||
            value.contains('/') ||
            value == "." ||
            value == ".." ||
            (value.startsWith("__") && value.endsWith("__"))
        ) {
            invalid()
        }
        // UTF-8 encoding replaces lone surrogates; reject them before signing
        // so two different malformed identities cannot bind the same bytes.
        var index = 0
        while (index < value.length) {
            val unit = value[index]
            if (Character.isHighSurrogate(unit)) {
                if (index + 1 >= value.length || !Character.isLowSurrogate(value[index + 1])) {
                    invalid()
                }
                index += 2
            } else {
                if (Character.isLowSurrogate(unit)) invalid()
                index += 1
            }
        }
    }

    private fun strictMap(value: Any?, expectedKeys: Set<String>): Map<String, Any?> {
        if (value !is Map<*, *>) {
            invalid()
        }
        val result = LinkedHashMap<String, Any?>(value.size)
        for ((rawKey, rawValue) in value) {
            if (rawKey !is String || result.put(rawKey, rawValue) != null) {
                invalid()
            }
        }
        if (result.keys != expectedKeys) {
            invalid()
        }
        return result
    }

    private fun strictString(value: Any?, maxBytes: Int): String {
        if (value !is String || value.toByteArray(StandardCharsets.UTF_8).size > maxBytes) {
            invalid()
        }
        return value
    }

    private fun strictTimestamp(value: Any?): Long {
        val parsed = strictLong(value)
        if (parsed < 0L || parsed > MAX_SAFE_INTEGER) {
            invalid()
        }
        return parsed
    }

    private fun strictLong(value: Any?): Long =
        when (value) {
            is Byte -> value.toLong()
            is Short -> value.toLong()
            is Int -> value.toLong()
            is Long -> value
            else -> invalid()
        }

    private fun invalid(): Nothing = throw BiteSaverDeviceContractException()
}

internal enum class BiteSaverAndroidProofKind(val wireValue: String) {
    ENROLLMENT("androidEnrollment"),
    USE("androidUse"),
}

internal data class BiteSaverAndroidTranscriptInput(
    val proofKind: BiteSaverAndroidProofKind,
    val challenge: BiteSaverDeviceChallenge,
    val credentialId: String,
    val installationPublicKeySha256: ByteArray,
    val androidSsaid: String?,
)

internal object BiteSaverCanonicalTranscript {
    private val header =
        "BiteStar/BiteSaver/DeviceProofTranscript/v1\u0000"
            .toByteArray(StandardCharsets.US_ASCII)

    fun encode(input: BiteSaverAndroidTranscriptInput): ByteArray {
        validate(input)
        val output = ByteArrayOutputStream(512)
        DataOutputStream(output).use { data ->
            data.write(header)
            data.writeInt(BITE_SAVER_DEVICE_PROOF_SCHEMA_VERSION)
            data.writeText(BITE_SAVER_DEVICE_PROOF_PROTOCOL)
            data.writeText(input.proofKind.wireValue)
            data.writeText(BITE_SAVER_DEVICE_PROOF_PLATFORM)
            data.writeText(BITE_SAVER_DEVICE_PROOF_PURPOSE)
            data.writeText(input.challenge.challengeId)
            data.writeBytesWithLength(input.challenge.challengeBytes)
            data.writeBytesWithLength(input.challenge.requestFingerprint)
            data.writeNullableText(input.challenge.authenticatedUserId, MAX_AUTHENTICATED_USER_ID_BYTES)
            data.writeText(input.challenge.origin)
            data.writeText(input.challenge.logicalRequestId)
            data.writeLong(input.challenge.issuedAtMillis)
            data.writeLong(input.challenge.validFromMillis)
            data.writeLong(input.challenge.expiresAtMillis)
            data.writeNullableText(input.credentialId)
            data.writeNullableBytes(input.installationPublicKeySha256)
            data.writeNullableBytes(input.androidSsaid?.toByteArray(StandardCharsets.UTF_8))
            data.writeNullableBytes(null)
            data.writeNullableText(null)
        }
        return output.toByteArray()
    }

    fun sha256(transcript: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(transcript)

    private fun validate(input: BiteSaverAndroidTranscriptInput) {
        input.challenge.authenticatedUserId?.let {
            BiteSaverDeviceProofRequestParser.requireAuthenticatedUserId(it)
        }
        if (
            !credentialIdPattern.matches(input.credentialId) ||
            input.installationPublicKeySha256.size != 32 ||
            input.challenge.challengeBytes.size != 32 ||
            input.challenge.requestFingerprint.size != 32
        ) {
            throw BiteSaverDeviceContractException()
        }
        when (input.proofKind) {
            BiteSaverAndroidProofKind.ENROLLMENT -> {
                if (input.androidSsaid == null || !androidSsaidPattern.matches(input.androidSsaid)) {
                    throw BiteSaverDeviceContractException()
                }
            }
            BiteSaverAndroidProofKind.USE -> {
                if (input.androidSsaid != null) {
                    throw BiteSaverDeviceContractException()
                }
            }
        }
    }

    private fun DataOutputStream.writeText(value: String, maximumBytes: Int = MAX_TEXT_BYTES) {
        val encoded = value.toByteArray(StandardCharsets.UTF_8)
        if (encoded.size > maximumBytes) {
            throw BiteSaverDeviceContractException()
        }
        writeBytesWithLength(encoded)
    }

    private fun DataOutputStream.writeBytesWithLength(value: ByteArray) {
        writeInt(value.size)
        write(value)
    }

    private fun DataOutputStream.writeNullableText(value: String?, maximumBytes: Int = MAX_TEXT_BYTES) {
        if (value == null) {
            writeByte(0)
        } else {
            writeByte(1)
            writeText(value, maximumBytes)
        }
    }

    private fun DataOutputStream.writeNullableBytes(value: ByteArray?) {
        if (value == null) {
            writeByte(0)
        } else {
            writeByte(1)
            writeBytesWithLength(value)
        }
    }
}

internal object BiteSaverCredentialId {
    private val header =
        "BiteStar/BiteSaver/CredentialId/v1\u0000"
            .toByteArray(StandardCharsets.US_ASCII)

    fun fromAndroidPublicKey(publicKeySpki: ByteArray): String {
        if (publicKeySpki.isEmpty() || publicKeySpki.size > 512) {
            throw BiteSaverDeviceContractException("corrupt-credential")
        }
        val publicKeyHash = MessageDigest.getInstance("SHA-256").digest(publicKeySpki)
        return fromAndroidPublicKeySha256(publicKeyHash)
    }

    fun fromAndroidPublicKeySha256(publicKeyHash: ByteArray): String {
        if (publicKeyHash.size != 32) {
            throw BiteSaverDeviceContractException("corrupt-credential")
        }
        val output = ByteArrayOutputStream(128)
        DataOutputStream(output).use { data ->
            data.write(header)
            val platform = BITE_SAVER_DEVICE_PROOF_PLATFORM.toByteArray(StandardCharsets.UTF_8)
            data.writeInt(platform.size)
            data.write(platform)
            data.writeInt(publicKeyHash.size)
            data.write(publicKeyHash)
        }
        return "bsic_${BiteSaverDeviceEncoding.base64Url(sha256(output.toByteArray()))}"
    }

    private fun sha256(value: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(value)
}

internal object BiteSaverDeviceEncoding {
    private const val BASE64_URL_ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun base64Url(value: ByteArray): String {
        val result = StringBuilder((value.size * 4 + 2) / 3)
        var offset = 0
        while (offset < value.size) {
            val first = value[offset].toInt() and 0xff
            val hasSecond = offset + 1 < value.size
            val hasThird = offset + 2 < value.size
            val second = if (hasSecond) value[offset + 1].toInt() and 0xff else 0
            val third = if (hasThird) value[offset + 2].toInt() and 0xff else 0
            result.append(BASE64_URL_ALPHABET[first ushr 2])
            result.append(BASE64_URL_ALPHABET[((first and 0x03) shl 4) or (second ushr 4)])
            if (hasSecond) {
                result.append(BASE64_URL_ALPHABET[((second and 0x0f) shl 2) or (third ushr 6)])
            }
            if (hasThird) {
                result.append(BASE64_URL_ALPHABET[third and 0x3f])
            }
            offset += 3
        }
        return result.toString()
    }

    fun decodeBase64Url(value: String, expectedBytes: Int): ByteArray {
        if (value.isEmpty() || value.any { !it.isLetterOrDigit() && it != '-' && it != '_' }) {
            throw BiteSaverDeviceContractException()
        }
        if (value.length % 4 == 1) {
            throw BiteSaverDeviceContractException()
        }
        val decoded = ByteArray(value.length * 6 / 8)
        var outputOffset = 0
        var buffer = 0
        var bufferedBits = 0
        for (character in value) {
            val digit = BASE64_URL_ALPHABET.indexOf(character)
            if (digit < 0) {
                throw BiteSaverDeviceContractException()
            }
            buffer = (buffer shl 6) or digit
            bufferedBits += 6
            if (bufferedBits >= 8) {
                bufferedBits -= 8
                decoded[outputOffset] = (buffer ushr bufferedBits).toByte()
                outputOffset += 1
                buffer = if (bufferedBits == 0) 0 else buffer and ((1 shl bufferedBits) - 1)
            }
        }
        if (buffer != 0 || outputOffset != decoded.size) {
            throw BiteSaverDeviceContractException()
        }
        if (decoded.size != expectedBytes || base64Url(decoded) != value) {
            throw BiteSaverDeviceContractException()
        }
        return decoded
    }

    fun decodeLowerHex(value: String): ByteArray {
        if (value.length % 2 != 0 || value.any { it !in '0'..'9' && it !in 'a'..'f' }) {
            throw BiteSaverDeviceContractException()
        }
        return ByteArray(value.length / 2) { index ->
            value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
    }

    fun lowerHex(value: ByteArray): String = value.joinToString("") { "%02x".format(it) }
}

internal object BiteSaverEcdsaDer {
    fun isCanonicalP256(signature: ByteArray): Boolean {
        if (signature.size !in 8..72 || signature[0] != 0x30.toByte()) {
            return false
        }
        val sequenceLength = signature[1].toInt() and 0xff
        if (sequenceLength != signature.size - 2) {
            return false
        }
        var offset = 2
        repeat(2) {
            if (offset + 2 > signature.size || signature[offset] != 0x02.toByte()) {
                return false
            }
            val integerLength = signature[offset + 1].toInt() and 0xff
            offset += 2
            if (integerLength !in 1..33 || offset + integerLength > signature.size) {
                return false
            }
            val first = signature[offset].toInt() and 0xff
            if ((first and 0x80) != 0) {
                return false
            }
            if (
                integerLength > 1 &&
                first == 0 &&
                (signature[offset + 1].toInt() and 0x80) == 0
            ) {
                return false
            }
            offset += integerLength
        }
        return offset == signature.size
    }
}
