import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { BundlesService } from '../dist/catalog/index.js';
import {
    AddSubscriptionBundleDto,
    PreviewSubscriptionBundleDto,
    SubscriptionBundlesService,
} from '../dist/billing/index.js';
import { FakeBundleRepository } from '../dist/testing/index.js';

// The bundle lifecycle from outside, one step per thing a person does.
//
// The arithmetic is proved next door in `a-bundle-runs-in-step-with-its-plan`
// and the previews in `subscription-bundle-preview`. What this file walks is the
// journey — an operator putting a bundle in the catalogue, a tenant looking at
// it, booking it, living with it, and leaving it — and it exists because the
// gaps between those steps are where nobody was looking: the refusal an operator
// actually reads, the booking made during a trial, the rhythm a plan change can
// invalidate after the fact, and what the HTTP boundary lets through at all.
//
// Every step has its negative beside it. A rule that only ever sees inputs it
// accepts is not a rule that has been tested.

const at = (s) => new Date(`${s}T00:00:00.000Z`);
const iso = (d) => (d === null ? null : d.toISOString().slice(0, 10));

let bundleRepo;
let catalog;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    catalog = new BundlesService(bundleRepo, null, { strictModeCheckMode: 'warn-only' });
});

/** A catalogue service that can see the plans a bundle is offered to. */
function withPlans(plans) {
    const planRepo = {
        list: async () => plans.map((p) => ({ id: p.planKey, planKey: p.planKey })),
        listVersions: async (planKey) => {
            const plan = plans.find((p) => p.planKey === planKey);
            return plan
                ? [
                      {
                          id: `pv-${planKey}`,
                          planId: planKey,
                          version: 1,
                          publishedAt: new Date('2026-01-01'),
                          supersededAt: null,
                          monthlyNet: plan.monthlyNet,
                          yearlyNet: plan.yearlyNet,
                      },
                  ]
                : [];
        },
    };
    return new BundlesService(
        bundleRepo,
        null,
        { strictModeCheckMode: 'warn-only' },
        null,
        planRepo,
    );
}

async function draft(fields) {
    const bundle = await catalog.createBundle({
        bundleKey: `B${Math.abs(JSON.stringify(fields).length)}`,
        label: 'Reporting',
    });
    return catalog.createBundleDraft({
        bundleId: bundle.id,
        features: ['REPORTS'],
        ...fields,
    });
}

const publish = (created) =>
    catalog.publishBundleVersion(created.bundleVersion.id, {
        publishedByUserId: null,
        validFrom: '2026-01-01',
    });

const codeOf = (err) => err.getResponse?.().code;

// ─── 1. An operator puts a bundle in the catalogue ────────────────────────

