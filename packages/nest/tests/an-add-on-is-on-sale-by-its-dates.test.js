import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CatalogBundleUpsellResolver,
    PublicCatalogController,
    SubscriptionBundlePreviewService,
    SubscriptionBundlesService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { PublicMarketingCatalogService } from '../dist/catalog/index.js';
import {
    FakeBundleRepository,
    FakePlanRepository,
    FakeSubscriptionBundleRepository,
} from '../dist/testing/index.js';

// An add-on is on sale by its dates, as a plan is.
//
// Version 1 sells from January. Version 2 is published with a start in June, which
// supersedes version 1 at once and closes its window on 31 May. Until then the
// add-on a tenant is shown and can book is version 1; from June it is version 2.
// The catalogue, the upsell, the preview and the booking ask the same question.

const at = (day) => new Date(`${day}T00:00:00.000Z`);
const MAY = at('2026-05-15');
const JUNE = at('2026-06-02');

/** The bundle version as a booking reads it, with the window and supersession given. */
function version({ id, validFrom, validUntil = null, supersededAt = null, publishedAt }) {
    return {
        id,
        bundleId: 'b-1',
        bundleKey: 'REPORTS',
        label: 'Reports',
        version: 1,
        features: ['REPORTS'],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        marketed: true,
        publishedAt: publishedAt === undefined ? '2026-01-01T00:00:00.000Z' : publishedAt,
        supersededAt,
        validFrom,
        validUntil,
    };
}

const PREDECESSOR = version({
    id: 'bv-1',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-05-31T00:00:00.000Z',
    supersededAt: '2026-05-10T00:00:00.000Z',
});
const SUCCESSOR = version({ id: 'bv-2', validFrom: '2026-06-01T00:00:00.000Z' });

function bookingOf(bundleVersion) {
    const added = [];
    const svc = new SubscriptionBundlesService(
        {
            add: async (data) => {
                added.push(data);
                return { id: 'sb-1', ...data };
            },
            listBySubscription: async () => [],
            listActiveBySubscription: async () => [],
            findById: async () => null,
        },
        { findVersionById: async () => bundleVersion, findById: async () => ({ deletedAt: null }) },
        { defaultMinimumTermMonths: 0 },
    );
    const book = (startedAt) =>
        svc.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: bundleVersion.id,
            currentPlanKey: 'STANDARD',
            startedAt,
            parentEndsAt: null,
            planCycle: 'MONTHLY',
            planPeriodEnd: at('2026-06-30'),
            planAnchorDay: 1,
            plansAhead: [],
        });
    return { book, added };
}

/** Refused with 422 and `code`, carrying `params` where given. */
const refusedWith = (code, params) => (error) => {
    assert.equal(error.getStatus?.(), 422);
    const body = error.getResponse();
    assert.equal(body.code, code);
    if (params) assert.deepEqual(body.params, params);
    return true;
};

// @requirement SC-BUN-035 — An add-on is on sale by its dates, in the catalogue and at booking alike
describe('a tenant booking an add-on', () => {
    test('takes the predecessor until its successor starts, though it is superseded', async () => {
        const { book, added } = bookingOf(PREDECESSOR);
        await book(MAY);
        assert.equal(added.length, 1);
    });

    test('is refused a version whose start is still to come, and told when it starts', async () => {
        const { book, added } = bookingOf(SUCCESSOR);
        await assert.rejects(
            () => book(MAY),
            refusedWith('BUNDLE_VERSION_NOT_YET_ON_SALE', {
                bundleVersionId: 'bv-2',
                validFrom: '2026-06-01',
            }),
        );
        assert.equal(added.length, 0);
    });

    test('takes the successor from its first day', async () => {
        const { book, added } = bookingOf(SUCCESSOR);
        await book(JUNE);
        assert.equal(added.length, 1);
    });

    test('is refused the predecessor once its successor has taken over', async () => {
        const { book } = bookingOf(PREDECESSOR);
        await assert.rejects(() => book(JUNE), refusedWith('BUNDLE_VERSION_SUPERSEDED'));
    });

    test('is refused a version superseded without a last day', async () => {
        const { book } = bookingOf(
            version({ id: 'bv-0', validFrom: null, supersededAt: '2026-05-10T00:00:00.000Z' }),
        );
        await assert.rejects(() => book(MAY), refusedWith('BUNDLE_VERSION_SUPERSEDED'));
    });

    test('is refused a draft', async () => {
        const { book } = bookingOf(version({ id: 'bv-d', validFrom: null, publishedAt: null }));
        await assert.rejects(() => book(MAY), refusedWith('BUNDLE_VERSION_NOT_PUBLISHED'));
    });
});

