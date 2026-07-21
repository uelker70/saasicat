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
        super(`User ${email} existiert bereits (Rolle: ${existingRole}).`);
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
