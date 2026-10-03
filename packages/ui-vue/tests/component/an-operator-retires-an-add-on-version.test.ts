// The add-on page offers to retire a version no longer on sale, where the
// version's status is shown, and the dialog says what the announcement will do
// before it is made: the version the bookings continue on and its list prices,
// the dates they move on, whom it misses, and what refuses it.
//
// Mounted as an app mounts the page, against stubbed resources: the test says
// what the server answers and reads what the operator is shown.

// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { afterEach, describe, expect, test } from 'vitest';

import BundlesPage from '../../src/pages/BundlesPage.vue';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import type { MfaPrompt } from '../../src/vue/use-mfa-prompt.js';
import {
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_HTTP_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
} from '../../src/vue/super-admin-context.js';
import { provideStubResources } from './support/stub-resources.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (offsetDays: number): string => new Date(NOW + offsetDays * DAY).toISOString();
const CODE = '123456';

const BUNDLE = {
    id: 'b-1',
    bundleKey: 'SEATS',
    label: 'Seats',
    description: null,
    icon: null,
    sortOrder: 0,
    i18n: {},
    createdAt: iso(-400),
    updatedAt: iso(-400),
    deletedAt: null as string | null,
};

const version = (id: string, fields: Record<string, unknown>) => ({
    id,
    bundleId: 'b-1',
    bundleKey: 'SEATS',
    label: 'Seats',
    features: [],
    quotas: {},
    compatibility: {},
    pricingOverrides: [],
    monthlyNet: '9.00',
    yearlyNet: '90.00',
    marketed: true,
    publishedAt: iso(-400),
    supersededAt: null,
    validFrom: iso(-400),
    validUntil: null,
    createdAt: iso(-400),
    updatedAt: iso(-400),
    ...fields,
});

const OFF_SALE = version('bv-1', { version: 1, validUntil: iso(-31), supersededAt: iso(-60) });
const ON_SALE = version('bv-2', { version: 2, validFrom: iso(-30), monthlyNet: '11.00' });

const side = (bundleVersionId: string, versionNumber: number, monthlyNet: number) => ({
    bundleVersionId,
    bundleKey: 'SEATS',
    label: 'Seats',
    version: versionNumber,
    features: [],
    quotas: {},
    monthlyNet,
    yearlyNet: 90,
});

const reached = (subscriptionBundleId: string) => ({
    tenantId: 't',
    subscriptionId: `s-${subscriptionBundleId}`,
    subscriptionBundleId,
    planKey: 'STANDARD',
    planCycle: 'MONTHLY',
    billingCycle: 'MONTHLY',
    effectiveAt: '2027-02-01T00:00:00.000Z',
    lastDayToCancel: '2027-01-31',
    reachedRecently: false,
});

const PREVIEW = {
    retired: side('bv-1', 1, 9),
    replacement: side('bv-2', 2, 11),
    changes: [{ field: 'monthlyNet', oldValue: '9.00', newValue: '11.00' }],
    asOf: iso(0),
    reached: [reached('sb-1'), reached('sb-2')],
    skipped: [
        { tenantId: 't', subscriptionId: 's-3', subscriptionBundleId: 'sb-3', reason: 'ended' },
    ],
    blockers: [] as Array<{ code: string; message: string; params: Record<string, unknown> }>,
};

