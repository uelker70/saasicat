// The tenant-facing catalog, provided once instead of passed down.
//
// `TenantPlanSection` used to hand `effectiveI18n` to six children as a prop,
// and two sibling views did the same with their own copies — the fourth
// pass-through of the same object is the shape AP3's resource ports exist to
// remove, one directory over.
//
// Like `useSuperAdminI18n` next door, this falls back to the shipped catalog
// when nothing provided one, so a child mounted on its own in a test needs no
// setup and a consumer embedding a single component does not have to know a
// provider exists.

import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';

import { useSuperAdminI18n } from '@saasicat/ui-vue';
import { defaultTenantPlanSectionI18n, type TenantPlanSectionI18n } from './default-i18n.js';

/** Injection key for the tenant catalog (see the `Symbol.for` note in super-admin-context.ts). */
export const TENANT_I18N_KEY: InjectionKey<ComputedRef<TenantPlanSectionI18n>> = Symbol.for(
    'saasicat/ui-vue-tenant/TENANT_I18N',
);

/**
 * Makes `messages` the tenant catalog for this subtree. Called by the view that
 * owns the catalog — typically `TenantPlanSection` — once.
 */
export function provideTenantI18n(messages: ComputedRef<TenantPlanSectionI18n>): void {
    provide(TENANT_I18N_KEY, messages);
}

/**
 * The tenant catalog. Falls back to the shipped default for the active locale
 * when no ancestor provided one.
 */
export function useTenantI18n(): ComputedRef<TenantPlanSectionI18n> {
    const provided = inject(TENANT_I18N_KEY, null);
    if (provided) return provided;
    const { locale } = useSuperAdminI18n();
    return computed(() => defaultTenantPlanSectionI18n(locale.value));
}
