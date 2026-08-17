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
    /** The project whose catalogue is being administered. */
    readonly projectKey: string;
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
    /**
     * Whether these operations read `ctx.projectKey`.
     *
     * Declared per descriptor rather than known centrally, because it is not a
     * property of the registry: one of the four platform resources is
     * project-scoped and three are not, and the tenant list would be refused
     * for a project it never asks about. `bindResource` refuses to bind a
     * descriptor that declares this against a context that names no project.
     *
     * `resources-declare-their-project-scope.test.js` drives every operation
     * and fails when a declaration and what the operations actually read
     * disagree — in either direction.
     */
    readonly projectScoped: boolean;
}

/** What a descriptor declares beyond its name and its operations. */
export interface DefineResourceOptions {
    /** See `ResourceDef.projectScoped`. Default `false`. */
    projectScoped?: boolean;
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
    options: DefineResourceOptions = {},
): ResourceDef<TOps> {
    return { key, ops, projectScoped: options.projectScoped ?? false };
}

/**
 * Refuses a project-scoped resource that has no project to be scoped to.
 *
 * An empty `projectKey` is not caught by anything downstream: the request goes
 * out as `?projectKey=`, and an admin API that filters on it answers a list for
 * no project at all — a valid-looking empty catalogue, with nothing on screen
 * saying the shell was misconfigured. The same context then puts `projectKey:
 * ''` in a create body, where it finally fails validation, one operator action
 * and one screen later than the mistake.
 *
 * `usePlans` has refused this at construction from the start; a page reaching
 * the same endpoints through the registry did not.
 */
function requireProjectKey(
    def: { key: string; projectScoped: boolean },
    ctx: ResourceContext,
): void {
    if (!def.projectScoped) return;
    if (typeof ctx.projectKey === 'string' && ctx.projectKey.trim() !== '') return;
    throw new Error(
        `Resource "${def.key}" is project-scoped, but the context it is bound to names no ` +
            'project. Its requests would go out as `?projectKey=`, which the admin API answers ' +
            'for no project at all: the catalogue reads as empty and the first create fails ' +
            'validation instead. Name the project this admin administers — `endpoints.projectKey` ' +
            'for createSuperAdminApp(), `context.projectKey` for createResourceRegistry().',
    );
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
    // Sampled once, here, rather than checked on every request. Binding is
    // where an app's configuration is handed over, so this is the moment a
    // missing option can still be reported as one — naming it at boot rather
    // than at the click that reads an empty list. What a later call sends is
    // still whatever `readContext()` says then.
    requireProjectKey(def, readContext());
    const bound: Record<string, unknown> = {};
    for (const [name, op] of Object.entries(def.ops)) {
        bound[name] = (...args: never[]) => op(http, readContext(), ...args);
    }
    // The loop cannot express, per key, that it produced exactly the operation
    // `Bound<TOps>` names — the relationship holds across the whole record, not
    // one entry at a time.
    return bound as Bound<TOps>;
}
