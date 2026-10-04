// The plan cockpit offers to retire a version no longer on sale, and the dialog
// shows what the announcement will do before it is made: the replacement and
// its price, the dates the subscriptions move on, whom it misses, and what
// refuses it.
//
// Mounted the way the page mounts it — the flow built in a component's setup
// and handed to the plan detail — against stubbed resources: the test says
// what the server answers and reads what the operator is shown.

// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import PlanDetail from '../../src/features/plan/PlanDetail.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { useVersionRetirement } from '../../src/vue/use-version-retirement.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (offsetDays: number): string => new Date(NOW + offsetDays * DAY).toISOString();

const PLAN = {
    id: 'plan-standard',
    planKey: 'STANDARD',
    label: 'Standard',
    description: null,
    icon: null,
    sortOrder: 0,
    createdAt: iso(-400),
    updatedAt: iso(-400),
    deletedAt: null,
};

const version = (fields: Record<string, unknown>) => ({
    planId: 'STANDARD',
    features: [],
    quotas: {},
    monthlyNet: '49.00',
    yearlyNet: '490.00',
    publishedAt: iso(-400),
    supersededAt: null,
    validFrom: iso(-400),
    validUntil: null,
    endsAt: null,
    changeNote: null,
    ...fields,
});

const OFF_SALE = version({ id: 'pv-1', version: 1, validUntil: iso(-31), supersededAt: iso(-60) });
const ON_SALE = version({ id: 'pv-2', version: 2, validFrom: iso(-30), monthlyNet: '59.00' });

const side = (planVersionId: string, versionNumber: number, monthlyNet: number) => ({
    planKey: 'STANDARD',
    planVersionId,
    version: versionNumber,
    features: [],
    quotas: {},
    monthlyNet,
    yearlyNet: 490,
    validUntil: null,
    endsAt: null,
});

const reached = (subscriptionId: string) => ({
    tenantId: 't',
    subscriptionId,
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    effectiveAt: '2027-02-01T00:00:00.000Z',
    lastDayToCancel: '2027-01-31',
    reachedRecently: false,
});

const PREVIEW = {
    retired: side('pv-1', 1, 49),
    replacement: side('pv-2', 2, 59),
    changes: [
        { field: 'monthlyNet', oldValue: '49.00', newValue: '59.00', direction: 'REGRESSION' },
    ],
    asOf: iso(0),
    reached: [reached('s-1'), reached('s-2')],
    skipped: [{ tenantId: 't', subscriptionId: 's-3', reason: 'ended' }],
    blockers: [] as Array<{ code: string; message: string; params: Record<string, unknown> }>,
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function mountCockpit({
    capability = true,
    preview = PREVIEW,
    list = async (): Promise<unknown[]> => [],
} = {}) {
    const announced: unknown[][] = [];
    const Host = defineComponent({
        setup() {
            const retirement = useVersionRetirement({
                plan: ref(PLAN),
                manifest: ref({
                    capabilities: capability ? { 'planVersions.retire': true } : {},
                } as never),
                plans: { list: async () => [PLAN] as never },
                versions: { listForPlan: async () => [OFF_SALE, ON_SALE] as never },
                retirements: {
                    list: async () => (await list()) as never,
                    preview: async () => preview as never,
                    announce: async (...args: unknown[]) => {
                        announced.push(args);
                        return { retirement: { id: 'r-1' }, told: 2, failed: 0 } as never;
                    },
                },
                mfa: { run: async (_d, _i, action) => ({ done: true, value: await action('1') }) },
            });
            return () =>
                h(PlanDetail, {
                    plan: PLAN as never,
                    versions: [OFF_SALE, ON_SALE] as never,
                    retirement,
                });
        },
    });
    const wrapper = mountWithQuasar(Host as never);
    mounted.push(wrapper);
    return { wrapper, announced };
}

type Wrapper = ReturnType<typeof mountCockpit>['wrapper'];

const retireButtons = (wrapper: Wrapper) =>
    wrapper.findAll('button').filter((button) => button.text() === 'Retire…');

function dialogButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === label,
    );
    expect(button, `no "${label}" button in the dialog`).toBeTruthy();
    return button as HTMLButtonElement;
}

