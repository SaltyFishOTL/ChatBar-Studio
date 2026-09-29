package com.example.chatbar.domain.image

import android.util.Base64
import com.example.chatbar.domain.ProxyAwareClient
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.Serializable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.decodeFromStream
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

@Serializable
private data class UpscaleJsonImage(val image: String)

@Serializable
private data class UpscaleJsonResponse(val images: List<UpscaleJsonImage>)

@OptIn(ExperimentalSerializationApi::class)
class NovelAiUpscaleService(
    private val client: OkHttpClient = ProxyAwareClient.builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()
) {
    fun upscale(token: String, imageBase64: String) = callbackFlow<NovelAiImageEvent> {
        val correlation = (1..6).map { "abcdefghijklmnopqrstuvwxyz0123456789".random() }.joinToString("")
        val request = Request.Builder()
            .url("https://image.novelai.net/ai/upscale")
            .header("Authorization", "Bearer ${token.trim()}")
            .header("Accept", "application/json")
            .header("x-correlation-id", correlation)
            .post(buildRequestBody(imageBase64).toRequestBody("application/json".toMediaType()))
            .build()
        val call = client.newCall(request)
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!call.isCanceled()) trySend(NovelAiImageEvent.Error("Upscale 请求失败：${e.message} [request: $correlation]"))
                close()
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!it.isSuccessful) {
                            val reason = when (it.code) {
                                400 -> "图片或请求参数不受支持"
                                401 -> "认证失败，请检查 NovelAI Token"
                                402 -> "Anlas 余额不足"
                                403 -> "无权访问 Upscale"
                                429 -> "请求频率过高，请稍后重试"
                                504 -> "服务器处理超时，余额将重新刷新"
                                else -> "服务端错误"
                            }
                            error("$reason（HTTP ${it.code}）")
                        }
                        val body = requireNotNull(it.body) { "服务器未返回图片" }
                        require(body.contentLength() <= MAX_RESPONSE_BYTES) { "处理结果过大" }
                        // Stream JSON to avoid retaining a byte buffer, response string and JSON tree for large PNGs.
                        val decoded = LimitedInput(body.byteStream()).use { input ->
                            Json { ignoreUnknownKeys = true }.decodeFromStream<UpscaleJsonResponse>(input)
                        }
                        if (call.isCanceled()) return
                        require(decoded.images.size == 1) { "Upscale 返回图片数量异常" }
                        val encoded = decoded.images.single().image
                        trySendBlocking(NovelAiImageEvent.Final(Base64.decode(encoded, Base64.DEFAULT)))
                    }
                } catch (error: Exception) {
                    if (!call.isCanceled()) trySend(NovelAiImageEvent.Error("Upscale 失败：${error.message} [request: $correlation]"))
                } finally {
                    close()
                }
            }
        })
        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    internal fun buildRequestBody(imageBase64: String): String = buildJsonObject {
        put("image", imageBase64)
        put("model", "nai-diffusion-5-curated")
        put("declared_blur_sigma", 0)
    }.toString()

    private companion object { const val MAX_RESPONSE_BYTES = 140L * 1024 * 1024 }

    private class LimitedInput(input: InputStream) : FilterInputStream(input) {
        private var count = 0L
        private fun countBytes(size: Int) {
            if (size > 0) count += size
            if (count > MAX_RESPONSE_BYTES) throw IOException("处理结果过大")
        }
        override fun read(): Int = `in`.read().also { if (it >= 0) countBytes(1) }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            `in`.read(buffer, offset, length).also(::countBytes)
    }
}
