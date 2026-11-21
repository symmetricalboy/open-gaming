package games.opengaming.sdk.cbor

import java.math.BigInteger
import java.security.MessageDigest
import java.util.Base64

class CidV1(val bytes: ByteArray) {
    val value: String = "b" + encodeBase32Lower(bytes)

    override fun toString(): String = value

    companion object {
        private const val CID_VERSION_1: Byte = 0x01
        private const val DAG_CBOR_CODEC: Byte = 0x71
        private const val SHA256_CODE: Byte = 0x12
        private const val SHA256_LEN: Byte = 0x20

        private const val BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
        private const val BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
        private val FIFTY_EIGHT = BigInteger.valueOf(58L)

        fun fromDagCborBytes(cborBytes: ByteArray): CidV1 {
            val digest = MessageDigest.getInstance("SHA-256").digest(cborBytes)
            val cidBytes = ByteArray(4 + digest.size)
            cidBytes[0] = CID_VERSION_1
            cidBytes[1] = DAG_CBOR_CODEC
            cidBytes[2] = SHA256_CODE
            cidBytes[3] = SHA256_LEN
            System.arraycopy(digest, 0, cidBytes, 4, digest.size)
            return CidV1(cidBytes)
        }

        fun encodeBase32Lower(data: ByteArray): String {
            if (data.isEmpty()) return ""
            val sb = StringBuilder((data.size * 8 + 4) / 5)
            var buffer = 0
            var bitsLeft = 0
            for (b in data) {
                buffer = (buffer shl 8) or (b.toInt() and 0xFF)
                bitsLeft += 8
                while (bitsLeft >= 5) {
                    val idx = (buffer shr (bitsLeft - 5)) and 0x1F
                    bitsLeft -= 5
                    sb.append(BASE32_ALPHABET[idx])
                }
            }
            if (bitsLeft > 0) {
                val idx = (buffer shl (5 - bitsLeft)) and 0x1F
                sb.append(BASE32_ALPHABET[idx])
            }
            return sb.toString()
        }

        fun encodeBase58Btc(data: ByteArray): String {
            if (data.isEmpty()) return ""
            var leadingZeros = 0
            while (leadingZeros < data.size && data[leadingZeros].toInt() == 0) {
                leadingZeros++
            }

            var num = BigInteger(1, data)
            val sb = StringBuilder()
            while (num > BigInteger.ZERO) {
                val divRem = num.divideAndRemainder(FIFTY_EIGHT)
                num = divRem[0]
                sb.append(BASE58_ALPHABET[divRem[1].toInt()])
            }
            repeat(leadingZeros) { sb.append('1') }
            return sb.reverse().toString()
        }

        fun decodeBase58Btc(input: String): ByteArray {
            if (input.isEmpty()) return ByteArray(0)
            var leadingOnes = 0
            while (leadingOnes < input.length && input[leadingOnes] == '1') {
                leadingOnes++
            }

            var num = BigInteger.ZERO
            for (ch in input) {
                val idx = BASE58_ALPHABET.indexOf(ch)
                require(idx >= 0) { "Invalid base58btc character '$ch'." }
                num = num.multiply(FIFTY_EIGHT).add(BigInteger.valueOf(idx.toLong()))
            }

            val raw = if (num == BigInteger.ZERO) ByteArray(0) else num.toByteArray()
            val strippedOffset = if (raw.isNotEmpty() && raw[0].toInt() == 0) 1 else 0
            val sigLen = raw.size - strippedOffset

            val out = ByteArray(leadingOnes + sigLen)
            System.arraycopy(raw, strippedOffset, out, leadingOnes, sigLen)
            return out
        }

        fun toBase64Unpadded(bytes: ByteArray): String =
            Base64.getEncoder().withoutPadding().encodeToString(bytes)

        fun toBase64Url(bytes: ByteArray): String =
            Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

        fun fromBase64Flexible(raw: String): ByteArray {
            val clean = raw.trim().replace('-', '+').replace('_', '/')
            val pad = (4 - clean.length % 4) % 4
            val padded = clean + "=".repeat(pad)
            return Base64.getDecoder().decode(padded)
        }
    }
}
