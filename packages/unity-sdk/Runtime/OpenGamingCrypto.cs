using System;
using System.Numerics;
using System.Security.Cryptography;
using OpenGaming.Sdk.Internal;

namespace OpenGaming.Sdk
{
    /// <summary>
    /// P-256 ECDSA keypair and signature utilities 100% compatible with @atproto/crypto and @opengaming/sdk:
    /// - Private keys export/import as 32-byte big-endian scalars in base64url.
    /// - Public keys encode as did:key:zDna... (base58btc of [0x80, 0x24] multicodec + 33-byte SEC1 compressed point).
    /// - Signatures use SHA-256 over raw CIDv1 bytes and output 64-byte IEEE P1363 (r || s) with mandatory low-S normalization.
    /// </summary>
    public sealed class OpenGamingSigningKey : IDisposable
    {
        // NIST P-256 (secp256r1) curve constants
        private static readonly BigInteger FieldPrimeP = ParseHexUnsigned(
            "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF");
        private static readonly BigInteger CurveB = ParseHexUnsigned(
            "5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B");
        private static readonly BigInteger CurveOrderN = ParseHexUnsigned(
            "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
        private static readonly BigInteger HalfOrderN = CurveOrderN >> 1;
        private static readonly BigInteger SqrtExponent = (FieldPrimeP + BigInteger.One) >> 2;

        private readonly ECDsa _ecdsa;
        private readonly byte[] _privateScalar;
        public string PublicDidKey { get; }

        private OpenGamingSigningKey(ECDsa ecdsa, byte[] privateScalar, string publicDidKey)
        {
            _ecdsa = ecdsa;
            _privateScalar = privateScalar;
            PublicDidKey = publicDidKey;
        }

        public static OpenGamingSigningKey Generate()
        {
            var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var p = ecdsa.ExportParameters(true);
            var d = PadTo32(p.D!);
            string didKey = FormatDidKeyFromPoint(p.Q.X!, p.Q.Y!);
            return new OpenGamingSigningKey(ecdsa, d, didKey);
        }

        public static OpenGamingSigningKey Load(string privateKeyBase64Url)
        {
            if (string.IsNullOrWhiteSpace(privateKeyBase64Url))
                throw new ArgumentException("Private key string cannot be empty.", nameof(privateKeyBase64Url));

            byte[] d = CidV1.FromBase64Flexible(privateKeyBase64Url);
            if (d.Length != 32)
                throw new FormatException($"Expected 32-byte P-256 private key, got {d.Length} bytes.");

            // Derive public point Q = d * G using BigInteger EC scalar multiplication on secp256r1
            // so cross-platform .NET & Mono/IL2CPP runtimes never reject ImportParameters without Q!
            (byte[] qx, byte[] qy) = DerivePublicPoint(d);

            var ecParams = new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                D = d,
                Q = new ECPoint { X = qx, Y = qy }
            };
            var ecdsa = ECDsa.Create(ecParams);
            string didKey = FormatDidKeyFromPoint(qx, qy);
            return new OpenGamingSigningKey(ecdsa, d, didKey);
        }

        public string ExportPrivateKeyBase64Url() => CidV1.ToBase64Url(_privateScalar);

        public byte[] Sign(byte[] message)
        {
#if NETSTANDARD2_1_OR_GREATER || NET5_0_OR_GREATER
            byte[] rawSig = _ecdsa.SignData(message, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
#else
            // Unity Mono/.NET Standard 2.0 SignData returns IEEE P1363 (64 bytes) or DER depending on runtime
            byte[] candidate = _ecdsa.SignData(message, HashAlgorithmName.SHA256);
            byte[] rawSig = candidate.Length == 64 ? candidate : DerToP1363(candidate);
#endif
            return NormalizeLowS(rawSig);
        }

        public static bool VerifyDidKeySignature(string didKey, byte[] message, byte[] signatureBytes)
        {
            if (signatureBytes == null || signatureBytes.Length != 64)
                return false;

            // Enforce non-malleable low-S compact signature (matching @atproto/crypto)
            byte[] rBytes = new byte[32];
            byte[] sBytes = new byte[32];
            Buffer.BlockCopy(signatureBytes, 0, rBytes, 0, 32);
            Buffer.BlockCopy(signatureBytes, 32, sBytes, 0, 32);

            BigInteger r = ToUnsignedBigInt(rBytes);
            BigInteger s = ToUnsignedBigInt(sBytes);
            if (r <= BigInteger.Zero || r >= CurveOrderN || s <= BigInteger.Zero || s > HalfOrderN)
                return false;

            if (!TryDecompressP256DidKey(didKey, out byte[] qx, out byte[] qy))
                return false;

            using var verifier = ECDsa.Create(new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = qx, Y = qy }
            });

#if NETSTANDARD2_1_OR_GREATER || NET5_0_OR_GREATER
            return verifier.VerifyData(message, signatureBytes, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
#else
            return verifier.VerifyData(message, signatureBytes, HashAlgorithmName.SHA256);
#endif
        }

