using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OpenGaming.Sdk
{
    /// <summary>
    /// Lightweight, zero-dependency JSON serializer and parser tailored for AT Protocol Lexicon records.
    /// Preserves 64-bit integer precision (`long`) so parsed PDS records re-encode to identical DAG-CBOR CIDs,
    /// and works cleanly across Unity IL2CPP, WebGL, Android, iOS, and standalone .NET without reflection stripping.
    /// </summary>
    public static class OpenGamingJson
    {
        public static string Serialize(object? value)
        {
            var sb = new StringBuilder(256);
            WriteJsonValue(sb, value);
            return sb.ToString();
        }

        public static Dictionary<string, object?> ParseObject(string json)
        {
            var parsed = ParseValue(json);
            if (parsed is Dictionary<string, object?> dict)
                return dict;
            throw new FormatException("Expected top-level JSON object.");
        }

        public static object? ParseValue(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            int idx = 0;
            SkipWhitespace(json, ref idx);
            object? val = ReadValue(json, ref idx);
            SkipWhitespace(json, ref idx);
            return val;
        }

        private static void WriteJsonValue(StringBuilder sb, object? value)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }

            switch (value)
            {
                case bool b:
                    sb.Append(b ? "true" : "false");
                    return;

                case int i:
                    sb.Append(i.ToString(CultureInfo.InvariantCulture));
                    return;

                case long l:
                    sb.Append(l.ToString(CultureInfo.InvariantCulture));
                    return;

                case double d:
                    sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                    return;

                case float f:
                    sb.Append(f.ToString("R", CultureInfo.InvariantCulture));
                    return;

                case string s:
                    WriteJsonString(sb, s);
                    return;

                case IDictionary<string, object?> dict:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (var kv in dict)
                    {
                        if (kv.Value == null) continue;
                        if (!first) sb.Append(',');
                        first = false;
                        WriteJsonString(sb, kv.Key);
                        sb.Append(':');
                        WriteJsonValue(sb, kv.Value);
                    }
                    sb.Append('}');
                    return;
                }

                case IDictionary<string, string> strDict:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (var kv in strDict)
                    {
                        if (kv.Value == null) continue;
                        if (!first) sb.Append(',');
                        first = false;
                        WriteJsonString(sb, kv.Key);
                        sb.Append(':');
                        WriteJsonString(sb, kv.Value);
                    }
                    sb.Append('}');
                    return;
                }

                case IEnumerable list:
                {
                    sb.Append('[');
                    bool first = true;
                    foreach (var item in list)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteJsonValue(sb, item);
                    }
                    sb.Append(']');
                    return;
                }

                default:
                    WriteJsonString(sb, value.ToString() ?? string.Empty);
                    return;
            }
        }

        private static void WriteJsonString(StringBuilder sb, string s)
        {
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
                        else
                            sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private static object? ReadValue(string s, ref int idx)
        {
            SkipWhitespace(s, ref idx);
            if (idx >= s.Length) throw new FormatException("Unexpected end of JSON.");
            char c = s[idx];
            return c switch
            {
                '{' => ReadObject(s, ref idx),
                '[' => ReadArray(s, ref idx),
                '"' => ReadString(s, ref idx),
                't' => ReadLiteral(s, ref idx, "true", true),
                'f' => ReadLiteral(s, ref idx, "false", false),
                'n' => ReadLiteral(s, ref idx, "null", null),
                _ => ReadNumber(s, ref idx)
            };
        }

        private static Dictionary<string, object?> ReadObject(string s, ref int idx)
        {
            var dict = new Dictionary<string, object?>();
            idx++; // '{'
            SkipWhitespace(s, ref idx);
            if (idx < s.Length && s[idx] == '}')
            {
                idx++;
                return dict;
            }

            while (true)
            {
                SkipWhitespace(s, ref idx);
                string key = ReadString(s, ref idx);
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length || s[idx] != ':')
                    throw new FormatException("Expected ':' in JSON object.");
                idx++;
                object? val = ReadValue(s, ref idx);
                dict[key] = val;
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length) throw new FormatException("Unterminated JSON object.");
                if (s[idx] == '}')
                {
                    idx++;
                    break;
                }
                if (s[idx] != ',')
                    throw new FormatException("Expected ',' or '}' in JSON object.");
                idx++;
            }
            return dict;
        }

        private static List<object?> ReadArray(string s, ref int idx)
        {
            var list = new List<object?>();
            idx++; // '['
            SkipWhitespace(s, ref idx);
            if (idx < s.Length && s[idx] == ']')
            {
                idx++;
                return list;
            }

            while (true)
            {
                list.Add(ReadValue(s, ref idx));
                SkipWhitespace(s, ref idx);
                if (idx >= s.Length) throw new FormatException("Unterminated JSON array.");
                if (s[idx] == ']')
                {
                    idx++;
                    break;
                }
                if (s[idx] != ',')
                    throw new FormatException("Expected ',' or ']' in JSON array.");
                idx++;
            }
            return list;
        }

        private static string ReadString(string s, ref int idx)
        {
            if (idx >= s.Length || s[idx] != '"')
                throw new FormatException("Expected '\"' at start of JSON string.");
            idx++;
            var sb = new StringBuilder();
            while (idx < s.Length)
            {
                char c = s[idx++];
                if (c == '"') return sb.ToString();
                if (c == '\\')
                {
                    if (idx >= s.Length) throw new FormatException("Unterminated escape in JSON string.");
                    char esc = s[idx++];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (idx + 4 > s.Length) throw new FormatException("Invalid \\uXXXX escape.");
                            int code = Convert.ToInt32(s.Substring(idx, 4), 16);
                            sb.Append((char)code);
                            idx += 4;
                            break;
                        default:
                            sb.Append(esc);
                            break;
                    }
                }
                else
                {
                    sb.Append(c);
                }
            }
            throw new FormatException("Unterminated JSON string.");
        }

        private static object? ReadLiteral(string s, ref int idx, string expected, object? result)
        {
            if (idx + expected.Length > s.Length ||
                string.CompareOrdinal(s, idx, expected, 0, expected.Length) != 0)
            {
                throw new FormatException($"Invalid JSON literal at index {idx}.");
            }
            idx += expected.Length;
            return result;
        }

        private static object ReadNumber(string s, ref int idx)
        {
            int start = idx;
            bool isFloat = false;
            if (idx < s.Length && s[idx] == '-') idx++;
            while (idx < s.Length)
            {
                char c = s[idx];
                if (c >= '0' && c <= '9')
                {
                    idx++;
                }
                else if (c == '.' || c == 'e' || c == 'E' || c == '+')
                {
                    isFloat = true;
                    idx++;
                }
                else if (c == '-' && idx > start)
                {
                    isFloat = true;
                    idx++;
                }
                else
                {
                    break;
                }
            }

            string token = s.Substring(start, idx - start);
            if (!isFloat && long.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out long l))
                return l;
            if (double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double d))
                return d;
            throw new FormatException($"Invalid JSON number '{token}'.");
        }

        private static void SkipWhitespace(string s, ref int idx)
        {
            while (idx < s.Length)
            {
                char c = s[idx];
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') idx++;
                else break;
            }
        }
    }
}
