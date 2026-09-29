import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BILLING_ERROR_CODES,
    CATALOG_ERROR_CODES,
    ERROR_MESSAGES_EN,
    PersistenceRefusal,
    bundleKeyTaken,
    catalogDraftExists,
    catalogVersionAlreadyPublished,
    catalogVersionGone,
    formatErrorMessage,
    isPersistenceRefusal,
    marketingProjectionTaken,
    noActivePlanVersion,
    noPendingPlanVersion,
    planKeyTaken,
    planNotInCatalog,
    subscriptionBundleAlreadyCancelled,
    subscriptionBundleGone,
    subscriptionChanged,
    subscriptionGone,
} from '../dist/index.js';

// An adapter says what it found; the platform turns that into an answer. The
// pairing of case and code lives here once, so both adapters give a caller the
// same code for the same race.

// @requirement SC-PLAN-019 — Two operators cannot publish the same draft
describe('a catalogue version refused', () => {
    for (const [kind, published, gone] of [
        [
            'PlanVersion',
            CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED,
            CATALOG_ERROR_CODES.PLAN_VERSION_NOT_FOUND,
        ],
        [
            'BundleVersion',
            CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED,
            CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
        ],
    ]) {
        test(`a ${kind} published first is refused as moved, with its code and id`, () => {
            const refusal = catalogVersionAlreadyPublished(kind, 'v-1');

            assert.equal(refusal.code, published);
            assert.equal(refusal.reason, 'moved');
            assert.deepEqual(refusal.params, { versionId: 'v-1' });
            assert.match(refusal.message, /v-1/);
        });

        test(`a ${kind} that is not there is refused as gone`, () => {
            const refusal = catalogVersionGone(kind, 'v-1');

            assert.equal(refusal.code, gone);
            assert.equal(refusal.reason, 'gone');
            assert.deepEqual(Object.values(refusal.params), ['v-1']);
        });
    }
});

describe('a refusal reads as its message says', () => {
    // A client localizes by code and params. Where the refusal names its id
    // under another key than the code's message interpolates, the operator
    // reads the placeholder itself — `BUNDLE_VERSION_NOT_FOUND` says
    // `{bundleVersionId}`, the other three `{versionId}`. The expectation is
    // read from the catalogue, so a reworded message cannot drift from this.
    const placeholders = (template) =>
        [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    for (const kind of ['PlanVersion', 'BundleVersion']) {
        for (const refuse of [catalogVersionGone, catalogVersionAlreadyPublished]) {
            test(`${refuse.name} for a ${kind} fills every placeholder of its message`, () => {
                const refusal = refuse(kind, 'v-1');

                assert.deepEqual(
                    Object.keys(refusal.params).sort(),
                    placeholders(ERROR_MESSAGES_EN[refusal.code]),
                );
            });
        }
    }
});

// @requirement SC-OPS-016 — A request that loses a race reads what the check says, not a server error
describe('a write that lost a race names the case the check names', () => {
    // Each refusal carries the code the platform's check answers the same case
    // with, and reads as that code's shipped English message does — so a
    // client that shows the message and one that localizes by code and params
    // tell the operator the same thing.
    const TARGET = { targetType: 'plan', targetVersionId: 'pv-1', locale: 'de' };
    const CASES = [
        [planKeyTaken('PRO'), CATALOG_ERROR_CODES.PLAN_ALREADY_EXISTS, 'moved', { planKey: 'PRO' }],
        [
            bundleKeyTaken('BANKING'),
            CATALOG_ERROR_CODES.BUNDLE_ALREADY_EXISTS,
            'moved',
            { bundleKey: 'BANKING' },
        ],
        [
            marketingProjectionTaken(TARGET),
            CATALOG_ERROR_CODES.MARKETING_PROJECTION_ALREADY_EXISTS,
            'moved',
            TARGET,
        ],
        [
            catalogDraftExists('PlanVersion', 'PRO', 3),
            CATALOG_ERROR_CODES.PLAN_DRAFT_ALREADY_EXISTS,
            'moved',
            { planKey: 'PRO', draftVersion: 3 },
        ],
        [
            catalogDraftExists('BundleVersion', 'BANKING', 2),
            CATALOG_ERROR_CODES.BUNDLE_DRAFT_ALREADY_EXISTS,
            'moved',
            { bundleKey: 'BANKING', draftVersion: 2 },
        ],
        [
            subscriptionBundleGone('sb-1'),
            BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND,
            'gone',
            { subscriptionBundleId: 'sb-1' },
        ],
        [
            subscriptionBundleAlreadyCancelled('sb-1'),
            BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED,
            'moved',
            { subscriptionBundleId: 'sb-1' },
        ],
        [
            subscriptionGone('t1'),
            BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
            'gone',
            { tenantId: 't1' },
        ],
        [
            subscriptionChanged('t1'),
            BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
            'moved',
            { tenantId: 't1' },
        ],
        [
            noPendingPlanVersion('t1'),
            BILLING_ERROR_CODES.NO_PENDING_PLAN_VERSION,
            'moved',
            { tenantId: 't1' },
        ],
        [
            // Late in the evening in UTC is still that day, whatever the
            // server's zone: the date is the UTC calendar day of the moment.
            noActivePlanVersion('PRO', new Date('2026-05-01T23:30:00.000Z')),
            BILLING_ERROR_CODES.NO_ACTIVE_PLAN_VERSION,
            'gone',
            { planId: 'PRO', asOf: '2026-05-01' },
        ],
        [
            planNotInCatalog('PRO'),
            BILLING_ERROR_CODES.PLAN_NOT_IN_CATALOG,
            'gone',
            { planKey: 'PRO' },
        ],
    ];

    for (const [refusal, code, reason, params] of CASES) {
        test(`${code} is refused as ${reason}, with what its message names`, () => {
            assert.ok(isPersistenceRefusal(refusal));
            assert.equal(refusal.code, code);
            assert.equal(refusal.reason, reason);
            assert.deepEqual(refusal.params, params);
            assert.equal(refusal.message, formatErrorMessage(ERROR_MESSAGES_EN[code], params));
            assert.doesNotMatch(refusal.message, /\{\w+\}/, 'no placeholder is left unfilled');
        });
    }
});

describe('telling a refusal from any other failure', () => {
    test('a refusal is recognised', () => {
        assert.equal(isPersistenceRefusal(catalogVersionGone('PlanVersion', 'v-1')), true);
    });

    test('so is one built by another copy of the class', () => {
        // Thrower and catcher can each load their own module instance, and
        // `instanceof` against the other's class is then false.
        const foreign = Object.assign(new Error('taken'), {
            name: 'PersistenceRefusal',
            code: 'PLAN_VERSION_ALREADY_PUBLISHED',
            reason: 'moved',
        });

        assert.equal(isPersistenceRefusal(foreign), true);
    });

    test('a plain error is not one', () => {
        assert.equal(isPersistenceRefusal(new Error('connection reset')), false);
    });

    test('nor an error that only borrows the name', () => {
        const named = Object.assign(new Error('x'), { name: 'PersistenceRefusal' });

        assert.equal(isPersistenceRefusal(named), false);
    });

    test('nor one whose reason is not a case the platform answers', () => {
        const unknown = new PersistenceRefusal('PLAN_VERSION_NOT_FOUND', 'lost', 'x');

        assert.equal(isPersistenceRefusal(unknown), false);
    });

    test('nor something that is not an error at all', () => {
        assert.equal(
            isPersistenceRefusal({ name: 'PersistenceRefusal', code: 'X', reason: 'gone' }),
            false,
        );
    });
});
