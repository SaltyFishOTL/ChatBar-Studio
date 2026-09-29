package com.example.chatbar.domain.image

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.Serializable

@Serializable
data class NovelAiHistoryFoldPreference(
    val depth: Int = 0,
    val enabled: Boolean = false,
    val type: NovelAiHistoryFoldType = NovelAiHistoryFoldType.FULL
)

@Serializable
enum class NovelAiHistoryFoldType(val label: String, val description: String) {
    FULL("完整", "比较画风、基础、额外及有序角色正负面；忽略权重、标点和空白，字符差异小于15%"),
    BASE("基础", "仅比较基础 Prompt；忽略权重、标点和空白，字符差异小于15%"),
    CONTENT("内容", "比较画风外的基础、额外及有序角色正负面；忽略权重、标点和空白，字符差异小于15%"),
    STYLE("画风", "仅比较画风 Prompt；忽略权重、标点和空白，字符差异小于15%"),
    DAY("日", "同一天生成的图片"),
    MONTH("月", "同一个月生成的图片"),
    YEAR("年", "同一年生成的图片")
}

/** Comparison-only keys preserve field boundaries and role order; stored prompts stay untouched. */
object NovelAiHistoryFolding {
    private val numericWeight = Regex("[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)\\s*::")
    private fun normalize(text: String): String = numericWeight.replace(text, "")
        .filter { it.isLetterOrDigit() }

    /** Sum field-local edit distances, relative to the longer structured prompt. */
    fun matches(left: List<String>, right: List<String>, type: NovelAiHistoryFoldType): Boolean {
        if (left == right) return true
        if (type in listOf(NovelAiHistoryFoldType.DAY, NovelAiHistoryFoldType.MONTH, NovelAiHistoryFoldType.YEAR)) return false
        if (left.size != right.size) return false
        val length = maxOf(left.sumOf { it.length }, right.sumOf { it.length })
        var remaining = ((length.toLong() * 15 - 1) / 100).toInt()
        for (index in left.indices) {
            remaining -= distance(left[index], right[index], remaining)
            if (remaining < 0) return false
        }
        return true
    }

    // Banded Levenshtein avoids quadratic work for clearly unrelated long prompts.
    private fun distance(a: String, b: String, limit: Int): Int {
        if (a == b) return 0
        if (kotlin.math.abs(a.length - b.length) > limit) return limit + 1
        val unreachable = limit + 1
        var previous = IntArray(b.length + 1) { if (it <= limit) it else unreachable }
        var current = IntArray(b.length + 1) { unreachable }
        for (i in 1..a.length) {
            val start = maxOf(1, i - limit)
            val end = minOf(b.length, i + limit)
            current[0] = if (i <= limit) i else unreachable
            if (start > 1) current[start - 1] = unreachable
            var minimum = current[0]
            for (j in start..end) {
                current[j] = minOf(previous[j] + 1, current[j - 1] + 1,
                    previous[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
                minimum = minOf(minimum, current[j])
            }
            if (end < b.length) current[end + 1] = unreachable
            if (minimum > limit) return unreachable
            val swap = previous
            previous = current
            current = swap
        }
        return previous[b.length]
    }

    fun key(
        entry: NovelAiGenerationHistoryEntry,
        type: NovelAiHistoryFoldType,
        timeZone: TimeZone = TimeZone.getDefault()
    ): List<String> = with(entry.recipe) {
        when (type) {
            NovelAiHistoryFoldType.FULL -> (listOf(stylePrompt) + contentKey(this)).map(::normalize)
            NovelAiHistoryFoldType.BASE -> listOf(normalize(basePrompt))
            NovelAiHistoryFoldType.CONTENT -> contentKey(this).map(::normalize)
            NovelAiHistoryFoldType.STYLE -> listOf(normalize(stylePrompt))
            else -> Calendar.getInstance(timeZone).run {
                timeInMillis = entry.createdAt
                val year = get(Calendar.YEAR).toString()
                val month = (get(Calendar.MONTH) + 1).toString()
                val day = get(Calendar.DAY_OF_MONTH).toString()
                buildList {
                    add(year)
                    if (type != NovelAiHistoryFoldType.YEAR) add(month)
                    if (type == NovelAiHistoryFoldType.DAY) add(day)
                }
            }
        }
    }

    private fun contentKey(recipe: NovelAiGenerationRecipe): List<String> =
        listOf(recipe.basePrompt, recipe.extraPrompt, recipe.negativePrompt) +
            recipe.characters.flatMap { listOf(it.prompt, it.negativePrompt) }
}