describe('retiring a version in the plan cockpit', () => {
    // @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
    test('is offered on the version no longer on sale, and on no other', () => {
        const { wrapper } = mountCockpit();

        expect(retireButtons(wrapper)).toHaveLength(1);
    });

    test('says on a version that it was retired, and for which replacement', async () => {
        const { wrapper } = mountCockpit({
            list: async () => [
                {
                    id: 'r-1',
                    retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                    replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
                    announcedAt: '2026-10-02T09:00:00.000Z',
                    announcedBy: 'web:operator@example.com:admin',
                    progress: {
                        moved: 0,
                        waiting: 2,
                        overdue: 0,
                        ended: 0,
                        notTold: 0,
                        reminded: 0,
                    },
                },
            ],
        });
        await settle();

        expect(wrapper.text()).toContain('Retired → STANDARD v2');
    });

    // @requirement SC-SUB-033 — The operator sees how far each retirement has come
    test('says how far the retirement has come, and marks a move overdue', async () => {
        const { wrapper } = mountCockpit({
            list: async () => [
                {
                    id: 'r-1',
                    retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                    replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
                    announcedAt: '2026-10-02T09:00:00.000Z',
                    announcedBy: 'web:operator@example.com:admin',
                    progress: {
                        moved: 3,
                        waiting: 1,
                        overdue: 1,
                        ended: 0,
                        notTold: 0,
                        reminded: 0,
                    },
                },
            ],
        });
        await settle();

        const parts = wrapper.findAll('.sa-retirement-progress');
        expect(parts.map((part) => part.text())).toEqual([
            '1 overdue',
            '1 waiting for their date',
            '3 moved',
        ]);
        expect(parts[0]!.classes()).toContain('sa-retirement-progress--attention');
        expect(parts[1]!.classes()).not.toContain('sa-retirement-progress--attention');
    });

    // @requirement SC-SUB-038 — A retirement waits for its notice to arrive, and a year after the last one told
    test('marks the subscriptions not told yet for a look', async () => {
        const { wrapper } = mountCockpit({
            list: async () => [
                {
                    id: 'r-1',
                    retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                    replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
                    announcedAt: '2026-10-02T09:00:00.000Z',
                    announcedBy: 'web:operator@example.com:admin',
                    progress: {
                        moved: 0,
                        waiting: 1,
                        overdue: 0,
                        ended: 0,
                        notTold: 2,
                        reminded: 0,
                    },
                },
            ],
        });
        await settle();

        const parts = wrapper.findAll('.sa-retirement-progress');
        expect(parts.map((part) => part.text())).toEqual([
            '2 not told',
            '1 waiting for their date',
        ]);
        expect(parts[0]!.classes()).toContain('sa-retirement-progress--attention');
        expect(parts[1]!.classes()).not.toContain('sa-retirement-progress--attention');
    });

    // @requirement SC-SUB-039 — The operator sees why a retirement's notice still waits
    test('says beside them why they wait, quieter than the count', async () => {
        const { wrapper } = mountCockpit({
            list: async () => [
                {
                    id: 'r-1',
                    retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                    replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
                    announcedAt: '2026-10-02T09:00:00.000Z',
                    announcedBy: 'web:operator@example.com:admin',
                    progress: {
                        moved: 0,
                        waiting: 0,
                        overdue: 0,
                        ended: 0,
                        notTold: 3,
                        notToldReasons: {
                            doesNotFit: 1,
                            twelveMonths: 0,
                            noLongerReached: 0,
                            nobodyYet: 2,
                        },
                        reminded: 0,
                    },
                },
            ],
        });
        await settle();

        const parts = wrapper.findAll('.sa-retirement-progress');
        expect(parts.map((part) => part.text())).toEqual([
            '3 not told',
            'of which 1: the replacement does not fit',
            'of which 2: nobody reached yet',
        ]);
        expect(parts[1]!.classes()).toContain('sa-retirement-progress--reason');
        expect(parts[1]!.classes()).not.toContain('sa-retirement-progress--attention');
    });

    // @requirement SC-SUB-034 — Where staying put costs something, a subscription is reminded once
    test('counts the subscriptions reminded beside the states, unmarked', async () => {
        const { wrapper } = mountCockpit({
            list: async () => [
                {
                    id: 'r-1',
                    retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                    replacement: { planVersionId: 'pv-2', planKey: 'STANDARD', version: 2 },
                    announcedAt: '2026-10-02T09:00:00.000Z',
                    announcedBy: 'web:operator@example.com:admin',
                    progress: {
                        moved: 0,
                        waiting: 2,
                        overdue: 0,
                        ended: 0,
                        notTold: 0,
                        reminded: 2,
                    },
                },
            ],
        });
        await settle();

        const parts = wrapper.findAll('.sa-retirement-progress');
        expect(parts.map((part) => part.text())).toEqual([
            '2 waiting for their date',
            '2 reminded',
        ]);
        expect(parts[1]!.classes()).not.toContain('sa-retirement-progress--attention');
    });

    test('says so where the announcements could not be read', async () => {
        const { wrapper } = mountCockpit({
            list: async () => {
                throw new Error('database down');
            },
        });
        await settle();

        expect(wrapper.text()).toContain('The retirements could not be read');
    });

    test('is not offered where the platform does not serve it', () => {
        const { wrapper } = mountCockpit({ capability: false });

        expect(retireButtons(wrapper)).toHaveLength(0);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('shows the replacement, its price, the dates and whom it misses before anything is sent', async () => {
        const { wrapper, announced } = mountCockpit();

        await retireButtons(wrapper)[0].trigger('click');
        await settle();

        const text = document.body.textContent ?? '';
        expect(text).toContain('Replacement: STANDARD v2');
        expect(text).toMatch(/Monthly\s*€49 → €59/);
        expect(text).toContain('Reaches 2 subscriptions');
        expect(text).toContain('2 move on 02/01/2027 — may cancel without notice until 01/31/2027');
        expect(text).toContain('1 ended');
        expect(announced).toEqual([]);
    });

    test('a blocker is said in words, and nothing can be announced', async () => {
        const { wrapper } = mountCockpit({
            preview: {
                ...PREVIEW,
                blockers: [
                    { code: 'RETIREMENT_WITHIN_TWELVE_MONTHS', message: 'x', params: { count: 1 } },
                ],
            },
        });

        await retireButtons(wrapper)[0].trigger('click');
        await settle();

        expect(document.body.textContent).toContain(
            '1 of these subscriptions were reached by a retirement within the last twelve months',
        );
        expect(dialogButton('Announce').disabled).toBe(true);
    });

    test('announcing names the subscriptions shown, and says what was sent', async () => {
        const { wrapper, announced } = mountCockpit();
        await retireButtons(wrapper)[0].trigger('click');
        await settle();

        dialogButton('Announce').click();
        await settle();

        expect(announced).toEqual([
            ['pv-1', { replacementPlanVersionId: 'pv-2', subscriptionIds: ['s-1', 's-2'] }, '1'],
        ]);
        expect(document.body.textContent).toContain('Announced. 2 subscriptions told');
    });
});
