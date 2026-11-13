// @requirement SC-ADM-054 — A tenant's users read why it is held back

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { TenantAccessView } from '@saasicat/core';
import { TENANT_ACCESS_POLL_MS, type HttpClient } from '@saasicat/ui-vue';
import { computed } from 'vue';

import TenantAccessBanner from '../../src/TenantAccessBanner.vue';
import { DEFAULT_I18N_DE } from '../../src/default-i18n.js';
import { TENANT_I18N_KEY } from '../../src/tenant-i18n.js';

// Above the application, every user of a tenant held back reads why: the state,
// each reason from its day, and under an unpaid invoice either a way to pay it
// or who can.

/** A status and its body; a body of bytes is a file, offered under the name beside it. */
type Answer = [number, unknown] | [number, Uint8Array, string];

/** A client answering each `METHOD url` in turn with the answers listed for it. */
function httpRouting(routes: Record<string, Answer[]>) {
    const calls: string[] = [];
    const http: HttpClient = async (url, init) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        calls.push(key);
        const [status, body, fileName] = routes[key]?.shift() ?? [404, {}];
        const headers: Record<string, string> = {
            'content-type': fileName ? 'application/json; charset=utf-8' : 'application/json',
        };
        if (fileName) headers['content-disposition'] = `attachment; filename="${fileName}"`;
        return {
            status,
            headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
            json: async () => body,
            text: async () => JSON.stringify(body),
            bytes: async () =>
                body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body)),
        };
    };
    return { http, calls };
}

/** What a reason other than an ended subscription carries of the days an end leaves. */
const NO_DAYS = { readOnlyUntil: null, deletesOn: null, deletionDue: null } as const;
const OVERDUE = {
    kind: 'overdue',
    since: '2026-11-16',
    invoiceNumber: 'RE-2026-0042',
    ...NO_DAYS,
} as const;

/** What a user with the billing permission reads, where it is collected through a gateway. */
const toBilling = (overrides: Partial<TenantAccessView> = {}): TenantAccessView => ({
    state: 'read-only',
    reasons: [OVERDUE],
    holdsBillingPermission: true,
    mayPay: true,
    mayExport: false,
    ...overrides,
});
const ACCOUNT = {
    balances: [{ currency: 'EUR', owed: 69, overdue: 69, credit: 0 }],
    directDebitCollectedOn: '2026-11-24',
};

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.useRealTimers();
});

