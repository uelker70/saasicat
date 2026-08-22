// A page's dialog belongs to the page, not to a table row.
//
// `UsersPage`'s one-time-password dialog sat inside the status cell's slot,
// which a table instantiates once for every rendered row. `otpMessage` is page
// state, so when a password reset filled it, every row's copy of the dialog
// opened at once: N stacked overlays, N focus traps competing, and a value the
// operator gets exactly one chance to read hidden behind the rest.
//
// The defect is invisible with one row, which is what a fixture reaches for by
// default. This one renders four.

import { afterEach, describe, expect, test } from 'vitest';

import UsersPage from '../../src/pages/UsersPage.vue';
import { provideStubResources } from './support/stub-resources.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

const USERS = ['ada', 'grace', 'alan', 'edsger'].map((name, index) => ({
    id: `u-${index}`,
    email: `${name}@example.com`,
    displayName: name,
    tenantSlug: 'demo',
    tenantName: 'Demo',
    isActive: true,
    invitationStatus: 'ACCEPTED' as const,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
}));

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

function mountUsers() {
    const wrapper = mountWithQuasar(UsersPage, {
        global: {
            provide: provideStubResources({
                users: {
                    list: async () => USERS,
                    resetPassword: async () => ({ oneTimePassword: 'hunter2' }),
                    deactivate: async () => undefined,
                },
            }),
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

describe('the one-time-password dialog is one dialog', () => {
    test('the fixture renders several rows — without that this proves nothing', async () => {
        const wrapper = mountUsers();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();
        expect(wrapper.findAll('tbody tr').length).toBeGreaterThan(1);
    });

    test('one instance exists, however many rows there are', async () => {
        const wrapper = mountUsers();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();

        // Setting the page's state directly: what is in question is how many
        // copies of the dialog that state reaches, not how a reset is clicked.
        (wrapper.vm as unknown as { otpMessage: string | null }).otpMessage = 'the password';
        await wrapper.vm.$nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Dialogs teleport out of the component, so they are counted in the
        // document rather than in the wrapper.
        const open = document.querySelectorAll('.sa-dialog__message');
        expect(open.length, 'one dialog per rendered row is the defect this file exists for').toBe(
            1,
        );
    });
});
