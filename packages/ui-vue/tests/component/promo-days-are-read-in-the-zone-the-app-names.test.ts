// @requirement SC-PROMO-031 — The administration reads a promo code's days in the zone the application names

// A promo code's days, read in the zone the application names for them: in the
// edit dialog, the list and the detail page. Every case runs with the process
// in Los Angeles, a zone none of them names, so a day read in the browser's
// zone would come out wrong in each of them.
//
// The days are the ones the clocks change on in Berlin: the first day starts at
// midnight of 29 March, 23:00 UTC the day before, and the last ends at the end
// of 25 October, 22:59:59.999 UTC.

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import PromoCodeEditDialog from '../../src/internal/dialogs/PromoCodeEditDialog.vue';
import PromoCodeDetailPage from '../../src/pages/PromoCodeDetailPage.vue';
import PromoCodesPage from '../../src/pages/PromoCodesPage.vue';
import { createSuperAdminApp } from '../../src/quasar/create-super-admin-app.js';
import { SA_MESSAGES } from '../../src/client/i18n/messages.js';
import { SUPER_ADMIN_PROMO_CODES_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const FIRST_DAY_IN_BERLIN = '2026-03-28T23:00:00.000Z';
const LAST_DAY_IN_BERLIN = '2026-10-25T22:59:59.999Z';
/** Half an hour into 1 November in Berlin, still 31 October in UTC. */
const PAST_MIDNIGHT_IN_BERLIN = '2026-10-31T23:30:00.000Z';

const processZone = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
    process.env.TZ = processZone;
});

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

const i18n = {
    locale: ref('de'),
    messages: computed(() => SA_MESSAGES.de),
    intlLocale: computed(() => 'de-DE'),
    setLocale: () => {},
};

/** What the shell provides: the German texts, and `timeZone` where the app names one. */
function shellWith(timeZone: string | null): Record<symbol, unknown> {
    return {
        [SUPER_ADMIN_I18N_KEY as symbol]: i18n,
        ...(timeZone ? { [SUPER_ADMIN_PROMO_CODES_KEY as symbol]: { timeZone } } : {}),
    };
}

describe('the edit dialog', () => {
    const row = {
        id: 'promo-1',
        status: 'ACTIVE' as const,
        valueType: 'PERCENT' as const,
        value: 10,
        durationType: 'ONCE' as const,
        durationValue: null,
        maxRedemptions: null,
        redemptionsCount: 0,
        validFrom: FIRST_DAY_IN_BERLIN,
        validUntil: LAST_DAY_IN_BERLIN,
    };

    function mountIn(timeZone: string | null, submit = vi.fn().mockResolvedValue(undefined)) {
        const wrapper = mountWithQuasar(PromoCodeEditDialog as never, {
            attachTo: document.body,
            props: { modelValue: true, row, submit },
            global: { provide: shellWith(timeZone) },
        });
        mounted.push(wrapper);
        return {
            wrapper,
            submit,
            form: (wrapper.vm as unknown as { form: Record<string, unknown> }).form,
        };
    }

    test('shows the days the code was given in Berlin, on the days the clocks change', () => {
        const { form } = mountIn('Europe/Berlin');

        expect([form.validFrom, form.validUntil]).toEqual(['2026-03-29', '2026-10-25']);
    });

    test('shows the UTC days where the application names no zone', () => {
        const { form } = mountIn(null);

        expect([form.validFrom, form.validUntil]).toEqual(['2026-03-28', '2026-10-25']);
    });

    test('sends neither day back when something else is changed', async () => {
        const { form, submit } = mountIn('Europe/Berlin');

        form.value = 15;
        await flushPromises();
        (document.querySelectorAll('.sa-dialog__actions button')[1] as HTMLButtonElement).click();
        await flushPromises();

        expect(submit.mock.calls[0]?.[1]).toEqual({ value: 15 });
    });
});

