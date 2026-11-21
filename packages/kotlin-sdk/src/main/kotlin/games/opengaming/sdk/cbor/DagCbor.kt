package games.opengaming.sdk.cbor

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.io.ByteArrayOutputStream
import kotlin.math.truncate

/**
 * Canonical IPLD DAG-CBOR encoder over `JsonElement` matching `@ipld/dag-cbor` byte-for-byte:
 * - Sorts map keys by UTF-8 byte length ascending, then unsigned lexicographic byte order.
 * - Strips null map entries when `stripNullEntries` is true.
 * - Encodes minimal integer widths and IEEE 754 float64 for non-integer decimals.
 */
object DagCbor {
    fun encode(element: JsonElement): ByteArray {
        val out = ByteArrayOutputStream(256)
        writeElement(out, element)
        return out.toByteArray()
    }

    private fun writeElement(out: ByteArrayOutputStream, element: JsonElement) {
        when (element) {
            is JsonNull -> out.write(0xF6)
            is JsonPrimitive -> {
                if (element.isString) {
                    writeTextString(out, element.content.encodeToByteArray())
                    return
                }
                element.booleanOrNull?.let { b ->
                    out.write(if (b) 0xF5 else 0xF4)
                    return
                }
                element.longOrNull?.let { l ->
                    writeInt64(out, l)
                    return
                }
                val d = element.doubleOrNull
                    ?: throw IllegalArgumentException("Unsupported JSON primitive: $element")
                require(!d.isNaN() && !d.isInfinite()) { "DAG-CBOR forbids NaN and Infinity." }
                if (truncate(d) == d && d >= Long.MIN_VALUE.toDouble() && d <= Long.MAX_VALUE.toDouble()) {
                    writeInt64(out, d.toLong())
                } else {
                    writeFloat64(out, d)
                }
            }
            is JsonArray -> {
                writeUInt64(out, 4, element.size.toULong())
                for (item in element) {
                    writeElement(out, item)
                }
            }
            is JsonObject -> {
                val entries = ArrayList<Pair<ByteArray, JsonElement>>(element.size)
                for ((k, v) in element) {
                    if (v is JsonNull) continue
                    entries.add(k.encodeToByteArray() to v)
                }
                entries.sortWith { a, b -> compareCanonicalKeys(a.first, b.first) }

                writeUInt64(out, 5, entries.size.toULong())
                for ((kUtf8, v) in entries) {
                    writeTextString(out, kUtf8)
                    writeElement(out, v)
                }
            }
        }
    }

    private fun writeInt64(out: ByteArrayOutputStream, value: Long) {
        if (value >= 0L) {
            writeUInt64(out, 0, value.toULong())
        } else {
            val encoded = (-1L - value).toULong()
            writeUInt64(out, 1, encoded)
        }
    }

    private fun writeUInt64(out: ByteArrayOutputStream, majorType: Int, value: ULong) {
        val prefix = majorType shl 5
        when {
            value < 24UL -> out.write(prefix or value.toInt())
            value <= 0xFFUL -> {
                out.write(prefix or 24)
                out.write(value.toInt() and 0xFF)
            }
            value <= 0xFFFFUL -> {
                out.write(prefix or 25)
                out.write((value shr 8).toInt() and 0xFF)
                out.write(value.toInt() and 0xFF)
            }
            value <= 0xFFFFFFFFUL -> {
                out.write(prefix or 26)
                out.write((value shr 24).toInt() and 0xFF)
                out.write((value shr 16).toInt() and 0xFF)
                out.write((value shr 8).toInt() and 0xFF)
                out.write(value.toInt() and 0xFF)
            }
            else -> {
                out.write(prefix or 27)
                for (shift in 56 downTo 0 step 8) {
                    out.write((value shr shift).toInt() and 0xFF)
                }
            }
        }
    }

    private fun writeFloat64(out: ByteArrayOutputStream, value: Double) {
        out.write(0xFB)
        val bits = java.lang.Double.doubleToRawLongBits(value).toULong()
        for (shift in 56 downTo 0 step 8) {
            out.write((bits shr shift).toInt() and 0xFF)
        }
    }

    private fun writeTextString(out: ByteArrayOutputStream, utf8: ByteArray) {
        writeUInt64(out, 3, utf8.size.toULong())
        out.write(utf8)
    }

    private fun compareCanonicalKeys(a: ByteArray, b: ByteArray): Int {
        if (a.size != b.size) return a.size.compareTo(b.size)
        for (i in a.indices) {
            val ua = a[i].toInt() and 0xFF
            val ub = b[i].toInt() and 0xFF
            if (ua != ub) return ua.compareTo(ub)
        }
        return 0
    }
}
