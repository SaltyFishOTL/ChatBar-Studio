package com.example.chatbar.ui.imageprompt

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.example.chatbar.domain.image.NovelAiGenerationSettings
import com.example.chatbar.domain.image.NovelAiImageSize
import com.example.chatbar.domain.image.NovelAiStudioSizePolicy
import com.example.chatbar.ui.kit.ButtonVariant
import com.example.chatbar.ui.kit.CbButton
import com.example.chatbar.ui.kit.CbField
import com.example.chatbar.ui.kit.CbDialog
import com.example.chatbar.ui.kit.CbNumberInput
import com.example.chatbar.ui.kit.CbText
import com.example.chatbar.ui.kit.ChatBarSpacing
import com.example.chatbar.ui.kit.ChatBarTheme

@Composable
internal fun NovelAiStudioSizeDialog(
    settings: NovelAiGenerationSettings,
    inpaintOutputSize: NovelAiImageSize?,
    onDismiss: () -> Unit,
    onConfirm: (Int, Int) -> Unit
) {
    val outputSize = settings.imageSize()
    var width by remember { mutableStateOf((settings.customWidth ?: outputSize.width).toString()) }
    var height by remember { mutableStateOf((settings.customHeight ?: outputSize.height).toString()) }
    val parsedWidth = width.toIntOrNull()
    val parsedHeight = height.toIntOrNull()
    val error = NovelAiStudioSizePolicy.validationError(parsedWidth, parsedHeight)
    CbDialog(
        title = "自定义尺寸",
        onDismissRequest = onDismiss,
        confirm = {
            CbButton("确认", {
                if (error == null && parsedWidth != null && parsedHeight != null) {
                    onConfirm(parsedWidth, parsedHeight)
                }
            }, enabled = error == null)
        },
        dismiss = { CbButton("取消", onDismiss, variant = ButtonVariant.Ghost) }
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(ChatBarSpacing.sm)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(ChatBarSpacing.sm)) {
                CbField("宽度（px）", modifier = Modifier.weight(1f)) {
                    CbNumberInput(
                        value = width,
                        onValueChange = { width = it },
                        isError = parsedWidth !in NovelAiStudioSizePolicy.MIN_SIDE..NovelAiStudioSizePolicy.MAX_SIDE
                    )
                }
                CbField("高度（px）", modifier = Modifier.weight(1f)) {
                    CbNumberInput(
                        value = height,
                        onValueChange = { height = it },
                        isError = parsedHeight !in NovelAiStudioSizePolicy.MIN_SIDE..NovelAiStudioSizePolicy.MAX_SIDE
                    )
                }
            }
            CbButton("交换宽高", variant = ButtonVariant.Outline, onClick = {
                val previousWidth = width
                width = height
                height = previousWidth
            })
            CbText(
                "宽高 64–2048 px，按最近的 64 像素倍数规整；总像素不超过 3,145,728。",
                style = ChatBarTheme.typography.caption,
                color = ChatBarTheme.colors.mutedForeground
            )
            error?.let { error ->
                CbText(error, color = ChatBarTheme.colors.destructive, style = ChatBarTheme.typography.caption)
            }
            val preview = inpaintOutputSize ?: if (
                parsedWidth in NovelAiStudioSizePolicy.MIN_SIDE..NovelAiStudioSizePolicy.MAX_SIDE &&
                parsedHeight in NovelAiStudioSizePolicy.MIN_SIDE..NovelAiStudioSizePolicy.MAX_SIDE
            ) NovelAiStudioSizePolicy.resolve(requireNotNull(parsedWidth), requireNotNull(parsedHeight)) else null
            if (preview != null) {
                val divisor = greatestCommonDivisor(preview.width, preview.height)
                val label = "${preview.width} × ${preview.height} · ${preview.width / divisor}:${preview.height / divisor}"
                CbText(
                    if (inpaintOutputSize != null) "聚焦重绘最终画布 · $label" else "最终尺寸 · $label",
                    style = ChatBarTheme.typography.caption
                )
                if (inpaintOutputSize != null) {
                    CbText(
                        "聚焦重绘保留原图尺寸；上方宽高用于普通生图。",
                        style = ChatBarTheme.typography.caption,
                        color = ChatBarTheme.colors.mutedForeground
                    )
                }
                val color = ChatBarTheme.colors.primary
                Canvas(
                    Modifier.fillMaxWidth().height(128.dp).padding(8.dp)
                        .semantics { contentDescription = "最终生图比例预览：$label" }
                ) {
                    val scale = minOf(size.width / preview.width, size.height / preview.height)
                    val frame = Size(preview.width * scale, preview.height * scale)
                    val origin = Offset((size.width - frame.width) / 2, (size.height - frame.height) / 2)
                    drawRect(color.copy(alpha = 0.1f), origin, frame)
                    drawRect(color, origin, frame, style = Stroke(1.dp.toPx()))
                }
            }
        }
    }
}

private tailrec fun greatestCommonDivisor(a: Int, b: Int): Int =
    if (b == 0) a.coerceAtLeast(1) else greatestCommonDivisor(b, a % b)
