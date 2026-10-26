// What the operator reads of a subscriber's contracts: each as it was frozen,
// and what each changed against the one before it for the same tenant. Read
// from the contracts alone, so a plan that left the catalogue changes nothing
// here.

// @requirement SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    adminContractInvoicesOf,
    adminContractLinesOf,
    adminSubscriberContractOf,
    adminSubscriberContractsOf,
    contractChangesOf,
    contractSourceStateOf,
} from '../dist/index.js';

const BERLIN = 'Europe/Berlin';

/** A frozen line: `priceNet` over one of its periods, as a contract keeps it. */
function line(kind, sourceKey, priceNet, overrides = {}) {
    return {
        id: `${kind}-${sourceKey}`,
        contractId: 'c',
        kind,
        sourceKey,
        sourceVersionId: `${sourceKey}-v1`,
        titleSnapshot: `${sourceKey} title`,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet,
        priceGross: priceNet,
        billingCycle: 'monthly',
        currency: 'EUR',
        taxRate: 19,
        taxAmount: 0,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    };
}

/** A contract of `tenantId` starting at `from`, written a minute after it. */
function contract(id, from, lines, overrides = {}) {
    const effectiveFrom = new Date(from);
    const totalGross = overrides.totalGross ?? lines.reduce((sum, l) => sum + l.priceGross, 0);
    return {
        id,
        tenantId: 't1',
        subscriberId: 's1',
        subscriber: { legalName: 'Muster GmbH' },
        issuer: null,
        partiesMigrated: false,
        taxTreatment: null,
        cancellationNoticeDays: 14,
        termsVersion: '2026-10',
        agreedAt: effectiveFrom,
        status: 'active',
        effectiveFrom,
        effectiveUntil: null,
        originalOfferId: null,
        originalPlanVersionId: null,
        originalBundleVersionIds: [],
        entitlementSnapshot: null,
        priceSnapshot: {
            currency: 'EUR',
            billingCycle: 'monthly',
            subtotalNet: totalGross,
            discountNet: 0,
            totalNet: totalGross,
            vatRate: 19,
            totalGross,
        },
        promotionSnapshots: [],
        promoCodeSnapshots: [],
        termsSnapshot: null,
        lineItems: lines,
        createdAt: new Date(effectiveFrom.getTime() + 60_000),
        updatedAt: new Date(effectiveFrom.getTime() + 60_000),
        ...overrides,
    };
}

const plan = (key, priceNet, cycle = 'monthly') =>
    line('plan', key, priceNet, { billingCycle: cycle });
const bundle = (key, priceNet = 5) => line('bundle', key, priceNet);

/** What the second contract changed against the first, for one tenant. */
function changeBetween(first, second) {
    return contractChangesOf([first, second]).get(second.id);
}