async function mountBanner(http: HttpClient, options: { german?: boolean } = {}) {
    const wrapper = mount(TenantAccessBanner, {
        props: {
            http,
            // The day the instant falls on in the viewer's zone, as an application's formatter writes it.
            formatDate: (iso: string) => new Date(iso).toLocaleDateString('de-DE'),
        },
        attachTo: document.body,
        global: options.german
            ? { provide: { [TENANT_I18N_KEY]: computed(() => DEFAULT_I18N_DE) } }
            : {},
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const payButton = (wrapper: VueWrapper) => wrapper.find('.sp-access-banner__actions button');
const lines = (wrapper: VueWrapper) =>
    wrapper.findAll('.sp-access-banner__reason').map((line) => line.text());

describe('the banner of a tenant held back', () => {
    test('shows nothing where the tenant is open', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, toBilling({ state: 'open', reasons: [] })]],
        });
        const wrapper = await mountBanner(http);
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });

    test('shows nothing where no route answers', async () => {
        const wrapper = await mountBanner(httpRouting({}).http);
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });

    test('to a user who may pay: the state, the invoice by number from its day, and paying with when it opens again', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[200, toBilling()]],
            'GET /billing/account': [[200, ACCOUNT]],
        });
        const wrapper = await mountBanner(http);

        const banner = wrapper.find('.sp-access-banner');
        expect(banner.attributes('role')).toBe('status');
        expect(wrapper.find('.sp-access-banner__state').text()).toBe(
            'This account can be read but not changed at the moment. You can still view and export its data.',
        );
        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: invoice RE-2026-0042 was not paid by its due date.',
        ]);
        expect(payButton(wrapper).exists()).toBe(true);
        expect(wrapper.text()).toContain('once it is collected on 24.11.2026');
        expect(calls).toEqual(['GET /billing/account/access', 'GET /billing/account']);
    });

    test('paying starts the payment, says what it set going, and reads the state again', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [
                [200, toBilling()],
                [200, toBilling()],
            ],
            'GET /billing/account': [
                [200, ACCOUNT],
                [200, ACCOUNT],
            ],
            'POST /billing/account/pay': [
                [
                    200,
                    {
                        paymentMethod: true,
                        collected: 0,
                        pending: 0,
                        failed: 0,
                        announced: 1,
                        onTheirWay: 0,
                        refused: 0,
                        waiting: 0,
                        notSentYet: 0,
                    },
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        await payButton(wrapper).trigger('click');
        await flushPromises();

        expect(calls.filter((call) => call === 'POST /billing/account/pay')).toHaveLength(1);
        expect(calls.at(-1)).toBe('GET /billing/account/access');
        expect(wrapper.text()).toContain('The direct debit is announced.');
    });

    test('to a user without the billing permission: no number, nothing to press, and who can pay', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[403, {}]],
            'GET /billing/access': [
                [
                    200,
                    toBilling({
                        reasons: [{ ...OVERDUE, invoiceNumber: null }],
                        holdsBillingPermission: false,
                        mayPay: false,
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: an invoice was not paid by its due date.',
        ]);
        expect(payButton(wrapper).exists()).toBe(false);
        expect(wrapper.text()).toContain(
            'Whoever looks after billing in your organisation can pay it.',
        );
        expect(calls).not.toContain('GET /billing/account');
    });

    test('to a user with the permission where nothing is collected here: the number, and nothing to press', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, toBilling({ mayPay: false })]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)[0]).toContain('RE-2026-0042');
        expect(payButton(wrapper).exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Whoever looks after billing');
    });

    test('suspended, nothing is offered to pay, since a suspension lets no payment through', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [
                    200,
                    toBilling({
                        state: 'suspended',
                        reasons: [
                            OVERDUE,
                            {
                                kind: 'suspended',
                                since: '2026-11-17',
                                invoiceNumber: null,
                                ...NO_DAYS,
                            },
                        ],
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(wrapper.find('.sp-access-banner').classes()).toContain('sp-access-banner--stopped');
        expect(wrapper.find('.sp-access-banner__state').text()).toBe(
            'This account is suspended. Please contact your provider.',
        );
        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: invoice RE-2026-0042 was not paid by its due date.',
            'Since 17.11.2026: suspended by your provider.',
        ]);
        expect(payButton(wrapper).exists()).toBe(false);
    });

    test('suspended, a user without the billing permission is not sent to somebody who cannot pay either', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[403, {}]],
            'GET /billing/access': [
                [
                    200,
                    toBilling({
                        state: 'suspended',
                        reasons: [
                            { ...OVERDUE, invoiceNumber: null },
                            {
                                kind: 'suspended',
                                since: '2026-11-17',
                                invoiceNumber: null,
                                ...NO_DAYS,
                            },
                        ],
                        holdsBillingPermission: false,
                        mayPay: false,
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toHaveLength(2);
        expect(wrapper.text()).not.toContain('Whoever looks after billing');
    });

    test('where an ended subscription holds it back as well, paying is offered without promising it opens again', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [
                    200,
                    toBilling({
                        reasons: [
                            { kind: 'ended', since: '2026-11-10', invoiceNumber: null, ...NO_DAYS },
                            OVERDUE,
                        ],
                    }),
                ],
            ],
            'GET /billing/account': [[200, ACCOUNT]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)[0]).toBe('Since 10.11.2026: the subscription has ended.');
        expect(payButton(wrapper).exists()).toBe(true);
        expect(wrapper.text()).not.toContain('collected on');
    });

    test('a hold begun while the page is open shows on the next read, and goes once lifted', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const open = toBilling({ state: 'open', reasons: [] });
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [200, open],
                [200, toBilling()],
                [200, open],
            ],
            'GET /billing/account': [[200, ACCOUNT]],
        });
        const wrapper = await mountBanner(http);
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);

        await vi.advanceTimersByTimeAsync(TENANT_ACCESS_POLL_MS);
        await flushPromises();
        expect(lines(wrapper)).toEqual([
            'Since 16.11.2026: invoice RE-2026-0042 was not paid by its due date.',
        ]);

        await vi.advanceTimersByTimeAsync(TENANT_ACCESS_POLL_MS);
        await flushPromises();
        expect(wrapper.find('.sp-access-banner').exists()).toBe(false);
    });
});

/** An ended subscription whose end is recorded: read until the 9th, deleted on the 10th. */
const ENDED = {
    kind: 'ended',
    since: '2026-11-10',
    invoiceNumber: null,
    readOnlyUntil: '2026-12-09',
    deletesOn: '2026-12-10',
    deletionDue: false,
} as const;
const ENDED_LINE =
    'Since 10.11.2026: the subscription has ended. After that you can still read your data until the end of 9.12.2026, but no longer change it. On 10.12.2026 it is deleted.';

