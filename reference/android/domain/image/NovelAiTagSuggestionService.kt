package com.example.chatbar.domain.image

import java.util.Locale
import java.util.TreeSet
import android.util.Log
import com.example.chatbar.DebugConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch

internal data class TagSuggestionUpdate(
    val candidates: List<NovelAiTagCandidate> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val version: String = ""
)

/** Incrementally ordered results; no source waits for another source to finish. */
internal class TagSuggestionAccumulator {
    private val ordered = TreeSet(comparator)
    private val byName = HashMap<String, NovelAiTagCandidate>()
    private val warnings = linkedMapOf<String, String>()
    private var remaining = 2

    @Synchronized fun found(candidate: NovelAiTagCandidate) {
        val key = candidate.name.lowercase(Locale.ROOT)
        val old = byName[key]
        if (old != null) {
            if (comparator.compare(candidate, old) >= 0) return
            ordered.remove(old)
        }
        byName[key] = candidate
        ordered.add(candidate)
    }

    @Synchronized fun warning(source: String, text: String) { warnings[source] = text }
    @Synchronized fun completed() { remaining-- }
    @Synchronized fun snapshot(version: String) = TagSuggestionUpdate(
        candidates = ordered.toList(), loading = remaining != 0,
        error = warnings.values.takeIf { it.isNotEmpty() }?.joinToString("；"), version = version
    )

    companion object {
        private val comparator = Comparator<NovelAiTagCandidate> { a, b ->
            when {
                a.fromDictionary != b.fromDictionary -> if (a.fromDictionary) 1 else -1
                a.fromDictionary -> a.name.compareTo(b.name)
                a.count != b.count -> b.count.compareTo(a.count)
                else -> a.name.lowercase(Locale.ROOT).compareTo(b.name.lowercase(Locale.ROOT))
            }
        }
    }
}

internal class NovelAiTagSuggestionService(
    private val catalog: DanbooruTagCatalog,
    private val dictionary: NovelAiPromptWordDictionary,
    private val scope: CoroutineScope
) {
    private var warming = false

    @Synchronized fun warmUp() {
        if (warming) return
        warming = true
        scope.launch(Dispatchers.IO) {
            // Preparation failure is reported by the actual query, never by a silent success.
            launch { try { catalog.prepareCompletion() } catch (e: Exception) { if (e is CancellationException) throw e } }
            launch { try { dictionary.prepareCompletion() } catch (e: Exception) { if (e is CancellationException) throw e } }
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun observe(query: String): Flow<TagSuggestionUpdate> = catalog.completionVersion.flatMapLatest { version ->
        streamTagSuggestions(version,
            tags = tracedSearch("danbooru") { found, warning -> catalog.streamCompletion(query, found, warning) },
            words = tracedSearch("dictionary") { found, warning -> dictionary.streamCompletion(query, found, warning) }
        )
    }.buffer(0).flowOn(Dispatchers.IO)

    fun isCurrent(update: TagSuggestionUpdate): Boolean = update.version == catalog.completionVersion.value
}

internal typealias TagSuggestionSearch = suspend (suspend (NovelAiTagCandidate) -> Unit, (String) -> Unit) -> Unit

internal fun streamTagSuggestions(
    version: String,
    tags: TagSuggestionSearch,
    words: TagSuggestionSearch
): Flow<TagSuggestionUpdate> = channelFlow {
    val accumulator = TagSuggestionAccumulator()
    val changed = Channel<Unit>(Channel.CONFLATED)
    val publisher = launch {
        for (ignored in changed) send(accumulator.snapshot(version))
    }
    suspend fun runSource(name: String, search: TagSuggestionSearch) {
        try {
            search({ candidate ->
                accumulator.found(candidate)
                changed.trySend(Unit)
            }, { warning ->
                accumulator.warning(name, warning)
                changed.trySend(Unit)
            })
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            accumulator.warning(name, "$name 补全失败：${error.message ?: error::class.java.simpleName}")
        } finally {
            accumulator.completed()
            changed.trySend(Unit)
        }
    }
    val tagJob = launch { runSource("Danbooru", tags) }
    val wordJob = launch { runSource("内置词典", words) }
    tagJob.join()
    wordJob.join()
    changed.close()
    publisher.join()
}.buffer(0)

private fun tracedSearch(source: String, search: TagSuggestionSearch): TagSuggestionSearch = { found, warning ->
    val started = System.nanoTime()
    var first = -1L
    var count = 0
    var status = "complete"
    try {
        search({ candidate ->
            if (first < 0) first = (System.nanoTime() - started) / 1_000_000
            count++
            found(candidate)
        }, warning)
    } catch (error: Exception) {
        status = if (error is CancellationException) "cancelled" else "failed"
        throw error
    } finally {
        if (DebugConfig.SHOW_DEBUG_UI) Log.d("TagCompletion",
            "source=$source status=$status first_ms=$first total_ms=${(System.nanoTime() - started) / 1_000_000} matches=$count")
    }
}
