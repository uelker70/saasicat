// The operator joins a returning customer's subscriber into the one it had, in
// the record of the subscriber with the live tenant: finds the earlier one,
// sees both side by side with what moves and what changes, gives a reason,
// declares both one legal entity, and confirms with the second factor — and the
// record of a subscriber joined says where everything went.

// @requirement SC-ADM-027 — An operator joins a returning customer's new tenant to the subscriber it had

import { afterEach, describe, expect, test } from 'vitest';
import type { AdminSubscriberJoinPreview } from '@saasicat/core';

import type { SubscriberJoinInput } from '../../src/client/resources/subscribers.resource.js';
import { dialog, enterTheCode, settle, typeInto } from './support/dialog-flow.js';
import { RECORD, SUBSCRIBER, mountRecord } from './support/subscriber-record.js';

const CODE = '123456';
const JOINS = { 'subscribers.join': true, 'subscribers.correct': true };

const EARLIER = {
    ...SUBSCRIBER,
    id: 's-old',
    customerNumber: 'K-10045',
    legalName: 'Northwind Handel GmbH',
    addressLine1: 'Alte Straße 2',
    postalCode: '28195',
    city: 'Bremen',
    vatId: null,
    vatIdValidated: false,
    business: null,
};

const PREVIEW: AdminSubscriberJoinPreview = {
    from: { subscriber: SUBSCRIBER, tenants: RECORD.tenants },
    into: {
        subscriber: EARLIER,
        tenants: [
            {
                tenantId: 't-old',
                linkedAt: '2024-02-01T09:00:00.000Z',
                unlinkedAt: '2026-03-31T00:00:00.000Z',
                known: false,
                slug: null,
                name: null,
                deletedAt: null,
            },
        ],
    },
    moving: { subscriber_tenants: 1, subscription_invoices: 2, subscriber_payments: 1 },
    replaced: [
        { field: 'addressLine1', previous: 'Alte Straße 2', next: 'Hafenstraße 1' },
        { field: 'postalCode', previous: '28195', next: '20457' },
        { field: 'city', previous: 'Bremen', next: 'Hamburg' },
        { field: 'business', previous: null, next: true },
    ],
    corrected: {
        previous: { legalName: 'Northwind Handel GmbH', vatId: null },
        corrected: { legalName: 'Northwind GmbH', vatId: 'DE123456789' },
    },
    vatIdCheck: 'adopted',
    paymentMethodsOutOfUse: 1,
    digest: 'a'.repeat(64),
};

afterEach(() => {
    document.body.innerHTML = '';
});

/** The record of the subscriber with the live tenant, every join call recorded. */
async function mountJoinable(record = RECORD, capabilities: Record<string, boolean> = JOINS) {
    const calls: unknown[][] = [];
    const mounted = await mountRecord({
        attach: true,
        capabilities,
        subscribers: {
            record: async () => record,
            history: async () => [],
            list: async (request: unknown) => {
                calls.push(['list', request]);
                return {
                    subscribers: [
                        { ...EARLIER, liveTenant: null, joinedInto: null },
                        { ...SUBSCRIBER, liveTenant: null, joinedInto: null },
                    ],
                    next: null,
                };
            },
            previewJoin: async (from: string, into: string) => {
                calls.push(['preview', from, into]);
                return PREVIEW;
            },
            join: async (from: string, input: SubscriberJoinInput, code?: string) => {
                calls.push(['join', from, input, code]);
                return {
                    joinedInto: {
                        subscriberId: 's-old',
                        customerNumber: 'K-10045',
                        legalName: 'Northwind GmbH',
                        joinedAt: '2026-11-03T09:00:00.000Z',
                        joinedBy: 'web:anna@ops.example:admin',
                        reason: input.reason,
                    },
                };
            },
        },
    });
    return { ...mounted, calls };
}

const actionOf = (wrapper: Awaited<ReturnType<typeof mountJoinable>>['wrapper']) =>
    // The icon's ligature stands before the label in the button's text.
    wrapper
        .findAll('button')
        .find((button) => button.text().endsWith('Belongs to an earlier subscriber …'));

