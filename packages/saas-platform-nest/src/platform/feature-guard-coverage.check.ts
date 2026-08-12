// Does every `@RequireFeature` route actually have a guard in front of it?
//
// `globalFeatureGuard: false` means the platform binds no APP_GUARD, and the
// app is expected to bind a feature guard itself — per controller, behind its
// own auth guard. That is a legitimate and common setup: both consumers we
// know of use it, and both do it correctly on every annotated route.
//
// The first version of this check was a warning in `forRoot()` that fired
// whenever the option was off. It could not do better — `forRoot()` runs
// before any controller exists — but it therefore announced "any annotated
// route without one serves unlicensed traffic" to applications where no such
// route existed. A warning that fires on a correct configuration is worse than
// none: it teaches people to scroll past warnings.
//
// So the question is asked where it can actually be answered: after bootstrap,
// against the routes that exist. Silence now means "checked, nothing open",
// not "did not look".

import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

import { isPlatformFeatureGuard } from '../billing/feature-guard-marker.js';
import { REQUIRE_FEATURE_KEY } from '../billing/require-feature.decorator.js';

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

interface UncoveredRoute {
    controller: string;
    handler: string;
    features: string[];
}

@Injectable()
export class FeatureGuardCoverageCheck implements OnApplicationBootstrap {
    private readonly logger = new Logger('SaaSiCat');

    constructor(
        @Inject(DiscoveryService)
        private readonly discoveryService: DiscoveryService,
        @Inject(MetadataScanner)
        private readonly metadataScanner: MetadataScanner,
    ) {}

    onApplicationBootstrap(): void {
        const uncovered = this.findUncoveredRoutes();
        if (uncovered.length === 0) return;

        const list = uncovered
            .map((r) => `  ${r.controller}.${r.handler} — requires ${r.features.join(' or ')}`)
            .join('\n');

        this.logger.warn(
            `globalFeatureGuard is off and ${uncovered.length} annotated route(s) have no feature ` +
                `guard in front of them, so they serve unlicensed traffic:\n${list}\n` +
                `Bind one behind your auth guard — @UseGuards(JwtAuthGuard, StaticFeatureGuard), ` +
                `or FeatureGuard from @saasicat/nest/billing on the V3 entitlement path. ` +
                `A guard of your own that wraps either one is not recognised here; if that is ` +
                `what these routes use, they are covered.`,
        );
    }

    /**
     * Annotated handlers whose own guards and whose controller's guards contain
     * no recognisable feature guard.
     *
     * Deliberately conservative in one direction only: an unrecognised wrapper
     * is reported (and the message says so) rather than assumed safe, because
     * the named route is cheap to check. The reverse — staying silent about a
     * route with no guard at all — is the failure this exists to prevent.
     */
    private findUncoveredRoutes(): UncoveredRoute[] {
        const uncovered: UncoveredRoute[] = [];

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
                    readFeatures(handler as object) ??
                    readFeatures(ctor) ??
                    /* not annotated */ null;
                if (!features || features.length === 0) continue;

                const guards = [...classGuards, ...readGuards(handler as object)];
                if (guards.some(isPlatformFeatureGuard)) continue;

                uncovered.push({ controller: ctor.name, handler: method, features });
            }
        }

        return uncovered;
    }
}

/** Feature keys a decorator put on `target`, or null when it carries none. */
function readFeatures(target: object): string[] | null {
    const value: unknown = Reflect.getMetadata(REQUIRE_FEATURE_KEY, target);
    return Array.isArray(value) ? (value as string[]) : null;
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