describe('an operator publishes a bundle', () => {
    test('a base price is enough', async () => {
        const published = await publish(await draft({ monthlyNet: '9.90' }));
        assert.ok(published.bundleVersion.publishedAt, 'the version must go live');
    });

    test('a price only for one plan is enough — that plan can buy it', async () => {
        // A bundle sold to one plan and not offered to the others is a normal
        // catalogue shape, and the publish gate asks whether ANY price resolves,
        // not whether a base one does.
        const published = await publish(
            await draft({
                monthlyNet: null,
                yearlyNet: null,
                pricingOverrides: [{ planId: 'PRO', monthlyNet: '4.90', yearlyNet: '49.00' }],
            }),
        );
        assert.ok(published.bundleVersion.publishedAt);
    });

    test('no price anywhere is refused, and the message says why', async () => {
        const priceless = await draft({ monthlyNet: null, yearlyNet: null });
        await assert.rejects(
            () => publish(priceless),
            (err) => {
                assert.equal(codeOf(err), 'BUNDLE_VERSION_NO_PRICE');
                assert.match(err.getResponse().message, /without a price/i);
                return true;
            },
        );
    });

    test('an explicit zero is refused as a zero, not as a missing price', async () => {
        // Two different mistakes with two different remedies: a seed placeholder
        // that should be null, and a bundle nobody priced. An operator who reads
        // "no price" for a 0.00 they typed on purpose goes looking in the wrong
        // place, so the order of the two checks is part of the contract.
        const zeroPriced = await draft({ monthlyNet: '0.00' });
        await assert.rejects(
            () => publish(zeroPriced),
            (err) => {
                assert.equal(codeOf(err), 'BUNDLE_VERSION_ZERO_PRICE');
                return true;
            },
        );
    });

    test('a bundle a compatible plan could not buy is refused, naming plan and cycle', async () => {
        // "Some price resolves" is not "this plan, in the rhythm it is sold in,
        // resolves one". A monthly-only bundle offered to a plan sold yearly
        // passes the first and fails the second — and without this the failure
        // surfaces at a tenant's checkout instead of the operator's desk.
        catalog = withPlans([{ planKey: 'PRO', monthlyNet: '49.00', yearlyNet: '490.00' }]);
        const monthlyOnly = await draft({ monthlyNet: '9.90', yearlyNet: null });
        await assert.rejects(
            () => publish(monthlyOnly),
            (err) => {
                // Its own code, not the "no price at all" one: two different
                // mistakes with two different remedies, and an operator who
                // reads the wrong one goes looking in the wrong place.
                assert.equal(codeOf(err), 'BUNDLE_VERSION_NOT_PRICED_FOR_PLAN');
                assert.equal(err.getResponse().params.planKey, 'PRO');
                assert.equal(err.getResponse().params.billingCycle, 'YEARLY');
                return true;
            },
        );
    });

    test('…and the same bundle restricted to a monthly-only plan publishes', async () => {
        catalog = withPlans([
            { planKey: 'PRO', monthlyNet: '49.00', yearlyNet: '490.00' },
            { planKey: 'LITE', monthlyNet: '9.00', yearlyNet: null },
        ]);
        const published = await publish(
            await draft({
                monthlyNet: '9.90',
                yearlyNet: null,
                compatibility: { planIds: ['LITE'] },
            }),
        );
        assert.ok(published.bundleVersion.publishedAt);
    });

    test('a plan override adds the cycle the base price is missing', async () => {
        // An omitted field leaves the base price standing; an explicit null
        // takes it away. The distinction is the whole of override resolution,
        // and it is easy to get backwards — this pins both halves.
        catalog = withPlans([{ planKey: 'PRO', monthlyNet: '49.00', yearlyNet: '490.00' }]);
        const published = await publish(
            await draft({
                monthlyNet: '9.90',
                yearlyNet: null,
                pricingOverrides: [{ planId: 'PRO', yearlyNet: '99.00' }],
            }),
        );
        assert.ok(published.bundleVersion.publishedAt);
    });

    test('…and an override that nulls a cycle takes that plan’s price away', async () => {
        catalog = withPlans([{ planKey: 'PRO', monthlyNet: '49.00', yearlyNet: '490.00' }]);
        const stripped = await draft({
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            pricingOverrides: [{ planId: 'PRO', monthlyNet: null }],
        });
        await assert.rejects(
            () => publish(stripped),
            (err) => {
                assert.equal(err.getResponse().params.planKey, 'PRO');
                assert.equal(err.getResponse().params.billingCycle, 'MONTHLY');
                return true;
            },
        );
    });

    test('without a plan repository the catalogue cannot be derived, so nothing is claimed', async () => {
        // A consumer that binds no plan repository has no catalogue to check
        // against, and guessing would refuse valid bundles. The base gate still
        // holds; only the per-plan question is skipped.
        const monthlyOnly = await draft({ monthlyNet: '9.90', yearlyNet: null });
        const published = await publish(monthlyOnly);
        assert.ok(published.bundleVersion.publishedAt);
    });

    test('an override that removes the price for one plan still publishes', async () => {
        // The base price carries the others; the override says "not for PRO".
        // Whether PRO may then book it is a booking question, answered below.
        const published = await publish(
            await draft({
                monthlyNet: '9.90',
                pricingOverrides: [{ planId: 'PRO', monthlyNet: null, yearlyNet: null }],
            }),
        );
        assert.ok(published.bundleVersion.publishedAt);
    });
});

