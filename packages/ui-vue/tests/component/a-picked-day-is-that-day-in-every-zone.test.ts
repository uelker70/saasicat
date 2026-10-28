// A day somebody picked in a date field is that day wherever the page is read:
// a pilot's end, stored by the application's pilot routes at its UTC midnight,
// and a plan version's start, from which the editor counts the days around it.
// Each runs with the browser in a zone where reading the wrong day shows: a
// UTC midnight is the evening before west of Greenwich, and a local midnight is
// the evening before in UTC east of it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import PilotsPage from '../../src/pages/PilotsPage.vue';
import PilotEditDialog from '../../src/internal/dialogs/PilotEditDialog.vue';
import PlanVersionEditor from '../../src/features/plan/PlanVersionEditor.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

/** Runs the enclosing block with the process — the browser — in `zone`. */
function inBrowserZone(zone: string, offsetMinutesInJuly: number): void {
    let before: string | undefined;
    beforeAll(() => {
        before = process.env.TZ;
        process.env.TZ = zone;
        // The block proves nothing in UTC, so it refuses to run in it.
        expect(new Date('2026-07-01T00:00:00.000Z').getTimezoneOffset()).toBe(offsetMinutesInJuly);
    });
    afterAll(() => {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
    });
}

/** What a page injects for the shell's manifest, naming `timeZone`. */
function provideManifest(timeZone: string) {
    // SAFETY: the key is the symbol the page injects its manifest under, typed
    // as Vue's injection key rather than as a symbol.
    return { [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => ({ capabilities: {}, timeZone }) };
}

const NEW_YORK = 'America/New_York';

/** A pilot whose end was picked as 31 January 2027 and stored at its UTC midnight. */
const PILOT = {
    id: 'pilot-1',
    tenant: { id: 'tenant-1', slug: 'demo-club', name: 'Demo Club' },
    plan: 'PRO',
    pilotEndsAt: '2027-01-31T00:00:00.000Z',
    pilotNote: null,
    grantedBy: 'admin@example.com',
};

// @requirement SC-ADM-048 — Every day the administration shows is a day of the installation
describe('a pilot’s end, read west of Greenwich', () => {
    inBrowserZone(NEW_YORK, 240);

    test('is the day picked in the pilots list', async () => {
        const wrapper = mountWithQuasar(PilotsPage, {
            global: {
                provide: {
                    ...provideStubResources({
                        pilots: { list: async () => [PILOT], reviewSoon: async () => [] },
                        plans: { list: async () => [] },
                    }),
                    ...provideManifest(NEW_YORK),
                },
            },
        });
        mounted.push(wrapper);
        for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('Jan 31, 2027');
        expect(wrapper.text()).not.toContain('Jan 30, 2027');
    });

    test('is the day the edit dialog opens on', async () => {
        const wrapper = mountWithQuasar(PilotEditDialog, {
            attachTo: document.body,
            props: { modelValue: false, row: PILOT, planOptions: [], submit: async () => {} },
            global: { provide: provideManifest(NEW_YORK) },
        });
        mounted.push(wrapper);
        // The dialog fills its form when it opens, as the page opens it.
        await wrapper.setProps({ modelValue: true });
        await wrapper.vm.$nextTick();

        const field = document.body.querySelector<HTMLInputElement>('input[type="date"]');
        expect(field?.value).toBe('2027-01-31');
    });
});

/** The editor for a successor of a version valid from 1 July 2026. */
async function mountEditor(validFrom: string | null) {
    const wrapper = mountWithQuasar(PlanVersionEditor, {
        props: {
            planKey: 'PRO',
            editingId: null,
            initialForm: {
                version: 2,
                features: [],
                quotas: {},
                monthlyNet: '10.00',
                yearlyNet: '100.00',
                changeNote: '',
                marketed: true,
                validFrom,
                validUntil: null,
            },
            saving: false,
            availableFeatures: [],
            availableQuotas: [],
            availableBundles: [],
            predecessorVersion: {
                version: 1,
                features: [],
                quotas: {},
                monthlyNet: '10.00',
                yearlyNet: '100.00',
                validFrom: '2026-07-01T00:00:00.000Z',
            },
        },
        global: { provide: provideManifest('Europe/Berlin') },
    });
    mounted.push(wrapper);
    await wrapper.vm.$nextTick();
    return wrapper;
}

// @requirement SC-ADM-048 — Every day the administration shows is a day of the installation
describe('a plan version’s days, counted east of Greenwich', () => {
    inBrowserZone('Europe/Berlin', -120);

    test('a successor starts the day after its predecessor at the earliest', async () => {
        const wrapper = await mountEditor(null);

        const start = wrapper.find<HTMLInputElement>('input[type="date"]');
        expect(start.attributes('min')).toBe('2026-07-02');
        expect(start.element.value).toBe('2026-07-02');
    });

    test('the predecessor ends the day before, also when the clocks go back between', async () => {
        // 25 October 2026 is the night the clocks go back in Berlin.
        const wrapper = await mountEditor('2026-10-26');

        expect(wrapper.find('code.pve-mono').text()).toBe('2026-10-25');
    });
});
