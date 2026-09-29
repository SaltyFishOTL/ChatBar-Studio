package com.example.chatbar.domain.image

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.CancellationSignal
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.zip.GZIPInputStream
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Versioned, derived data. Posting order is final source order, not query-time sorting. */
internal class RankedTagIndexStore(private val context: Context, private val kind: String) {
    private var current: Handle? = null
    private val preparationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val preparation = TagIndexPreparation<File>()

    internal class Handle(val file: File, val database: SQLiteDatabase) {
        var readers = 0
        var retired = false
    }

    internal class Lease internal constructor(
        private val store: RankedTagIndexStore,
        internal val handle: Handle,
        val version: String
    ) : AutoCloseable {
        val database: SQLiteDatabase get() = handle.database
        override fun close() = store.release(handle)
    }

    suspend fun prepare(source: String, database: SQLiteDatabase, table: String): File {
        val directory = File(context.filesDir, "tag_completion").apply { mkdirs() }
        require(source.matches(Regex("[a-fA-F0-9]+"))) { "词库版本无效" }
        val target = File(directory, "$kind-v$FORMAT-$source.sqlite")
        if (target.isFile) return target
        return preparation.await(source) {
            // Retain before dispatch: the caller may cancel its own wait or a catalog
            // update may retire the source while this independent build is still running.
            database.acquireReference()
            preparationScope.async(start = CoroutineStart.LAZY) {
                prepareFile(source, database, table, target)
            }.also { task -> task.invokeOnCompletion { database.releaseReference() } }
        }
    }

