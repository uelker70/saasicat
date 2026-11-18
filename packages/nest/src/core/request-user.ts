// Who made a request, read in one place for every route that records or checks
// who acted: the second factor, the audit log, the promotion preview's rate
// limit, a tenant's own writes. An application binds its resolvers once, at the
// root of `SaaSiCatModule`; without them the platform reads `user.sub`, then
// `user.id`, `user.email` and the `x-session-id` header. A route that read the
// request itself would answer by a rule of its own, and one request would name
// one user to the second factor and another to the audit log —
// `tests/the-user-behind-a-request-is-read-in-one-place.test.js` refuses any
// other file that reads these fields.
//
// `userId` is not read by default: an application whose authentication sets it
// says so with `userIdResolver`, as one whose identity provider's subject is
// not the id its users table keys the second factor by does.

import type { AdminActor } from '@saasicat/core';

import type {
    AuditContextResolver,
    UserEmailResolver,
    UserIdResolver,
} from '../billing/tenant-billing.tokens.js';

const SESSION_HEADER = 'x-session-id';

/** The actor an audit record names where the request names nobody. */
const NOBODY = 'unknown';

/** The resolvers an application binds to name the user behind a request. */
export interface RequestActorResolvers {
    readonly userId?: UserIdResolver | null;
    readonly email?: UserEmailResolver | null;
    readonly context?: AuditContextResolver | null;
}

/** A value that names something: a non-empty string. An empty one names nothing. */
function named(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

/** The `user` an authentication guard left on the request, where it left an object. */
function userOf(request: unknown): object | null {
    if (typeof request !== 'object' || request === null || !('user' in request)) return null;
    const { user } = request;
    return typeof user === 'object' && user !== null ? user : null;
}

/**
 * A value that names a user: a non-empty string, or a finite number as its
 * decimal text — an application whose rows carry an integer key leaves that
 * number on the request, and it names the user as surely as a string would.
 */
function namedUser(value: unknown): string | null {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : named(value);
}

const subOf = (user: object | null): string | null =>
    user !== null && 'sub' in user ? namedUser(user.sub) : null;
const idOf = (user: object | null): string | null =>
    user !== null && 'id' in user ? namedUser(user.id) : null;
const emailOf = (user: object | null): string | null =>
    user !== null && 'email' in user ? named(user.email) : null;

/**
 * The user a request names: what the application's resolver returns, or
 * without one `user.sub`, then `user.id`. `null` where it names nobody,
 * an empty string included.
 */
export function requestUserIdOf(request: unknown, resolver?: UserIdResolver | null): string | null {
    if (resolver) return named(resolver(request));
    const user = userOf(request);
    return subOf(user) ?? idOf(user);
}

/** The e-mail of the user a request names: the resolver's, or `user.email`. */
export function requestUserEmailOf(
    request: unknown,
    resolver?: UserEmailResolver | null,
): string | null {
    if (resolver) return named(resolver(request));
    return emailOf(userOf(request));
}

/** Where a request came from: the resolver's answer, or the `x-session-id` header. */
export function requestContextOf(
    request: unknown,
    resolver?: AuditContextResolver | null,
): string | null {
    if (resolver) return named(resolver(request));
    if (typeof request !== 'object' || request === null || !('headers' in request)) return null;
    const { headers } = request;
    if (typeof headers !== 'object' || headers === null || !(SESSION_HEADER in headers)) {
        return null;
    }
    const value = headers[SESSION_HEADER];
    return named(Array.isArray(value) ? value[0] : value);
}

/**
 * The actor behind a request, for the audit log: the user, their e-mail and
 * where the request came from, each through `resolvers` — and `fallbackContext`
 * where nothing names a context. A request that names no user or no e-mail is
 * recorded as `unknown` rather than as an address nobody has.
 */
export function actorFromRequest(
    request: unknown,
    resolvers: RequestActorResolvers,
    fallbackContext: string,
): AdminActor {
    return {
        userId: requestUserIdOf(request, resolvers.userId) ?? NOBODY,
        email: requestUserEmailOf(request, resolvers.email) ?? NOBODY,
        source: 'web',
        context: requestContextOf(request, resolvers.context) ?? fallbackContext,
    };
}
