// Whether a subscriber is a business is recorded, never derived.
//
// A tax adapter decides a subscriber's treatment from its country, whether it
// is a business, and its validated VAT id (ADR 0013). The business status is
// its own detail rather than a reading of the tax identifiers: a business
// outside the European Union may have no VAT id and is still a business. It is
// stated at creation or changed as a change of the tax origin, recorded with
// its date and who made it — as is a change of the country or the VAT id,
// whichever way it arrives.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { subscribersFor } from './helpers/subscribers.js';

/** A tenant's user, tagged as the audit log tags them. */
const TENANT_USER = 'web:owner@tenant.example:tenant-self-service';

const refusedWith = (code, params) => (error) => {
    const body = error.getResponse?.() ?? error.response;
    assert.equal(body?.code, code, error.message);
    if (params) assert.deepEqual(body.params, params);
    return true;
};

describe('a new subscriber', () => {
    test('is recorded as a business, as none, or as not stated', async () => {
        const { service } = await subscribersFor();

        const business = await service.createForTenant('tenant-ch', {
            legalName: 'Zürich Software GmbH',
            country: 'ch',
            business: true,
        });
        const consumer = await service.createForTenant('tenant-de', {
            legalName: 'Erika Mustermann',
            business: false,
        });
        const notStated = await service.createForTenant('tenant-x', { legalName: 'Offen GmbH' });

        assert.deepEqual(
            [business.business, consumer.business, notStated.business],
            [true, false, null],
        );
        // No VAT id, and still a business: nothing is read off the identifiers.
        assert.equal(business.vatId, null);
    });

    for (const [what, value] of [
        ['a yes written as text', 'yes'],
        ['a number', 1],
    ]) {
        test(`with ${what} for the business status is refused, naming the field`, async () => {
            const { service } = await subscribersFor();

            await assert.rejects(
                () =>
                    service.createForTenant('tenant-1', {
                        legalName: 'Unklar GmbH',
                        business: value,
                    }),
                refusedWith('SUBSCRIBER_DETAIL_INVALID', { field: 'business' }),
            );
            assert.equal(await service.findByTenantId('tenant-1'), null);
        });
    }
});

/** Why the business status moves, as an operator writes it. */
const WHY = 'Trade register extract handed in';

describe('the business status', () => {
    // @requirement SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice
    test('changes as a change of the tax origin, recorded with its date and who made it', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const { id } = await service.requireForTenant('tenant-1');
        const before = Date.now();

        const result = await service.changeBusinessStatus(id, {
            business: true,
            changedBy: ' operator:anna ',
            reason: ` ${WHY} `,
        });

        assert.equal(result.subscriber.business, true);
        assert.equal((await service.getById(id)).business, true);
        assert.deepEqual(
            {
                previous: result.change?.previous,
                changed: result.change?.changed,
                changedBy: result.change?.changedBy,
                reason: result.change?.reason,
            },
            {
                previous: { business: null },
                changed: { business: true },
                changedBy: 'operator:anna',
                reason: WHY,
            },
        );
        const at = result.change?.changedAt.getTime() ?? 0;
        assert.ok(at >= before && at <= Date.now(), 'the change is dated when it is written');
    });

    test('set to the status it has records nothing', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const { id } = await service.requireForTenant('tenant-1');
        await service.changeBusinessStatus(id, {
            business: false,
            changedBy: 'operator:anna',
            reason: WHY,
        });

        const again = await service.changeBusinessStatus(id, {
            business: false,
            changedBy: 'operator:anna',
            reason: WHY,
        });

        assert.equal(again.change, null);
        assert.equal((await service.listTaxOriginChanges(id)).length, 1);
    });

    test('can be set back to not stated', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const { id } = await service.requireForTenant('tenant-1');
        await service.changeBusinessStatus(id, {
            business: true,
            changedBy: 'operator:anna',
            reason: WHY,
        });

        const cleared = await service.changeBusinessStatus(id, {
            business: null,
            changedBy: 'operator:anna',
            reason: 'Not known after all',
        });

        assert.equal(cleared.subscriber.business, null);
        assert.deepEqual(cleared.change?.changed, { business: null });
    });

    for (const [what, changedBy] of [
        ['nobody', undefined],
        ['an empty actor', '   '],
    ]) {
        test(`naming ${what} as who changes it is refused, and nothing moves`, async () => {
            const { service } = await subscribersFor(['tenant-1']);
            const { id } = await service.requireForTenant('tenant-1');

            await assert.rejects(
                () => service.changeBusinessStatus(id, { business: true, changedBy, reason: WHY }),
                refusedWith('SUBSCRIBER_CHANGE_ACTOR_REQUIRED'),
            );
            assert.equal((await service.getById(id)).business, null);
            assert.deepEqual(await service.listTaxOriginChanges(id), []);
        });
    }

    for (const [what, reason] of [
        ['no reason', undefined],
        ['an empty reason', ''],
        ['a reason of blanks', '   '],
    ]) {
        // @requirement SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice
        test(`with ${what} is refused, and nothing moves`, async () => {
            const { service } = await subscribersFor(['tenant-1']);
            const { id } = await service.requireForTenant('tenant-1');

            await assert.rejects(
                () =>
                    service.changeBusinessStatus(id, {
                        business: true,
                        changedBy: 'operator:anna',
                        reason,
                    }),
                refusedWith('SUBSCRIBER_BUSINESS_STATUS_REASON_REQUIRED'),
            );
            assert.equal((await service.getById(id)).business, null);
            assert.deepEqual(await service.listTaxOriginChanges(id), []);
        });
    }

    test('set to the status it has, without a reason, is refused all the same', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const { id } = await service.requireForTenant('tenant-1');

        await assert.rejects(
            () =>
                service.changeBusinessStatus(id, {
                    business: null,
                    changedBy: 'operator:anna',
                    reason: '',
                }),
            refusedWith('SUBSCRIBER_BUSINESS_STATUS_REASON_REQUIRED'),
        );
    });

    test('given as anything but yes, no or not stated is refused', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const { id } = await service.requireForTenant('tenant-1');

        await assert.rejects(
            () =>
                service.changeBusinessStatus(id, {
                    business: 'no',
                    changedBy: 'operator:anna',
                    reason: WHY,
                }),
            refusedWith('SUBSCRIBER_DETAIL_INVALID', { field: 'business' }),
        );
        assert.equal((await service.getById(id)).business, null);
    });

    test('of a subscriber that does not exist is refused as not found', async () => {
        const { service } = await subscribersFor();

        await assert.rejects(
            () =>
                service.changeBusinessStatus('subscriber-nobody', {
                    business: true,
                    changedBy: 'operator:anna',
                    reason: WHY,
                }),
            refusedWith('SUBSCRIBER_NOT_FOUND', { subscriberId: 'subscriber-nobody' }),
        );
    });

    test('is not a contact detail: a contact change naming it is refused rather than dropped', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const { id } = await service.requireForTenant('tenant-1');

        await assert.rejects(
            () => service.changeContact(id, { city: 'Kiel', business: true }, 'operator:anna'),
            refusedWith('SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT'),
        );
        await assert.rejects(
            () => service.changeContactOfTenant('tenant-1', { business: false }, TENANT_USER),
            refusedWith('SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT'),
        );
        const unchanged = await service.getById(id);
        assert.deepEqual([unchanged.city, unchanged.business], [null, null]);
    });
});

