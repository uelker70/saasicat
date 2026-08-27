// A resource is a named set of operations over `(http, ctx, ...args)`.
//
// The point is to define an endpoint once. Today the same URL is assembled in
// several places — `catalog/plans/:id/versions` is built by `usePlanVersions`
// and again by `useLivePlanVersions`, and the JSON request/response dance
// around it (`204` means empty, a 2xx body may be unparsable, `>= 400` throws
// with the parsed body attached) is written out three times verbatim in this
// package. An operation that lives in one place can be read, tested and
// overridden in one place.
//
// Framework-free on purpose: no Vue, no refs. An op is a plain async function,
// so it can be checked with `node --test` against `dist/` like the rest of
// `src/client/`, and reused by a binding that is not Vue at all.

import type { HttpClient } from '../types.js';

/**
 * What an operation needs to know about the app it runs in, beyond its own
 * arguments.
 *
 * Today each composable takes these as its own options and each consumer
 * passes them again per page. They are app-wide constants — which is why they
 * belong in one context rather than in every signature.
 */
export interface ResourceContext {
    /** Admin API root, e.g. `/api/v1/admin`. No trailing slash. */
    readonly apiBase: string;
    /** Active UI locale, for the operations whose payload is per-language. */
    readonly locale: string;
}

/** One operation: everything it needs, in the order it needs it. */
export type ResourceOp<A extends unknown[], R> = (
    http: HttpClient,
    ctx: ResourceContext,
    ...args: A
) => Promise<R>;

/** The operations of one resource, keyed by name. */
export type ResourceOps = Record<string, ResourceOp<never[], unknown>>;

export interface ResourceDef<TOps extends ResourceOps> {
    /** Name this resource is registered and overridden under. */
    readonly key: string;
    readonly ops: TOps;
}

/**
 * The same operations with `(http, ctx)` already supplied — the form a page or
 * a composable calls.
 */
export type Bound<TOps extends ResourceOps> = {
    [K in keyof TOps]: TOps[K] extends ResourceOp<infer A, infer R>
        ? (...args: A) => Promise<R>
        : never;
};

/**
 * Declares a resource.
 *
 * Deliberately thin — it exists to name the set and to fix the type, not to
 * add behaviour. Anything it did at definition time would be a thing an
 * override could not replace.
 */
export function defineResource<const TOps extends ResourceOps>(
    key: string,
    ops: TOps,
): ResourceDef<TOps> {
    return { key, ops };
}

/**
 * Supplies `(http, ctx)` once and hands back the callable operations.
 *
 * The context is read at call time rather than captured per operation, so a
 * context that changes — a locale the operator switches, a project the shell
 * re-scopes — is picked up by calls made afterwards without rebinding.
 */
export function bindResource<TOps extends ResourceOps>(
    def: ResourceDef<TOps>,
    http: HttpClient,
    ctx: ResourceContext | (() => ResourceContext),
): Bound<TOps> {
    const readContext = typeof ctx === 'function' ? ctx : () => ctx;
    const bound: Record<string, unknown> = {};
    for (const [name, op] of Object.entries(def.ops)) {
        bound[name] = async (...args: never[]) => op(http, readContext(), ...args);
    }
    // The loop cannot express, per key, that it produced exactly the operation
    // `Bound<TOps>` names — the relationship holds across the whole record, not
    // one entry at a time.
    return bound as Bound<TOps>;
}