describe('what a contract changed against the one before it', () => {
    test('the first contract of a tenant is concluded, not changed', () => {
        const only = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)]);

        assert.deepEqual(contractChangesOf([only]).get('c1'), {
            concluded: true,
            plan: null,
            bundlesAdded: [],
            bundlesRemoved: [],
            frozenAnew: false,
            priceChanged: false,
            cancelled: false,
        });
    });

    for (const [why, before, after, expected] of [
        ['a dearer plan', plan('BASIC', 29), plan('PRO', 49), 'upgraded'],
        ['a cheaper plan', plan('PRO', 49), plan('BASIC', 29), 'downgraded'],
        ['a plan a cent dearer', plan('BASIC', 29), plan('PRO', 29.01), 'upgraded'],
        ['a plan a cent cheaper', plan('BASIC', 29), plan('PRO', 28.99), 'downgraded'],
        ['another plan at the same price', plan('BASIC', 29), plan('PRO', 29), 'changed'],
        [
            'a yearly plan cheaper per month (29 €/month → 290 €/year)',
            plan('BASIC', 29),
            plan('PRO', 290, 'yearly'),
            'downgraded',
        ],
        [
            'a yearly plan at the same price per month (29 €/month → 348 €/year)',
            plan('BASIC', 29),
            plan('PRO', 348, 'yearly'),
            'changed',
        ],
        [
            'a plan in another currency',
            plan('BASIC', 29),
            line('plan', 'PRO', 10, { currency: 'CHF' }),
            'changed',
        ],
        ['the same plan at another price', plan('BASIC', 29), plan('BASIC', 39), null],
    ]) {
        test(`${why} is ${expected ?? 'no change of plan'}`, () => {
            const first = contract('c1', '2026-01-01T00:00:00Z', [before]);
            const second = contract('c2', '2026-02-01T00:00:00Z', [after]);

            assert.equal(changeBetween(first, second).plan, expected);
        });
    }

    test('a plan on one side only is a change of plan; none on either is none', () => {
        const withPlan = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)]);
        const withoutPlan = contract('c2', '2026-02-01T00:00:00Z', [bundle('STORAGE')]);
        const alsoWithout = contract('c3', '2026-03-01T00:00:00Z', [bundle('STORAGE', 9)]);

        const changes = contractChangesOf([withPlan, withoutPlan, alsoWithout]);
        assert.equal(changes.get('c2').plan, 'changed');
        assert.equal(changes.get('c3').plan, null);
    });

    test('names the add-ons added and the ones removed, by their key', () => {
        const first = contract('c1', '2026-01-01T00:00:00Z', [
            plan('BASIC', 29),
            bundle('STORAGE'),
            bundle('USERS'),
        ]);
        const second = contract('c2', '2026-02-01T00:00:00Z', [
            plan('BASIC', 29),
            bundle('USERS'),
            bundle('SUPPORT'),
        ]);

        const change = changeBetween(first, second);
        assert.deepEqual(change.bundlesAdded, [{ key: 'SUPPORT', title: 'SUPPORT title' }]);
        assert.deepEqual(change.bundlesRemoved, [{ key: 'STORAGE', title: 'STORAGE title' }]);
        assert.equal(change.frozenAnew, false);
    });

    test('an add-on at another version is neither added nor removed', () => {
        const first = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29), bundle('USERS')]);
        const second = contract('c2', '2026-02-01T00:00:00Z', [
            plan('BASIC', 29),
            line('bundle', 'USERS', 7, { sourceVersionId: 'USERS-v2' }),
        ]);

        const change = changeBetween(first, second);
        assert.deepEqual([change.bundlesAdded, change.bundlesRemoved], [[], []]);
        assert.equal(change.frozenAnew, true);
        assert.equal(change.priceChanged, true);
    });

    test('the same plan and add-ons written anew is frozen anew, at the price it says', () => {
        const first = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)]);
        const same = contract('c2', '2026-02-01T00:00:00Z', [plan('BASIC', 29)]);
        const dearer = contract('c3', '2026-03-01T00:00:00Z', [plan('BASIC', 31)]);

        const changes = contractChangesOf([first, same, dearer]);
        assert.deepEqual(
            [changes.get('c2').frozenAnew, changes.get('c2').priceChanged],
            [true, false],
        );
        assert.deepEqual(
            [changes.get('c3').frozenAnew, changes.get('c3').priceChanged],
            [true, true],
        );
    });

    test('the price compares per year, so a yearly contract at the same price per month is unchanged', () => {
        const monthly = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)]);
        const yearly = contract('c2', '2026-02-01T00:00:00Z', [plan('BASIC', 348, 'yearly')], {
            priceSnapshot: { ...monthly.priceSnapshot, billingCycle: 'yearly', totalGross: 348 },
        });

        assert.equal(changeBetween(monthly, yearly).priceChanged, false);
    });

    test('the last contract of a tenant that ends is cancelled; one open-ended or superseded is not', () => {
        const superseded = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)], {
            status: 'superseded',
            effectiveUntil: new Date('2026-02-01T00:00:00Z'),
        });
        const ending = contract('c2', '2026-02-01T00:00:00Z', [plan('PRO', 49)], {
            effectiveUntil: new Date('2026-06-01T00:00:00Z'),
        });
        const terminated = contract('c3', '2026-01-01T00:00:00Z', [plan('BASIC', 29)], {
            tenantId: 't2',
            status: 'terminated',
            effectiveUntil: new Date('2026-03-01T00:00:00Z'),
        });
        const running = contract('c4', '2026-01-01T00:00:00Z', [plan('BASIC', 29)], {
            tenantId: 't3',
        });

        const changes = contractChangesOf([superseded, ending, terminated, running]);
        assert.deepEqual(
            ['c1', 'c2', 'c3', 'c4'].map((id) => changes.get(id).cancelled),
            [false, true, true, false],
        );
    });

    test('a contract never in force is not what the next one changed, and is not cancelled', () => {
        const basic = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)], {
            status: 'superseded',
            effectiveUntil: new Date('2026-03-01T00:00:00Z'),
        });
        // Scheduled for April, and replaced in February before it began.
        const scheduledPro = contract('c2', '2026-04-01T00:00:00Z', [plan('PRO', 49)], {
            status: 'superseded',
            effectiveUntil: new Date('2026-02-15T00:00:00Z'),
            createdAt: new Date('2026-01-20T00:00:00Z'),
        });
        const basicAgain = contract('c3', '2026-05-01T00:00:00Z', [plan('BASIC', 29)]);

        const changes = contractChangesOf([basic, scheduledPro, basicAgain]);
        assert.equal(
            changes.get('c2').plan,
            'upgraded',
            'compared with the one in force before it',
        );
        assert.equal(changes.get('c2').cancelled, false);
        assert.equal(
            changes.get('c3').plan,
            null,
            'the plan in force before it was Basic, not the Pro that never began',
        );
        assert.equal(changes.get('c3').frozenAnew, true);
    });

    test('a cancellation that lands where a scheduled change was to begin is said at the contract it ended', () => {
        // A downgrade scheduled for 1 May, then a cancellation to the same day:
        // the cancellation finds the scheduled contract, which starts then, and
        // ends it before it begins. The contract the tenant was under ends on
        // 1 May all the same, and nothing follows it.
        const basic = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)], {
            effectiveUntil: new Date('2026-05-01T00:00:00Z'),
        });
        const downgrade = contract('c2', '2026-05-01T00:00:00Z', [plan('LITE', 19)], {
            status: 'terminated',
            effectiveUntil: new Date('2026-05-01T00:00:00Z'),
            createdAt: new Date('2026-03-01T00:00:00Z'),
        });

        const changes = contractChangesOf([basic, downgrade]);
        assert.equal(changes.get('c1').cancelled, true, 'the last contract in force was cancelled');
        assert.equal(changes.get('c2').cancelled, false, 'the one that never began was not');
    });

    test('each tenant has a timeline of its own, ordered by start and then by when written', () => {
        const laterT1 = contract('c2', '2026-03-01T00:00:00Z', [plan('PRO', 49)]);
        const firstT2 = contract('c3', '2026-02-01T00:00:00Z', [plan('PRO', 49)], {
            tenantId: 't2',
        });
        const firstT1 = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)]);
        // Its id sorts before c2's, and it was written after c2: when it was
        // written decides, not its id.
        const sameStartT1 = contract('c0', '2026-03-01T00:00:00Z', [plan('PREMIUM', 99)], {
            createdAt: new Date('2026-03-02T00:00:00Z'),
        });

        const changes = contractChangesOf([laterT1, firstT2, firstT1, sameStartT1]);
        assert.equal(changes.get('c1').concluded, true);
        assert.equal(changes.get('c3').concluded, true, 'another tenant starts its own');
        assert.equal(changes.get('c2').plan, 'upgraded', 'Basic to Pro');
        assert.equal(changes.get('c0').plan, 'upgraded', 'Pro to Premium, written after c2');
    });
});

