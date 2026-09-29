package com.example.chatbar.domain.image

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

class NovelAiPostProcessFiles(private val context: Context) {
    private val directory get() = File(context.filesDir, "images/image-processing").also { it.mkdirs() }

    fun orientedDimensions(source: ImportedProcessImage): ImportedProcessImage {
        if (source.kind != ProcessImageKind.STATIC) return source
        val orientation = orientation(source.path)
        return if (orientation in setOf(5, 6, 7, 8)) source.copy(width = source.height, height = source.width) else source
    }

    suspend fun encode(source: ImportedProcessImage, size: NovelAiImageSize? = null, flattenAlpha: Boolean = false): String {
        require(source.kind == ProcessImageKind.STATIC) { "请先还原伪装图片；GIF/APNG 不支持直接增强或放大" }
        currentCoroutineContext().ensureActive()
        val file = File(source.path)
        val sameSize = size == null || size.width == source.width && size.height == source.height
        if (sameSize && !flattenAlpha && orientation(source.path) == ExifInterface.ORIENTATION_NORMAL &&
            ApngDisguiseCodec.hasPngSignature(file)) {
            return Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
        }
        val decoded = NovelAiStudioAssetStorage(context).decodeOriented(file)
        var scaled: Bitmap? = null
        var opaque: Bitmap? = null
        try {
            scaled = if (sameSize) decoded else Bitmap.createScaledBitmap(decoded, size.width, size.height, true)
            val outputBitmap = if (flattenAlpha) {
                Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888).also {
                    opaque = it
                    android.graphics.Canvas(it).apply {
                        drawColor(android.graphics.Color.WHITE)
                        drawBitmap(scaled, 0f, 0f, null)
                    }
                }
            } else scaled
            currentCoroutineContext().ensureActive()
            return ByteArrayOutputStream().use { output ->
                check(outputBitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "图片编码失败" }
                Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            }
        } finally {
            opaque?.recycle()
            if (scaled !== decoded) scaled?.recycle()
            decoded.recycle()
        }
    }

    suspend fun save(bytes: ByteArray, tab: NovelAiPostProcessTab, expected: NovelAiImageSize?): ImportedProcessImage {
        require(bytes.size in 1..100 * 1024 * 1024) { "结果为空或超过 100 MB" }
        val target = File(directory, "${tab.name.lowercase()}_${UUID.randomUUID()}.png")
        val temporary = File(directory, "${target.name}.tmp")
        try {
            temporary.writeBytes(bytes)
            require(ApngDisguiseCodec.hasPngSignature(temporary) && !ApngDisguiseCodec.containsAnimationControl(temporary)) {
                "服务器未返回静态 PNG"
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(temporary.path, bounds)
            val pixelLimit = NovelAiPostProcessPolicy.MAX_PIXELS * if (tab == NovelAiPostProcessTab.UPSCALE) 4 else 1
            require(bounds.outWidth > 0 && bounds.outHeight > 0 &&
                bounds.outWidth.toLong() * bounds.outHeight <= pixelLimit) { "返回图片尺寸无效" }
            if (expected != null) require(bounds.outWidth == expected.width && bounds.outHeight == expected.height) {
                "返回尺寸异常：${bounds.outWidth}×${bounds.outHeight}，预期 ${expected.width}×${expected.height}"
            }
            val validation = BitmapFactory.Options().apply { inSampleSize = 4 }
            val decoded = BitmapFactory.decodeFile(temporary.path, validation) ?: error("返回 PNG 无法解码")
            decoded.recycle()
            currentCoroutineContext().ensureActive()
            check(temporary.renameTo(target)) { "无法保存处理结果" }
            return ImportedProcessImage(target.path, target.name, "image/png", bounds.outWidth, bounds.outHeight, 1)
        } catch (error: Throwable) {
            target.delete()
            throw error
        } finally {
            temporary.delete()
        }
    }

    private fun orientation(path: String): Int = runCatching {
        File(path).inputStream().use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
}
