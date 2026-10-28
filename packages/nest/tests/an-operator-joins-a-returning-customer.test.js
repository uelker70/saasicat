// The operator joins a returning customer's new subscriber into the one it had,
// through the platform as an application composes it: what the preview shows,
// what the join leaves in both records, what it audits and in which frame it
// reads — and every refusal with its code. That the join asks for the second
// factor is held by `lasting-operator-actions-require-the-second-factor.test.js`,
// which walks every route the platform mounts; that every row moves in one
// transaction, and that a joined subscriber is given nothing afterwards, by the
// persistence contract against PostgreSQL.

// @requirement SC-ADM-027 — An operator joins a returning customer's new tenant to the subscriber it had

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { SubscriberJoinModule } from '../dist/subscriber/index.js';
import { RECORD_ROUTE, LIST_ROUTE, aPlatform } from './helpers/operator-subscriber-platform.js';

const PREVIEW_ROUTE = 'POST admin/subscribers/:id/join/preview';
const JOIN_ROUTE = 'POST admin/subscribers/:id/join';
const IDENTITY_ROUTE = 'POST admin/subscribers/:id/identity';
const BUSINESS_ROUTE = 'POST admin/subscribers/:id/business-status';

/** The operator's request, as the application's guards leave it. */
const REQUEST = { user: { sub: 'op-1', email: 'anna@ops.example' }, headers: {} };
const ANNA = 'web:anna@ops.example:admin';
const REASON = 'Returning customer, confirmed by phone';

/**
 * The platform keeping joins, with Fabrikam's tenant gone: Fabrikam is the
 * earlier subscriber, and Wien — with its VAT number and the check that counts
 * for it — the one sign-up created for the new tenant.
 */
async function anAdministration(options = {}) {
    const platform = await aPlatform({ joins: true, ...options });
    platform.repo.closeTenantLink(platform.idOf('fabrikam'), new Date('2026-03-31T00:00:00.000Z'));
    const { idOf, call } = platform;
    return {
        ...platform,
        preview: (from, into) => call(PREVIEW_ROUTE)(idOf(from), { intoSubscriberId: idOf(into) }),
        join: (from, into, body = {}) =>
            call(JOIN_ROUTE)(
                idOf(from),
                { intoSubscriberId: idOf(into), kind: 'same-entity', reason: REASON, ...body },
                REQUEST,
            ),
        record: (slug) => call(RECORD_ROUTE)(idOf(slug)),
        list: () => call(LIST_ROUTE)({}),
        auditedActions: () => platform.seen.audited.map((entry) => entry.action),
    };
}

const refusedWith = (code, params) => (error) => {
    const body = error.getResponse?.();
    assert.equal(body?.code, code, `refused with ${body?.code ?? error.message}`);
    if (params) {
        for (const [name, value] of Object.entries(params)) {
            assert.equal(body.params?.[name], value, `the refusal's ${name}`);
        }
    }
    return true;
};