/** The same end once its deletion day has come, before anything has deleted the data. */
const ENDED_DUE = { ...ENDED, deletionDue: true } as const;
const ENDED_DUE_LINE =
    'Since 10.11.2026: the subscription has ended. Read-only period until the end of 9.12.2026; deletion has been due since 10.12.2026. Until it happens, you can still read your data.';

/** The same two days where the tenant is suspended or being deleted and can read nothing now. */
const ENDED_DAYS_LINE =
    'Since 10.11.2026: the subscription has ended. Read-only period until the end of 9.12.2026, deletion on 10.12.2026.';

/** What a user who is not the tenant's administrator reads of an ended subscription. */
const endedToAnyone = (overrides: Partial<TenantAccessView> = {}): TenantAccessView => ({
    state: 'read-only',
    reasons: [ENDED],
    holdsBillingPermission: false,
    mayPay: false,
    mayExport: false,
    ...overrides,
});
/** What the tenant's administrator reads of it: they may take the export. */
const endedToAdministrator = (): TenantAccessView =>
    endedToAnyone({ holdsBillingPermission: true, mayExport: true });

const EXPORT_BYTES = new TextEncoder().encode('{"notes":[]}');
const EXPORT_LABEL = "Export the account's data";

const exportButton = (wrapper: VueWrapper, label = EXPORT_LABEL) =>
    wrapper.findAll<HTMLButtonElement>('button').find((button) => button.text() === label);

/**
 * What the browser was handed to save. jsdom keeps no object URLs, so the two
 * calls `saveFile` makes are given here, and the link it follows is read
 * rather than followed.
 */
const handedToSave: Array<{ blob: Blob; fileName: string }> = [];
beforeAll(() => {
    const blobs = new Map<string, Blob>();
    Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: (blob: Blob) => {
            const url = `blob:export-${blobs.size}`;
            blobs.set(url, blob);
            return url;
        },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function follow(
        this: HTMLAnchorElement,
    ) {
        const blob = blobs.get(this.href);
        if (blob) handedToSave.push({ blob, fileName: this.download });
    });
});
afterEach(() => {
    handedToSave.splice(0);
});