const RECORD = {
    id: 'r-1',
    retired: { bundleVersionId: 'bv-1', bundleKey: 'SEATS', version: 1 },
    replacement: { bundleVersionId: 'bv-2', bundleKey: 'SEATS', version: 2 },
    announcedAt: '2026-10-02T09:00:00.000Z',
    announcedBy: 'web:operator@example.com:admin',
    progress: { moved: 0, waiting: 2, overdue: 1, ended: 0, notTold: 0, reminded: 0 },
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

type Page = {
    toggle: (bundle: unknown) => Promise<void>;
    onSelectVersion: (bundleId: string, versionId: string) => void;
    mfa: MfaPrompt;
};

function mountPage({
    capability = true,
    bundles = [BUNDLE],
    versions = [OFF_SALE, ON_SALE],
    preview = PREVIEW,
    list = async (): Promise<unknown[]> => [],
} = {}) {
    const previews: unknown[][] = [];
    const announced: unknown[][] = [];
    const wrapper = mountWithQuasar(BundlesPage as never, {
        global: {
            provide: {
                [SUPER_ADMIN_BRAND_KEY as symbol]: { tag: 'SuperAdmin', name: 'T', logoText: 'T' },
                [SUPER_ADMIN_ENDPOINTS_KEY as symbol]: {
                    apiBase: '/api/admin',
                    publicBootEndpoint: '/api/admin/boot',
                    manifestEndpoint: '/api/admin/manifest',
                },
                [SUPER_ADMIN_HTTP_KEY as symbol]: async () => {
                    throw new Error('the page reached the network past its resources');
                },
                [SUPER_ADMIN_MANIFEST_KEY as symbol]: () => ({
                    capabilities: capability ? { 'bundleVersions.retire': true } : {},
                }),
                ...provideStubResources({
                    bundles: { list: async () => bundles },
                    bundleVersions: { listForBundle: async () => versions },
                    catalog: { features: async () => [], quotas: async () => [] },
                    plans: { list: async () => [] },
                    planVersions: { listForPlan: async () => [] },
                    discovery: { read: async () => ({ status: 'unchanged' }) },
                    bundleVersionRetirements: {
                        list,
                        preview: async (...args: unknown[]) => {
                            previews.push(args);
                            return preview;
                        },
                        announce: async (...args: unknown[]) => {
                            announced.push(args);
                            return { retirement: RECORD, told: 2, failed: 0 };
                        },
                    },
                } as never),
            },
        },
    });
    mounted.push(wrapper);
    return { wrapper, page: wrapper.vm as unknown as Page, previews, announced };
}

/** Opens the add-on and selects `versionId` in its editor. */
async function showVersion(mountedPage: ReturnType<typeof mountPage>, versionId: string) {
    await settle();
    await mountedPage.page.toggle(BUNDLE);
    await settle();
    mountedPage.page.onSelectVersion(BUNDLE.id, versionId);
    await settle();
}

const bannerButtons = (mountedPage: ReturnType<typeof mountPage>) => {
    const banner = mountedPage.wrapper.element.querySelector('.bv-status-banner');
    expect(banner, 'the status banner is not rendered — this case proves nothing').not.toBeNull();
    return [...banner!.querySelectorAll('button')];
};
const retireButton = (mountedPage: ReturnType<typeof mountPage>) =>
    bannerButtons(mountedPage).find((button) => button.textContent?.trim() === 'Retire…');

function dialogButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')].find(
        (element) => element.textContent?.trim() === label,
    );
    expect(button, `no "${label}" button in the dialog`).toBeTruthy();
    return button as HTMLButtonElement;
}