// @requirement SC-ADM-049 — A join is shown before it is made, and held to what was shown
describe("the operator joins a returning customer's subscriber into the one it had", () => {
    test('the preview puts both side by side and says what moves, is replaced and corrected', async () => {
        const admin = await anAdministration();

        const preview = await admin.preview('wien', 'fabrikam');

        assert.deepEqual(
            [preview.from.subscriber.legalName, preview.into.subscriber.legalName],
            ['Wien GmbH', 'Fabrikam GmbH'],
        );
        assert.deepEqual(
            preview.from.tenants.map((tenant) => [tenant.slug, tenant.unlinkedAt]),
            [['wien', null]],
        );
        assert.deepEqual(
            preview.into.tenants.map((tenant) => [tenant.slug, tenant.unlinkedAt]),
            [['fabrikam', '2026-03-31T00:00:00.000Z']],
        );
        assert.deepEqual(preview.moving, {
            subscriber_tenants: 1,
            subscriber_corrections: 0,
            subscriber_tax_origin_changes: 0,
            subscriber_vat_id_checks: 1,
        });
        assert.deepEqual(
            preview.replaced.map(({ field, previous, next }) => [field, previous, next]),
            [
                ['city', null, 'Hamburg'],
                ['country', 'DE', 'AT'],
                ['business', null, true],
            ],
        );
        assert.deepEqual(preview.corrected, {
            previous: { legalName: 'Fabrikam GmbH', vatId: null },
            corrected: { legalName: 'Wien GmbH', vatId: 'ATU12345678' },
        });
        assert.equal(preview.vatIdCheck, 'adopted');
        assert.match(preview.digest, /^[0-9a-f]{64}$/);
        assert.deepEqual(admin.seen.audited, [], 'a preview was audited');
        assert.ok(
            admin.seen.reads.every((read) => read.bypassed),
            'a read ran in the request frame',
        );
    });

    test('the join answers the subscriber everything moved to, and both records say so', async () => {
        const admin = await anAdministration();
        const { digest } = await admin.preview('wien', 'fabrikam');

        const { joinedInto } = await admin.join('wien', 'fabrikam', { previewDigest: digest });

        assert.deepEqual(
            [joinedInto.subscriberId, joinedInto.legalName, joinedInto.reason, joinedInto.joinedBy],
            [admin.idOf('fabrikam'), 'Wien GmbH', REASON, ANNA],
        );
        const into = await admin.record('fabrikam');
        assert.deepEqual(
            into.tenants.map((tenant) => [tenant.slug, tenant.unlinkedAt === null]),
            [
                ['wien', true],
                ['fabrikam', false],
            ],
        );
        assert.deepEqual(
            [into.subscriber.legalName, into.subscriber.vatId, into.subscriber.vatIdValidated],
            ['Wien GmbH', 'ATU12345678', true],
        );
        assert.deepEqual(
            into.joins.from.map((note) => [note.subscriberId, note.reason]),
            [[admin.idOf('wien'), REASON]],
        );
        assert.equal(into.joins.into, null);
        const joined = await admin.record('wien');
        assert.deepEqual(joined.tenants, []);
        assert.equal(joined.joins.into?.subscriberId, admin.idOf('fabrikam'));
        assert.deepEqual(joined.joins.from, []);
        assert.deepEqual(admin.auditedActions(), ['SUBSCRIBER_JOINED']);
        const [entry] = admin.seen.audited;
        assert.deepEqual(
            [entry.entityId, entry.changes?.fromSubscriberId, entry.changes?.reason],
            [admin.idOf('fabrikam'), admin.idOf('wien'), REASON],
        );
        assert.ok(
            admin.seen.reads.every((read) => read.bypassed),
            'a read ran in the request frame',
        );
    });

    test('the list marks a subscriber joined with the one it was joined into', async () => {
        const admin = await anAdministration();
        await admin.join('wien', 'fabrikam');

        const { subscribers } = await admin.list();

        const fabrikam = await admin.record('fabrikam');
        assert.deepEqual(subscribers.find((row) => row.id === admin.idOf('wien'))?.joinedInto, {
            subscriberId: admin.idOf('fabrikam'),
            customerNumber: fabrikam.subscriber.customerNumber,
        });
        assert.equal(subscribers.find((row) => row.id === admin.idOf('contoso'))?.joinedInto, null);
    });

    test('is announced and served only where joins are kept', async () => {
        const kept = await anAdministration();
        const without = await aPlatform();

        assert.equal(kept.manifest.capabilities['subscribers.join'], true);
        assert.ok(kept.served(JOIN_ROUTE) && kept.served(PREVIEW_ROUTE));
        assert.equal(without.manifest.capabilities['subscribers.join'], undefined);
        assert.equal(without.served(JOIN_ROUTE), undefined);
        assert.equal(without.served(PREVIEW_ROUTE), undefined);
        assert.equal((await without.call(RECORD_ROUTE)(without.idOf('wien'))).joins, undefined);
    });
});

