// A tenant is told of maintenance before it begins, sees one page while it
// holds, and carries on afterwards on the screen it was on.
//
// The gate wraps the application; the application is a stand-in that counts
// how often it was mounted, so "carries on where it was" is something a test
// can see. The status comes from a scripted HTTP client, and the refusal an
// application's own request met from `reportMaintenanceRefusal`.

// @requirement SC-UI-026 — A tenant locked out for maintenance sees one page that says so, and carries on afterwards
// @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins

import { afterEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import {
    MAINTENANCE_LOCKED_POLL_MS,
    reportMaintenanceRefusal,
    type HttpClient,
} from '@saasicat/ui-vue';

import MaintenanceGate from '../../src/MaintenanceGate.vue';
import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

const i18n = defaultTenantPlanSectionI18n('en');

const ANNOUNCED = {
    state: 'announced',
    startsAt: '2026-10-02T20:00:00.000Z',
    endsAt: '2026-10-02T21:00:00.000Z',
    message: 'Upgrade to 2.3',
};
const LOCKED = {
    state: 'locked',
    lockedAt: '2026-10-02T20:03:00.000Z',
    endsAt: '2026-10-02T21:00:00.000Z',
    message: 'Upgrade to 2.3',
    overrun: false,
};

/** Answers the status route with whatever `current` says at the time. */
function statusHttp(initial: [number, unknown]) {
    let current = initial;
    const asked: string[] = [];
    const http: HttpClient = async (url) => {
        asked.push(url);
        const [status, body] = current;
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { http, asked, answer: (next: [number, unknown]) => (current = next) };
}

let mounts = 0;
const TheApplication = defineComponent({
    setup() {
        mounts += 1;
        return () => h('div', { class: 'the-application' }, 'the application');
    },
});

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.useRealTimers();
    mounts = 0;
});

async function mountGate(http: HttpClient, apiBase = '/api') {
    const wrapper = mount(MaintenanceGate, {
        props: { http, apiBase },
        slots: { default: () => h(TheApplication) },
        attachTo: document.body,
    });
    mounted.push(wrapper as VueWrapper);
    await flushPromises();
    return wrapper;
}

const showsTheApplication = (wrapper: VueWrapper) => wrapper.find('.the-application').exists();

describe('the maintenance gate', () => {
    test('with nothing announced, the application and nothing else', async () => {
        const { http, asked } = statusHttp([200, { state: 'none' }]);
        const wrapper = await mountGate(http);
        expect(asked).toEqual(['/api/public/maintenance']);
        expect(showsTheApplication(wrapper)).toBe(true);
        expect(wrapper.text()).toBe('the application');
    });

    test('an installation that keeps no windows answers 404, and the application runs', async () => {
        const { http } = statusHttp([404, {}]);
        const wrapper = await mountGate(http);
        expect(showsTheApplication(wrapper)).toBe(true);
    });

    test('a window ahead is announced above the application, with the operator’s message', async () => {
        const { http } = statusHttp([200, ANNOUNCED]);
        const wrapper = await mountGate(http);
        expect(showsTheApplication(wrapper)).toBe(true);
        expect(wrapper.text()).toMatch(/^Planned maintenance from .+ to .+\./);
        expect(wrapper.text()).toContain('Upgrade to 2.3');
    });

    test('while the lock holds, one page with the expected end — and no application behind it', async () => {
        const { http } = statusHttp([200, LOCKED]);
        const wrapper = await mountGate(http);
        expect(showsTheApplication(wrapper)).toBe(false);
        expect(wrapper.text()).toContain(i18n.maintenanceTitle);
        expect(wrapper.text()).toMatch(/expected back at .+/);
        expect(wrapper.text()).toContain('Upgrade to 2.3');
        expect(wrapper.text()).not.toContain(i18n.maintenanceRefused);
    });

    test('past its announced end, it says it is taking longer', async () => {
        const { http } = statusHttp([200, { ...LOCKED, overrun: true }]);
        const wrapper = await mountGate(http);
        expect(wrapper.text()).toContain(i18n.maintenanceOverrun);
        expect(wrapper.text()).not.toMatch(/expected back at/);
    });

    test('once the lock is lifted, the tenant is back on the screen it was on', async () => {
        vi.useFakeTimers();
        const { http, answer } = statusHttp([200, { state: 'none' }]);
        const wrapper = await mountGate(http);
        expect(mounts).toBe(1);

        reportMaintenanceRefusal(503, { code: 'MAINTENANCE', maintenance: LOCKED });
        await flushPromises();
        expect(showsTheApplication(wrapper)).toBe(false);

        answer([200, { state: 'none' }]);
        await vi.advanceTimersByTimeAsync(MAINTENANCE_LOCKED_POLL_MS);
        await flushPromises();
        expect(showsTheApplication(wrapper)).toBe(true);
        // Mounted again inside the same session: the route and the sign-in
        // are the application's own, and nothing here touched either.
        expect(mounts).toBe(2);
    });

    test('a refused request switches to the page at once and says it was not carried out', async () => {
        const { http } = statusHttp([200, { state: 'none' }]);
        const wrapper = await mountGate(http);

        expect(reportMaintenanceRefusal(503, { code: 'MAINTENANCE', maintenance: LOCKED })).toBe(
            true,
        );
        await flushPromises();
        expect(showsTheApplication(wrapper)).toBe(false);
        expect(wrapper.text()).toContain(i18n.maintenanceRefused);
    });

    test('a 503 that is not the lock’s — a proxy’s, say — is not taken for maintenance', async () => {
        const { http } = statusHttp([200, { state: 'none' }]);
        const wrapper = await mountGate(http);
        expect(reportMaintenanceRefusal(503, '<html>Bad gateway</html>')).toBe(false);
        expect(reportMaintenanceRefusal(500, { code: 'MAINTENANCE' })).toBe(false);
        await flushPromises();
        expect(showsTheApplication(wrapper)).toBe(true);
    });
});
