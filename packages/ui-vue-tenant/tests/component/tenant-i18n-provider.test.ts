import { describe, expect, test } from 'vitest';
import { computed, defineComponent, h } from 'vue';

import TenantUsageGrid from '../../src/tenant-plan-section/TenantUsageGrid.vue';
import { provideTenantI18n, useTenantI18n } from '../../src/tenant-i18n';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';
import { DEFAULT_SA_LOCALE } from '@saasicat/ui-vue';
import type { UsageSnapshotShape } from '@saasicat/ui-vue';
import { mount } from '@vue/test-utils';

// Six children read the tenant catalog. They used to receive it as a prop from
// TenantPlanSection, four levels of pass-through in places; now they inject it.
//
// Two claims come with that, and neither is visible in the rendered output of a
// happy path: an ancestor's catalog has to actually reach a grandchild, and a
// child mounted on its own — which is what a consumer embedding one component
// does, and what every isolated test does — must still render words rather than
// blanks.

// Written out rather than cast: the grid reads `limits.quotas` and `usage`, and
// a cast would let a later field rename pass this file while the component
// renders nothing — which is the state this test exists to rule out.
const usage: UsageSnapshotShape = {
    plan: 'PRO',
    effectivePlan: 'PRO',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: {
        id: 'pv-1',
        planId: 'plan-1',
        version: 3,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        changeNote: null,
    },
    pendingPlanVersion: null,
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
    limits: { plan: 'PRO', quotas: { notes: 100 }, features: ['export'] },
    usage: { notes: 12 },
    packageSnapshot: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    cancellation: {
        effectiveAt: '2026-12-31T00:00:00.000Z',
        termEndsAt: '2026-12-31T00:00:00.000Z',
        noticeDeadline: null,
        afterNoticeDeadline: false,
    },
    checkoutOfferId: null,
};

const gridProps = {
    usage,
    catalogQuotaKeys: ['notes'],
    quotaLabel: (key: string) => key,
    isFractionalQuota: () => false,
    usageBarFormatter: () => undefined,
};

describe('the tenant catalog reaches a child without a prop', () => {
    test('an ancestor that provides is read by a grandchild', () => {
        const Grandchild = defineComponent({
            setup() {
                const i18n = useTenantI18n();
                return () => h('span', i18n.value.usageTitle);
            },
        });
        const Ancestor = defineComponent({
            setup() {
                provideTenantI18n(
                    // A whole catalog with one string moved, so a pass-through
                    // that quietly fell back to the default would still fail.
                    computedCatalog(),
                );
                return () => h('div', [h(Grandchild)]);
            },
        });
        const wrapper = mount(Ancestor);
        expect(wrapper.text()).toBe('Verbrauch dieses Mandanten');
    });

    test('without a provider the shipped catalog fills in, so nothing renders blank', () => {
        const wrapper = mount(TenantUsageGrid, { props: gridProps });
        const shipped = defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE);
        expect(wrapper.text()).toContain(shipped.usageTitle);
        expect(shipped.usageTitle.length).toBeGreaterThan(0);
    });

    test('the provided catalog wins over the shipped one', () => {
        const Host = defineComponent({
            setup() {
                provideTenantI18n(computedCatalog());
                return () => h(TenantUsageGrid, gridProps);
            },
        });
        const wrapper = mount(Host);
        expect(wrapper.text()).toContain('Verbrauch dieses Mandanten');
        expect(wrapper.text()).not.toContain(
            defaultTenantPlanSectionI18n(DEFAULT_SA_LOCALE).usageTitle,
        );
    });
});

/**
 * A catalog with one string moved, so a child that quietly fell back to the
 * shipped default would still fail the assertion.
 *
 * A real `computed`, not a `{ value }` stand-in: the templates read `i18n.x`
 * and rely on Vue unwrapping the ref: a plain object with a `value` field is
 * not a ref, so every string would come back `undefined` — which is what the
 * first draft of this fixture did, and it looked like a bug in the composable.
 */
function computedCatalog() {
    const base = defaultTenantPlanSectionI18n('de');
    return computed(() => ({ ...base, usageTitle: 'Verbrauch dieses Mandanten' }));
}
