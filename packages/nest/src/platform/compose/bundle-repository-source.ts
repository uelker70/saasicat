import type {
    BundleRepository,
    PersistenceProvider,
    SaaSiCatPersistenceAdapter,
} from '@saasicat/core';

/**
 * Where a bundle catalogue repository may come from.
 *
 * Two slices can carry one, and both are legitimate. `catalog` is the more
 * specific statement — an adapter that has a whole plan-and-bundle catalogue —
 * and stays the first answer. `entitlement` is the other: an adapter may have
 * bundles without plans, because the two are separate tables and separate work.
 *
 * One function rather than the expression written out at each reader, because
 * the readers are a composer and a boot-time validation rule, and those two
 * disagreeing is the worst shape available: the rule refuses a configuration
 * the composer would have handled, or admits one it would not. `adapter-drizzle`
 * found exactly that — it gained complete bundle support, and
 * `subscriptionBundles: true` then rejected it at startup as missing, because
 * the `catalog` slice it could not fill was the only place either reader looked.
 */
export function resolveBundleRepository(
    persistence: SaaSiCatPersistenceAdapter | undefined,
): PersistenceProvider<BundleRepository> | undefined {
    return persistence?.catalog?.bundleRepository ?? persistence?.entitlement?.bundleRepository;
}
