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
import type { PlanVersionRow, PromotionRow } from '@saasicat/core';

import MarketingCatalogAdmin from '../../src/internal/marketing-catalog-page/MarketingCatalogAdmin.vue';
import type { MarketingRow } from '../../src/internal/marketing-catalog-page/types.js';
import MarketingPromotionsTab from '../../src/features/marketing/MarketingPromotionsTab.vue';
import PromoCodeDialogFields, {
    type PromoCodeSharedForm,
} from '../../src/internal/dialogs/PromoCodeDialogFields.vue';
import { createSuperAdminI18n, SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

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
        // The first field in the open editor is the internal label. It is a
        // `q-input` now, so the native element sits inside it and the event
        // that carries a value is `input` rather than `change`.
        const label = wrapper.find('.sa-accordion__body .q-field input');
        (label.element as HTMLInputElement).value = 'Autumn sale';
        await label.trigger('input');

        expect(calls).toEqual([['p-1', { internalLabel: 'Autumn sale' }]]);
    });
});

describe('a marketing row opens its editor from anywhere but its fields', () => {
    // The row is not an `AdminAccordion` and cannot be one — the reason is
    // written above `CONTROL_SELECTOR` in the component. What it borrows is the
    // gesture: the whole row opens the editor, as the accordion header does.
    //
    // Nothing else can assert this. The visual baseline records computed
    // styles, so it sees the row's cursor but never a click, and the row's
    // cells are the one place in the package where "clickable" and "leave this
    // alone" sit inside the same element.
    const plan = {
        id: 'plan-1',
        projectKey: 'fixture',
        planKey: 'PRO',
        label: 'Pro',
        description: null,
        icon: null,
        sortOrder: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
    };

    // Only its presence is read here: it is what makes the row openable.
    const liveVersion = { id: 'ver-1', planId: 'plan-1', version: 1 } as PlanVersionRow;

    const row = {
        plan,
        accent: '#3f6bff',
        liveVersion,
        publishedVersions: [liveVersion],
        projection: null,
        m: {
            displayLabel: 'Pro',
            visible: true,
            highlight: false,
            badge: '',
            priority: 10,
            description: '',
            trialEnabled: false,
            trialDays: 14,
            ctaLabel: null,
            topFeatures: [],
            priceTag: null,
        },
    } as MarketingRow;

    const secondRow = { ...row, plan: { ...plan, id: 'plan-2', planKey: 'BASIC', label: 'Basic' } };

    const mountAdmin = ({
        rows = [row],
        ...options
    }: { attachTo?: HTMLElement; rows?: MarketingRow[] } = {}) => {
        const wrapper = mountWithQuasar(MarketingCatalogAdmin, {
            ...options,
            props: {
                adminRows: rows,
                busy: false,
                expandedKey: null,
                activeLocale: 'en',
                defaultLocale: 'en',
                editFeatures: [],
                formatVersionTitle: () => 'v1',
                formatVersionTab: () => 'v1',
                autoCtaText: () => 'Start now',
                ctaValue: (raw: string) => raw || null,
                resolveComponentLabel: (key: string) => key,
                suggestionsFor: () => [],
            },
            ...provide,
        });
        mounted.push(wrapper);
        return wrapper;
    };

    test('the plan cell is the keyboard path, and says what it controls', () => {
        const trigger = mountAdmin().find('.sa-marketing-plan-cell');

        expect(trigger.element.tagName).toBe('BUTTON');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        expect(trigger.attributes('aria-controls')).toBeTruthy();
    });

    test('a click on a cell that holds no control opens the row', async () => {
        const wrapper = mountAdmin();
        const cells = wrapper.findAll('.sa-marketing-admin-row > div');

        await cells[cells.length - 1]!.trigger('click');

        expect(wrapper.emitted('toggle-expand')).toHaveLength(1);
    });

    test('a click on a field in the row does not', async () => {
        const wrapper = mountAdmin();

        await wrapper.find('.sa-marketing-field--badge input').trigger('click');
        await wrapper.find('.q-toggle').trigger('click');

        expect(wrapper.emitted('toggle-expand')).toBeUndefined();
    });

    test('the handle moves the row with the arrow keys', async () => {
        // WCAG 2.2 SC 2.5.7: the drag needs a path that is not a drag. Two
        // rows, because "moved" is only observable against a neighbour.
        const wrapper = mountAdmin({ rows: [row, secondRow] });
        const handles = wrapper.findAll('.sa-marketing-grip');

        expect(handles).toHaveLength(2);
        await handles[1]!.trigger('keydown', { key: 'ArrowUp' });

        expect(wrapper.emitted('reorder')).toEqual([[1, 0]]);
    });

    test('the arrow keys stop at the ends of the list', async () => {
        const wrapper = mountAdmin({ rows: [row, secondRow] });
        const handles = wrapper.findAll('.sa-marketing-grip');

        await handles[0]!.trigger('keydown', { key: 'ArrowUp' });
        await handles[1]!.trigger('keydown', { key: 'ArrowDown' });

        expect(wrapper.emitted('reorder')).toBeUndefined();
    });

    /**
     * A drag, as the DOM delivers one.
     *
     * `trigger` cannot carry `clientY`: it assigns onto a `MouseEvent`, whose
     * coordinates are getters. And jsdom lays nothing out — every rectangle is
     * zero — so the handles are given the geometry a browser would have
     * measured. Without it the drop position is decided by a tie between empty
     * rects, which proves nothing about the arithmetic that reads them.
     */
    function drag(wrapper: ReturnType<typeof mountAdmin>, fromIndex: number, toY: number): void {
        const handles = wrapper.findAll('.sa-marketing-grip');
        handles.forEach((handle, index) => {
            const top = index * 60;
            handle.element.getBoundingClientRect = () =>
                ({ top, height: 40, bottom: top + 40 }) as DOMRect;
        });

        handles[fromIndex]!.element.dispatchEvent(
            Object.assign(new Event('pointerdown', { bubbles: true }), {
                button: 0,
                pointerId: 1,
                clientY: fromIndex * 60 + 10,
            }),
        );
        document.dispatchEvent(Object.assign(new Event('pointermove'), { clientY: toY }));
        document.dispatchEvent(new Event('pointerup'));
    }

    test('a drag from the first row to the second reports that move', () => {
        const wrapper = mountAdmin({ rows: [row, secondRow] });

        drag(wrapper, 0, 75);

        expect(wrapper.emitted('reorder')).toEqual([[0, 1]]);
    });

    test('a drag released where it started reports nothing', () => {
        const wrapper = mountAdmin({ rows: [row, secondRow] });

        drag(wrapper, 0, 12);

        expect(wrapper.emitted('reorder')).toBeUndefined();
    });

    test('a row without a live version has no handle', () => {
        // It cannot hold a projection, so there is no priority to write — a
        // handle that looked draggable would promise a move nothing performs.
        const wrapper = mountAdmin({ rows: [{ ...row, liveVersion: null }] });

        expect(wrapper.find('.sa-marketing-grip').exists()).toBe(false);
    });

    test('a focusable ancestor does not silence the row', async () => {
        // The counter-proof for walking by hand instead of with `closest`:
        // `closest` climbs out of the row, so one `tabindex` anywhere above it —
        // a dialog, a focus container, a consumer's layout — used to make every
        // click in the row look like a click on a control. Mounted inside one.
        const host = document.createElement('div');
        host.setAttribute('tabindex', '-1');
        document.body.appendChild(host);
        const wrapper = mountAdmin({ attachTo: host });

        const cells = wrapper.findAll('.sa-marketing-admin-row > div');
        await cells[cells.length - 1]!.trigger('click');

        expect(wrapper.emitted('toggle-expand')).toHaveLength(1);
    });

    test('the plan cell opens the row exactly once', async () => {
        // It is a control inside the clickable row: the row's handler has to
        // let the button's own handler have it, or the row opens and closes in
        // the same click.
        const wrapper = mountAdmin();

        await wrapper.find('.sa-marketing-plan-cell').trigger('click');

        expect(wrapper.emitted('toggle-expand')).toHaveLength(1);
    });
});
