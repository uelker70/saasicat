// The registry: which resources a page can reach, and what an app may change
// about them.
//
// A page asks for a resource by name and gets operations that already know the
// endpoint, the project and the locale — so a standard page needs no data
// props at all. An app that has to divert one call overrides that one
// operation and keeps the rest, which is the property a prop-based page cannot
// offer: its props are all-or-nothing.

import { inject, type InjectionKey } from 'vue';

import {
    bindResource,
    type Bound,
    type PlatformResources,
    type ResourceContext,
    type ResourceDef,
    type ResourceOps,
} from '../client/resources/index.js';
import type { HttpClient } from '../client/types.js';

/**
 * An override receives the platform's own implementation as `next`, so it
 * wraps rather than replaces. Recording an approval before a publish is three
 * lines; rewriting the publish is not.
 */
export type OpOverride<TOp> = TOp extends (
    http: HttpClient,
    ctx: ResourceContext,
    ...args: infer A
) => Promise<infer R>
    ? (next: (...args: A) => Promise<R>, ...args: A) => Promise<R>
    : never;

export interface ResourceOverride<TOps extends ResourceOps> {
    /** Only the endpoint, project or locale this resource is read under. */
    context?: Partial<ResourceContext>;
    /** Only the transport, e.g. a client with a different auth. */
    http?: HttpClient;
    /** Individual operations, each wrapping the platform's. */
    ops?: { [K in keyof TOps]?: OpOverride<TOps[K]> };
}

/** Resources by key, in the shape a registry holds them. */
export type ResourceMap = Record<string, ResourceDef<ResourceOps>>;

export type ResourceOverrides<TMap extends ResourceMap> = {
    [K in keyof TMap]?: ResourceOverride<TMap[K]['ops']>;
};

export interface ResourceRegistry<TMap extends ResourceMap = ResourceMap> {
    /** The bound operations of one resource. Throws for an unknown key. */
    get<K extends keyof TMap>(key: K): Bound<TMap[K]['ops']>;
    /**
     * The same resource with one more override layered on, for a single page
     * instance rather than the whole app.
     *
     * Layered, not replaced: the app's own override still runs. An app that
     * records approvals around `publish` keeps doing so when one page is
     * pointed at a legacy host, and the page does not have to know the approval
     * exists. The order is platform, then app, then instance — the instance is
     * outermost, so it sees what the app already decided.
     */
    bind<K extends keyof TMap>(
        key: K,
        override: ResourceOverride<TMap[K]['ops']>,
    ): Bound<TMap[K]['ops']>;
    /** Every key the registry can answer for. */
    keys(): string[];
}

/**
 * Composes two overrides into one, `layer` outermost.
 *
 * The op case is the reason this is not `{ ...base, ...layer }`: both may wrap
 * the same operation, and a spread would drop the app's wrapper on the floor.
 * Each side receives the next one down as its `next`, so the chain reads
 * platform ← app ← instance in the order a reader would expect.
 */
function mergeOverrides<TOps extends ResourceOps>(
    base: ResourceOverride<TOps> | undefined,
    layer: ResourceOverride<TOps>,
): ResourceOverride<TOps> {
    if (!base) return layer;
    const ops: Record<string, unknown> = { ...(base.ops ?? {}) };
    for (const [name, outer] of Object.entries(layer.ops ?? {})) {
        if (typeof outer !== 'function') continue;
        const inner = (base.ops as Record<string, unknown> | undefined)?.[name];
        ops[name] =
            typeof inner === 'function'
                ? (next: (...a: never[]) => Promise<unknown>, ...args: never[]) =>
                      (outer as (n: unknown, ...a: never[]) => Promise<unknown>)(
                          (...inner_args: never[]) =>
                              (inner as (n: unknown, ...a: never[]) => Promise<unknown>)(
                                  next,
                                  ...inner_args,
                              ),
                          ...args,
                      )
                : outer;
    }
    return {
        context: { ...base.context, ...layer.context },
        http: layer.http ?? base.http,
        ops: ops as ResourceOverride<TOps>['ops'],
    };
}

export interface CreateResourceRegistryOptions<TMap extends ResourceMap> {
    /**
     * Required — there is deliberately no fallback.
     *
     * A registry that quietly reached for `fetch` when nobody passed a client
     * would send every request without the app's `Authorization` header, and
     * the failure is silent: the call 401s, one card renders an em dash, and
     * nothing is logged. Three such call sites existed in this package and had
     * to be found by reading. Asking for the client makes them unwritable.
     */
    http: HttpClient;
    /** Read per call, so a switched locale or project applies to what follows. */
    context: ResourceContext | (() => ResourceContext);
    /** The resources on offer. */
    resources: TMap;
    /** Per-resource adjustments from the app. */
    overrides?: ResourceOverrides<TMap>;
}

function boundWithOverride<TOps extends ResourceOps>(
    def: ResourceDef<TOps>,
    http: HttpClient,
    readContext: () => ResourceContext,
    override: ResourceOverride<TOps> | undefined,
): Bound<TOps> {
    const context = override?.context
        ? () => ({ ...readContext(), ...override.context })
        : readContext;
    const platform = bindResource(def, override?.http ?? http, context);
    if (!override?.ops) return platform;

    const result = { ...platform } as Record<string, unknown>;
    for (const [name, wrap] of Object.entries(override.ops)) {
        if (typeof wrap !== 'function') continue;
        // An own-property check, not a truthy read: indexing walks the
        // prototype chain, so an override named `toString` or `constructor`
        // found `Object.prototype`'s and wrapped that instead of reporting a
        // name the resource does not offer — the one case this check exists
        // for. A typo like `lst` failed loudly while `constructor` passed
        // silently.
        //
        // `hasOwnProperty.call` rather than `Object.hasOwn`, which is ES2022:
        // this file is reached from `pages/*`, which ships as source, so a
        // consumer on the ES2021 floor compiles it. See CONTRIBUTING,
        // "The shipped source has a language floor".
        if (!Object.prototype.hasOwnProperty.call(platform as object, name)) {
            throw new Error(
                `createResourceRegistry: resource "${def.key}" has no operation "${name}" to ` +
                    `override. It offers: ${Object.keys(platform).join(', ')}.`,
            );
        }
        const next = (platform as Record<string, (...args: never[]) => Promise<unknown>>)[name];
        result[name] = (...args: never[]) =>
            (wrap as (n: unknown, ...a: never[]) => Promise<unknown>)(next, ...args);
    }
    return result as Bound<TOps>;
}

