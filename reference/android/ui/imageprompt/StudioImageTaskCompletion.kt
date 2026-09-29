package com.example.chatbar.ui.imageprompt

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal suspend fun finishStudioImageFailure(
    cleanup: () -> Unit,
    publish: (cleanupError: Throwable?) -> Unit
) = withContext(NonCancellable) {
    // Return from IO into this protected context, not the cancelled generation Job.
    // Otherwise prompt cancellation skips the terminal UI update after cleanup.
    val cleanupError = runCatching { withContext(Dispatchers.IO) { cleanup() } }.exceptionOrNull()
    publish(cleanupError)
}