describe('a contract as the list shows it', () => {
    test('reads its days in the installation’s zone, across midnight', () => {
        // 23:30 UTC on 31 January is 00:30 on 1 February in Berlin.
        const across = contract('c1', '2026-01-31T23:30:00Z', [plan('BASIC', 29)], {
            effectiveUntil: new Date('2026-02-28T23:00:00Z'),
        });

        const view = adminSubscriberContractsOf([across], [], BERLIN)[0];
        assert.deepEqual([view.firstDay, view.lastDay], ['2026-02-01', '2026-02-28']);
    });

    test('an end at midnight leaves the day before as its last day', () => {
        // Midnight on 1 March in Berlin.
        const ending = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)], {
            effectiveUntil: new Date('2026-02-28T23:00:00Z'),
        });

        assert.equal(adminSubscriberContractsOf([ending], [], BERLIN)[0].lastDay, '2026-02-28');
    });

    test('one never in force has no last day and says so', () => {
        const never = contract('c1', '2026-04-01T00:00:00Z', [plan('PRO', 49)], {
            status: 'superseded',
            effectiveUntil: new Date('2026-02-15T00:00:00Z'),
        });

        const view = adminSubscriberContractsOf([never], [], BERLIN)[0];
        assert.deepEqual([view.neverInForce, view.lastDay], [true, null]);
        assert.equal(view.change.cancelled, false, 'it ended before it began, nobody cancelled it');
    });

    test('names its plan and add-ons as frozen, and the latest minimum term of its lines', () => {
        const frozen = contract('c1', '2026-01-01T00:00:00Z', [
            plan('BASIC', 29, 'monthly'),
            line('bundle', 'USERS', 5, { minimumTermUntil: new Date('2027-01-01T00:00:00Z') }),
            line('bundle', 'STORAGE', 5, { minimumTermUntil: new Date('2026-07-01T00:00:00Z') }),
        ]);

        const view = adminSubscriberContractOf(
            frozen,
            undefined,
            contractChangesOf([frozen]).get('c1'),
            BERLIN,
        );
        assert.deepEqual(view.plan, { key: 'BASIC', title: 'BASIC title' });
        assert.deepEqual(
            view.bundles.map(({ key }) => key),
            ['USERS', 'STORAGE'],
        );
        assert.equal(view.minimumTermUntil, '2027-01-01T00:00:00.000Z');
    });

    test('lists the one written last first', () => {
        const first = contract('c1', '2026-01-01T00:00:00Z', [plan('BASIC', 29)]);
        const second = contract('c2', '2026-02-01T00:00:00Z', [plan('PRO', 49)]);

        assert.deepEqual(
            adminSubscriberContractsOf([first, second], [], BERLIN).map(({ id }) => id),
            ['c2', 'c1'],
        );
    });
});

