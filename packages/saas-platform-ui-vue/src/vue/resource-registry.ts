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
    /** Every key the registry can answer for. */
    keys(): string[];
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
        const next = (platform as Record<string, (...args: never[]) => Promise<unknown>>)[name];
        if (!next) {
            throw new Error(
                `createResourceRegistry: resource "${def.key}" has no operation "${name}" to ` +
                    `override. It offers: ${Object.keys(platform).join(', ')}.`,
            );
        }
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

    // Bound once per resource: the context is read per call, so nothing here
    // goes stale, and a page that asks twice gets the same operations.
    const bound = new Map<string, unknown>();
    for (const [key, def] of Object.entries(options.resources)) {
        bound.set(key, boundWithOverride(def, options.http, readContext, options.overrides?.[key]));
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
        keys: () => [...bound.keys()],
    };
}

/** Vue inject key for the registry (see `Symbol.for` note in super-admin-context.ts). */
export const SUPER_ADMIN_RESOURCES_KEY: InjectionKey<ResourceRegistry> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_RESOURCES',
);

/**
 * The operations of one resource, ready to call.
 *
 * Throws when the shell has no registry rather than returning something
 * inert — a page whose data silently never arrives is harder to diagnose than
 * one that says what is missing.
 */
export function useResource<K extends string>(key: K): Bound<ResourceOps> {
    const registry = inject(SUPER_ADMIN_RESOURCES_KEY, null);
    if (!registry) {
        throw new Error(
            `useResource("${key}"): no resource registry in scope. Was the component mounted ` +
                'inside createSuperAdminApp()?',
        );
    }
    return registry.get(key);
}