// ─── 2. A tenant books one ────────────────────────────────────────────────

describe('a key an operator has retired', () => {
    // The unique index does not exclude retired rows, so the key is still
    // taken. What decides whether the operator learns that as a sentence or as
    // a 500 is one predicate in one repository method.

    test('creating the same key again is refused, with the code that says why', async () => {
        const bundle = await catalog.createBundle({
            bundleKey: 'REPORTING',
            label: 'Reporting',
        });
        await bundleRepo.softDelete(bundle.id);

        await assert.rejects(
            () =>
                catalog.createBundle({
                    bundleKey: 'REPORTING',
                    label: 'Reporting, again',
                }),
            (err) => {
                assert.equal(codeOf(err), 'BUNDLE_ALREADY_EXISTS');
                return true;
            },
        );
    });

    test('a key nobody used is still free', async () => {
        const bundle = await catalog.createBundle({
            bundleKey: 'REPORTING',
            label: 'Reporting',
        });
        await bundleRepo.softDelete(bundle.id);

        const other = await catalog.createBundle({
            bundleKey: 'ANALYTICS',
            label: 'Analytics',
        });
        assert.ok(other.id);
    });
});

describe('a tenant books a bundle', () => {
    const version = (fields = {}) => ({
        id: 'bv-1',
        bundleId: 'b-1',
        bundleKey: 'REPORTING',
        label: 'Reporting',
        publishedAt: at('2025-01-01'),
        supersededAt: null,
        compatibility: {},
        features: ['REPORTS'],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        pricingOverrides: [],
        ...fields,
    });

    function service(bundleVersion) {
        const written = [];
        const svc = new SubscriptionBundlesService(
            {
                add: async (data) => {
                    written.push(data);
                    return { id: 'sb-1', ...data };
                },
                listBySubscription: async () => [],
                listActiveBySubscription: async () => [],
                findById: async () => null,
            },
            { findVersionById: async () => bundleVersion },
            { defaultMinimumTermMonths: 12 },
        );
        return { svc, written };
    }

    const book = (svc, overrides = {}) =>
        svc.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: 'bv-1',
            currentPlanKey: 'PRO',
            startedAt: at('2026-02-21'),
            parentEndsAt: null,
            planCycle: 'MONTHLY',
            planPeriodEnd: at('2026-03-21'),
            planAnchorDay: 21,
            ...overrides,
        });

    test('on a running plan it gets a window on the plan’s day', async () => {
        const { svc, written } = service(version());
        await book(svc);
        assert.equal(iso(written[0].currentPeriodEnd), '2026-03-21');
        assert.equal(written[0].billingCycle, 'MONTHLY');
    });

    test('during a trial it is booked, and waits for a window rather than inventing one', async () => {
        // A trial has nothing to align to. The booking succeeds — the tenant
        // gets the features — and the renewal job opens its first window once
        // the plan has a paid period.
        const { svc, written } = service(version());
        await book(svc, { planPeriodEnd: null, planAnchorDay: null });
        assert.equal(written[0].currentPeriodEnd, null);
        assert.equal(written[0].currentPeriodStart, null);
        // The rhythm is still recorded — it is what tells a waiting booking
        // apart from one written before bundles had windows at all.
        assert.equal(written[0].billingCycle, 'MONTHLY');
    });

    test('a plan that has no price for it refuses the booking outright', async () => {
        const { svc } = service(
            version({ pricingOverrides: [{ planId: 'PRO', monthlyNet: null, yearlyNet: null }] }),
        );
        await assert.rejects(
            () => book(svc),
            (err) => codeOf(err) === 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
        );
    });

    test('…while a plan the override does not touch books it happily', async () => {
        const { svc, written } = service(
            version({ pricingOverrides: [{ planId: 'OTHER', monthlyNet: null, yearlyNet: null }] }),
        );
        await book(svc);
        assert.equal(written.length, 1);
    });
});