        public static string FormatDidKeyFromPoint(byte[] x, byte[] y)
        {
            byte[] x32 = PadTo32(x);
            byte[] y32 = PadTo32(y);
            byte parityPrefix = (y32[31] & 1) == 0 ? (byte)0x02 : (byte)0x03;

            // [0x80, 0x24] P-256 multicodec prefix + 33-byte SEC1 compressed public key
            var prefixed = new byte[35];
            prefixed[0] = 0x80;
            prefixed[1] = 0x24;
            prefixed[2] = parityPrefix;
            Buffer.BlockCopy(x32, 0, prefixed, 3, 32);

            return "did:key:z" + CidV1.EncodeBase58Btc(prefixed);
        }

        public static bool TryDecompressP256DidKey(string didKey, out byte[] x32, out byte[] y32)
        {
            x32 = Array.Empty<byte>();
            y32 = Array.Empty<byte>();

            if (string.IsNullOrEmpty(didKey) || !didKey.StartsWith("did:key:z", StringComparison.Ordinal))
                return false;

            byte[] prefixed;
            try
            {
                prefixed = CidV1.DecodeBase58Btc(didKey.Substring("did:key:z".Length));
            }
            catch
            {
                return false;
            }

            if (prefixed.Length != 35 || prefixed[0] != 0x80 || prefixed[1] != 0x24)
                return false;

            byte tag = prefixed[2];
            if (tag != 0x02 && tag != 0x03)
                return false;

            x32 = new byte[32];
            Buffer.BlockCopy(prefixed, 3, x32, 0, 32);
            BigInteger x = ToUnsignedBigInt(x32);
            if (x >= FieldPrimeP)
                return false;

            // y^2 = x^3 - 3x + b (mod p)
            BigInteger x3 = BigInteger.ModPow(x, 3, FieldPrimeP);
            BigInteger threeX = (3 * x) % FieldPrimeP;
            BigInteger rhs = (x3 - threeX + CurveB) % FieldPrimeP;
            if (rhs.Sign < 0) rhs += FieldPrimeP;

            BigInteger y = BigInteger.ModPow(rhs, SqrtExponent, FieldPrimeP);
            if (BigInteger.ModPow(y, 2, FieldPrimeP) != rhs)
                return false;

            bool isOdd = !y.IsEven;
            bool wantOdd = tag == 0x03;
            if (isOdd != wantOdd)
            {
                y = FieldPrimeP - y;
            }

            y32 = ToBigEndian32(y);
            return true;
        }

        private static byte[] NormalizeLowS(byte[] sig64)
        {
            var sBytes = new byte[32];
            Buffer.BlockCopy(sig64, 32, sBytes, 0, 32);
            BigInteger s = ToUnsignedBigInt(sBytes);
            if (s > HalfOrderN)
            {
                BigInteger lowS = CurveOrderN - s;
                byte[] normalizedS = ToBigEndian32(lowS);
                var outSig = new byte[64];
                Buffer.BlockCopy(sig64, 0, outSig, 0, 32);
                Buffer.BlockCopy(normalizedS, 0, outSig, 32, 32);
                return outSig;
            }
            return sig64;
        }

        private static byte[] DerToP1363(byte[] der)
        {
            if (der.Length < 8 || der[0] != 0x30)
                throw new CryptographicException("Invalid ASN.1 DER ECDSA signature.");
            int idx = 2;
            if ((der[1] & 0x80) != 0) idx += der[1] & 0x7F;
            if (der[idx++] != 0x02) throw new CryptographicException("Expected DER INTEGER for r.");
            int rLen = der[idx++];
            var r = new byte[rLen];
            Buffer.BlockCopy(der, idx, r, 0, rLen);
            idx += rLen;
            if (der[idx++] != 0x02) throw new CryptographicException("Expected DER INTEGER for s.");
            int sLen = der[idx++];
            var s = new byte[sLen];
            Buffer.BlockCopy(der, idx, s, 0, sLen);

            var out64 = new byte[64];
            Buffer.BlockCopy(PadTo32(r), 0, out64, 0, 32);
            Buffer.BlockCopy(PadTo32(s), 0, out64, 32, 32);
            return out64;
        }

