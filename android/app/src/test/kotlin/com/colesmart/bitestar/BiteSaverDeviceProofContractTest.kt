package com.colesmart.bitestar

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BiteSaverDeviceProofContractTest {
    @Test
    fun canonicalAndroidEnrollmentMatchesFrozenCrossLanguageVector() {
        val transcript =
            BiteSaverCanonicalTranscript.encode(
                BiteSaverAndroidTranscriptInput(
                    proofKind = BiteSaverAndroidProofKind.ENROLLMENT,
                    challenge = goldenChallenge(),
                    credentialId = GOLDEN_CREDENTIAL_ID,
                    installationPublicKeySha256 = bytes(0x20),
                    androidSsaid = "0123456789abcdef",
                ),
            )

        assertEquals(441, transcript.size)
        assertEquals(
            "958ae8084cbc061695525386fbbcd3eabbdfd566ab11fc422e72381992cb5b17",
            BiteSaverDeviceEncoding.lowerHex(BiteSaverCanonicalTranscript.sha256(transcript)),
        )
        assertEquals(
            "lYroCEy8BhaVUlOG-7zT6rvf1WarEfxCLnI4GZLLWxc",
            BiteSaverDeviceEncoding.base64Url(BiteSaverCanonicalTranscript.sha256(transcript)),
        )
    }

    @Test
    fun credentialIdMatchesFrozenPublicKeyHashVector() {
        assertEquals(
            GOLDEN_CREDENTIAL_ID,
            BiteSaverCredentialId.fromAndroidPublicKeySha256(bytes(0x20)),
        )
    }

    @Test
    fun challengeParserAcceptsOnlyExactBoundedShape() {
        val parsed = BiteSaverDeviceProofRequestParser.parseEnrollment(enrollmentArguments())
        assertEquals(253_983_587_346L, parsed.cloudProjectNumber)
        assertEquals("device-use-request-0001", parsed.challenge.logicalRequestId)
        assertArrayEquals(bytes(0), parsed.challenge.challengeBytes)

        val unknown = enrollmentArguments().toMutableMap().apply { put("extra", true) }
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverDeviceProofRequestParser.parseEnrollment(unknown)
        }

        val paddedId =
            enrollmentArguments().toMutableMap().apply {
                put("authenticatedUserId", " user-1")
            }
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverDeviceProofRequestParser.parseEnrollment(paddedId)
        }

        val reservedId =
            enrollmentArguments().toMutableMap().apply {
                put("authenticatedUserId", "__reserved__")
            }
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverDeviceProofRequestParser.parseEnrollment(reservedId)
        }

        val paddedEncoding =
            enrollmentArguments().toMutableMap().apply {
                put("challengeBytes", "$GOLDEN_CHALLENGE_BASE64=")
            }
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverDeviceProofRequestParser.parseEnrollment(paddedEncoding)
        }

        val mismatchedChallengeId =
            enrollmentArguments().toMutableMap().apply {
                put("challengeId", "bsdc_${"A".repeat(43)}")
            }
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverDeviceProofRequestParser.parseEnrollment(mismatchedChallengeId)
        }

        val internalSpaceUid =
            enrollmentArguments().toMutableMap().apply {
                put("authenticatedUserId", "customer user")
            }
        assertEquals(
            "customer user",
            BiteSaverDeviceProofRequestParser
                .parseEnrollment(internalSpaceUid)
                .challenge
                .authenticatedUserId,
        )
    }

    @Test
    fun useTranscriptCannotContainSsaid() {
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverCanonicalTranscript.encode(
                BiteSaverAndroidTranscriptInput(
                    proofKind = BiteSaverAndroidProofKind.USE,
                    challenge = goldenChallenge(),
                    credentialId = GOLDEN_CREDENTIAL_ID,
                    installationPublicKeySha256 = bytes(0x20),
                    androidSsaid = "0123456789abcdef",
                ),
            )
        }
    }

    @Test
    fun apiGateLeaves24And25UnsupportedWithoutRaisingAppMinimum() {
        assertFalse(BiteSaverDeviceProofAvailability.isSupported(24))
        assertFalse(BiteSaverDeviceProofAvailability.isSupported(25))
        assertTrue(BiteSaverDeviceProofAvailability.isSupported(26))
    }

    @Test
    fun resetRequiresExplicitProtocolReason() {
        BiteSaverDeviceProofRequestParser.parseReset(
            mapOf(
                "schemaVersion" to 1,
                "protocolVersion" to BITE_SAVER_DEVICE_PROOF_PROTOCOL,
                "platform" to BITE_SAVER_DEVICE_PROOF_PLATFORM,
                "reason" to "serverDirectedReenrollment",
            ),
        )
        assertThrows(BiteSaverDeviceContractException::class.java) {
            BiteSaverDeviceProofRequestParser.parseReset(
                mapOf(
                    "schemaVersion" to 1,
                    "protocolVersion" to BITE_SAVER_DEVICE_PROOF_PROTOCOL,
                    "platform" to BITE_SAVER_DEVICE_PROOF_PLATFORM,
                    "reason" to "userRequested",
                ),
            )
        }
    }

    @Test
    fun ecdsaDerValidatorRejectsNonCanonicalValues() {
        assertTrue(
            BiteSaverEcdsaDer.isCanonicalP256(
                byteArrayOf(0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01),
            ),
        )
        assertFalse(
            BiteSaverEcdsaDer.isCanonicalP256(
                byteArrayOf(0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01),
            ),
        )
    }

    private fun goldenChallenge(): BiteSaverDeviceChallenge =
        BiteSaverDeviceChallenge(
            challengeId = "bsdc_$GOLDEN_CHALLENGE_BASE64",
            challengeBytes = bytes(0),
            requestFingerprint = bytes(0),
            authenticatedUserId = null,
            origin = "discovery",
            logicalRequestId = "device-use-request-0001",
            issuedAtMillis = 1_789_617_600_000L,
            validFromMillis = 1_789_617_600_000L,
            expiresAtMillis = 1_789_617_720_000L,
        )

    private fun enrollmentArguments(): Map<String, Any?> =
        mapOf(
            "schemaVersion" to 1,
            "protocolVersion" to BITE_SAVER_DEVICE_PROOF_PROTOCOL,
            "platform" to BITE_SAVER_DEVICE_PROOF_PLATFORM,
            "purpose" to BITE_SAVER_DEVICE_PROOF_PURPOSE,
            "challengeId" to "bsdc_$GOLDEN_CHALLENGE_BASE64",
            "challengeBytes" to GOLDEN_CHALLENGE_BASE64,
            "requestFingerprint" to BiteSaverDeviceEncoding.lowerHex(bytes(0)),
            "authenticatedUserId" to null,
            "origin" to "discovery",
            "logicalRequestId" to "device-use-request-0001",
            "issuedAtMillis" to 1_789_617_600_000L,
            "validFromMillis" to 1_789_617_600_000L,
            "expiresAtMillis" to 1_789_617_720_000L,
            "cloudProjectNumber" to 253_983_587_346L,
        )

    private fun bytes(start: Int): ByteArray =
        ByteArray(32) { index -> (start + index).toByte() }

    private companion object {
        const val GOLDEN_CHALLENGE_BASE64 =
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
        const val GOLDEN_CREDENTIAL_ID =
            "bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI"
    }
}