// @requirement SC-ADM-049 — A join is shown before it is made, and held to what was shown
describe('a join is refused', () => {
    test('without a reason, before anything about the subscribers is asked', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.join('wien', 'wien', { reason: '   ' }),
            refusedWith('SUBSCRIBER_JOIN_REASON_REQUIRED'),
        );
    });

    test('where the operator declares another legal entity', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.join('wien', 'fabrikam', { kind: 'takeover' }),
            refusedWith('SUBSCRIBER_TAKEOVER_IS_A_TRANSFER'),
        );
    });

    test('into itself', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.preview('wien', 'wien'),
            refusedWith('SUBSCRIBER_JOIN_SAME_SUBSCRIBER'),
        );
    });

    test('into a subscriber that still has a live tenant, naming it', async () => {
        const admin = await anAdministration();
        const contoso = await admin.record('contoso');

        await assert.rejects(
            admin.preview('wien', 'contoso'),
            refusedWith('SUBSCRIBER_JOIN_INTO_HAS_LIVE_TENANT', {
                customerNumber: contoso.subscriber.customerNumber,
                tenantId: 't-contoso',
            }),
        );
    });

    test('from a subscriber without a live tenant', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.preview('fabrikam', 'wien'),
            refusedWith('SUBSCRIBER_JOIN_WITHOUT_LIVE_TENANT'),
        );
    });

    test('for a subscriber joined already, either way', async () => {
        const admin = await anAdministration();
        admin.repo.closeTenantLink(admin.idOf('contoso'));
        await admin.join('wien', 'fabrikam');
        const wien = await admin.record('wien');

        await assert.rejects(
            admin.preview('wien', 'contoso'),
            refusedWith('SUBSCRIBER_JOIN_ALREADY_JOINED', {
                customerNumber: wien.subscriber.customerNumber,
            }),
        );
        await assert.rejects(
            admin.preview('northwind', 'wien'),
            refusedWith('SUBSCRIBER_JOIN_ALREADY_JOINED', {
                customerNumber: wien.subscriber.customerNumber,
            }),
        );
    });

    test('for a subscriber nobody keeps', async () => {
        const admin = await anAdministration();

        await assert.rejects(
            admin.call(PREVIEW_ROUTE)(admin.idOf('wien'), { intoSubscriberId: 'no-such' }),
            refusedWith('SUBSCRIBER_NOT_FOUND', { subscriberId: 'no-such' }),
        );
    });

    test('where what it would do changed since the preview, with the preview as it stands', async () => {
        const admin = await anAdministration();
        const shown = await admin.preview('wien', 'fabrikam');
        await admin.repo.updateContact(
            admin.idOf('wien'),
            { invoiceEmail: 'billing@wien.example' },
            ANNA,
        );

        await assert.rejects(
            admin.join('wien', 'fabrikam', { previewDigest: shown.digest }),
            (error) => {
                refusedWith('SUBSCRIBER_JOIN_PREVIEW_CHANGED')(error);
                const { preview } = error.getResponse().params;
                assert.notEqual(preview.digest, shown.digest);
                assert.deepEqual(
                    preview.replaced.find((each) => each.field === 'invoiceEmail')?.next,
                    'billing@wien.example',
                );
                return true;
            },
        );
        assert.equal((await admin.record('wien')).joins.into, null, 'the join was made anyway');
    });
});

// @requirement SC-ADM-049 — A join is shown before it is made, and held to what was shown
describe('a subscriber joined', () => {
    test('takes no correction of its identity or its business status', async () => {
        const admin = await anAdministration();
        await admin.join('wien', 'fabrikam');
        const wien = admin.idOf('wien');

        await assert.rejects(
            admin.call(IDENTITY_ROUTE)(
                wien,
                { kind: 'correction', legalName: 'Wien Neu GmbH', reason: 'Typo' },
                REQUEST,
            ),
            refusedWith('SUBSCRIBER_JOINED'),
        );
        await assert.rejects(
            admin.call(BUSINESS_ROUTE)(wien, { business: false, reason: 'Is a consumer' }, REQUEST),
            refusedWith('SUBSCRIBER_JOINED'),
        );
    });
});

// @requirement SC-ADM-050 — A join moves everything in one step, and a subscriber joined is given nothing afterwards
describe('joining subscribers', () => {
    test('refuses to start beside a database that would let a join leave rows behind', async () => {
        const unguarded = {
            protectionProblem: async () => 'subscriber_payments lacks its trigger',
        };

        await assert.rejects(
            Test.createTestingModule({
                imports: [
                    SubscriberJoinModule.forRoot({
                        subscriberJoinRepository: unguarded,
                        subscriberRepository: {},
                        transactionRunner: { run: (fn) => fn({}) },
                    }),
                ],
            })
                .compile()
                .then((moduleRef) => moduleRef.init()),
            /Joining subscribers cannot start:\n- subscriber_payments lacks its trigger/,
        );
    });
});
