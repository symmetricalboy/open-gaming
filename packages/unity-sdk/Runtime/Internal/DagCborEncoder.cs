using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace OpenGaming.Sdk.Internal
{
    /// <summary>
    /// Canonical IPLD DAG-CBOR encoder matching @ipld/dag-cbor byte-for-byte:
    /// - Map keys are UTF-8 strings sorted by UTF-8 byte length ascending, then unsigned lexicographic byte order.
    /// - Null values are encoded as 0xF6 when explicitly present; dictionary entries with C# null values are omitted
    ///   when StripNullMapValues is true (matching stripUndefinedShallow / normalizeRecordValue in @opengaming/sdk).
    /// - Minimal integer headers (0..23 inline, 1B, 2B, 4B, 8B) and IEEE 754 float64 for non-integer doubles.
    /// </summary>
    public static class DagCborEncoder
    {
        public static byte[] Encode(object? value)
        {
            using var ms = new MemoryStream();
            WriteValue(ms, value);
            return ms.ToArray();
        }

        private static void WriteValue(Stream s, object? value)
        {
            if (value == null)
            {
                s.WriteByte(0xF6); // CBOR null
                return;
            }

            switch (value)
            {
                case bool b:
                    s.WriteByte(b ? (byte)0xF5 : (byte)0xF4);
                    return;

                case int i:
                    WriteInt64(s, i);
                    return;

                case long l:
                    WriteInt64(s, l);
                    return;

                case uint u:
                    WriteUInt64(s, 0, u);
                    return;

                case ulong ul:
                    WriteUInt64(s, 0, ul);
                    return;

                case double d:
                    if (double.IsNaN(d) || double.IsInfinity(d))
                        throw new InvalidOperationException("DAG-CBOR forbids NaN and Infinity.");
                    if (Math.Truncate(d) == d && d >= long.MinValue && d <= long.MaxValue)
                    {
                        WriteInt64(s, (long)d);
                    }
                    else
                    {
                        WriteFloat64(s, d);
                    }
                    return;

                case float f:
                    WriteValue(s, (double)f);
                    return;

                case string str:
                    WriteTextString(s, Encoding.UTF8.GetBytes(str));
                    return;

                case byte[] bytes:
                    // Normalize raw byte[] identically to normalizeRecordValue in @opengaming/sdk ({ "$bytes": base64 })
                    var bMap = new Dictionary<string, object?>
                    {
                        ["$bytes"] = CidV1.ToBase64Unpadded(bytes)
                    };
                    WriteMap(s, bMap);
                    return;

                case IDictionary<string, object?> dict:
                    WriteMap(s, dict);
                    return;

                case IDictionary<string, string> strDict:
                {
                    var converted = new Dictionary<string, object?>(strDict.Count);
                    foreach (var kv in strDict) converted[kv.Key] = kv.Value;
                    WriteMap(s, converted);
                    return;
                }

                case IEnumerable enumerable:
                    WriteArray(s, enumerable);
                    return;

                default:
                    throw new NotSupportedException($"Unsupported DAG-CBOR value type: {value.GetType().FullName}");
            }
        }

        private static void WriteInt64(Stream s, long value)
        {
            if (value >= 0)
            {
                WriteUInt64(s, 0, (ulong)value);
            }
            else
            {
                ulong encoded = (ulong)(-1L - value);
                WriteUInt64(s, 1, encoded);
            }
        }

        private static void WriteUInt64(Stream s, int majorType, ulong value)
        {
            byte prefix = (byte)(majorType << 5);
            if (value < 24)
            {
                s.WriteByte((byte)(prefix | value));
            }
            else if (value <= 0xFF)
            {
                s.WriteByte((byte)(prefix | 24));
                s.WriteByte((byte)value);
            }
            else if (value <= 0xFFFF)
            {
                s.WriteByte((byte)(prefix | 25));
                s.WriteByte((byte)(value >> 8));
                s.WriteByte((byte)value);
            }
            else if (value <= 0xFFFFFFFFUL)
            {
                s.WriteByte((byte)(prefix | 26));
                s.WriteByte((byte)(value >> 24));
                s.WriteByte((byte)(value >> 16));
                s.WriteByte((byte)(value >> 8));
                s.WriteByte((byte)value);
            }
            else
            {
                s.WriteByte((byte)(prefix | 27));
                for (int shift = 56; shift >= 0; shift -= 8)
                {
                    s.WriteByte((byte)(value >> shift));
                }
            }
        }

        private static void WriteFloat64(Stream s, double value)
        {
            s.WriteByte(0xFB);
            ulong bits = (ulong)BitConverter.DoubleToInt64Bits(value);
            for (int shift = 56; shift >= 0; shift -= 8)
            {
                s.WriteByte((byte)(bits >> shift));
            }
        }

        private static void WriteTextString(Stream s, byte[] utf8)
        {
            WriteUInt64(s, 3, (ulong)utf8.Length);
            s.Write(utf8, 0, utf8.Length);
        }

        private static void WriteArray(Stream s, IEnumerable items)
        {
            var list = new List<object?>();
            foreach (var item in items)
            {
                list.Add(item);
            }
            WriteUInt64(s, 4, (ulong)list.Count);
            foreach (var item in list)
            {
                WriteValue(s, item);
            }
        }

        private static void WriteMap(Stream s, IDictionary<string, object?> map)
        {
            var entries = new List<(byte[] KeyUtf8, object? Value)>(map.Count);
            foreach (var kv in map)
            {
                if (kv.Value == null) continue; // Strip omitted/undefined properties
                entries.Add((Encoding.UTF8.GetBytes(kv.Key), kv.Value));
            }

            entries.Sort((a, b) => CompareCanonicalKeys(a.KeyUtf8, b.KeyUtf8));

            WriteUInt64(s, 5, (ulong)entries.Count);
            foreach (var entry in entries)
            {
                WriteTextString(s, entry.KeyUtf8);
                WriteValue(s, entry.Value);
            }
        }

        private static int CompareCanonicalKeys(byte[] a, byte[] b)
        {
            if (a.Length != b.Length)
            {
                return a.Length.CompareTo(b.Length);
            }
            for (int i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i])
                {
                    return a[i].CompareTo(b[i]);
                }
            }
            return 0;
        }
    }
}
