// Is the licence-enforcement chain actually connected?
//
// Three ways it can be broken, and all three are silent. An annotated route
// whose enforcement does nothing does not fail, log, or look different — it
// serves a paid feature to everyone, and the first signal is a customer using
// something they never bought. That is the failure this refuses to let boot.
//
//   1. The static entitlement stack was never registered, because nothing can
//      resolve a tenant to a plan — no `adapters.planResolver`, no
//      `defaultPlanId`, no `tenantBilling`. Then `@RequireFeature` and
//      `@EnforceQuota` are inert markup.
//   2. The static stack was not registered but the V3 entitlement stack was.
//      `FeatureGuard` from `@saasicat/nest/billing` then answers
//      `@RequireFeature` — but nothing answers `@EnforceQuota`, because
//      `EnforceQuotaInterceptor` is registered only alongside a plan resolver.
//      Quotas read as unlimited while features are enforced correctly, which
//      is the shape a single "is entitlement on?" flag cannot express.
//   3. `globalFeatureGuard: false` unbinds the platform's APP_GUARD, and the
//      app is expected to bind a feature guard itself, per controller, behind
//      its own auth guard. That is a legitimate and common setup — both
//      consumers we know of use it, and both do it correctly on every
//      annotated route. It stops being legitimate for the route that was
//      forgotten.
//
// The question is asked after bootstrap, against the routes that exist,
// because that is the only place it is answerable: `forRoot()` runs before any
// controller does. An earlier version warned from `forRoot` whenever the option
// was off, which announced "annotated routes serve unlicensed traffic" to
// applications that had no such route — a warning that fires on a correct
// configuration teaches people to scroll past warnings.
//
// Case 1 with NO annotated route anywhere stays a warning, raised in
// `forRoot`: a catalogue-only application that never enforces anything is a
// real and supported shape.

