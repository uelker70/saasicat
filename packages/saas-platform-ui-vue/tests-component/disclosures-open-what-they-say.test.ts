// The two surfaces moved onto `AdminAccordion`, asserted where a baseline
// cannot see them.
//
// Neither is rendered by any visual fixture: the marketing catalog's cases open
// its preview and its admin tab, never the promotions tab, and the promo-code
// cases never open a dialog. So the migration changed markup that no recorded
// snapshot covers, and "the suite is green" would have meant nothing about it.
//
// What is asserted is the claim the migration makes, not its appearance: the
// header is a real control that reports its state, and it opens the body that
// belongs to it. `admin-accordion.test.ts` proves the component; this proves
// these two call sites are wired to it.

import { afterEach, describe, expect, test } from 'vitest';
import { reactive, ref } from 'vue';
import type { PromotionRow } from '@saasicat/types';

import MarketingPromotionsTab from '../src/components/MarketingPromotionsTab.vue';
import PromoCodeDialogFields, {
    type PromoCodeSharedForm,
} from '../src/components/dialogs/PromoCodeDialogFields.vue';
import { createSuperAdminI18n, SUPER_ADMIN_I18N_KEY } from '../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

// The real factory rather than a hand-built stand-in: the promotions tab reads
// `intlLocale` for its timeline ticks, and a partial fake would have failed
// there for a reason that has nothing to do with the disclosure.
const provide = {
    global: {
        provide: { [SUPER_ADMIN_I18N_KEY as symbol]: createSuperAdminI18n({ locale: ref('en') }) },
    },
};

