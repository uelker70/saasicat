// The maintenance page answers the operator's question before a deploy — have
// the tenants been told, and are they out? — and the shell keeps answering the
// second half on every page while the lock holds.
//
// These mount the page and the layout against a stubbed registry and read what
// each shows for the states a window can be in: none, announced, lapsed,
// locked, and locked past its announced end.

import { afterEach, describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import MaintenanceWindowDialog from '../../src/internal/maintenance/MaintenanceWindowDialog.vue';
import AdminLayout from '../../src/layouts/AdminLayout.vue';
import MaintenancePage from '../../src/pages/MaintenancePage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_CONFIRM_KEY } from '../../src/vue/ui-confirm.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { provideStubResources } from './support/stub-resources.js';

const WINDOW = {
    id: 'w-1',
    status: 'announced',
    startsAt: '2026-10-02T20:00:00.000Z',
    endsAt: '2026-10-02T21:00:00.000Z',
    message: 'Upgrade to 2.3',
    createdAt: '2026-10-01T09:00:00.000Z',
    createdBy: 'web:ops@example.com:s1',
    lockedAt: null,
    lockedBy: null,
    endedAt: null,
    endedBy: null,
    overrun: false,
    lapsed: false,
};
const LOCKED = {
    ...WINDOW,
    status: 'locked',
    lockedAt: '2026-10-02T20:03:00.000Z',
    lockedBy: 'cli:ops@example.com:deploy',
};
const overviewOf = (open: unknown) => ({
    open,
    recent: open ? [open] : [],
    takesEffectWithinSeconds: 5,
});

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle() {
    for (let i = 0; i < 3; i += 1) await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

function mountPage(open: unknown, ops: Record<string, (...args: never[]) => unknown> = {}) {
    const questions: string[] = [];
    const wrapper = mountWithQuasar(MaintenancePage as never, {
        global: {
            provide: {
                ...provideStubResources({
                    maintenance: { overview: async () => overviewOf(open), ...ops },
                } as never),
                [SUPER_ADMIN_NOTIFY_KEY as symbol]: () => {},
                [SUPER_ADMIN_CONFIRM_KEY as symbol]: async (request: { title: string }) => {
                    questions.push(request.title);
                    return { ok: true };
                },
            },
        },
    });
    mounted.push(wrapper);
    return { wrapper, questions };
}

const buttonLabels = (wrapper: { findAll: (s: string) => { text: () => string }[] }) =>
    wrapper.findAll('button').map((b) => b.text());

// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
describe('MaintenancePage', () => {
    test('with nothing open, it offers to announce a window or to lock at once', async () => {
        const { wrapper } = mountPage(null);
        await settle();
        expect(wrapper.text()).toMatch(/No maintenance window is open|Kein Wartungsfenster offen/);
        expect(buttonLabels(wrapper).join(' ')).toMatch(/Announce|ankündigen/);
        expect(buttonLabels(wrapper).join(' ')).toMatch(/Lock now|Jetzt sperren/);
    });

    test('an announced window shows what tenants were told, and can be locked, moved or cancelled', async () => {
        const { wrapper } = mountPage(WINDOW);
        await settle();
        expect(wrapper.text()).toContain('Upgrade to 2.3');
        expect(wrapper.text()).toContain('web:ops@example.com:s1');
        const labels = buttonLabels(wrapper).join(' ');
        expect(labels).toMatch(/Lock|Sperren/);
        expect(labels).toMatch(/Move|Verschieben/);
        expect(labels).toMatch(/Cancel|Streichen/);
        expect(labels).not.toMatch(/Unlock|Entsperren/);
    });

    test('an announcement whose end passed without a lock is flagged for cancelling', async () => {
        const { wrapper } = mountPage({ ...WINDOW, lapsed: true });
        await settle();
        expect(wrapper.text()).toMatch(/without a lock|ohne dass gesperrt wurde/);
    });

    // @requirement SC-OPS-014 — The lock begins and ends when somebody says so, not when the clock does
    test('a locked window says since when, offers to unlock, and says so louder past its end', async () => {
        const { wrapper } = mountPage(LOCKED);
        await settle();
        expect(wrapper.text()).toMatch(/locked out since|ausgesperrt seit/);
        expect(buttonLabels(wrapper).join(' ')).toMatch(/Unlock|Entsperren/);
        expect(wrapper.text()).not.toMatch(/has passed|ist vorbei/);

        const late = mountPage({ ...LOCKED, overrun: true }).wrapper;
        await settle();
        expect(late.text()).toMatch(/has passed|ist vorbei/);
    });

    // @requirement SC-UI-020 — A page never takes the whole screen down because data arrived in an unexpected shape
    test('a resource of the application’s own that answers another shape does not take the page down', async () => {
        for (const odd of [
            { open: null, recent: 'not a list', takesEffectWithinSeconds: 5 },
            { open: null },
        ]) {
            const wrapper = mountWithQuasar(MaintenancePage as never, {
                global: {
                    provide: {
                        ...provideStubResources({
                            maintenance: { overview: async () => odd },
                        } as never),
                        [SUPER_ADMIN_NOTIFY_KEY as symbol]: () => {},
                    },
                },
            });
            mounted.push(wrapper);
            await settle();
            expect(wrapper.text()).toMatch(/Maintenance|Wartung/);
            expect(wrapper.text()).toMatch(/No maintenance window|Kein Wartungsfenster/);
        }
    });

    test('cancelling asks first, then cancels the window it is shown', async () => {
        const cancelled: string[] = [];
        const { wrapper, questions } = mountPage(WINDOW, {
            cancel: (async (id: string) => {
                cancelled.push(id);
                return { ...WINDOW, status: 'cancelled' };
            }) as never,
        });
        await settle();
        const cancel = wrapper
            .findAll('button')
            // The icon's ligature is part of the text, so the label is matched at the end.
            .find((b) => /(Cancel|Streichen)$/.test(b.text().trim()));
        expect(cancel, 'a cancel button').toBeDefined();
        await cancel!.trigger('click');
        await settle();
        expect(questions).toHaveLength(1);
        expect(cancelled).toEqual(['w-1']);
    });
});

// @requirement SC-ADM-030 — While tenants are locked out, every page of the administration says so
describe('the lock strip in the administration’s shell', () => {
    function mountLayout(open: unknown, capability = true) {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: { template: '<div />' } },
                { path: '/admin/maintenance', component: { template: '<div />' } },
            ],
        });
        const wrapper = mountWithQuasar(AdminLayout, {
            props: {
                manifest: {
                    capabilities: capability ? { 'maintenance.manage': true } : {},
                    navigation: { standardPages: {} },
                },
            } as never,
            global: {
                plugins: [router],
                provide: provideStubResources({
                    maintenance: { overview: async () => overviewOf(open) },
                } as never),
            },
        });
        mounted.push(wrapper);
        return wrapper;
    }

    test('while tenants are locked out, the shell says so, with a way to the page', async () => {
        const wrapper = mountLayout(LOCKED);
        await settle();
        expect(wrapper.text()).toMatch(
            /tenants are locked out since|Mandanten sind ausgesperrt seit/,
        );
        expect(wrapper.find('a[href="/admin/maintenance"]').exists()).toBe(true);
    });

    test('past the announced end it asks the operator to unlock', async () => {
        const wrapper = mountLayout({ ...LOCKED, overrun: true });
        await settle();
        expect(wrapper.text()).toMatch(/Remember to unlock|Entsperren nicht vergessen/);
    });

    test('an announced window, or nothing, shows no strip', async () => {
        for (const open of [WINDOW, null]) {
            const wrapper = mountLayout(open);
            await settle();
            expect(wrapper.text()).not.toMatch(/locked out since|ausgesperrt seit/);
        }
    });

    // @requirement SC-ADM-015 — The administration only offers what the application actually has
    test('an installation that keeps no windows is not asked about them', async () => {
        const wrapper = mountLayout(LOCKED, false);
        await settle();
        expect(wrapper.text()).not.toMatch(/locked out since|ausgesperrt seit/);
    });
});

// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
describe('moving a window in the dialog', () => {
    test('saving only a new message sends only the message, however precise the window’s times', async () => {
        const sent: unknown[] = [];
        // Announced from the command line, to the second.
        const window = {
            ...WINDOW,
            startsAt: '2026-10-02T20:00:30.000Z',
            endsAt: '2026-10-02T21:00:45.000Z',
        };
        const wrapper = mountWithQuasar(MaintenanceWindowDialog as never, {
            attachTo: document.body,
            props: {
                modelValue: true,
                window,
                announce: async () => {},
                reschedule: async (id: string, input: unknown) => {
                    sent.push([id, input]);
                },
            },
        });
        mounted.push(wrapper);
        await settle();
        const message = document.querySelector('textarea') as HTMLTextAreaElement;
        message.value = 'Upgrade to 2.4';
        message.dispatchEvent(new Event('input'));
        await settle();
        const save = [...document.querySelectorAll('button')].find((b) =>
            /(Save|Speichern)$/.test(b.textContent?.trim() ?? ''),
        );
        expect(save, 'a save button').toBeDefined();
        save!.click();
        await settle();
        expect(sent).toEqual([['w-1', { message: 'Upgrade to 2.4' }]]);
    });
});