import { Inject, Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

import { isPlatformFeatureGuard } from '../billing/feature-guard-marker.js';
import { REQUIRE_FEATURE_KEY } from '../billing/require-feature.decorator.js';
import { ENFORCE_QUOTA_KEY } from '../discovery/tokens.js';

/** Nest stores `@UseGuards(...)` under this key, on the class and the handler. */
const GUARDS_METADATA = '__guards__';

/**
 * Nest puts this on every method that `@Get`/`@Post`/… turned into a route.
 *
 * Needed because a controller's class also holds helper methods, and a
 * class-level `@RequireFeature` is inherited by all of them. Judging helpers by
 * their guards would report them as open routes while every real endpoint is
 * covered — the false positive this check exists to remove.
 */
const METHOD_METADATA = 'method';

/** What the module knows at composition time and this check cannot see. */
export interface EnforcementChainState {
    /**
     * Whether anything can enforce `@RequireFeature`.
     *
     * True on the static path, and also on the V3 path, where the application
     * binds `FeatureGuard` from `@saasicat/nest/billing` itself.
     */
    readonly featureEnforcementActive: boolean;
    /**
     * Whether anything can enforce `@EnforceQuota`.
     *
     * Narrower than the field above, and the two were one field until an app
     * on the V3 path with no plan resolver booted with every quota unenforced:
     * `EnforceQuotaInterceptor` comes from `composeEnforcementRuntime`, which
     * registers nothing unless a plan resolver exists. A flag named for
     * "entitlement" answered a question about features and was read as an
     * answer about quotas.
     */
    readonly quotaEnforcementActive: boolean;
    /** Whether the platform bound its own global feature guard. */
    readonly globalGuardBound: boolean;
    /**
     * Whether `globalFeatureGuard: false` is what unbound it.
     *
     * Distinct from `globalGuardBound` because the two have different causes
     * and the message has to say the true one. On the V3 entitlement path the
     * platform binds no global guard either — it never registers the static
     * stack — and naming an option the application did not set sends the reader
     * to look for a line that is not in their file.
     */
    readonly globalGuardOptedOut: boolean;
}

export const ENFORCEMENT_CHAIN_STATE_TOKEN = Symbol.for('saasicat/nest/EnforcementChainState');

interface AnnotatedRoute {
    controller: string;
    handler: string;
    /** Feature keys the route requires, if any. */
    features: string[];
    /** The quota key the route enforces, if any. */
    quota: string | null;
    /** Whether a recognisable platform feature guard sits in front of it. */
    guarded: boolean;
}

@Injectable()
export class EnforcementChainCheck implements OnApplicationBootstrap {
    constructor(
        @Inject(DiscoveryService)
        private readonly discoveryService: DiscoveryService,
        @Inject(MetadataScanner)
        private readonly metadataScanner: MetadataScanner,
        @Optional()
        @Inject(ENFORCEMENT_CHAIN_STATE_TOKEN)
        private readonly state: EnforcementChainState = {
            featureEnforcementActive: true,
            quotaEnforcementActive: true,
            globalGuardBound: true,
            globalGuardOptedOut: false,
        },
    ) {}

    onApplicationBootstrap(): void {
        const annotated = this.findAnnotatedRoutes();

        if (!this.state.featureEnforcementActive) {
            if (annotated.length === 0) return;
            throw new Error(
                `${annotated.length} route(s) are annotated for licence enforcement, but ` +
                    'nothing can resolve a tenant to a plan, so @RequireFeature and ' +
                    '@EnforceQuota do nothing at all: every annotated route serves unlicensed ' +
                    'traffic and every quota reads as unlimited.\n' +
                    `${describe(annotated)}\n` +
                    'Set one of: adapters.planResolver, defaultPlanId, or tenantBilling. ' +
                    'If this application deliberately publishes a catalogue without enforcing ' +
                    'it, remove the annotations — a decorator that cannot act is not ' +
                    'documentation, it is a claim the code does not keep.',
            );
        }

        // Features can be enforced but quotas cannot: the V3 path without a
        // plan resolver. Asked separately from the branch above because the
        // application is not misconfigured for features — a route that only
        // requires a feature is enforced correctly here, and refusing to boot
        // for that would be the false positive this check may not have.
        if (!this.state.quotaEnforcementActive) {
            const unenforced = annotated.filter((r) => r.quota !== null);
            if (unenforced.length > 0) {
                throw new Error(
                    `${unenforced.length} route(s) enforce a quota, but nothing registers ` +
                        'EnforceQuotaInterceptor, so every @EnforceQuota reads as unlimited ' +
                        'and the limit a customer paid for is not applied:\n' +
                        `${describe(unenforced)}\n` +
                        'The V3 entitlement stack resolves features, not quotas: the ' +
                        'interceptor is registered only where a plan can be resolved. Set one ' +
                        'of adapters.planResolver, defaultPlanId, or tenantBilling with a ' +
                        'subscription repository — or remove the annotations, because a ' +
                        'decorator that cannot act is not documentation.\n' +
                        'If this application enforces these quotas itself, set ' +
                        '`enforcementChainCheck: false` — it turns this check off and nothing ' +
                        'else.',
                );
            }
        }

        if (this.state.globalGuardBound) return;

        const uncovered = annotated.filter((r) => r.features.length > 0 && !r.guarded);
        if (uncovered.length === 0) return;

        const why = this.state.globalGuardOptedOut
            ? 'globalFeatureGuard is off'
            : 'the platform binds no global feature guard on this entitlement path';
        throw new Error(
            `${why} and ${uncovered.length} annotated route(s) have no feature guard in front ` +
                'of them, so they serve unlicensed traffic:\n' +
                `${describe(uncovered)}\n` +
                'Bind one behind your auth guard — @UseGuards(JwtAuthGuard, StaticFeatureGuard), ' +
                'or FeatureGuard from @saasicat/nest/billing on the V3 entitlement path.\n' +
                'Two things this cannot see, and the way out of each: a guard of your own that ' +
                'wraps ours (put FEATURE_GUARD_MARKER on the wrapper class — the symbol ' +
                'StaticFeatureGuard and FeatureGuard both carry), and a feature guard you bind ' +
                'globally as an APP_GUARD rather than per controller. If either is what these ' +
                'routes use, set `enforcementChainCheck: false` — it turns this check off and ' +
                'nothing else.',
        );
    }

    /**
     * Every route carrying an enforcement annotation, with whether a
     * recognisable feature guard covers it.
     *
     * Deliberately conservative in one direction only: an unrecognised wrapper
     * is reported (and the message says so) rather than assumed safe, because
     * the named route is cheap to check. The reverse — staying silent about a
     * route with no guard at all — is the failure this exists to prevent.
     */
    private findAnnotatedRoutes(): AnnotatedRoute[] {
        const annotated: AnnotatedRoute[] = [];

        for (const wrapper of this.discoveryService.getControllers()) {
            const instance = wrapper.instance as object | null | undefined;
            if (!instance || typeof instance !== 'object') continue;

            const ctor = instance.constructor as (new (...args: unknown[]) => unknown) | undefined;
            if (!ctor) continue;

            const classGuards = readGuards(ctor);
            const prototype = Object.getPrototypeOf(instance) as object;

            for (const method of this.metadataScanner.getAllMethodNames(prototype)) {
                const handler = (instance as Record<string, unknown>)[method];
                if (typeof handler !== 'function') continue;
                // Route handlers only — see METHOD_METADATA above.
                if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

                // Handler first, then class — the same order the guard itself
                // uses when it reads the requirement.
                const features =
                    readFeatures(handler as object) ?? readFeatures(ctor) ?? /* none */ [];
                const quota = readQuota(handler as object) ?? readQuota(ctor);
                if (features.length === 0 && quota === null) continue;

                const guards = [...classGuards, ...readGuards(handler as object)];
                annotated.push({
                    controller: ctor.name,
                    handler: method,
                    features,
                    quota,
                    guarded: guards.some(isPlatformFeatureGuard),
                });
            }
        }

        return annotated;
    }
}

function describe(routes: readonly AnnotatedRoute[]): string {
    return routes
        .map((r) => {
            const requirement =
                r.features.length > 0
                    ? `requires ${r.features.join(' or ')}`
                    : `enforces quota ${r.quota}`;
            return `  ${r.controller}.${r.handler} — ${requirement}`;
        })
        .join('\n');
}

/** Feature keys a decorator put on `target`, or null when it carries none. */
function readFeatures(target: object): string[] | null {
    const value: unknown = Reflect.getMetadata(REQUIRE_FEATURE_KEY, target);
    return Array.isArray(value) ? (value as string[]) : null;
}

/** The quota key `@EnforceQuota` put on `target`, or null. */
function readQuota(target: object): string | null {
    const value: unknown = Reflect.getMetadata(ENFORCE_QUOTA_KEY, target);
    if (typeof value !== 'object' || value === null) return null;
    const quotaKey = (value as { quotaKey?: unknown }).quotaKey;
    return typeof quotaKey === 'string' ? quotaKey : null;
}

/**
 * Guards bound to `target` via `@UseGuards(...)`.
 *
 * `@UseGuards` takes classes or instances. An instance carries the marker on
 * its constructor, so both forms are returned and the caller checks each.
 */
function readGuards(target: object): unknown[] {
    const value: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
    if (!Array.isArray(value)) return [];

    return value.flatMap((guard) =>
        typeof guard === 'function'
            ? [guard]
            : [guard, (guard as { constructor?: unknown } | null)?.constructor],
    );
}
