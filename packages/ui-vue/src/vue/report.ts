// Announcing an outcome is not part of the outcome. Kept apart from the
// actions that use it, so it is shared inside the package without becoming
// part of what the package exports.

/**
 * Announces an outcome without being able to change it.
 *
 * A report is not part of the action. A notify port can throw — its
 * notification centre not mounted, a message that cannot be worded — and a
 * throw inside the action turns a mutation the server has applied into a
 * failure; a caller answering a failure with a retry then repeats a
 * non-idempotent request over a toast.
 *
 * The throw is isolated, not swallowed: it is raised again out of band, where
 * the app's error handler still sees it and no result is left to corrupt.
 */
export function report(announce: () => void): void {
    try {
        announce();
    } catch (err: unknown) {
        queueMicrotask(() => {
            throw err;
        });
    }
}
