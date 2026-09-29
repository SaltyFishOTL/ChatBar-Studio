package com.example.chatbar.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.input.OutputTransformation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextGeometricTransform
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.sp
import com.example.chatbar.domain.image.NovelAiPromptAnnotation
import com.example.chatbar.domain.image.NovelAiPromptWrapPolicy
import com.example.chatbar.ui.kit.ChatBarTheme
import kotlin.math.roundToInt

@Composable
internal fun promptEditorTextStyle(translationEnabled: Boolean): TextStyle =
    if (translationEnabled) {
        ChatBarTheme.typography.body.copy(
            lineHeight = 25.sp,
            lineHeightStyle = LineHeightStyle(
                alignment = LineHeightStyle.Alignment.Top,
                trim = LineHeightStyle.Trim.None
            ),
            lineBreak = LineBreak.Paragraph
        )
    } else {
        ChatBarTheme.typography.body.copy(lineBreak = LineBreak.Paragraph)
    }

@Composable
internal fun promptTagWrappingOutputTransformation(
    naturalLanguage: Boolean
): OutputTransformation? {
    if (naturalLanguage) return null
    val commaStyle = remember {
        SpanStyle(textGeometricTransform = TextGeometricTransform(scaleX = 0.55f))
    }
    return remember(commaStyle) {
        OutputTransformation {
            val wrapPlan = NovelAiPromptWrapPolicy.plan(toString())
            wrapPlan.nonBreakingSpaceOffsets.forEach { offset ->
                replace(offset, offset + 1, "\u00A0")
            }
            wrapPlan.breakableCommaOffsets.forEach { offset ->
                replace(offset, offset + 1, "\uFF0C")
                addStyle(commaStyle, offset, offset + 1)
            }
        }
    }
}

@Composable
internal fun PromptTranslationOverlay(
    layout: TextLayoutResult?,
    annotations: List<NovelAiPromptAnnotation>,
    scrollOffsetPx: Int
) {
    val textMeasurer = rememberTextMeasurer()
    val annotationColor = ChatBarTheme.colors.mutedForeground.copy(alpha = 0.55f)
    val annotationStyle = TextStyle(color = annotationColor, fontSize = 9.sp)
    // Scroll changes only the draw origin. Keep glyph lookup and Chinese shaping
    // out of the per-frame path, including annotations outside the viewport.
    val rendered = remember(layout, annotations, textMeasurer, annotationStyle) {
        val textLayout = layout ?: return@remember emptyList<PromptAnnotationDraw>()
        val draws = mutableListOf<PromptAnnotationDraw>()
        val textLength = textLayout.layoutInput.text.length
        val horizontalGap = 1f
        val verticalGap = 5f
        val annotationHeight = textMeasurer.measure(
            text = AnnotatedString("中"),
            style = annotationStyle,
            maxLines = 1
        ).size.height
        val placements = annotations
            .asSequence()
            .filter { it.start in 0 until textLength && it.end > it.start && it.translation.isNotBlank() }
            .map { annotation ->
                val startOffset = annotation.start.coerceIn(0, textLength)
                val endOffset = annotation.end.coerceIn(startOffset, textLength)
                val startLine = textLayout.getLineForOffset(startOffset)
                val endLine = textLayout.getLineForOffset((endOffset - 1).coerceAtLeast(startOffset))
                PromptAnnotationPlacement(
                    annotation = annotation,
                    slots = (startLine..endLine).map { line ->
                        PromptAnnotationLineSlot(
                            line = line,
                            startX = if (line == startLine) {
                                // Use the glyph's line, not caret affinity at a soft-wrap boundary.
                                textLayout.getBoundingBox(startOffset).left
                            } else {
                                textLayout.getLineLeft(line)
                            },
                            endX = if (line == endLine && endOffset > startOffset) {
                                textLayout.getBoundingBox(endOffset - 1).right
                            } else {
                                textLayout.getLineRight(line)
                            }
                        )
                    }
                )
            }
            .sortedWith(
                compareBy<PromptAnnotationPlacement> { it.slots.first().line }
                    .thenBy { it.slots.first().startX }
            )
            .toList()

        placements.forEach { placement ->
            var remainingTranslation = placement.annotation.translation
            placement.slots.forEachIndexed { slotIndex, slot ->
                val y = textLayout.getLineBaseline(slot.line) + verticalGap
                val availableWidth = (slot.endX - slot.startX - horizontalGap)
                    .roundToInt()
                    .coerceAtLeast(1)
                if (remainingTranslation.isEmpty()) {
                    if (slot.endX - slot.startX >= 2f) {
                        draws.add(PromptAnnotationDraw(slot.startX, y, annotationHeight, null, slot.startX, slot.endX))
                    }
                    return@forEachIndexed
                }
                val lastSlot = slotIndex == placement.slots.lastIndex
                val measured = textMeasurer.measure(
                    text = AnnotatedString(remainingTranslation),
                    style = annotationStyle,
                    overflow = if (lastSlot) TextOverflow.Ellipsis else TextOverflow.Clip,
                    softWrap = true,
                    maxLines = 1,
                    constraints = Constraints(maxWidth = availableWidth)
                )
                val consumed = if (lastSlot) {
                    remainingTranslation.length
                } else {
                    measured.getLineEnd(0, visibleEnd = true)
                        .coerceIn(1, remainingTranslation.length)
                }
                remainingTranslation = remainingTranslation.substring(consumed)
                val lineStartX = if (remainingTranslation.isEmpty() && !measured.hasVisualOverflow) {
                    (slot.startX + measured.getLineRight(0) + 1f).takeIf { slot.endX - it >= 2f }
                } else null
                draws.add(PromptAnnotationDraw(slot.startX, y, measured.size.height, measured, lineStartX, slot.endX))
            }
        }
        draws.sortedBy { it.y }
    }
    Canvas(Modifier.fillMaxSize()) {
        // Sorted by baseline; stop as soon as subsequent lines leave the viewport.
        for (draw in rendered) {
            val y = draw.y - scrollOffsetPx
            if (y >= size.height) break
            if (y + draw.height <= 0f) continue
            draw.text?.let { drawText(it, topLeft = Offset(draw.x, y)) }
            draw.lineStartX?.let { startX ->
                val centerY = y + draw.height * 0.55f
                drawLine(annotationColor, Offset(startX, centerY), Offset(draw.endX, centerY), strokeWidth = 1f)
            }
        }
    }
}

private data class PromptAnnotationDraw(
    val x: Float,
    val y: Float,
    val height: Int,
    val text: TextLayoutResult?,
    val lineStartX: Float?,
    val endX: Float
)

private data class PromptAnnotationPlacement(
    val annotation: NovelAiPromptAnnotation,
    val slots: List<PromptAnnotationLineSlot>
)

private data class PromptAnnotationLineSlot(
    val line: Int,
    val startX: Float,
    val endX: Float
)
