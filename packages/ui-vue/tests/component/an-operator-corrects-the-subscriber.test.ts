// The operator corrects a tenant's subscriber on the tenant's page: its legal
// identity and its business status, each in a dialog that asks for a reason
// and then for the second factor, and checks its VAT number again; the history
// below lists what was done. Mounted through a router against a stubbed
// registry, so what is asserted is what the operator does and sees.

// @requirement SC-SUB-041 — The operator corrects a subscriber's identity and business status, with a reason
// @requirement SC-ADM-032 — The operator reads a subscriber's history, with who, when and why

import { afterEach, describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import TenantDetailPage from '../../src/pages/TenantDetailPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { provideStubResources } from './support/stub-resources.js';

const TENANT = { id: 't-1', slug: 'wien', name: 'Wien', isActive: true, users: [] };
const CODE = '123456';

const SUBSCRIBER = {
    id: 's-1',
    customerNumber: 'K-10001',
    legalName: 'Wien GmbH',
    addressLine1: 'Ringstraße 1',
    addressLine2: null,
    postalCode: '1010',
    city: 'Wien',
    country: 'AT',
    business: true,
    vatId: 'ATU12345678',
    vatIdValidated: false,
    taxNumber: null,
    migrated: true,
};
const STANDING = {
    subscriber: SUBSCRIBER,
    readiness: { ready: false, missing: [], taxRefusal: 'No validated VAT number.' },
};

const HISTORY = [
    {
        kind: 'identity-corrected',
        at: '2026-10-06T09:00:00.000Z',
        by: 'web:anna@ops.example:admin',
        previous: { legalName: 'Wien Gmbh' },
        corrected: { legalName: 'Wien GmbH' },
        reason: 'Legal form spelt as registered',
    },
    {
        kind: 'vat-id-checked',
        at: '2026-10-05T09:00:00.000Z',
        vatId: 'ATU12345678',
        valid: false,
        service: 'VIES',
        counts: true,
    },
];

const CORRECTING = {
    capabilities: { 'subscribers.read': true, 'subscribers.correct': true },
};
const DECIDING = {
    capabilities: { ...CORRECTING.capabilities, 'subscribers.attention': true },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
}

type Call = [string, ...unknown[]];

async function mountPage(manifest: unknown = DECIDING) {
    const calls: Call[] = [];
    const notices: Array<[string, string]> = [];
    const answer = { subscriber: STANDING, vatIdCheck: null };
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/tenants/:slug', component: TenantDetailPage },
            { path: '/:rest(.*)', component: { template: '<div />' } },
        ],
    });
    await router.push('/admin/tenants/wien');
    await router.isReady();
    const wrapper = mountWithQuasar({ template: '<router-view />' } as never, {
        attachTo: document.body,
        global: {
            plugins: [router],
            provide: {
                ...provideStubResources({
                    tenants: {
                        detail: async () => TENANT,
                        subscriber: async () => STANDING,
                        subscriberHistory: async () => HISTORY,
                        correctSubscriberIdentity: async (...args: unknown[]) => {
                            calls.push(['identity', ...args]);
                            return answer;
                        },
                        changeSubscriberBusinessStatus: async (...args: unknown[]) => {
                            calls.push(['business', ...args]);
                            return answer;
                        },
                        checkSubscriberVatId: async (...args: unknown[]) => {
                            calls.push(['check', ...args]);
                            return {
                                subscriber: STANDING,
                                vatIdCheck: {
                                    completed: true,
                                    valid: true,
                                    checkedAt: '2026-10-06T10:00:00.000Z',
                                    service: 'VIES',
                                    counts: true,
                                },
                            };
                        },
                    },
                } as never),
                [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => manifest,
                [SUPER_ADMIN_NOTIFY_KEY as symbol]: (kind: string, message: string) =>
                    notices.push([kind, message]),
            },
        },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, calls, notices };
}

type Mounted = Awaited<ReturnType<typeof mountPage>>['wrapper'];

/** The button of the page labelled `label`; its icon's ligature is part of its text. */
function buttonNamed(wrapper: Mounted, label: string) {
    return wrapper.findAll('button').find((button) => button.text().endsWith(label));
}

/** The dialog on screen, and its confirming button. */
function dialog() {
    const node = [...document.querySelectorAll('.sa-dialog')].at(-1) as HTMLElement | undefined;
    const buttons = node?.querySelectorAll('.sa-dialog__actions button') ?? [];
    return { node, submit: buttons[1] as HTMLButtonElement | undefined };
}

/** Types `value` into the field of the dialog labelled `label`. */
async function typeInto(label: string, value: string): Promise<void> {
    const field = [...(dialog().node?.querySelectorAll('.sa-field') ?? [])].find((candidate) =>
        candidate.textContent?.includes(label),
    );
    const input = field?.querySelector('input, textarea') as HTMLInputElement | null;
    expect(input, `no field ${label}`).toBeTruthy();
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    await nextTick();
}

/** Answers the second factor's dialog with the code, as the operator does. */
async function enterTheCode(): Promise<void> {
    await settle();
    const card = document.querySelector('.mfa-card') as HTMLElement | null;
    expect(card, 'the second factor was not asked for').toBeTruthy();
    const input = card!.querySelector('input') as HTMLInputElement;
    input.value = CODE;
    input.dispatchEvent(new Event('input'));
    await nextTick();
    const confirm = [...card!.querySelectorAll('button')].at(-1) as HTMLButtonElement;
    confirm.click();
    await settle();
}

describe('the operator corrects the subscriber on the tenant page', () => {
    test('offers the corrections, and a check where a tax adapter decides and a number is held', async () => {
        const { wrapper } = await mountPage();

        expect(buttonNamed(wrapper, 'Correct identity')).toBeTruthy();
        expect(buttonNamed(wrapper, 'Change business status')).toBeTruthy();
        expect(buttonNamed(wrapper, 'Check VAT ID')).toBeTruthy();
    });

    test('offers no check where no tax adapter names a service', async () => {
        const { wrapper } = await mountPage(CORRECTING);

        expect(buttonNamed(wrapper, 'Correct identity')).toBeTruthy();
        expect(buttonNamed(wrapper, 'Check VAT ID')).toBeUndefined();
    });

    // @requirement SC-ADM-015 — The administration only offers what the application actually has
    test('without the capability, nothing is offered and no history is shown', async () => {
        const { wrapper } = await mountPage({ capabilities: { 'subscribers.read': true } });

        expect(buttonNamed(wrapper, 'Correct identity')).toBeUndefined();
        expect(wrapper.text()).not.toContain('History');
    });

    test('a correction is sent only once something changed and a reason is given, with the second factor', async () => {
        const { wrapper, calls, notices } = await mountPage();

        await buttonNamed(wrapper, 'Correct identity')!.trigger('click');
        await settle();
        expect(dialog().submit?.disabled, 'nothing changed yet').toBe(true);

        await typeInto('Tax number', '12/345/67890');
        expect(dialog().submit?.disabled, 'no reason yet').toBe(true);
        await typeInto('Reason', 'Tax number handed in');
        expect(dialog().submit?.disabled).toBe(false);

        dialog().submit!.click();
        await enterTheCode();

        expect(calls).toEqual([
            [
                'identity',
                'wien',
                { taxNumber: '12/345/67890', reason: 'Tax number handed in' },
                CODE,
            ],
        ]);
        expect(document.querySelector('.sa-dialog')).toBeNull();
        expect(notices).toEqual([['positive', 'Correction saved.']]);
    });

    test('stepping back from the second factor sends nothing and keeps the form', async () => {
        const { wrapper, calls } = await mountPage();
        await buttonNamed(wrapper, 'Change business status')!.trigger('click');
        await settle();
        // As the select reports a choice of "Consumer".
        wrapper.findComponent({ name: 'QSelect' }).vm.$emit('update:modelValue', false);
        await nextTick();
        await typeInto('Reason', 'Sole trader, no company');

        expect(dialog().submit?.disabled, 'the form did not take the choice').toBe(false);
        dialog().submit!.click();
        await settle();
        expect(
            document.querySelector('.mfa-card'),
            'the second factor was not asked for',
        ).toBeTruthy();
        const cancel = [...document.querySelectorAll('.mfa-card button')][0] as HTMLButtonElement;
        cancel.click();
        await settle();

        expect(calls).toEqual([]);
        expect(dialog().node, 'the form was closed').toBeTruthy();
        expect(dialog().node?.querySelector('.sa-banner--negative')).toBeNull();
    });

    // @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
    test('a check is asked without the second factor', async () => {
        const { wrapper, calls, notices } = await mountPage();

        await buttonNamed(wrapper, 'Check VAT ID')!.trigger('click');
        await settle();

        expect(calls).toEqual([['check', 'wien']]);
        expect(document.querySelector('.mfa-card')).toBeNull();
        expect(notices).toEqual([['positive', 'VAT ID is valid (VIES).']]);
    });

    test('the history lists each correction and check with what it changed, why and by whom', async () => {
        const { wrapper } = await mountPage();

        const section = wrapper
            .findAll('section')
            .find(
                (element) => element.find('h2').exists() && element.find('h2').text() === 'History',
            );
        expect(section, 'no history').toBeTruthy();
        const rows = (section?.findAll('tbody tr') ?? []).map((row) =>
            row.findAll('td').map((cell) => cell.text()),
        );
        expect(rows.map((cells) => cells.slice(1))).toEqual([
            [
                'Identity corrected',
                'Name: Wien Gmbh → Wien GmbH',
                'Legal form spelt as registered',
                'web:anna@ops.example:admin',
            ],
            ['VAT ID checked', 'ATU12345678: invalid (VIES) · counts', '—', '—'],
        ]);
    });
});
