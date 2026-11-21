using System;
using System.Collections.Generic;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;

namespace OpenGaming.Sdk.Internal
{
    public readonly struct CidV1
    {
        private const byte CidVersion1 = 0x01;
        private const byte DagCborCodec = 0x71;
        private const byte Sha256HashCode = 0x12;
        private const byte Sha256DigestLen = 0x20;

        private const string Base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";
        private const string Base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

        public byte[] Bytes { get; }
        public string Value { get; }

        public CidV1(byte[] bytes)
        {
            Bytes = bytes ?? throw new ArgumentNullException(nameof(bytes));
            Value = "b" + EncodeBase32Lower(bytes);
        }

        public static CidV1 FromDagCborBytes(byte[] cborBytes)
        {
            byte[] digest;
            using (var sha = SHA256.Create())
            {
                digest = sha.ComputeHash(cborBytes);
            }

            var cidBytes = new byte[4 + digest.Length];
            cidBytes[0] = CidVersion1;
            cidBytes[1] = DagCborCodec;
            cidBytes[2] = Sha256HashCode;
            cidBytes[3] = Sha256DigestLen;
            Buffer.BlockCopy(digest, 0, cidBytes, 4, digest.Length);
            return new CidV1(cidBytes);
        }

        public override string ToString() => Value;

        public static string EncodeBase32Lower(byte[] data)
        {
            if (data.Length == 0) return string.Empty;
            var sb = new StringBuilder((data.Length * 8 + 4) / 5);
            int buffer = 0;
            int bitsLeft = 0;

            for (int i = 0; i < data.Length; i++)
            {
                buffer = (buffer << 8) | data[i];
                bitsLeft += 8;
                while (bitsLeft >= 5)
                {
                    int index = (buffer >> (bitsLeft - 5)) & 0x1F;
                    bitsLeft -= 5;
                    sb.Append(Base32Alphabet[index]);
                }
            }

            if (bitsLeft > 0)
            {
                int index = (buffer << (5 - bitsLeft)) & 0x1F;
                sb.Append(Base32Alphabet[index]);
            }

            return sb.ToString();
        }

        public static string EncodeBase58Btc(byte[] data)
        {
            if (data.Length == 0) return string.Empty;

            int leadingZeros = 0;
            while (leadingZeros < data.Length && data[leadingZeros] == 0)
            {
                leadingZeros++;
            }

            // BigInteger in .NET expects little-endian with trailing 0x00 for unsigned positive
            var reversed = new byte[data.Length + 1];
            for (int i = 0; i < data.Length; i++)
            {
                reversed[data.Length - 1 - i] = data[i];
            }

            var value = new BigInteger(reversed);
            var chars = new List<char>();
            var fiftyEight = new BigInteger(58);

            while (value > BigInteger.Zero)
            {
                value = BigInteger.DivRem(value, fiftyEight, out BigInteger remainder);
                chars.Add(Base58Alphabet[(int)remainder]);
            }

            for (int i = 0; i < leadingZeros; i++)
            {
                chars.Add('1');
            }

            chars.Reverse();
            return new string(chars.ToArray());
        }

        public static byte[] DecodeBase58Btc(string input)
        {
            if (string.IsNullOrEmpty(input)) return Array.Empty<byte>();

            int leadingOnes = 0;
            while (leadingOnes < input.Length && input[leadingOnes] == '1')
            {
                leadingOnes++;
            }

            var value = BigInteger.Zero;
            var fiftyEight = new BigInteger(58);
            for (int i = 0; i < input.Length; i++)
            {
                int digit = Base58Alphabet.IndexOf(input[i]);
                if (digit < 0)
                {
                    throw new FormatException($"Invalid base58btc character '{input[i]}'.");
                }
                value = value * fiftyEight + digit;
            }

            byte[] littleEndian = value == BigInteger.Zero ? Array.Empty<byte>() : value.ToByteArray();
            int significantLen = littleEndian.Length;
            while (significantLen > 0 && littleEndian[significantLen - 1] == 0)
            {
                significantLen--;
            }

            var result = new byte[leadingOnes + significantLen];
            for (int i = 0; i < significantLen; i++)
            {
                result[leadingOnes + i] = littleEndian[significantLen - 1 - i];
            }
            return result;
        }

        public static string ToBase64Unpadded(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).TrimEnd('=');
        }

        public static byte[] FromBase64Flexible(string raw)
        {
            string s = raw.Trim().Replace('-', '+').Replace('_', '/');
            int mod = s.Length % 4;
            if (mod > 0) s += new string('=', 4 - mod);
            return Convert.FromBase64String(s);
        }

        public static string ToBase64Url(byte[] bytes)
        {
            return Convert.ToBase64String(bytes)
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }
    }
}