describe('the lines of a contract', () => {
    test('read the plan, then the add-ons, then the discounts, each kind in the contract’s order', () => {
        const frozen = contract('c1', '2026-01-01T00:00:00Z', [
            line('discount', 'retirement-hold:r1', -5),
            bundle('STORAGE'),
            plan('BASIC', 29),
            bundle('USERS'),
        ]);

        const lines = adminContractLinesOf(frozen, () => 'in-catalog');
        assert.deepEqual(
            lines.map(({ key }) => key),
            ['BASIC', 'STORAGE', 'USERS', 'retirement-hold:r1'],
        );
    });

    test('a discount names no source, and the catalogue is not asked about it', () => {
        const asked = [];
        const frozen = contract('c1', '2026-01-01T00:00:00Z', [
            plan('BASIC', 29),
            line('discount', 'retirement-hold:r1', -5),
        ]);

        const lines = adminContractLinesOf(frozen, (asking) => {
            asked.push(asking.sourceKey);
            return 'removed';
        });
        assert.deepEqual(asked, ['BASIC']);
        assert.deepEqual(
            lines.map(({ source }) => source),
            ['removed', null],
        );
    });

    test('hand out copies of what the contract froze', () => {
        const frozen = contract('c1', '2026-01-01T00:00:00Z', [
            line('plan', 'BASIC', 29, {
                featuresSnapshot: ['export'],
                quotaEffectsSnapshot: { users: 5 },
            }),
        ]);

        const [read] = adminContractLinesOf(frozen, () => null);
        read.features.push('more');
        read.quotas.users = 99;
        assert.deepEqual(frozen.lineItems[0].featuresSnapshot, ['export']);
        assert.deepEqual(frozen.lineItems[0].quotaEffectsSnapshot, { users: 5 });
    });
});

describe('where a line’s source stands in today’s catalogue', () => {
    test('is in the catalogue, removed from it, or deleted', () => {
        assert.equal(contractSourceStateOf({ deletedAt: null }), 'in-catalog');
        assert.equal(contractSourceStateOf({ deletedAt: new Date() }), 'removed');
        assert.equal(contractSourceStateOf(null), 'deleted');
    });
});

describe('the invoices issued under a contract', () => {
    const invoice = (id, contractId, issueDate, numberSequence) => ({
        id,
        contractId,
        number: `RE-2026-${numberSequence}`,
        numberYear: 2026,
        numberSequence,
        issueDate,
        currency: 'EUR',
        totalGross: 58.31,
    });

    test('are only the contract’s, the latest issue day first, and of one day by number', () => {
        const invoices = [
            invoice('i1', 'c1', '2026-02-01', 1),
            invoice('i2', 'c2', '2026-03-01', 2),
            invoice('i3', 'c1', '2026-03-01', 4),
            invoice('i4', 'c1', '2026-03-01', 3),
        ];

        assert.deepEqual(
            adminContractInvoicesOf(invoices, 'c1').map(({ id }) => id),
            ['i3', 'i4', 'i1'],
        );
        assert.deepEqual(adminContractInvoicesOf(invoices, 'c1')[0], {
            id: 'i3',
            number: 'RE-2026-4',
            issueDate: '2026-03-01',
            currency: 'EUR',
            totalGross: 58.31,
        });
    });
});
