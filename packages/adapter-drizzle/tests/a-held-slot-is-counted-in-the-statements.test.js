// What `DrizzlePromoCodeHoldRepository` asks the database, statement by
// statement, through Drizzle's own query builder and a transport that records
// what it would send.
//
// Whether the statements hold under concurrency is the persistence contract's
// to prove against PostgreSQL. These cases pin what can be read off the
// statements without one: which rule each write carries, what a step skips
// when the one before it answered no, and the order a sweep gives slots back
// in, which is what keeps two sweeps from locking codes against each other.

// @requirement SC-PROMO-023 — A customer at the payment form keeps the promo code the checkout started with

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';

import { DrizzlePromoCodeHoldRepository } from '../dist/index.js';

const EXPIRES = new Date('2026-10-23T10:00:00.000Z');
const HOLD_ROW = ['hold-1', 'code-1', 'offer-1', '2026-10-23 10:00:00', '2026-09-23 10:00:00'];

/**
 * A database that records every statement and answers from `script`: the first
 * entry whose pattern the statement matches gives its rows. A transaction runs
 * on the same recorder — the statements are what is asked, not how it is
 * isolated.
 */
function recordingDb(script = []) {
    const statements = [];
    const db = drizzle(async (sql, params, method) => {
        statements.push({ sql, params, method });
        const answer = script.find(([pattern]) => pattern.test(sql));
        return { rows: answer ? answer[1] : [] };
    });
    db.transaction = async (work) => work(db);
    return { db, statements, repo: new DrizzlePromoCodeHoldRepository(db) };
}

const kindOf = ({ sql }) => sql.trim().split(/\s/, 1)[0].toLowerCase();

describe('taking a slot for a checkout', () => {
    const lock = [/for update/i, [['code-1']]];
    const noHoldYet = [/from "promo_code_holds"/i, []];
    const counted = [/^update "promo_codes"/i, [['code-1']]];
    const inserted = [/^insert into "promo_code_holds"/i, [HOLD_ROW]];

    test('locks the code, finds no hold for the offer, counts the slot, then writes the hold', async () => {
        const { repo, statements } = recordingDb([lock, noHoldYet, counted, inserted]);

        const taken = await repo.take({
            promoCodeId: 'code-1',
            checkoutOfferId: 'offer-1',
            expiresAt: EXPIRES,
        });

        assert.equal(taken.outcome, 'taken');
        assert.equal(taken.hold.checkoutOfferId, 'offer-1');
        assert.deepEqual(statements.map(kindOf), ['select', 'select', 'update', 'insert']);
        assert.match(statements[0].sql, /for update/i);
        const count = statements[2].sql;
        assert.match(count, /"heldCount" = "promo_codes"\."heldCount" \+ 1/);
        assert.match(count, /"status" = \$\d/);
        assert.match(count, /"deletedAt" is null/);
        assert.match(
            count,
            /"redemptionsCount" \+ "promo_codes"\."heldCount" < "promo_codes"\."maxRedemptions"/,
        );
    });

    test('an offer that holds a slot already takes no second one', async () => {
        const { repo, statements } = recordingDb([
            lock,
            [/from "promo_code_holds"/i, [['hold-0']]],
        ]);

        const taken = await repo.take({
            promoCodeId: 'code-1',
            checkoutOfferId: 'offer-1',
            expiresAt: EXPIRES,
        });

        assert.deepEqual(taken, { outcome: 'offer-holds-one' });
        assert.deepEqual(statements.map(kindOf), ['select', 'select']);
    });

    test('a code without a free slot writes no hold', async () => {
        const { repo, statements } = recordingDb([lock, noHoldYet]);

        const taken = await repo.take({
            promoCodeId: 'code-1',
            checkoutOfferId: 'offer-1',
            expiresAt: EXPIRES,
        });

        assert.deepEqual(taken, { outcome: 'no-slot' });
        assert.deepEqual(statements.map(kindOf), ['select', 'select', 'update']);
    });

    test('a code that does not exist is asked nothing further', async () => {
        const { repo, statements } = recordingDb();

        const taken = await repo.take({
            promoCodeId: 'gone',
            checkoutOfferId: 'offer-1',
            expiresAt: EXPIRES,
        });

        assert.deepEqual(taken, { outcome: 'no-slot' });
        assert.equal(statements.length, 1);
    });
});

