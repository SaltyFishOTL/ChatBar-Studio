package com.example.chatbar.domain.image

import kotlinx.coroutines.Deferred

/** Query cancellation stops waiting, not the shared application-owned index build. */
internal class TagIndexPreparation<T> {
    private val pending = mutableMapOf<String, Deferred<T>>()

    suspend fun await(key: String, createLazy: () -> Deferred<T>): T {
        val task = synchronized(pending) {
            pending[key] ?: createLazy().also { created ->
                pending[key] = created
                created.invokeOnCompletion {
                    synchronized(pending) {
                        if (pending[key] === created) pending.remove(key)
                    }
                }
            }
        }
        task.start()
        return task.await()
    }
}