    private suspend fun prepareFile(source: String, database: SQLiteDatabase, table: String, target: File): File {
        if (target.isFile) return target
        val directory = target.parentFile!!
        val manifest = context.assets.open("tag_completion/$kind.json").bufferedReader().use {
            JSONObject(it.readText())
        }
        if (manifest.getInt("format") == FORMAT && manifest.getString("source") == source) {
            val staged = File(directory, "${target.name}.part")
            try {
                val digest = MessageDigest.getInstance("SHA-256")
                FileOutputStream(staged).use { output ->
                    GZIPInputStream(context.assets.open("tag_completion/$kind.sqlite.binz")).use { input ->
                        val hashing = DigestOutputStream(output, digest)
                        input.copyTo(hashing)
                        hashing.flush()
                    }
                    output.fd.sync()
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
                check(actual == manifest.getString("sha256")) { "补全索引完整性校验失败" }
                check(staged.length() == manifest.getLong("bytes")) { "补全索引大小不匹配" }
                check(staged.renameTo(target)) { "无法安装补全索引" }
            } finally { staged.delete() }
        } else {
            val staged = File(directory, "${target.name}.part")
            staged.delete()
            try {
                build(staged, database, table, source)
                check(staged.renameTo(target)) { "无法安装补全索引" }
            } finally {
                staged.delete()
            }
        }
        return target
    }

    @Synchronized
    fun acquire(file: File, version: String): Lease {
        var handle = current
        if (handle == null || handle.file != file) {
            val database = SQLiteDatabase.openDatabase(
                file.absolutePath, null, SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS
            )
            try {
                database.rawQuery("SELECT version,source FROM metadata", null).use {
                    check(it.moveToFirst() && it.getInt(0) == FORMAT && it.getString(1) == version) {
                        "补全索引版本不匹配"
                    }
                }
            } catch (error: Throwable) {
                database.close()
                file.delete()
                throw error
            }
            val next = Handle(file, database)
            current = next
            handle?.let { old ->
                old.retired = true
                if (old.readers == 0) retire(old)
            }
            handle = next
        }
        handle.readers++
        return Lease(this, handle, version)
    }

    @Synchronized
    private fun release(handle: Handle) {
        handle.readers--
        if (handle.readers == 0 && handle.retired) retire(handle)
    }

    private fun retire(handle: Handle) {
        handle.database.close()
        // Version files are immutable; a later rollback can rebuild this derived data.
        handle.file.delete()
    }

    internal suspend fun build(file: File, source: SQLiteDatabase, table: String, version: String) {
        SQLiteDatabase.openOrCreateDatabase(file, null).use { destination ->
            // journal_mode assignments return a row; Android execSQL rejects row-producing SQL.
            destination.rawQuery("PRAGMA journal_mode=OFF", null).use { cursor ->
                check(cursor.moveToFirst() && cursor.getString(0).equals("off", ignoreCase = true)) {
                    "无法设置补全索引构建日志模式"
                }
            }
            destination.execSQL("PRAGMA synchronous=OFF")
            destination.execSQL("PRAGMA temp_store=FILE")
            destination.execSQL("CREATE TABLE entries(rank INTEGER PRIMARY KEY, name TEXT NOT NULL, " +
                "cn_name TEXT NOT NULL, post_count INTEGER NOT NULL, category INTEGER NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL)")
            destination.execSQL("CREATE TABLE postings(gram INTEGER NOT NULL, rank INTEGER NOT NULL, PRIMARY KEY(gram, rank)) WITHOUT ROWID")
            destination.execSQL("CREATE TABLE grams(gram INTEGER PRIMARY KEY, n INTEGER NOT NULL, ranks BLOB NOT NULL)")
            destination.execSQL("CREATE TABLE metadata(version INTEGER NOT NULL, source TEXT NOT NULL)")
            destination.execSQL("INSERT INTO metadata VALUES (?, ?)", arrayOf<Any>(FORMAT, version))
            val quoted = "\"${table.replace("\"", "\"\"")}\""
            val sql = if (kind == "dictionary") {
                "SELECT word, meaning, 0, 0, lower(word), lower(meaning) FROM $quoted ORDER BY word"
            } else "SELECT name, coalesce(cn_name,''), coalesce(post_count,0), category, " +
                "lower(name), replace(lower(coalesce(cn_name,'')), ' ', '') FROM $quoted " +
                "ORDER BY post_count DESC, lower(name) ASC"
            destination.beginTransaction()
            try {
                destination.compileStatement("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)").use { entry ->
                    destination.compileStatement("INSERT INTO postings VALUES (?, ?)").use { posting ->
                        source.rawQuery(sql, null).use { cursor ->
                            var rank = 0L
                            while (cursor.moveToNext()) {
                                currentCoroutineContext().ensureActive()
                                val name = cursor.getString(0).orEmpty().trim()
                                if (kind != "dictionary" && (!validCompletionTag(name) || NovelAiTagCategory.fromCode(cursor.getInt(3)) == null)) continue
                                val a = cursor.getString(4).orEmpty()
                                val b = cursor.getString(5).orEmpty()
                                entry.bindLong(1, rank)
                                entry.bindString(2, name)
                                entry.bindString(3, cursor.getString(1).orEmpty())
                                entry.bindLong(4, cursor.getLong(2).coerceAtLeast(0))
                                entry.bindLong(5, cursor.getInt(3).toLong())
                                entry.bindString(6, a)
                                entry.bindString(7, b)
                                entry.executeInsert()
                                (completionGrams(a) + completionGrams(b)).forEach { gram ->
                                    posting.bindLong(1, gram)
                                    posting.bindLong(2, rank)
                                    posting.executeInsert()
                                }
                                rank++
                            }
                        }
                    }
                }
                destination.compileStatement("INSERT INTO grams VALUES (?, ?, ?)").use { insert ->
                    run {
                        var gram = -1L
                        var previous = 0L
                        var count = 0L
                        val packed = ByteArrayOutputStream()
                        fun flush() {
                            if (count == 0L) return
                            insert.bindLong(1, gram)
                            insert.bindLong(2, count)
                            insert.bindBlob(3, packed.toByteArray())
                            insert.executeInsert()
                            packed.reset()
                            previous = 0
                            count = 0
                        }
                        var afterGram = -1L
                        var afterRank = -1L
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            var rows = 0
                            // SQLiteCursor refills otherwise rescan/count a multi-million-row
                            // result. Resume from its primary key instead of from row zero.
                            destination.rawQuery(
                                "SELECT gram,rank FROM postings WHERE (gram,rank)>(?,?) " +
                                    "ORDER BY gram,rank LIMIT 4096",
                                arrayOf(afterGram.toString(), afterRank.toString())
                            ).use { cursor ->
                                while (cursor.moveToNext()) {
                                    val nextGram = cursor.getLong(0)
                                    if (nextGram != gram) { flush(); gram = nextGram }
                                    val rank = cursor.getLong(1)
                                    var delta = rank - previous
                                    previous = rank
                                    while (delta >= 128) {
                                        packed.write((delta.toInt() and 127) or 128)
                                        delta = delta ushr 7
                                    }
                                    packed.write(delta.toInt())
                                    count++
                                    rows++
                                    afterGram = nextGram
                                    afterRank = rank
                                }
                            }
                            if (rows < 4096) break
                        }
                        flush()
                    }
                }
                destination.execSQL("DROP TABLE postings")
                // Completion reads entries by rank; no secondary name index is needed.
                destination.setTransactionSuccessful()
            } finally {
                destination.endTransaction()
            }
            destination.execSQL("VACUUM")
        }
    }

    companion object { const val FORMAT = 2 }
}

internal fun validCompletionTag(name: String): Boolean = name.length in 1..200 &&
    name.none { it.isWhitespace() || it == ',' || it.code !in 0x21..0x7e }

