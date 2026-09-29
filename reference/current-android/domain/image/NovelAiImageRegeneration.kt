package com.example.chatbar.domain.image

import com.example.chatbar.data.local.entity.GeneratedImageCharacterPrompt
import com.example.chatbar.data.local.entity.GeneratedImageMetadata
import com.example.chatbar.domain.prompt.PromptTemplates

data class NovelAiImageRegenerationDraft(
    val baseCaption: String,
    val characterPrompts: List<GeneratedImageCharacterPrompt>,
    val negativePrompt: String,
    val sizePreset: String,
    val width: Int,
    val height: Int,
    val stylePrompt: String = ""
) {
    val canRegenerate: Boolean
        get() = baseCaption.isNotBlank() && characterPrompts.all { it.prompt.isNotBlank() }

    fun addCharacterPrompt(): NovelAiImageRegenerationDraft {
        if (characterPrompts.size >= NOVEL_AI_MAX_CHARACTER_PROMPTS) return this
        val newCount = characterPrompts.size + 1
        val center = NovelAiPromptDesigner.fallbackCenter(characterPrompts.size, newCount)
        return copy(
            characterPrompts = characterPrompts + GeneratedImageCharacterPrompt(
                prompt = "",
                centerX = center.x,
                centerY = center.y
            )
        )
    }

    fun removeCharacterPrompt(index: Int): NovelAiImageRegenerationDraft {
        if (index !in characterPrompts.indices) return this
        return copy(characterPrompts = characterPrompts.filterIndexed { itemIndex, _ -> itemIndex != index })
    }

    fun withSizePreset(preset: NovelAiImageSizePreset): NovelAiImageRegenerationDraft =
        copy(
            sizePreset = preset.name,
            width = preset.width,
            height = preset.height
        )

    fun imageSize(label: String = "重新生成尺寸"): NovelAiImageSize =
        NovelAiImageSize(width = width, height = height, label = label)

    fun toPromptPlan(stylePrompt: String = this.stylePrompt): NovelAiPromptPlan = NovelAiPromptPlan(
        baseCaption = NovelAiPromptDesigner.prependStylePrompt(stylePrompt, baseCaption),
        characterCaptions = characterPrompts.map {
            NovelAiCharacterCaption(
                prompt = it.prompt,
                center = DesignedCharacterCenter(it.centerX, it.centerY),
                negativePrompt = it.negativePrompt
            )
        },
        sizePreset = NovelAiImageSizePreset.from(sizePreset),
        negativePrompt = negativePrompt,
        stylePrompt = stylePrompt
    )
}

fun emptyNovelAiImageRegenerationDraft(
    sizePreset: NovelAiImageSizePreset = NovelAiImageSizePreset.PORTRAIT
): NovelAiImageRegenerationDraft = NovelAiImageRegenerationDraft(
    baseCaption = "",
    characterPrompts = emptyList(),
    negativePrompt = PromptTemplates.defaultCharacterNaiNegativePrompt(),
    sizePreset = sizePreset.name,
    width = sizePreset.width,
    height = sizePreset.height
)

fun NovelAiPromptPlan.toRegenerationDraft(): NovelAiImageRegenerationDraft =
    NovelAiImageRegenerationDraft(
        baseCaption = splitRecordedStyle(baseCaption, stylePrompt).second,
        stylePrompt = splitRecordedStyle(baseCaption, stylePrompt).first,
        characterPrompts = characterCaptions.map {
            GeneratedImageCharacterPrompt(
                prompt = it.prompt,
                centerX = it.center.x,
                centerY = it.center.y,
                negativePrompt = it.negativePrompt
            )
        },
        negativePrompt = effectiveNegativePrompt,
        sizePreset = sizePreset.name,
        width = sizePreset.width,
        height = sizePreset.height
    )

const val NOVEL_AI_MAX_CHARACTER_PROMPTS = 6

fun GeneratedImageMetadata.toRegenerationDraft(): NovelAiImageRegenerationDraft =
    NovelAiImageRegenerationDraft(
        baseCaption = splitRecordedStyle(baseCaption, stylePrompt).second,
        stylePrompt = splitRecordedStyle(baseCaption, stylePrompt).first,
        characterPrompts = characterPrompts,
        negativePrompt = negativePrompt,
        sizePreset = sizePreset,
        width = width,
        height = height
    )

fun NovelAiPromptPlan.toGeneratedImageMetadata(
    imagePath: String,
    imageSize: NovelAiImageSize
): GeneratedImageMetadata = GeneratedImageMetadata(
    imagePath = imagePath,
    baseCaption = baseCaption,
    stylePrompt = stylePrompt,
    characterPrompts = characterCaptions.map {
        GeneratedImageCharacterPrompt(
            prompt = it.prompt,
            centerX = it.center.x,
            centerY = it.center.y,
            negativePrompt = it.negativePrompt
        )
    },
    negativePrompt = effectiveNegativePrompt,
    sizePreset = sizePreset.name,
    width = imageSize.width,
    height = imageSize.height
)

// Only split a recorded, exact prefix. Legacy combined prompts remain untouched.
private fun splitRecordedStyle(baseCaption: String, stylePrompt: String): Pair<String, String> {
    if (stylePrompt.isBlank()) return "" to baseCaption
    val prefix = NovelAiPromptDesigner.prependStylePrompt(stylePrompt, "_").dropLast(1)
    return if (baseCaption.startsWith(prefix)) {
        stylePrompt to baseCaption.removePrefix(prefix)
    } else {
        "" to baseCaption
    }
}