        // NIST P-256 base point G for deterministic Q = d * G scalar multiplication on import
        private static readonly BigInteger Gx = ParseHexUnsigned(
            "6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296");
        private static readonly BigInteger Gy = ParseHexUnsigned(
            "4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5");

        private static (byte[] X, byte[] Y) DerivePublicPoint(byte[] scalarD)
        {
            BigInteger k = ToUnsignedBigInt(scalarD);
            if (k <= BigInteger.Zero || k >= CurveOrderN)
                throw new CryptographicException("Invalid P-256 private scalar.");

            (BigInteger X, BigInteger Y, bool Infinity) acc = (BigInteger.Zero, BigInteger.Zero, true);
            (BigInteger X, BigInteger Y, bool Infinity) addend = (Gx, Gy, false);

            while (k > BigInteger.Zero)
            {
                if (!k.IsEven)
                {
                    acc = PointAdd(acc, addend);
                }
                addend = PointDouble(addend);
                k >>= 1;
            }

            return (ToBigEndian32(acc.X), ToBigEndian32(acc.Y));
        }

        private static (BigInteger X, BigInteger Y, bool Infinity) PointDouble((BigInteger X, BigInteger Y, bool Infinity) p)
        {
            if (p.Infinity || p.Y.IsZero) return (BigInteger.Zero, BigInteger.Zero, true);
            BigInteger num = Mod(3 * p.X * p.X - 3);
            BigInteger den = ModInverse(Mod(2 * p.Y), FieldPrimeP);
            BigInteger lambda = Mod(num * den);
            BigInteger xr = Mod(lambda * lambda - 2 * p.X);
            BigInteger yr = Mod(lambda * (p.X - xr) - p.Y);
            return (xr, yr, false);
        }

        private static (BigInteger X, BigInteger Y, bool Infinity) PointAdd(
            (BigInteger X, BigInteger Y, bool Infinity) p,
            (BigInteger X, BigInteger Y, bool Infinity) q)
        {
            if (p.Infinity) return q;
            if (q.Infinity) return p;
            if (p.X == q.X)
            {
                if (Mod(p.Y + q.Y).IsZero) return (BigInteger.Zero, BigInteger.Zero, true);
                return PointDouble(p);
            }
            BigInteger num = Mod(q.Y - p.Y);
            BigInteger den = ModInverse(Mod(q.X - p.X), FieldPrimeP);
            BigInteger lambda = Mod(num * den);
            BigInteger xr = Mod(lambda * lambda - p.X - q.X);
            BigInteger yr = Mod(lambda * (p.X - xr) - p.Y);
            return (xr, yr, false);
        }

        private static BigInteger Mod(BigInteger v)
        {
            BigInteger r = v % FieldPrimeP;
            return r.Sign < 0 ? r + FieldPrimeP : r;
        }

        private static BigInteger ModInverse(BigInteger a, BigInteger m) =>
            BigInteger.ModPow(a, m - 2, m);

        private static BigInteger ParseHexUnsigned(string hex)
        {
            byte[] be = new byte[hex.Length / 2];
            for (int i = 0; i < be.Length; i++)
                be[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            return ToUnsignedBigInt(be);
        }

        private static BigInteger ToUnsignedBigInt(byte[] bigEndian)
        {
            var le = new byte[bigEndian.Length + 1];
            for (int i = 0; i < bigEndian.Length; i++)
                le[bigEndian.Length - 1 - i] = bigEndian[i];
            return new BigInteger(le);
        }

        private static byte[] ToBigEndian32(BigInteger val)
        {
            byte[] le = val.ToByteArray();
            var out32 = new byte[32];
            int count = Math.Min(32, le.Length);
            for (int i = 0; i < count; i++)
            {
                out32[31 - i] = le[i];
            }
            return out32;
        }

        private static byte[] PadTo32(byte[] src)
        {
            if (src.Length == 32) return src;
            var dst = new byte[32];
            if (src.Length > 32)
                Buffer.BlockCopy(src, src.Length - 32, dst, 0, 32);
            else
                Buffer.BlockCopy(src, 0, dst, 32 - src.Length, src.Length);
            return dst;
        }

        public void Dispose() => _ecdsa.Dispose();
    }
}