describe('ending a hold', () => {
    test('a release deletes the offer’s hold and gives its slot back', async () => {
        const { repo, statements } = recordingDb([[/^delete/i, [['code-1']]]]);

        assert.equal(await repo.release('offer-1'), true);

        assert.deepEqual(statements.map(kindOf), ['delete', 'update']);
        assert.match(statements[1].sql, /greatest\("promo_codes"\."heldCount" - \$\d, 0\)/i);
        assert.doesNotMatch(statements[1].sql, /redemptionsCount/);
    });

    test('a release that finds no hold changes no count', async () => {
        const { repo, statements } = recordingDb();

        assert.equal(await repo.release('offer-1'), false);

        assert.deepEqual(statements.map(kindOf), ['delete']);
    });

    test('a sweep gives the slots back per code, in one fixed order of codes', async () => {
        const { repo, statements } = recordingDb([
            [/^delete/i, [['code-b'], ['code-a'], ['code-b']]],
        ]);

        assert.equal(await repo.expireDue(EXPIRES), 3);

        const [sweep, ...giveBacks] = statements;
        assert.match(sweep.sql, /"expiresAt" <= \$\d/);
        assert.match(sweep.sql, /"handedOverTx" is distinct from txid_current\(\)/i);
        assert.deepEqual(
            giveBacks.map(({ params }) => [params.at(-1), params[0]]),
            [
                ['code-a', 1],
                ['code-b', 2],
            ],
        );
    });

    test('a sweep of one code names it', async () => {
        const { repo, statements } = recordingDb();

        assert.equal(await repo.expireDue(EXPIRES, 'code-1'), 0);

        assert.ok(statements[0].params.includes('code-1'));
        assert.equal(statements.length, 1, 'nothing ended, so no count moves');
    });
});

describe('handing a hold to the redemption on the same transaction', () => {
    test('marks it with the transaction, only while it has not expired', async () => {
        const { db, repo, statements } = recordingDb([
            [/^update "promo_code_holds"/i, [['hold-1']]],
        ]);

        assert.equal(await repo.handOver('offer-1', EXPIRES, db), true);

        assert.match(statements[0].sql, /"handedOverTx" = txid_current\(\)/i);
        assert.match(statements[0].sql, /"expiresAt" > \$\d/);
    });

    test('the redemption on that transaction takes it as its slot', async () => {
        const { db, repo, statements } = recordingDb([
            [/^select/i, [['hold-1']]],
            [/^delete/i, [['code-1']]],
        ]);

        assert.equal(await repo.convertHandedOver('code-1', db), true);

        assert.match(statements[0].sql, /"handedOverTx" = txid_current\(\)/i);
        assert.deepEqual(statements.map(kindOf), ['select', 'delete', 'update']);
        assert.match(
            statements[2].sql,
            /"redemptionsCount" = "promo_codes"\."redemptionsCount" \+ \$\d/,
        );
    });

    test('a redemption on another transaction finds nothing and changes nothing', async () => {
        const { db, repo, statements } = recordingDb();

        assert.equal(await repo.convertHandedOver('code-1', db), false);

        assert.deepEqual(statements.map(kindOf), ['select']);
    });
});

describe('starting the same checkout again', () => {
    test('moves the expiry of the hold it has on that code', async () => {
        const { repo, statements } = recordingDb([[/^update/i, [['hold-1']]]]);

        assert.equal(await repo.extend('offer-1', 'code-1', EXPIRES), true);

        assert.ok(statements[0].params.includes('offer-1'));
        assert.ok(statements[0].params.includes('code-1'));
    });

    test('answers false when the hold ended meanwhile', async () => {
        const { repo } = recordingDb();

        assert.equal(await repo.extend('offer-1', 'code-1', EXPIRES), false);
    });

    test('reads the hold an offer has', async () => {
        const { repo } = recordingDb([[/^select/i, [HOLD_ROW]]]);

        const hold = await repo.findByCheckoutOffer('offer-1');

        assert.equal(hold.promoCodeId, 'code-1');
        assert.ok(hold.expiresAt instanceof Date);
        assert.equal(await recordingDb().repo.findByCheckoutOffer('offer-1'), null);
    });
});