// @requirement SC-BUN-035 — An add-on is on sale by its dates, in the catalogue and at booking alike
describe('the preview of an add-on booking', () => {
    const CTX = {
        subscriptionId: 'sub-1',
        currentPlanKey: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        startedAt: at('2026-01-01'),
        currentPeriodStart: at('2026-05-01'),
        currentPeriodEnd: at('2026-06-01'),
        parentEndsAt: null,
        planAnchorDay: 1,
        plansAhead: [],
    };
    const previewOf = (bundleVersion, now) =>
        new SubscriptionBundlePreviewService(
            new FakeSubscriptionBundleRepository(),
            {
                findVersionById: async () => bundleVersion,
                findById: async () => ({ deletedAt: null }),
            },
            null,
        ).previewAdd(CTX, { bundleVersionId: bundleVersion.id }, now);
    const codes = (dto) => dto.blockers.map((blocker) => blocker.code);

    test('says what the booking would say: the successor is not on sale before June', async () => {
        assert.ok(
            codes(await previewOf(SUCCESSOR, MAY)).includes('BUNDLE_VERSION_NOT_YET_ON_SALE'),
        );
    });

    test('and has no word against the superseded predecessor while its window is open', async () => {
        const blockers = codes(await previewOf(PREDECESSOR, MAY));
        assert.equal(blockers.includes('BUNDLE_VERSION_SUPERSEDED'), false);
        assert.equal(blockers.includes('BUNDLE_VERSION_NOT_YET_ON_SALE'), false);
    });
});

/** v1 from January, v2 published with a start in `successorStart`, through the fake's publish. */
async function bundleWithSuccessor(successorStart) {
    const bundles = new FakeBundleRepository();
    const bundle = await bundles.create({ bundleKey: 'REPORTS', label: 'Reports' });
    const publish = async (monthlyNet, validFrom) => {
        const draft = await bundles.createDraft({
            bundleId: bundle.id,
            features: ['REPORTS'],
            monthlyNet,
            compatibility: {},
            marketed: true,
        });
        return bundles.publishDraft(draft.id, {
            publishedByUserId: null,
            publishedChanges: [],
            nonRegressive: true,
            validFrom,
            validUntil: null,
        });
    };
    const first = await publish('9.90', at('2026-01-01'));
    await publish('12.90', successorStart);
    return { bundles, first };
}

// @requirement SC-BUN-035 — An add-on is on sale by its dates, in the catalogue and at booking alike
describe('the public catalogue', () => {
    test('shows the add-on version on sale at the moment it is read', async () => {
        const { bundles } = await bundleWithSuccessor(at('2026-06-01'));
        const svc = new PublicMarketingCatalogService(
            new FakePlanRepository(),
            { findByTarget: async () => null },
            { list: async () => [] },
            null,
            bundles,
        );
        const priceAt = async (asOf) =>
            (await svc.getCatalog('en', 'EUR', 19, asOf)).bundles.map((b) => b.monthlyNet);

        assert.deepEqual(await priceAt(MAY), [9.9], 'version 1, superseded but still on sale');
        assert.deepEqual(await priceAt(JUNE), [12.9], 'version 2 from its first day');
    });
});

// The successor starts in 2099: published, newest, and not on sale. These two
// read the clock rather than a moment they are given.
const SUCCESSOR_IN_2099 = at('2099-01-01');

// @requirement SC-BUN-035 — An add-on is on sale by its dates, in the catalogue and at booking alike
describe('the bundle list of the public catalogue', () => {
    test('lists the add-on version on sale now, not the newest published', async () => {
        const { bundles, first } = await bundleWithSuccessor(SUCCESSOR_IN_2099);
        const listed = await new PublicCatalogController(
            givenPlanCatalogSource({ plans: [] }),
            {},
            null,
            bundles,
        ).listBundles();
        assert.deepEqual(
            listed.map((entry) => entry.bundleVersionId),
            [first.id],
        );
    });
});

// @requirement SC-BUN-035 — An add-on is on sale by its dates, in the catalogue and at booking alike
describe('the upsell', () => {
    test('offers the add-on version on sale now, not the newest published', async () => {
        const { bundles, first } = await bundleWithSuccessor(SUCCESSOR_IN_2099);
        const offers = await new CatalogBundleUpsellResolver(bundles).resolveOffers(
            ['REPORTS'],
            't1',
        );
        assert.deepEqual(
            offers.map((offer) => offer.bundleVersionId),
            [first.id],
        );
    });
});
