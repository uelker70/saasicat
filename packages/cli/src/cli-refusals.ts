import { HttpStatus } from '@nestjs/common';

import { CliError } from './cli-context.service.js';

/** Exit codes per `cli-conventions.md` §6. */
const EXIT_USER_ERROR = 1;
const EXIT_CONFLICT = 6;

/**
 * The platform's services refuse the way a route does, with a coded HTTP
 * exception. Here it becomes the exit code a script can branch on — 6 for a
 * conflict, 1 for any other refusal —, with the service's sentence, under
 * `fallbackCode` where the refusal names none. A server error is thrown on.
 */
export async function refusalsAsCliErrors<T>(
    fallbackCode: string,
    act: () => Promise<T>,
): Promise<T> {
    try {
        return await act();
    } catch (error) {
        const status = statusOf(error);
        if (status === null || status >= 500) throw error;
        // SAFETY: `statusOf` found `getStatus` and `getResponse` on it, both functions.
        const response: unknown = (error as { getResponse(): unknown }).getResponse();
        const body = typeof response === 'object' && response !== null ? response : {};
        throw new CliError(
            'code' in body && typeof body.code === 'string' ? body.code : fallbackCode,
            'message' in body && typeof body.message === 'string' ? body.message : String(error),
            status === HttpStatus.CONFLICT ? EXIT_CONFLICT : EXIT_USER_ERROR,
        );
    }
}

/**
 * The HTTP status of a Nest exception, read rather than tested with
 * `instanceof`: the service's `@nestjs/common` and this package's may be two
 * copies in an application's `node_modules`.
 */
function statusOf(error: unknown): number | null {
    // SAFETY: both properties are read as unknown and checked to be functions before either is called.
    const candidate = error as { getStatus?: unknown; getResponse?: unknown } | null;
    if (typeof candidate?.getStatus !== 'function' || typeof candidate.getResponse !== 'function') {
        return null;
    }
    const status: unknown = candidate.getStatus();
    return typeof status === 'number' ? status : null;
}