// ─── 3. What the HTTP boundary lets through ───────────────────────────────

describe('the request bodies a tenant can send', () => {
    // The platform does not install the validation pipe — the consumer does —
    // so a decorator dropped in a refactor removes a check silently. These ask
    // what the decorators say.
    const refused = (Dto, payload) =>
        validateSync(plainToInstance(Dto, payload), { forbidUnknownValues: true })
            .map((e) => e.property)
            .sort();

    const BOOKING = { bundleVersionId: '11111111-1111-4111-8111-111111111111' };

    test('a booking needs a version id, and it must be one', () => {
        assert.deepEqual(refused(AddSubscriptionBundleDto, BOOKING), []);
        assert.deepEqual(refused(AddSubscriptionBundleDto, {}), ['bundleVersionId']);
        assert.deepEqual(refused(AddSubscriptionBundleDto, { bundleVersionId: 'REPORTING' }), [
            'bundleVersionId',
        ]);
    });

    test('the rhythm is one of two words, and nothing else', () => {
        for (const billingCycle of ['MONTHLY', 'YEARLY']) {
            assert.deepEqual(refused(AddSubscriptionBundleDto, { ...BOOKING, billingCycle }), []);
        }
        for (const billingCycle of ['monthly', 'WEEKLY', 'QUARTERLY', 12]) {
            assert.deepEqual(
                refused(AddSubscriptionBundleDto, { ...BOOKING, billingCycle }),
                ['billingCycle'],
                `"${billingCycle}" must be refused`,
            );
        }
    });

    test('the rhythm is optional — omitting it means the plan’s, and so does null', () => {
        // `@IsOptional()` treats null as absent, here as everywhere in this
        // codebase. A client that sends `billingCycle: null` is saying "you
        // choose", and the service reads it as the plan's rhythm.
        assert.deepEqual(refused(AddSubscriptionBundleDto, BOOKING), []);
        assert.deepEqual(refused(AddSubscriptionBundleDto, { ...BOOKING, billingCycle: null }), []);
    });

    test('a minimum term is a whole number of months within ten years', () => {
        for (const minimumTermMonths of [0, 1, 12, 120]) {
            assert.deepEqual(
                refused(AddSubscriptionBundleDto, { ...BOOKING, minimumTermMonths }),
                [],
            );
        }
        for (const minimumTermMonths of [-1, 121, 1.5, '12']) {
            assert.deepEqual(
                refused(AddSubscriptionBundleDto, { ...BOOKING, minimumTermMonths }),
                ['minimumTermMonths'],
                `${minimumTermMonths} must be refused`,
            );
        }
    });

    test('a preview takes the same rhythm the booking does', () => {
        // It did not, and that was the defect: a tenant asking for a monthly
        // bundle beside a yearly plan was quoted the yearly one.
        assert.deepEqual(
            refused(PreviewSubscriptionBundleDto, { ...BOOKING, billingCycle: 'MONTHLY' }),
            [],
        );
        assert.deepEqual(
            refused(PreviewSubscriptionBundleDto, { ...BOOKING, billingCycle: 'FORTNIGHTLY' }),
            ['billingCycle'],
        );
    });

    test('a preview asks about exactly one thing, and either is optional alone', () => {
        assert.deepEqual(refused(PreviewSubscriptionBundleDto, BOOKING), []);
        assert.deepEqual(
            refused(PreviewSubscriptionBundleDto, {
                subscriptionBundleId: '22222222-2222-4222-8222-222222222222',
            }),
            [],
        );
        // Which of the two is required is the controller's decision, not the
        // DTO's — it answers 400 BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS for both.
        assert.deepEqual(refused(PreviewSubscriptionBundleDto, {}), []);
    });
});
