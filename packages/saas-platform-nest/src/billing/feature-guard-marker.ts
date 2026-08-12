// Marks a class as one of the platform's entitlement guards.
//
// `Symbol.for`, for the same reason every cross-entry DI token is one: the
// package ships as a dozen CJS entry points, and a class imported through two
// of them is two classes as far as `===` is concerned. A local `Symbol()`
// would be two symbols; the global registry gives one.
//
// The alternative — comparing class NAMES — was tried and is worse in the
// direction that matters. `FeatureGuard` is a name any application might use
// for a guard of its own, and matching it would report an unprotected route as
// covered. A false positive costs a moment to verify; a false negative leaves
// `@RequireFeature` serving unlicensed traffic and says nothing.

export const FEATURE_GUARD_MARKER: unique symbol = Symbol.for(
    'saasicat/nest/feature-guard',
) as never;

/** A guard class or instance carrying the platform's marker. */
export interface MarkedFeatureGuard {
    [FEATURE_GUARD_MARKER]: true;
}

/** True when `target` is one of the platform's entitlement guards. */
export function isPlatformFeatureGuard(target: unknown): boolean {
    if (target === null || (typeof target !== 'function' && typeof target !== 'object')) {
        return false;
    }
    return (target as Partial<MarkedFeatureGuard>)[FEATURE_GUARD_MARKER] === true;
}