describe('the changes of the tax origin', () => {
    // @requirement SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice
    test('are listed the latest first, whichever way each arrived, and only those that moved it', async () => {
        const { service } = await subscribersFor();
        const { id } = await service.createForTenant('tenant-1', {
            legalName: 'Wien Handel GmbH',
            country: 'DE',
        });

        await service.changeContact(id, { city: 'Wien' }, 'operator:anna');
        await service.changeContactOfTenant('tenant-1', { country: 'at' }, TENANT_USER);
        await service.correctIdentity(id, {
            kind: 'correction',
            vatId: 'ATU12345678',
            reason: 'VAT id handed in after sign-up',
            correctedBy: 'operator:anna',
        });
        await service.correctIdentity(id, {
            kind: 'correction',
            legalName: 'Wien Handel GesmbH',
            reason: 'Legal form spelt as registered',
            correctedBy: 'operator:anna',
        });
        await service.changeBusinessStatus(id, {
            business: true,
            changedBy: 'operator:ben',
            reason: WHY,
        });

        const listed = await service.listTaxOriginChanges(id);
        assert.deepEqual(
            listed.map((change) => [
                change.changed,
                change.previous,
                change.changedBy,
                change.reason,
            ]),
            [
                [{ business: true }, { business: null }, 'operator:ben', WHY],
                [
                    { vatId: 'ATU12345678' },
                    { vatId: null },
                    'operator:anna',
                    'VAT id handed in after sign-up',
                ],
                [{ country: 'AT' }, { country: 'DE' }, TENANT_USER, null],
            ],
        );
    });

    for (const [what, changedBy] of [
        ['nobody', undefined],
        ['an empty actor', '   '],
    ]) {
        test(`a contact change naming ${what} as who makes it is refused, and nothing moves`, async () => {
            const { service } = await subscribersFor();
            const { id } = await service.createForTenant('tenant-1', {
                legalName: 'Wien Handel GmbH',
                country: 'DE',
            });

            await assert.rejects(
                () => service.changeContact(id, { country: 'AT' }, changedBy),
                refusedWith('SUBSCRIBER_CHANGE_ACTOR_REQUIRED'),
            );
            await assert.rejects(
                () => service.changeContactOfTenant('tenant-1', { country: 'AT' }, changedBy),
                refusedWith('SUBSCRIBER_CHANGE_ACTOR_REQUIRED'),
            );
            assert.equal((await service.getById(id)).country, 'DE');
            assert.deepEqual(await service.listTaxOriginChanges(id), []);
        });
    }
});

describe('a VAT identification number', () => {
    test('is kept in one form: upper case, without the spaces, dots and hyphens it is written with', async () => {
        const { service } = await subscribersFor();

        const created = await service.createForTenant('tenant-1', {
            legalName: 'Wien Handel GmbH',
            vatId: ' atu 123.456-78 ',
        });

        assert.equal(created.vatId, 'ATU12345678');
    });

    test('entered again in another spelling moves nothing', async () => {
        const { service } = await subscribersFor();
        const { id } = await service.createForTenant('tenant-1', {
            legalName: 'Wien Handel GmbH',
            vatId: 'ATU12345678',
        });

        await assert.rejects(
            () =>
                service.correctIdentity(id, {
                    kind: 'correction',
                    vatId: 'atu 12345678',
                    reason: 'Typed again from the letterhead',
                    correctedBy: 'operator:anna',
                }),
            refusedWith('SUBSCRIBER_CORRECTION_CHANGES_NOTHING'),
        );
        assert.deepEqual(await service.listTaxOriginChanges(id), []);
    });

    test('made only of separators is no number', async () => {
        const { service } = await subscribersFor();

        const created = await service.createForTenant('tenant-1', {
            legalName: 'Wien Handel GmbH',
            vatId: ' - . ',
        });

        assert.equal(created.vatId, null);
    });
});