function promotion(id: string, internalLabel: string): PromotionRow {
    return {
        id,
        projectKey: 'fixture',
        internalLabel,
        type: 'percent',
        value: 10,
        appliesTo: [],
        billingCycle: 'both',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        priority: 5,
        onlyLocales: null,
        requiresCoupon: false,
        codes: [],
        color: '#3f6bff',
        i18n: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

describe('a promotion row opens its editor', () => {
    // Two rows, because the editor is what the row opens rather than what the
    // list opens: with one row a test cannot tell the two apart.
    const mountTab = () => {
        const wrapper = mountWithQuasar(MarketingPromotionsTab, {
            props: {
                promotions: [promotion('p-1', 'Spring sale'), promotion('p-2', 'Launch offer')],
                plans: [],
                activeLocales: ['en'],
                projectKey: 'fixture',
                create: async () => promotion('p-3', 'New'),
                update: async () => promotion('p-1', 'Spring sale'),
                remove: async () => {},
            },
            ...provide,
        });
        mounted.push(wrapper);
        return wrapper;
    };

    test('the row is a button that says whether it is open', async () => {
        // It was a `<div>` with a click handler: reachable with a mouse and
        // with nothing else.
        const wrapper = mountTab();
        const triggers = wrapper.findAll('.sa-accordion__trigger');

        expect(triggers).toHaveLength(2);
        expect(triggers[0]!.element.tagName).toBe('BUTTON');
        expect(triggers.map((t) => t.attributes('aria-expanded'))).toEqual(['false', 'false']);
    });

    test('clicking one row opens that row, and only that one', async () => {
        const wrapper = mountTab();
        await wrapper.findAll('.sa-accordion__trigger')[1]!.trigger('click');

        const bodies = wrapper.findAll('.sa-accordion__body');
        expect(bodies).toHaveLength(1);
        expect(bodies[0]!.find('.mc-promo-editor-grid').exists()).toBe(true);
        expect(
            wrapper.findAll('.sa-accordion__trigger').map((t) => t.attributes('aria-expanded')),
        ).toEqual(['false', 'true']);
    });

    test('clicking the open row closes it again', async () => {
        const wrapper = mountTab();
        const trigger = () => wrapper.findAll('.sa-accordion__trigger')[0]!;

        await trigger().trigger('click');
        expect(wrapper.find('.sa-accordion__body').exists()).toBe(true);

        await trigger().trigger('click');
        expect(wrapper.find('.sa-accordion__body').exists()).toBe(false);
    });

    test('the timeline bar that opens the same row is a control too', async () => {
        // The row moved onto `AdminAccordion`; the bar charting it on the
        // timeline above kept opening the same editor from a `<div>` — the
        // shape the migration existed to remove, one element away from where it
        // was removed. Nothing rendered it: the visual fixture serves an empty
        // promotions list, so the timeline is behind a `v-if` no baseline sees.
        const wrapper = mountTab();
        const bars = wrapper.findAll('.mc-promo-bar');

        expect(bars).toHaveLength(2);
        expect(bars[0]!.element.tagName).toBe('BUTTON');
        expect(bars.map((b) => b.attributes('aria-expanded'))).toEqual(['false', 'false']);

        await bars[1]!.trigger('click');

        expect(wrapper.findAll('.sa-accordion__body')).toHaveLength(1);
        expect(wrapper.findAll('.mc-promo-bar').map((b) => b.attributes('aria-expanded'))).toEqual([
            'false',
            'true',
        ]);
    });
});

describe('the advanced section of the promo-code form opens', () => {
    // The fields block rather than a dialog around it: `QDialog` is not among
    // the components the mount helper registers, so a dialog would render an
    // unresolved element and every query below would find nothing.
    const form = (): PromoCodeSharedForm =>
        reactive({
            valueType: 'PERCENT',
            value: 10,
            durationType: 'ONCE',
            durationValue: null,
            maxRedemptions: null,
            validFrom: '',
            validUntil: '',
            appliesToPlans: [],
            firstTimeCustomersOnly: false,
            minimumPlanAmountGross: null,
            allowZeroInvoice: false,
            campaignTag: '',
            revenueDeductionAccount: '',
            description: '',
        });

    const mountFields = (advancedOpen = false) => {
        const wrapper = mountWithQuasar(PromoCodeDialogFields, {
            props: { mode: 'create', form: form(), code: 'SUMMER', advancedOpen },
            ...provide,
        });
        mounted.push(wrapper);
        return wrapper;
    };

    test('the toggle is a button that says whether it is open', () => {
        // It already was a `<button>`. What it never said was what it does:
        // the state lived in an icon swap and nowhere else.
        const wrapper = mountFields();
        const trigger = wrapper.find('.sa-accordion__trigger');

        expect(trigger.element.tagName).toBe('BUTTON');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('.pc-advanced').exists()).toBe(false);
    });

    test('the backend-only fields appear once it is open', () => {
        const wrapper = mountFields(true);

        expect(wrapper.find('.sa-accordion__body .pc-advanced').exists()).toBe(true);
        expect(wrapper.find('.sa-accordion__trigger').attributes('aria-expanded')).toBe('true');
    });

    test('the toggle asks its owner rather than deciding', async () => {
        // `advancedOpen` is a `defineModel`, so the dialog around this block
        // keeps the section open across a close and reopen. A component that
        // flipped its own boolean would take that away silently.
        const wrapper = mountFields();
        await wrapper.find('.sa-accordion__trigger').trigger('click');

        expect(wrapper.emitted('update:advancedOpen')).toEqual([[true]]);
    });
});

describe('the promotions tab is a reactive form, not a snapshot', () => {
    test('an edit in the open editor reaches the update handler', async () => {
        // The editor moved from a sibling `v-if` into the accordion's default
        // slot. A slot renders in the PARENT's scope, so `p` still resolves —
        // but nothing else would have said so if it did not.
        const calls: Array<[string, Record<string, unknown>]> = [];
        const wrapper = mountWithQuasar(MarketingPromotionsTab, {
            props: reactive({
                promotions: [promotion('p-1', 'Spring sale')],
                plans: [],
                activeLocales: ['en'],
                projectKey: 'fixture',
                create: async () => promotion('p-2', 'New'),
                update: async (id: string, data: Record<string, unknown>) => {
                    calls.push([id, data]);
                    return promotion('p-1', 'Spring sale');
                },
                remove: async () => {},
            }),
            ...provide,
        });
        mounted.push(wrapper);

        await wrapper.find('.sa-accordion__trigger').trigger('click');
        const label = wrapper.find('.sa-accordion__body input.mc-promo-input');
        (label.element as HTMLInputElement).value = 'Autumn sale';
        await label.trigger('change');

        expect(calls).toEqual([['p-1', { internalLabel: 'Autumn sale' }]]);
    });
});
