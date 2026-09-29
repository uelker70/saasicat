// Shared domain errors. Deliberately framework-free (no NestJS import), so that
// both adapters (consumers) and callers (nest services, CLI) can throw them or
// map them semantically, instead of passing them through as a 500.

import type { PlatformRole } from './ports/core-ports.types.js';

const USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS';

/**
 * A user to be created already exists under this email. Adapters throw it
 * (e.g. in the SuperAdmin bootstrap); callers map it semantically:
 * SetupService → HTTP 409, CLI → readable message.
 */
export class PlatformUserExistsError extends Error {
    readonly code = USER_ALREADY_EXISTS;
    constructor(
        readonly email: string,
        readonly existingRole: PlatformRole,
    ) {
        super(`User ${email} already exists (role: ${existingRole}).`);
        this.name = 'PlatformUserExistsError';
    }
}

/**
 * Realm-safe type guard (checks `code` instead of `instanceof`) — works even
 * when thrower and catcher see the class from different module instances.
 */
export function isPlatformUserExistsError(err: unknown): err is PlatformUserExistsError {
    return err instanceof Error && (err as { code?: string }).code === USER_ALREADY_EXISTS;
}

const PERSISTENCE_REFUSAL = 'PersistenceRefusal';

/**
 * What a refused write found instead of the state its caller had read:
 * `gone` — the row no longer exists; `moved` — it exists, but no longer in the
 * state the write required, because a concurrent request changed it first.
 */
export type PersistenceRefusalReason = 'gone' | 'moved';

/**
 * A write an adapter refused because the row was no longer what the caller
 * read, carrying the platform's error code for that case.
 *
 * The platform checks these conditions before it writes and answers with the
 * same code. The adapter's own guard is what holds when two requests pass
 * that check together — a double click, two operators — and throwing this
 * rather than a plain `Error` gives the loser of that race the answer the
 * check would have given, instead of a 500 that reads like a crash in the log.
 * The adapter says what it found; the platform decides what that is on the
 * wire.
 */
export class PersistenceRefusal extends Error {
    constructor(
        readonly code: string,
        readonly reason: PersistenceRefusalReason,
        message: string,
        readonly params: Readonly<Record<string, unknown>> = {},
    ) {
        super(message);
        this.name = PERSISTENCE_REFUSAL;
    }
}

/** Realm-safe type guard, like `isPlatformUserExistsError`. */
export function isPersistenceRefusal(err: unknown): err is PersistenceRefusal {
    if (!(err instanceof Error) || err.name !== PERSISTENCE_REFUSAL) return false;
    const { code, reason } = err as Partial<PersistenceRefusal>;
    return typeof code === 'string' && (reason === 'gone' || reason === 'moved');
}
