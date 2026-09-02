// The settings page answers the operator's question: has my edit landed?
//
// The timestamp is the requirement, not decoration. Somebody who edited
// config/saas.yaml an hour ago reads "applied at …, from …" and knows. These
// mount the page against a stubbed registry and read what it shows for the
// states the endpoint can be in: recorded and current, recorded but stale, not
// recorded at all — and a change an operator can mark as seen.

// @requirement SC-CFG-008 — An operator can see when the running configuration was applied, and from where
// @requirement SC-CFG-031 — A recorded change survives until an operator acknowledges it

import { afterEach, describe, expect, test } from 'vitest';
import { nextTick } from 'vue';

import SettingsPage from '../../src/pages/SettingsPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { provideStubResources } from './support/stub-resources.js';

const VIEW = {
    source: '/srv/app/config/saas.yaml',
    fingerprint: 'sha256-abc',
    settings: {
        currency: 'EUR',
        vatRate: 19,
        tenantBilling: {
            cancellationNoticeDays: { monthly: 14, yearly: 90 },
            selfServiceBlockedPlans: { asTarget: ['ENTERPRISE'], asSource: [] },
        },
    },
    recorded: true,
    appliedAt: '2026-08-22T12:03:00.000Z',
    changes: [
        {
            id: 'c-1',
            noticedAt: '2026-08-22T12:03:00.000Z',
            source: '/srv/app/config/saas.yaml',
            differences: [
                { path: 'tenantBilling.cancellationNoticeDays.monthly', before: 0, after: 14 },
            ],
            acknowledgedAt: null,
            acknowledgedBy: null,
        },
    ],
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle() {
    for (let i = 0; i < 3; i += 1) await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

function mountPage(
    view: unknown,
    acknowledge: (id: string) => Promise<unknown> = async (id) => ({ ...VIEW.changes[0], id }),
) {
    const notifications: string[] = [];
    const wrapper = mountWithQuasar(SettingsPage as never, {
        global: {
            provide: {
                ...provideStubResources({
                    settings: { read: async () => view, acknowledgeChange: acknowledge },
                } as never),
                [SUPER_ADMIN_NOTIFY_KEY as symbol]: (kind: string, message: string) => {
                    notifications.push(`${kind}: ${message}`);
                },
            },
        },
    });
    mounted.push(wrapper);
    return { wrapper, notifications };
}

describe('SettingsPage', () => {
    test('says when the running configuration was applied, and from where', async () => {
        const { wrapper } = mountPage(VIEW);
        await settle();
        const text = wrapper.text();
        expect(text).toContain('/srv/app/config/saas.yaml');
        expect(text).toContain('sha256-abc');
        // The moment, formatted for the locale — the year is the part every
        // format carries.
        expect(text).toMatch(/2026/);
        // And the running values, leaf by leaf, as the file spells them.
        expect(text).toContain('tenantBilling.cancellationNoticeDays.monthly');
        expect(text).toContain('["ENTERPRISE"]');
    });

    test('a change is shown with what moved, and can be marked as seen', async () => {
        const seen: string[] = [];
        const { wrapper } = mountPage(VIEW, async (id: string) => {
            seen.push(id);
            return {
                ...VIEW.changes[0],
                acknowledgedAt: '2026-08-23T08:00:00.000Z',
                acknowledgedBy: 'web:ops@example.com:s-1',
            };
        });
        await settle();
        expect(wrapper.text()).toContain('0');
        expect(wrapper.text()).toContain('14');
        const button = wrapper.findAll('button').find((b) => /seen|gesehen/i.test(b.text()));
        expect(button, 'an acknowledge button').toBeDefined();
        await button!.trigger('click');
        await settle();
        expect(seen).toEqual(['c-1']);
        // The record, as the server answered it: who saw it, in place.
        expect(wrapper.text()).toContain('web:ops@example.com:s-1');
        expect(
            wrapper.findAll('button').some((b) => /mark as seen|als gesehen/i.test(b.text())),
        ).toBe(false);
    });

    test('an installation that keeps no record is told so, and still sees its running values', async () => {
        const { wrapper } = mountPage({ ...VIEW, recorded: false, appliedAt: null, changes: [] });
        await settle();
        expect(wrapper.text()).toMatch(/does not record|zeichnet nicht auf/);
        expect(wrapper.text()).toContain('EUR');
    });

    test('a record that describes an earlier configuration is named as stale', async () => {
        const { wrapper } = mountPage({ ...VIEW, appliedAt: null });
        await settle();
        expect(wrapper.text()).toMatch(/earlier configuration|frühere Konfiguration/);
    });

    test('a failed acknowledgement is reported through the notify port, and the change stays open', async () => {
        const { wrapper, notifications } = mountPage(VIEW, async () => {
            throw new Error('503');
        });
        await settle();
        const button = wrapper.findAll('button').find((b) => /seen|gesehen/i.test(b.text()));
        await button!.trigger('click');
        await settle();
        expect(notifications.some((n) => n.startsWith('negative:'))).toBe(true);
        expect(wrapper.findAll('button').some((b) => /seen|gesehen/i.test(b.text()))).toBe(true);
    });
});
