package com.example.chatbar.domain.image

/** Studio pixel dimensions; chat's normal-area aspect-ratio policy remains independent. */
object NovelAiStudioSizePolicy {
    const val STEP = 64
    const val MIN_SIDE = 64
    const val MAX_SIDE = 2048
    const val MAX_PIXELS = 2048 * 1536

    // Keep requested integers in the draft so live numeric editing never jumps to a rounded echo.
    fun resolve(width: Int, height: Int): NovelAiImageSize = NovelAiImageSize(
        roundSide(width), roundSide(height), "自定义"
    )

    fun validationError(width: Int?, height: Int?): String? {
        if (width == null || height == null) return "请填写自定义宽度和高度"
        if (width !in MIN_SIDE..MAX_SIDE || height !in MIN_SIDE..MAX_SIDE) {
            return "宽高需在 $MIN_SIDE–$MAX_SIDE 像素之间"
        }
        val size = resolve(width, height)
        return if (size.width.toLong() * size.height > MAX_PIXELS) {
            "规整后超过 3,145,728 像素，请减小宽度或高度"
        } else null
    }

    private fun roundSide(value: Int): Int =
        ((value.coerceIn(MIN_SIDE, MAX_SIDE) + STEP / 2) / STEP) * STEP
}