/** UTF-16 encoding shared with the offline compiler; singles and pairs cannot collide. */
internal fun completionGrams(text: String): Set<Long> = buildSet {
    text.forEachIndexed { index, char ->
        add(char.code + 1L)
        if (index > 0) add(((text[index - 1].code + 1L) shl 17) or (char.code + 1L))
    }
}

internal suspend fun <T> withCompletionCancellation(block: suspend (CancellationSignal) -> T): T = coroutineScope {
    val signal = CancellationSignal()
    val watcher = launch(Dispatchers.Unconfined, start = CoroutineStart.UNDISPATCHED) {
        try { awaitCancellation() } finally { signal.cancel() }
    }
    try { block(signal) } finally { watcher.cancel() }
}

internal suspend fun searchRankedIndex(
    database: SQLiteDatabase,
    query: String,
    dictionary: Boolean,
    onCandidate: suspend (NovelAiTagCandidate) -> Unit
) = withCompletionCancellation { signal ->
    val grams = completionGrams(query).let { all ->
        if (query.length > 1) all.filter { it > 0x10000L } else all.toList()
    }
    if (grams.isEmpty()) return@withCompletionCancellation
    var rarest = 0L
    var minimum = Long.MAX_VALUE
    for (gram in grams) {
        currentCoroutineContext().ensureActive()
        val count = database.rawQuery("SELECT n FROM grams WHERE gram = ?", arrayOf(gram.toString()), signal).use {
            if (it.moveToFirst()) it.getLong(0) else 0L
        }
        if (count == 0L) return@withCompletionCancellation
        if (count < minimum) { minimum = count; rarest = gram }
    }
    val encoded = database.rawQuery("SELECT ranks FROM grams WHERE gram=?", arrayOf(rarest.toString()), signal).use {
        check(it.moveToFirst()) { "补全索引缺少候选列表" }
        it.getBlob(0)
    }
    val ranks = RankedPostingReader(encoded)
    // Android SQLiteCursor counts the whole SQL result on its first window fill.
    // Bound physical reads with ranked ID pages; each individual match is still emitted
    // immediately, without collecting a page of matches or waiting for its completion.
    while (ranks.hasNext()) {
        currentCoroutineContext().ensureActive()
        val page = ArrayList<String>(64)
        while (page.size < 64 && ranks.hasNext()) page.add(ranks.next().toString())
        val placeholders = page.joinToString(",") { "?" }
        // Only this bounded physical page is visited, in its precomputed rank order.
        val sql = "SELECT name,cn_name,post_count,category,a,b FROM entries WHERE rank IN ($placeholders) ORDER BY rank"
        database.rawQuery(sql, page.toTypedArray(), signal).use { cursor ->
            while (cursor.moveToNext()) {
                currentCoroutineContext().ensureActive()
                if (!cursor.getString(4).contains(query) && !cursor.getString(5).contains(query)) continue
                val translated = cursor.getString(1).orEmpty()
                onCandidate(NovelAiTagCandidate(
                    name = cursor.getString(0),
                    translatedName = if (dictionary) translated else translated.replace(translationWhitespace, " ").trim().take(200),
                    count = cursor.getLong(2),
                    category = NovelAiTagCategory.fromCode(cursor.getInt(3)) ?: continue,
                    fromDictionary = dictionary
                ))
            }
        }
    }
}

internal class RankedPostingReader(private val encoded: ByteArray) {
    private var offset = 0
    private var rank = 0L
    fun hasNext(): Boolean = offset < encoded.size
    fun next(): Long {
        var delta = 0L
        var shift = 0
        while (true) {
            check(offset < encoded.size && shift <= 56) { "补全索引候选编码损坏" }
            val byte = encoded[offset++].toInt() and 255
            delta = delta or ((byte and 127).toLong() shl shift)
            if (byte < 128) break
            shift += 7
        }
        rank += delta
        return rank
    }
}

private val translationWhitespace = Regex("\\s+")

internal class TagCompletionCache {
    private val values = LinkedHashMap<String, List<NovelAiTagCandidate>>(16, 0.75f, true)
    private var count = 0
    @Synchronized fun get(version: String, query: String): List<NovelAiTagCandidate>? = values["$version\n$query"]
    @Synchronized fun put(version: String, query: String, candidates: List<NovelAiTagCandidate>) {
        if (candidates.size > 10_000) return
        val key = "$version\n$query"
        values.remove(key)?.let { count -= it.size }
        values[key] = candidates.toList()
        count += candidates.size
        while (values.size > 128 || count > 10_000) {
            val iterator = values.entries.iterator()
            count -= iterator.next().value.size
            iterator.remove()
        }
    }
}

internal fun completionQueryKey(query: String): String = query.normalizeDanbooruTagQuery().lowercase(Locale.ROOT) +
    "\n" + query.trim().replace('_', ' ').lowercase(Locale.ROOT)