export function createResourceRegistry<TMap extends ResourceMap>(
    options: CreateResourceRegistryOptions<TMap>,
): ResourceRegistry<TMap> {
    if (!options?.http) {
        throw new Error(
            'createResourceRegistry: `http` is required. Pass the HttpClient your app already ' +
                'uses — createAxiosHttpClient(instance) or createFetchHttpClient({ headers }) — ' +
                'so every platform request carries its auth.',
        );
    }
    const readContext =
        typeof options.context === 'function'
            ? options.context
            : () => options.context as ResourceContext;

    // An override for a resource that is not registered would otherwise be
    // read by nothing: the loop below walks the resources, so a typo like
    // `planVersion` silently drops the approval or auth wrapper it was meant to
    // add and leaves the platform operation running. A misspelled OPERATION
    // already fails at boot, so the two spellings of the same mistake had
    // opposite outcomes. TypeScript catches this for a typed consumer; a
    // JavaScript one, or a config assembled at runtime, gets nothing.
    // `hasOwn`, not `in`: `in` walks the prototype chain, so an override named
    // `constructor` or `toString` passed the check and was then skipped by the
    // loop below — silently ignored, which is the outcome this validation
    // exists to prevent.
    const unknown = Object.keys(options.overrides ?? {}).filter(
        (key) => !Object.prototype.hasOwnProperty.call(options.resources, key),
    );
    if (unknown.length > 0) {
        throw new Error(
            `createResourceRegistry: no resource named ${unknown.map((k) => `"${k}"`).join(', ')} ` +
                `to override. The registry holds: ${Object.keys(options.resources).join(', ')}.`,
        );
    }

    // Bound once per resource: the context is read per call, so nothing here
    // goes stale, and a page that asks twice gets the same operations.
    const bound = new Map<string, unknown>();
    for (const [key, def] of Object.entries(options.resources)) {
        bound.set(key, boundWithOverride(def, options.http, readContext, options.overrides?.[key]));
    }

    function defOf(key: string): ResourceDef<ResourceOps> {
        const def = options.resources[key];
        if (!def) {
            throw new Error(
                `useResource("${key}"): no such resource. The registry offers: ` +
                    `${[...bound.keys()].join(', ')}.`,
            );
        }
        return def as ResourceDef<ResourceOps>;
    }

    return {
        get(key) {
            const ops = bound.get(key as string);
            if (!ops) {
                throw new Error(
                    `useResource("${String(key)}"): no such resource. The registry offers: ` +
                        `${[...bound.keys()].join(', ')}.`,
                );
            }
            return ops as Bound<TMap[typeof key]['ops']>;
        },
        bind(key, override) {
            const name = String(key);
            // Bound from the descriptor rather than from the cached result: an
            // override may move the context or the client, and neither can be
            // applied to operations that already closed over the old ones.
            return boundWithOverride(
                defOf(name),
                options.http,
                readContext,
                mergeOverrides(
                    options.overrides?.[name] as ResourceOverride<ResourceOps> | undefined,
                    override as ResourceOverride<ResourceOps>,
                ),
            ) as Bound<TMap[typeof key]['ops']>;
        },
        keys: () => [...bound.keys()],
    };
}

/** Vue inject key for the registry (see `Symbol.for` note in super-admin-context.ts). */
export const SUPER_ADMIN_RESOURCES_KEY: InjectionKey<ResourceRegistry> = Symbol.for(
    'saasicat/ui-vue/SUPER_ADMIN_RESOURCES',
);

/**
 * The operations of one resource, ready to call.
 *
 * Typed against the platform roster, so `useResource('plans').update(id, data)`
 * carries the argument types the descriptor declares and an unknown key is a
 * compile error. Without that mapping the key parameter erased the operations
 * to `ResourceOps`, whose `never[]` constraint made *every* call with an
 * argument a type error while accepting any misspelled resource name — the
 * exact opposite of the guarantee the registry exists for.
 *
 * An app with its own resources passes its map as the second type argument.
 *
 * Throws when the shell has no registry rather than returning something
 * inert — a page whose data silently never arrives is harder to diagnose than
 * one that says what is missing.
 */
export function useResource<
    K extends keyof TMap & string,
    TMap extends ResourceMap = PlatformResources,
>(key: K, override?: ResourceOverride<TMap[K]['ops']>): Bound<TMap[K]['ops']> {
    const registry = inject(SUPER_ADMIN_RESOURCES_KEY, null);
    if (!registry) {
        throw new Error(
            `useResource("${key}"): no resource registry in scope. Either the component was ` +
                'not mounted inside createSuperAdminApp(), or the app did not pass an `http` ' +
                'client — the registry is not installed without one, because a bare fetch would ' +
                'send every request without your Authorization header and fail silently.',
        );
    }
    return (
        override ? registry.bind(key, override as ResourceOverride<ResourceOps>) : registry.get(key)
    ) as Bound<TMap[K]['ops']>;
}