// @requirement SC-BUN-038 — An add-on version is retired only off sale, onto a version of the same add-on on sale
describe('retiring an add-on version where the add-on is managed', () => {
    test('is offered on the version no longer on sale', async () => {
        const mountedPage = mountPage();
        await showVersion(mountedPage, OFF_SALE.id);

        expect(retireButton(mountedPage)).toBeTruthy();
    });

    test('is not offered on the version on sale', async () => {
        const mountedPage = mountPage();
        await showVersion(mountedPage, ON_SALE.id);

        expect(retireButton(mountedPage)).toBeUndefined();
    });

    test('is not offered where the platform does not serve it', async () => {
        const mountedPage = mountPage({ capability: false });
        await showVersion(mountedPage, OFF_SALE.id);

        expect(retireButton(mountedPage)).toBeUndefined();
    });

    // @requirement SC-BUN-047 — The operator sees how far each add-on retirement has come
    test('says on a version that it was retired, onto which version, and how far that has come', async () => {
        const mountedPage = mountPage({ list: async () => [RECORD] });
        await showVersion(mountedPage, OFF_SALE.id);

        const banner = mountedPage.wrapper.element.querySelector('.bv-status-banner')!;
        expect(banner.textContent).toContain('Retired → v2');
        const parts = [...banner.querySelectorAll('.sa-retirement-progress')];
        expect(parts.map((part) => part.textContent?.trim())).toEqual([
            '1 overdue',
            '2 waiting for their date',
        ]);
        expect(parts[0]!.classList).toContain('sa-retirement-progress--attention');
        expect(parts[1]!.classList).not.toContain('sa-retirement-progress--attention');
    });

    test('says so where the announcements could not be read', async () => {
        const mountedPage = mountPage({
            list: async () => {
                throw new Error('database down');
            },
        });
        await showVersion(mountedPage, OFF_SALE.id);

        expect(mountedPage.wrapper.text()).toContain('The retirements could not be read');
    });

    // @requirement SC-BUN-039 — An add-on retirement is announced for exactly the bookings the operator was shown
    test('shows the replacement, its list prices, the dates and whom it misses before anything is sent', async () => {
        const mountedPage = mountPage();
        await showVersion(mountedPage, OFF_SALE.id);

        retireButton(mountedPage)!.click();
        await settle();

        const text = document.body.textContent ?? '';
        expect(mountedPage.previews).toEqual([['bv-1', 'bv-2']]);
        expect(text).toContain('Replacement: SEATS v2');
        expect(text).toMatch(/Monthly\s*€9 → €11/);
        expect(text).toContain('List prices. Where a plan sets a price of its own');
        expect(text).toContain('Reaches 2 bookings');
        expect(text).toContain(
            '2 move on 02/01/2027 — may cancel without the minimum term until 01/31/2027',
        );
        expect(text).toContain('1 ended');
        expect(mountedPage.announced).toEqual([]);
    });

    test('an add-on with no version on sale says so, and asks for no preview', async () => {
        const mountedPage = mountPage({ versions: [OFF_SALE] });
        await showVersion(mountedPage, OFF_SALE.id);

        retireButton(mountedPage)!.click();
        await settle();

        expect(document.body.textContent).toContain(
            'SEATS has no version on sale for the bookings to continue on.',
        );
        expect(mountedPage.previews).toEqual([]);
        expect(dialogButton('Announce').disabled).toBe(true);
    });

    // @requirement SC-BUN-044 — An add-on retirement's replacement has to fit every plan a booking meets from its date
    test('a blocker is said in words, and nothing can be announced', async () => {
        const mountedPage = mountPage({
            preview: {
                ...PREVIEW,
                blockers: [
                    {
                        code: 'BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN',
                        message: 'x',
                        params: { count: 1, bundleKey: 'SEATS', version: 2 },
                    },
                ],
            },
        });
        await showVersion(mountedPage, OFF_SALE.id);

        retireButton(mountedPage)!.click();
        await settle();

        expect(document.body.textContent).toContain(
            '1 of these bookings run beside a plan that v2 of SEATS cannot run beside',
        );
        expect(dialogButton('Announce').disabled).toBe(true);
    });

    // @requirement SC-BUN-039 — An add-on retirement is announced for exactly the bookings the operator was shown
    test('announcing asks for the code, names the bookings shown, and says what was sent', async () => {
        const mountedPage = mountPage();
        await showVersion(mountedPage, OFF_SALE.id);
        retireButton(mountedPage)!.click();
        await settle();

        dialogButton('Announce').click();
        await settle();
        expect(mountedPage.announced).toEqual([]);
        expect(mountedPage.page.mfa.show.value).toBe(true);

        mountedPage.page.mfa.onConfirm(CODE);
        await settle();

        expect(mountedPage.announced).toEqual([
            [
                'bv-1',
                { replacementBundleVersionId: 'bv-2', subscriptionBundleIds: ['sb-1', 'sb-2'] },
                CODE,
            ],
        ]);
        expect(document.body.textContent).toContain('Announced. 2 bookings told');
    });
});

// @requirement SC-ADM-031 — A deleted add-on is called deleted, so retiring names one thing
describe('a deleted add-on', () => {
    test('reads "Deleted", in its row and in the status filter', async () => {
        const deleted = { ...BUNDLE, deletedAt: iso(-5) };
        const { wrapper } = mountPage({ bundles: [deleted] });
        await settle();

        expect(wrapper.text()).toContain('Deleted');
        expect(wrapper.text()).not.toContain('Retired');
    });
});