// @requirement SC-CANC-033 — An ended subscription's deletion day is shown to the tenant and to the operator
describe('the banner of a tenant whose subscription ended', () => {
    test('tells a user who is not its administrator the last day it can read and the day its data is deleted on, and offers no export', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[403, {}]],
            'GET /billing/access': [[200, endedToAnyone()]],
        });
        const wrapper = await mountBanner(http);

        expect(wrapper.find('.sp-access-banner__state').text()).toBe(
            'This account can be read but not changed at the moment. You can still view and export its data.',
        );
        expect(lines(wrapper)).toEqual([ENDED_LINE]);
        expect(exportButton(wrapper)).toBeUndefined();
        expect(wrapper.find('.sp-access-banner__actions').exists()).toBe(false);
        expect(calls).not.toContain('GET /billing/export');
    });

    test('tells its administrator the same two days', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([ENDED_LINE]);
    });

    test('names the two days in German to a German reader', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
        });
        const wrapper = await mountBanner(http, { german: true });

        expect(lines(wrapper)).toEqual([
            'Seit 10.11.2026: Das Abonnement ist beendet. Danach können Sie Ihre Daten bis einschließlich 9.12.2026 nur noch lesen, nicht mehr ändern. Am 10.12.2026 werden sie gelöscht.',
        ]);
        expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
            'Daten des Kontos exportieren',
        ]);
    });

    test('once the deletion day has come and nothing has deleted the data, says the deletion is due and that it can still read', async () => {
        const { http } = httpRouting({
            'GET /billing/access': [[200, endedToAnyone({ reasons: [ENDED_DUE] })]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([ENDED_DUE_LINE]);
        expect(wrapper.text()).not.toContain('On 10.12.2026 it is deleted');
    });

    test('says the deletion is due in German to a German reader', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [200, endedToAnyone({ reasons: [ENDED_DUE], holdsBillingPermission: true })],
            ],
        });
        const wrapper = await mountBanner(http, { german: true });

        expect(lines(wrapper)).toEqual([
            'Seit 10.11.2026: Das Abonnement ist beendet. Lesefrist bis einschließlich 9.12.2026; die Löschung ist seit dem 10.12.2026 fällig. Bis sie erfolgt, können Sie Ihre Daten noch lesen.',
        ]);
    });

    test('suspended past the deletion day, names the two days as days and says nothing of reading now', async () => {
        const { http } = httpRouting({
            'GET /billing/access': [
                [
                    200,
                    endedToAnyone({
                        state: 'suspended',
                        reasons: [
                            ENDED_DUE,
                            {
                                kind: 'suspended',
                                since: '2026-12-11',
                                invoiceNumber: null,
                                ...NO_DAYS,
                            },
                        ],
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([
            ENDED_DAYS_LINE,
            'Since 11.12.2026: suspended by your provider.',
        ]);
        expect(wrapper.text()).not.toContain('you can still read');
    });

    test('names no days while the end is not recorded yet', async () => {
        const { http } = httpRouting({
            'GET /billing/access': [[200, endedToAnyone({ reasons: [{ ...ENDED, ...NO_DAYS }] })]],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual(['Since 10.11.2026: the subscription has ended.']);
    });

    test('while suspended, names the two days as days and says nothing of reading now, and offers no export', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [
                    200,
                    endedToAnyone({
                        state: 'suspended',
                        reasons: [
                            ENDED,
                            {
                                kind: 'suspended',
                                since: '2026-11-17',
                                invoiceNumber: null,
                                ...NO_DAYS,
                            },
                        ],
                        holdsBillingPermission: true,
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([
            ENDED_DAYS_LINE,
            'Since 17.11.2026: suspended by your provider.',
        ]);
        expect(wrapper.text()).not.toContain('you can still read');
        expect(exportButton(wrapper)).toBeUndefined();
    });

    test('while being deleted, names the two days as days and says nothing of reading now', async () => {
        const { http } = httpRouting({
            'GET /billing/access': [
                [
                    200,
                    endedToAnyone({
                        state: 'deleting',
                        reasons: [
                            ENDED,
                            {
                                kind: 'deleting',
                                since: '2026-12-10',
                                invoiceNumber: null,
                                ...NO_DAYS,
                            },
                        ],
                    }),
                ],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(lines(wrapper)).toEqual([
            ENDED_DAYS_LINE,
            'Since 10.12.2026: the account is being deleted.',
        ]);
        expect(wrapper.text()).not.toContain('you can still read');
    });

    test('while suspended, names the two days as days in German to a German reader', async () => {
        const { http } = httpRouting({
            'GET /billing/access': [[200, endedToAnyone({ state: 'suspended' })]],
        });
        const wrapper = await mountBanner(http, { german: true });

        expect(lines(wrapper)).toEqual([
            'Seit 10.11.2026: Das Abonnement ist beendet. Lesefrist bis einschließlich 9.12.2026, Löschung am 10.12.2026.',
        ]);
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe("the tenant's export, taken from the banner", () => {
    test('is offered to its administrator as a button named for what it downloads, reached from the keyboard', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
        });
        const wrapper = await mountBanner(http);

        const button = exportButton(wrapper);
        expect(button).toBeDefined();
        expect(button!.element.tagName).toBe('BUTTON');
        expect(button!.attributes('disabled')).toBeUndefined();
        expect(button!.attributes('aria-label')).toBeUndefined();
        button!.element.focus();
        expect(document.activeElement).toBe(button!.element);
    });

    test('downloads the export and saves it under the name the server offers', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
            'GET /billing/export': [[200, EXPORT_BYTES, 'northwind-export.json']],
        });
        const wrapper = await mountBanner(http);

        await exportButton(wrapper)!.trigger('click');
        await flushPromises();

        expect(calls.filter((call) => call === 'GET /billing/export')).toHaveLength(1);
        expect(handedToSave).toHaveLength(1);
        // The bytes themselves are the composable's to hand over unchanged, which
        // its own suite reads; jsdom's Blob cannot read a view from Node's realm.
        expect(handedToSave[0]!.fileName).toBe('northwind-export.json');
        expect(handedToSave[0]!.blob.type).toBe('application/json; charset=utf-8');
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    test('is busy while it downloads, and cannot be pressed a second time meanwhile', async () => {
        const { http: answering, calls } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
            'GET /billing/export': [[200, EXPORT_BYTES, 'northwind-export.json']],
        });
        let release = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const http: HttpClient = async (url, init) => {
            if (url === '/billing/export') await held;
            return answering(url, init);
        };
        const wrapper = await mountBanner(http);

        await exportButton(wrapper)!.trigger('click');
        expect(exportButton(wrapper)!.attributes('aria-busy')).toBe('true');
        expect(exportButton(wrapper)!.attributes('disabled')).toBeDefined();
        await exportButton(wrapper)!.trigger('click');
        release();
        await flushPromises();

        expect(calls.filter((call) => call === 'GET /billing/export')).toHaveLength(1);
        expect(exportButton(wrapper)!.attributes('aria-busy')).toBeUndefined();
        expect(handedToSave).toHaveLength(1);
    });

    test('is offered to nobody the server does not say may take it', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [
                [200, endedToAnyone({ holdsBillingPermission: true, mayExport: false })],
            ],
        });
        const wrapper = await mountBanner(http);

        expect(exportButton(wrapper)).toBeUndefined();
    });

    test('refused, says why in the sentence each refusal is worded with, never its code', async () => {
        const refusals = [
            [
                409,
                'TENANT_EXPORT_NOT_OFFERED',
                'The export of this account is offered once its subscription has ended.',
            ],
            [
                503,
                'TENANT_EXPORT_FAILED',
                'The export of this account could not be produced just now. Please try again later.',
            ],
            [403, 'TENANT_SUSPENDED', 'This account is suspended. Please contact your provider.'],
            [403, 'TENANT_BEING_DELETED', 'This account is being deleted.'],
            [403, 'TENANT_ADMIN_REQUIRED', 'This action requires the TENANT_ADMIN role.'],
        ] as const;
        for (const [status, code, sentence] of refusals) {
            const { http } = httpRouting({
                'GET /billing/account/access': [[200, endedToAdministrator()]],
                'GET /billing/export': [[status, { statusCode: status, code, message: code }]],
            });
            const wrapper = await mountBanner(http);

            await exportButton(wrapper)!.trigger('click');
            await flushPromises();

            expect(wrapper.find('[role="alert"]').text(), code).toBe(sentence);
        }
        expect(handedToSave).toHaveLength(0);
    });

    test('refused in German, says why in German', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
            'GET /billing/export': [[503, { code: 'TENANT_EXPORT_FAILED', message: 'x' }]],
        });
        const wrapper = await mountBanner(http, { german: true });

        await exportButton(wrapper, 'Daten des Kontos exportieren')!.trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe(
            'Der Export dieses Kontos ließ sich gerade nicht erstellen. Bitte versuchen Sie es später erneut.',
        );
    });

    test('failed without a code the platform words, says the export did not arrive, and leaves the banner as it was', async () => {
        const { http, calls } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
            'GET /billing/export': [
                [500, { statusCode: 500, message: 'Internal server error' }],
                [200, EXPORT_BYTES, 'northwind-export.json'],
            ],
        });
        const wrapper = await mountBanner(http);
        const before = wrapper.find('.sp-access-banner').text();

        await exportButton(wrapper)!.trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe('The export could not be downloaded.');
        expect(wrapper.find('.sp-access-banner__state').text()).toBe(
            'This account can be read but not changed at the moment. You can still view and export its data.',
        );
        expect(lines(wrapper)).toEqual([ENDED_LINE]);
        expect(exportButton(wrapper)!.attributes('disabled')).toBeUndefined();
        expect(calls.filter((call) => call.endsWith('/access'))).toHaveLength(1);
        expect(handedToSave).toHaveLength(0);

        await exportButton(wrapper)!.trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(wrapper.find('.sp-access-banner').text()).toBe(before);
        expect(handedToSave).toHaveLength(1);
    });

    test('refused with a code the platform does not word, says the export did not arrive rather than the code', async () => {
        const { http } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
            'GET /billing/export': [
                [502, { code: 'GATEWAY_UNREACHABLE', message: 'upstream gateway unreachable' }],
            ],
        });
        const wrapper = await mountBanner(http);

        await exportButton(wrapper)!.trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe('The export could not be downloaded.');
    });

    test('where the connection breaks, says the export did not arrive', async () => {
        const { http: answering } = httpRouting({
            'GET /billing/account/access': [[200, endedToAdministrator()]],
        });
        const http: HttpClient = async (url, init) => {
            if (url === '/billing/export') throw new TypeError('Failed to fetch');
            return answering(url, init);
        };
        const wrapper = await mountBanner(http);

        await exportButton(wrapper)!.trigger('click');
        await flushPromises();

        expect(wrapper.find('[role="alert"]').text()).toBe('The export could not be downloaded.');
    });
});