function buttonInDialog(text: string): HTMLButtonElement {
    const button = [...(dialog().node?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
        (each) => each.textContent?.trim() === text,
    );
    expect(button, `no "${text}" in the dialog`).toBeTruthy();
    return button!;
}

describe("joining a returning customer's subscriber into the one it had", () => {
    test('is offered on a subscriber with a live tenant where joins are served, and nowhere else', async () => {
        const served = await mountJoinable();
        expect(actionOf(served.wrapper)).toBeTruthy();
        served.wrapper.unmount();

        const notServed = await mountJoinable(RECORD, { 'subscribers.correct': true });
        expect(actionOf(notServed.wrapper)).toBeUndefined();
        notServed.wrapper.unmount();

        const withoutTenant = await mountJoinable({
            ...RECORD,
            tenants: [{ ...RECORD.tenants[0]!, unlinkedAt: '2026-03-31T00:00:00.000Z' }],
        });
        expect(actionOf(withoutTenant.wrapper)).toBeUndefined();
    });

    test('finds the earlier subscriber, shows both with what moves and changes, and joins them as confirmed', async () => {
        const { wrapper, calls, router } = await mountJoinable();

        await actionOf(wrapper)!.trigger('click');
        await settle();
        await typeInto('Earlier subscriber', 'Northwind');
        await new Promise((resolve) => setTimeout(resolve, 350));
        await settle();
        expect(calls[0]).toEqual(['list', { query: 'Northwind', withoutLiveTenant: true }]);
        // The subscriber on screen is no candidate of its own.
        expect(dialog().node?.textContent).not.toContain('K-10001 · Northwind GmbH');
        buttonInDialog('K-10045 · Northwind Handel GmbH').click();
        await settle();

        expect(calls[1]).toEqual(['preview', 's-1', 's-old']);
        const text = dialog().node?.textContent ?? '';
        expect(text).toContain('This subscriber');
        expect(text).toContain('Earlier subscriber');
        expect(text).toContain('formerly tenant t-old');
        expect(text).toContain('Invoices2');
        expect(text).toContain(
            'Billing address: Alte Straße 2, 28195 Bremen, DE → Hafenstraße 1, 20457 Hamburg, DE',
        );
        expect(text).toContain('Acts as: not stated → Business');
        expect(text).toContain(
            'VAT ID (as a correction of the same legal entity): not stated → DE123456789',
        );
        expect(text).toContain('The check of the VAT number made at sign-up counts');
        expect(text).toContain("The earlier subscriber's payment method goes out of use");

        // Nothing is sent before a reason and the declaration.
        expect(dialog().submit?.disabled).toBe(true);
        await typeInto('Reason', 'Returning customer, confirmed by phone');
        expect(dialog().submit?.disabled).toBe(true);
        dialog().node?.querySelector<HTMLElement>('.q-checkbox')?.click();
        await settle();
        expect(dialog().submit?.disabled).toBe(false);

        dialog().submit?.click();
        await enterTheCode(CODE);

        expect(calls.at(-1)).toEqual([
            'join',
            's-1',
            {
                intoSubscriberId: 's-old',
                reason: 'Returning customer, confirmed by phone',
                previewDigest: PREVIEW.digest,
            },
            CODE,
        ]);
        expect(router.currentRoute.value.path).toBe('/admin/subscribers/s-old');
    });

    test('a record joined into another says where everything went, leads there, and takes no correction', async () => {
        const { wrapper } = await mountJoinable({
            ...RECORD,
            tenants: [],
            joins: {
                into: {
                    subscriberId: 's-old',
                    customerNumber: 'K-10045',
                    legalName: 'Northwind GmbH',
                    joinedAt: '2026-11-03T09:00:00.000Z',
                    joinedBy: 'web:anna@ops.example:admin',
                    reason: 'Returning customer',
                },
                from: [],
            },
        });

        expect(wrapper.text()).toContain(
            'Joined into K-10045 · Northwind GmbH on 11/03/2026, by web:anna@ops.example:admin: Returning customer',
        );
        expect(wrapper.text()).toContain('This record stays as it is and takes no change.');
        expect(wrapper.find('a[href="/admin/subscribers/s-old"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Correct identity');
        expect(actionOf(wrapper)).toBeUndefined();
    });

    test('the earlier record names the subscribers joined into it, leading to each', async () => {
        const { wrapper } = await mountJoinable({
            ...RECORD,
            joins: {
                into: null,
                from: [
                    {
                        subscriberId: 's-new',
                        customerNumber: 'K-10234',
                        legalName: 'Northwind GmbH',
                        joinedAt: '2026-11-03T09:00:00.000Z',
                        joinedBy: 'web:anna@ops.example:admin',
                        reason: 'Returning customer',
                    },
                ],
            },
        });

        expect(wrapper.text()).toContain('Joined into this one');
        expect(wrapper.text()).toContain(
            'K-10234 · Northwind GmbH on 11/03/2026, by web:anna@ops.example:admin: Returning customer',
        );
        expect(wrapper.find('a[href="/admin/subscribers/s-new"]').exists()).toBe(true);
    });
});
