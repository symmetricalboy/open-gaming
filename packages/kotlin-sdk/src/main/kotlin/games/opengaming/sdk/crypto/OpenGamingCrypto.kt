package games.opengaming.sdk.crypto

import games.opengaming.sdk.cbor.CidV1
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec

/**
 * P-256 (secp256r1) ECDSA signing & verification utilities 100% compatible with
 * `@atproto/crypto`, `@opengaming/sdk`, and `com.opengaming.sdk` (Unity):
 * - Private keys import/export as 32-byte big-endian scalars in base64url.
 * - Public keys format as `did:key:zDna...` (`[0x80, 0x24]` multicodec + 33-byte SEC1 compressed point).
 * - Signatures use SHA-256 over raw CIDv1 bytes and output 64-byte IEEE P1363 (`r || s`) with mandatory `low-S` normalization.
 */
class OpenGamingSigningKey private constructor(
    private val privateKey: PrivateKey,
    private val privateScalar: ByteArray,
    val publicDidKey: String,
    val publicPointX: ByteArray,
    val publicPointY: ByteArray
) {
    fun exportPrivateKeyBase64Url(): String = CidV1.toBase64Url(privateScalar)

    fun sign(message: ByteArray): ByteArray {
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(message)
        val derSig = signer.sign()
        val raw64 = derToP1363(derSig)
        return normalizeLowS(raw64)
    }

    companion object {
        private val FIELD_PRIME_P = BigInteger(
            "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF",
            16
        )
        private val CURVE_B = BigInteger(
            "5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B",
            16
        )
        private val CURVE_ORDER_N = BigInteger(
            "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
            16
        )
        private val HALF_ORDER_N: BigInteger = CURVE_ORDER_N.shiftRight(1)
        private val SQRT_EXPONENT: BigInteger = FIELD_PRIME_P.add(BigInteger.ONE).shiftRight(2)
        private val GX = BigInteger(
            "6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296",
            16
        )
        private val GY = BigInteger(
            "4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5",
            16
        )

        private val EC_PARAM_SPEC: ECParameterSpec by lazy {
            val params = AlgorithmParameters.getInstance("EC")
            params.init(ECGenParameterSpec("secp256r1"))
            params.getParameterSpec(ECParameterSpec::class.java)
        }

        fun generate(): OpenGamingSigningKey {
            val kpg = KeyPairGenerator.getInstance("EC")
            kpg.initialize(ECGenParameterSpec("secp256r1"))
            val kp = kpg.generateKeyPair()
            val pub = kp.public as ECPublicKey
            val privS = (kp.private as java.security.interfaces.ECPrivateKey).s
            val scalar32 = toBigEndian32(privS)
            val x32 = toBigEndian32(pub.w.affineX)
            val y32 = toBigEndian32(pub.w.affineY)
            return OpenGamingSigningKey(
                privateKey = kp.private,
                privateScalar = scalar32,
                publicDidKey = formatDidKeyFromPoint(x32, y32),
                publicPointX = x32,
                publicPointY = y32
            )
        }

        fun load(privateKeyBase64Url: String): OpenGamingSigningKey {
            val clean = privateKeyBase64Url.trim()
            require(clean.isNotEmpty()) { "Private key string cannot be empty." }
            val scalar = CidV1.fromBase64Flexible(clean)
            require(scalar.size == 32) { "Expected 32-byte P-256 private key, got ${scalar.size} bytes." }

            val d = BigInteger(1, scalar)
            require(d > BigInteger.ZERO && d < CURVE_ORDER_N) { "Invalid P-256 private scalar." }

            val kf = KeyFactory.getInstance("EC")
            val privateKey = kf.generatePrivate(ECPrivateKeySpec(d, EC_PARAM_SPEC))
            val (qx, qy) = derivePublicPoint(d)
            val x32 = toBigEndian32(qx)
            val y32 = toBigEndian32(qy)

            return OpenGamingSigningKey(
                privateKey = privateKey,
                privateScalar = scalar,
                publicDidKey = formatDidKeyFromPoint(x32, y32),
                publicPointX = x32,
                publicPointY = y32
            )
        }

        fun verifyDidKeySignature(didKey: String, message: ByteArray, signatureBytes: ByteArray): Boolean {
            if (signatureBytes.size != 64) return false

            val r = BigInteger(1, signatureBytes.copyOfRange(0, 32))
            val s = BigInteger(1, signatureBytes.copyOfRange(32, 64))
            if (r <= BigInteger.ZERO || r >= CURVE_ORDER_N || s <= BigInteger.ZERO || s > HALF_ORDER_N) {
                return false
            }

            val coords = decompressP256DidKey(didKey) ?: return false
            return try {
                val kf = KeyFactory.getInstance("EC")
                val pubKey: PublicKey = kf.generatePublic(
                    ECPublicKeySpec(ECPoint(coords.first, coords.second), EC_PARAM_SPEC)
                )
                val verifier = Signature.getInstance("SHA256withECDSA")
                verifier.initVerify(pubKey)
                verifier.update(message)
                verifier.verify(p1363ToDer(r, s))
            } catch (_: Exception) {
                false
            }
        }

        fun formatDidKeyFromPoint(x32: ByteArray, y32: ByteArray): String {
            val parity: Byte = if ((y32[31].toInt() and 1) == 0) 0x02 else 0x03
            val prefixed = ByteArray(35)
            prefixed[0] = 0x80.toByte()
            prefixed[1] = 0x24.toByte()
            prefixed[2] = parity
            System.arraycopy(x32, 0, prefixed, 3, 32)
            return "did:key:z" + CidV1.encodeBase58Btc(prefixed)
        }

        fun decompressP256DidKey(didKey: String): Pair<BigInteger, BigInteger>? {
            if (!didKey.startsWith("did:key:z")) return null
            val prefixed = try {
                CidV1.decodeBase58Btc(didKey.removePrefix("did:key:z"))
            } catch (_: Exception) {
                return null
            }
            if (prefixed.size != 35 ||
                (prefixed[0].toInt() and 0xFF) != 0x80 ||
                (prefixed[1].toInt() and 0xFF) != 0x24
            ) {
                return null
            }

            val tag = prefixed[2].toInt() and 0xFF
            if (tag != 0x02 && tag != 0x03) return null

            val x = BigInteger(1, prefixed.copyOfRange(3, 35))
            if (x >= FIELD_PRIME_P) return null

            val rhs = modField(x.modPow(BigInteger.valueOf(3L), FIELD_PRIME_P)
                .subtract(x.multiply(BigInteger.valueOf(3L)))
                .add(CURVE_B))
            var y = rhs.modPow(SQRT_EXPONENT, FIELD_PRIME_P)
            if (y.modPow(BigInteger.TWO, FIELD_PRIME_P) != rhs) return null

            val isOdd = y.testBit(0)
            val wantOdd = tag == 0x03
            if (isOdd != wantOdd) {
                y = FIELD_PRIME_P.subtract(y)
            }
            return x to y
        }

        private fun normalizeLowS(sig64: ByteArray): ByteArray {
            val s = BigInteger(1, sig64.copyOfRange(32, 64))
            if (s <= HALF_ORDER_N) return sig64
            val lowS = CURVE_ORDER_N.subtract(s)
            val out = sig64.copyOf()
            System.arraycopy(toBigEndian32(lowS), 0, out, 32, 32)
            return out
        }

        private fun derToP1363(der: ByteArray): ByteArray {
            require(der.size >= 8 && der[0].toInt() == 0x30) { "Invalid DER ECDSA signature." }
            var idx = 2
            if ((der[1].toInt() and 0x80) != 0) {
                idx += der[1].toInt() and 0x7F
            }
            require(der[idx++].toInt() == 0x02) { "Expected DER INTEGER for r." }
            val rLen = der[idx++].toInt() and 0xFF
            val r = BigInteger(1, der.copyOfRange(idx, idx + rLen))
            idx += rLen
            require(der[idx++].toInt() == 0x02) { "Expected DER INTEGER for s." }
            val sLen = der[idx++].toInt() and 0xFF
            val s = BigInteger(1, der.copyOfRange(idx, idx + sLen))

            val out = ByteArray(64)
            System.arraycopy(toBigEndian32(r), 0, out, 0, 32)
            System.arraycopy(toBigEndian32(s), 0, out, 32, 32)
            return out
        }

        private fun p1363ToDer(r: BigInteger, s: BigInteger): ByteArray {
            val rDer = r.toByteArray()
            val sDer = s.toByteArray()
            val seqLen = 2 + rDer.size + 2 + sDer.size
            val out = ByteArrayOutputStream(2 + seqLen)
            out.write(0x30)
            if (seqLen < 128) {
                out.write(seqLen)
            } else {
                out.write(0x81)
                out.write(seqLen)
            }
            out.write(0x02)
            out.write(rDer.size)
            out.write(rDer)
            out.write(0x02)
            out.write(sDer.size)
            out.write(sDer)
            return out.toByteArray()
        }

        private data class CurvePoint(val x: BigInteger, val y: BigInteger, val infinity: Boolean)

        private fun derivePublicPoint(scalarD: BigInteger): Pair<BigInteger, BigInteger> {
            var acc = CurvePoint(BigInteger.ZERO, BigInteger.ZERO, true)
            var addend = CurvePoint(GX, GY, false)
            var k = scalarD
            while (k > BigInteger.ZERO) {
                if (k.testBit(0)) {
                    acc = pointAdd(acc, addend)
                }
                addend = pointDouble(addend)
                k = k.shiftRight(1)
            }
            return acc.x to acc.y
        }

        private fun pointDouble(p: CurvePoint): CurvePoint {
            if (p.infinity || p.y == BigInteger.ZERO) return CurvePoint(BigInteger.ZERO, BigInteger.ZERO, true)
            val num = modField(p.x.multiply(p.x).multiply(BigInteger.valueOf(3L)).subtract(BigInteger.valueOf(3L)))
            val den = modField(p.y.shiftLeft(1)).modInverse(FIELD_PRIME_P)
            val lambda = modField(num.multiply(den))
            val xr = modField(lambda.multiply(lambda).subtract(p.x.shiftLeft(1)))
            val yr = modField(lambda.multiply(p.x.subtract(xr)).subtract(p.y))
            return CurvePoint(xr, yr, false)
        }

        private fun pointAdd(p: CurvePoint, q: CurvePoint): CurvePoint {
            if (p.infinity) return q
            if (q.infinity) return p
            if (p.x == q.x) {
                return if (modField(p.y.add(q.y)) == BigInteger.ZERO) {
                    CurvePoint(BigInteger.ZERO, BigInteger.ZERO, true)
                } else {
                    pointDouble(p)
                }
            }
            val num = modField(q.y.subtract(p.y))
            val den = modField(q.x.subtract(p.x)).modInverse(FIELD_PRIME_P)
            val lambda = modField(num.multiply(den))
            val xr = modField(lambda.multiply(lambda).subtract(p.x).subtract(q.x))
            val yr = modField(lambda.multiply(p.x.subtract(xr)).subtract(p.y))
            return CurvePoint(xr, yr, false)
        }

        private fun modField(v: BigInteger): BigInteger {
            val r = v.mod(FIELD_PRIME_P)
            return if (r.signum() < 0) r.add(FIELD_PRIME_P) else r
        }

        internal fun toBigEndian32(v: BigInteger): ByteArray {
            val raw = v.toByteArray()
            if (raw.size == 32) return raw
            val out = ByteArray(32)
            if (raw.size > 32) {
                System.arraycopy(raw, raw.size - 32, out, 0, 32)
            } else {
                System.arraycopy(raw, 0, out, 32 - raw.size, raw.size)
            }
            return out
        }
    }
}
