// What joining a returning customer's subscriber into the one it had changes,
// decided from the two as they stand: which details the earlier record takes,
// which are a correction of the same legal entity, how the check of the VAT
// number is decided, which payment methods go out of use — and which join is
// refused, in which order. Each class of detail once: the subscriber joined
// has a value, has none, or has the same one.

// @requirement SC-ADM-049 — A join is shown before it is made, and held to what was shown

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { planSubscriberJoin, subscriberJoinRefusal } from '../dist/index.js';

const NOW = new Date('2026-11-03T09:00:00.000Z');

/** A subscriber as a join reads it; every detail but the name unknown unless given. */
const subscriber = (id, details = {}) => ({
    id,
    customerNumber: `K-${id}`,
    tenantId: null,
    legalName: 'Muster GmbH',
    vatId: null,
    taxNumber: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    country: null,
    invoiceEmail: null,
    business: null,
    migrated: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...details,
});

const LIVE = [{ tenantId: 't-new', linkedAt: NOW, unlinkedAt: null }];
const CLOSED = [{ tenantId: 't-old', linkedAt: NOW, unlinkedAt: NOW }];

const check = (id, vatId, at) => ({
    id,
    subscriberId: 'x',
    vatId,
    checkedAt: new Date(at),
    valid: true,
    service: 'VIES',
    confirmation: {},
    recordedAt: new Date(at),
});

/** The state of joining `from` into `into`, the one with the live tenant into the earlier one. */
const stateOf = (from, into, overrides = {}) => ({
    from: {
        subscriber: subscriber('new', from),
        links: LIVE,
        joinedIntoId: null,
        countingVatIdCheck: null,
        paymentMethodsInUse: 1,
        ...overrides.from,
    },
    into: {
        subscriber: subscriber('old', into),
        links: CLOSED,
        joinedIntoId: null,
        countingVatIdCheck: null,
        paymentMethodsInUse: 1,
        ...overrides.into,
    },
    moving: { subscriber_tenants: 1 },
});

