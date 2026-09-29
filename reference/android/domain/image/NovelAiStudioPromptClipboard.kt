package com.example.chatbar.domain.image

import com.example.chatbar.domain.prompt.PromptTemplates
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Clipboard interchange only; never sent as a model prompt. */
object NovelAiStudioPromptClipboard {
    private const val FORMAT = "chatbar-positive-prompt-v1"
    private val json = Json
    private val heading = Regex("【(?:画风|基础|补充|角色 [1-9][0-9]*)】")
    private val sectionHeading = Regex("(?m)^【(画风|基础|补充|角色 [1-9][0-9]*)】$")

    @Serializable
    private data class Payload(
        val format: String,
        val basePrompt: String,
        val extraPrompt: String,
        val characterPrompts: List<String>,
        val stylePrompt: String? = null
    )

    fun encode(draft: NovelAiStudioDraft): String = buildList {
        if (!draft.copyPositivePromptIgnoreStyle) add("画风" to draft.stylePrompt)
        add("基础" to draft.basePrompt)
        if (draft.extraPrompt.isNotEmpty()) add("补充" to draft.extraPrompt)
        draft.characters.forEachIndexed { index, character -> add("角色 ${index + 1}" to character.prompt) }
    }.joinToString("\n\n") { (label, content) ->
        "【$label】\n" + content.replace("\r\n", "\n").split('\n').joinToString("\n") { line ->
            if (line.startsWith("\\") || heading.matches(line)) "\\$line" else line
        }
    }

    private fun decodeSections(text: String): Payload {
        val source = text.replace("\r\n", "\n")
        val sections = sectionHeading.findAll(source).toList()
        require(sections.isNotEmpty() && sections.first().range.first == 0) { "缺少提示词分段标识" }
        val values = linkedMapOf<String, String>()
        sections.forEachIndexed { index, match ->
            val label = match.groupValues[1]
            require(label !in values) { "提示词分段重复：$label" }
            val end = sections.getOrNull(index + 1)?.range?.first ?: source.length
            var content = source.substring(match.range.last + 1, end)
            require(content.isEmpty() || content.startsWith('\n')) { "分段标识后需要换行" }
            content = content.removePrefix("\n")
            if (index < sections.lastIndex) content = content.removeSuffix("\n\n")
            values[label] = content.split('\n').joinToString("\n") { line ->
                if (line.startsWith("\\\\") || line.startsWith("\\") && heading.matches(line.drop(1))) {
                    line.drop(1)
                } else line
            }
        }
        val roles = values.keys.filter { it.startsWith("角色 ") }
        require(roles == List(roles.size) { "角色 ${it + 1}" }) { "角色编号必须从 1 开始连续排列" }
        require("基础" in values) { "缺少基础提示词分段" }
        return Payload(FORMAT, values.getValue("基础"), values["补充"].orEmpty(),
            roles.map { values.getValue(it) }, values["画风"])
    }

    fun apply(text: String, draft: NovelAiStudioDraft): NovelAiStudioDraft {
        val payload = try {
            if (text.trimStart().startsWith("{")) json.decodeFromString<Payload>(text.trim())
            else decodeSections(text)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("剪贴板不是新版工作室的结构化正向提示词，请重新复制", error)
        }
        require(payload.format == FORMAT) { "不支持此提示词格式版本" }
        require(payload.characterPrompts.size <= draft.selectedModel.maxCharacters) {
            "${draft.selectedModel.displayName} 最多支持 ${draft.selectedModel.maxCharacters} 个角色"
        }
        return draft.copy(
            stylePrompt = payload.stylePrompt ?: draft.stylePrompt,
            basePrompt = payload.basePrompt,
            extraPrompt = payload.extraPrompt,
            characters = payload.characterPrompts.mapIndexed { index, prompt ->
                (draft.characters.getOrNull(index) ?: NovelAiCharacterPromptDraft()).copy(prompt = prompt)
            },
            conversionSnapshot = null
        )
    }
}

fun NovelAiStudioDraft.clearPrompts(): NovelAiStudioDraft = copy(
    stylePrompt = "",
    basePrompt = "",
    extraPrompt = "",
    negativePrompt = PromptTemplates.defaultCharacterNaiNegativePrompt(),
    characters = emptyList(),
    imageDescription = "",
    extraRequirement = "",
    conversionSnapshot = null
)