describe('the list', () => {
    const rows = [
        {
            id: '1',
            code: 'SPRING',
            status: 'ACTIVE',
            valueType: 'PERCENT',
            value: 10,
            redemptionsCount: 0,
            heldCount: 0,
            maxRedemptions: null,
            validUntil: PAST_MIDNIGHT_IN_BERLIN,
            campaignTag: null,
        },
    ];
    const dayIn = (timeZone: string) =>
        new Date(PAST_MIDNIGHT_IN_BERLIN).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone,
        });

    async function cellsIn(timeZone: string | null): Promise<string[]> {
        const wrapper = mountWithQuasar(PromoCodesPage, {
            global: {
                provide: {
                    ...provideStubResources({ promoCodes: { list: () => Promise.resolve(rows) } }),
                    ...shellWith(timeZone),
                },
            },
        });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper.findAll('td').map((cell) => cell.text());
    }

    test('shows a code’s last day in the zone the application names, and in UTC without one', async () => {
        const inBerlin = await cellsIn('Europe/Berlin');
        const inUtc = await cellsIn(null);

        expect(dayIn('Europe/Berlin')).not.toBe(dayIn('UTC'));
        expect([inBerlin.includes(dayIn('Europe/Berlin')), inUtc.includes(dayIn('UTC'))]).toEqual([
            true,
            true,
        ]);
    });
});

describe('the detail page', () => {
    const detail = {
        promo: {
            id: 'id-SPRING',
            code: 'SPRING',
            type: 'PERCENT',
            value: 10,
            status: 'ACTIVE',
            maxRedemptions: null,
            redemptionsCount: 1,
            heldCount: 0,
            validFrom: null,
            validUntil: null,
            appliesToPlans: [],
        },
        redemptions: [
            {
                id: 'r-1',
                tenant: { slug: 'meier' },
                status: 'ACTIVE',
                startsAt: FIRST_DAY_IN_BERLIN,
                endsAt: LAST_DAY_IN_BERLIN,
                redeemedAt: '2026-10-05T15:44:35.000Z',
            },
        ],
    };

    async function redemptionIn(timeZone: string | null): Promise<string[]> {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/admin/promo-codes/:code', component: PromoCodeDetailPage }],
        });
        await router.push('/admin/promo-codes/SPRING');
        await router.isReady();
        const wrapper = mountWithQuasar({ template: '<router-view />' } as never, {
            global: {
                plugins: [router],
                provide: {
                    ...provideStubResources({
                        promoCodes: { detail: async () => detail },
                    } as never),
                    ...shellWith(timeZone),
                },
            },
        });
        mounted.push(wrapper);
        await flushPromises();
        const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('meier'));
        return (row?.findAll('td') ?? []).map((cell) => cell.text()).slice(2);
    }

    test('shows each redemption’s term and moment in the zone the application names, saying which', async () => {
        expect(await redemptionIn('Europe/Berlin')).toEqual([
            '2026-03-29',
            '2026-10-25',
            '2026-10-05 17:44:35 GMT+2',
        ]);
    });

    test('and in UTC where it names none', async () => {
        expect(await redemptionIn(null)).toEqual([
            '2026-03-28',
            '2026-10-25',
            '2026-10-05 15:44:35 UTC',
        ]);
    });
});

describe('the shell', () => {
    const Root = defineComponent({ setup: () => () => h('div') });
    const boot = (promoCodes?: { timeZone?: string }) =>
        createSuperAdminApp({
            rootComponent: Root,
            brand: { name: 'Fixture', logoText: 'FX' },
            endpoints: { apiBase: '/api/v1/admin' },
            appRoutes: [{ path: '/:pathMatch(.*)*', component: Root }],
            theme: { persist: false },
            ...(promoCodes ? { promoCodes } : {}),
        } as never);
    const providedBy = (handle: ReturnType<typeof boot>) =>
        (handle.app as unknown as { _context: { provides: Record<symbol, unknown> } })._context
            .provides[SUPER_ADMIN_PROMO_CODES_KEY as symbol];

    test('hands the pages the zone the application names, and UTC where it names none', () => {
        const named = boot({ timeZone: 'Europe/Berlin' });
        const unnamed = boot();

        expect([providedBy(named), providedBy(unnamed)]).toEqual([
            { timeZone: 'Europe/Berlin' },
            { timeZone: 'UTC' },
        ]);
        named.dispose();
        unnamed.dispose();
    });

    test('refuses a zone the browser cannot read before it touches the document', () => {
        document.documentElement.removeAttribute('data-sa-theme');

        expect(() => boot({ timeZone: 'Europe/Atlantis' })).toThrow(
            "promoCodes.timeZone 'Europe/Atlantis'",
        );
        expect(document.documentElement.hasAttribute('data-sa-theme')).toBe(false);
    });
});