const ADDRESS = {
    addressLine1: 'Neue Straße 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};
const EARLIER = {
    addressLine1: 'Alte Straße 2',
    addressLine2: 'Hinterhaus',
    postalCode: '28195',
    city: 'Bremen',
    country: 'AT',
};

describe('the address the earlier record takes', () => {
    test('replaces it as a whole where the subscriber joined has one, a line it lacks included', () => {
        const plan = planSubscriberJoin(stateOf(ADDRESS, EARLIER));

        assert.deepEqual(plan.contact, {
            addressLine1: 'Neue Straße 1',
            addressLine2: null,
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
        });
        assert.deepEqual(plan.taxOrigin, {
            previous: { country: 'AT' },
            changed: { country: 'DE' },
        });
    });

    test('is kept where the subscriber joined has none', () => {
        const plan = planSubscriberJoin(stateOf({}, EARLIER));

        assert.deepEqual([plan.contact, plan.replaced, plan.taxOrigin], [{}, [], null]);
    });
});

describe('a detail of the subscriber joined', () => {
    for (const [field, given, held] of [
        ['invoiceEmail', 'billing@new.example', 'billing@old.example'],
        ['business', true, false],
    ]) {
        test(`${field}: replaces the earlier one where it has a value`, () => {
            const plan = planSubscriberJoin(stateOf({ [field]: given }, { [field]: held }));

            assert.deepEqual(
                plan.replaced.map((each) => [each.field, each.previous, each.next]),
                [[field, held, given]],
            );
        });

        test(`${field}: keeps the earlier one where it has none`, () => {
            const plan = planSubscriberJoin(stateOf({ [field]: null }, { [field]: held }));

            assert.deepEqual(plan.replaced, []);
        });

        test(`${field}: changes nothing where both are the same`, () => {
            const plan = planSubscriberJoin(stateOf({ [field]: held }, { [field]: held }));

            assert.deepEqual(plan.replaced, []);
        });
    }

    for (const field of ['vatId', 'taxNumber']) {
        test(`${field}: is corrected as the same entity where it differs, kept where it has none`, () => {
            const corrected = planSubscriberJoin(
                stateOf({ [field]: 'NEW-1' }, { [field]: 'OLD-1' }),
            );
            const kept = planSubscriberJoin(stateOf({ [field]: null }, { [field]: 'OLD-1' }));

            assert.deepEqual(corrected.identity, {
                previous: { [field]: 'OLD-1' },
                corrected: { [field]: 'NEW-1' },
            });
            assert.equal(kept.identity, null);
        });
    }

    test('the legal name is corrected where it differs: it is always given', () => {
        const plan = planSubscriberJoin(
            stateOf({ legalName: 'Muster GmbH & Co. KG' }, { legalName: 'Muster GmbH' }),
        );

        assert.deepEqual(plan.identity, {
            previous: { legalName: 'Muster GmbH' },
            corrected: { legalName: 'Muster GmbH & Co. KG' },
        });
    });
});

describe('the check of the VAT number after a join', () => {
    test('is the one of the subscriber joined where the number moves with it', () => {
        const plan = planSubscriberJoin(
            stateOf(
                { vatId: 'DE1' },
                {},
                { from: { countingVatIdCheck: check('c-new', 'DE1', '2026-11-02') } },
            ),
        );

        assert.deepEqual([plan.vatIdCheck, plan.adoptedVatIdCheckId], ['adopted', 'c-new']);
    });

    test('is none where the number changes and no check comes with it', () => {
        const plan = planSubscriberJoin(
            stateOf(
                { vatId: 'DE1' },
                { vatId: 'DE9' },
                { into: { countingVatIdCheck: check('c-old', 'DE9', '2025-01-01') } },
            ),
        );

        assert.deepEqual([plan.vatIdCheck, plan.adoptedVatIdCheckId], ['ended', null]);
    });

    test('is the later one where the number stays', () => {
        const later = planSubscriberJoin(
            stateOf(
                { vatId: 'DE1' },
                { vatId: 'DE1' },
                {
                    from: { countingVatIdCheck: check('c-new', 'DE1', '2026-11-02') },
                    into: { countingVatIdCheck: check('c-old', 'DE1', '2025-01-01') },
                },
            ),
        );
        const earlier = planSubscriberJoin(
            stateOf(
                { vatId: 'DE1' },
                { vatId: 'DE1' },
                {
                    from: { countingVatIdCheck: check('c-new', 'DE1', '2024-01-01') },
                    into: { countingVatIdCheck: check('c-old', 'DE1', '2025-01-01') },
                },
            ),
        );

        assert.deepEqual([later.vatIdCheck, later.adoptedVatIdCheckId], ['adopted', 'c-new']);
        assert.deepEqual([earlier.vatIdCheck, earlier.adoptedVatIdCheckId], ['kept', null]);
    });
});

describe('the payment methods of the earlier subscriber', () => {
    for (const inUse of [0, 1]) {
        test(`go out of use, all ${inUse} of them in use`, () => {
            const plan = planSubscriberJoin(
                stateOf({}, {}, { into: { paymentMethodsInUse: inUse } }),
            );

            assert.equal(plan.paymentMethodsOutOfUse, inUse);
        });
    }
});

describe('a join is refused, the first that holds in this order', () => {
    const SAME = { kind: 'same-entity', reason: 'Returning customer' };

    for (const [label, state, request, code] of [
        [
            'a blank reason, before the subscribers',
            stateOf({}, {}, { into: { links: LIVE } }),
            { ...SAME, reason: '  ' },
            'SUBSCRIBER_JOIN_REASON_REQUIRED',
        ],
        [
            'another legal entity declared',
            stateOf({}, {}),
            { ...SAME, kind: 'takeover' },
            'SUBSCRIBER_TAKEOVER_IS_A_TRANSFER',
        ],
        [
            'the same subscriber twice',
            { ...stateOf({}, {}), into: stateOf({}, {}).from },
            SAME,
            'SUBSCRIBER_JOIN_SAME_SUBSCRIBER',
        ],
        [
            'a subscriber joined already',
            stateOf({}, {}, { into: { joinedIntoId: 'other' } }),
            SAME,
            'SUBSCRIBER_JOIN_ALREADY_JOINED',
        ],
        [
            'a subscriber to join without a live tenant',
            stateOf({}, {}, { from: { links: CLOSED } }),
            SAME,
            'SUBSCRIBER_JOIN_WITHOUT_LIVE_TENANT',
        ],
        [
            'an earlier subscriber with a live tenant',
            stateOf({}, {}, { into: { links: LIVE } }),
            SAME,
            'SUBSCRIBER_JOIN_INTO_HAS_LIVE_TENANT',
        ],
    ]) {
        test(label, () => {
            assert.equal(subscriberJoinRefusal(state, request)?.code, code);
        });
    }

    test('none where the two can be joined, and a preview asks nothing of the request', () => {
        assert.equal(subscriberJoinRefusal(stateOf({}, {}), SAME), null);
        assert.equal(subscriberJoinRefusal(stateOf({}, {})), null);
    });
});
