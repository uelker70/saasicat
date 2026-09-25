// A moment the adapter writes is the moment it was written, whatever time zone
// the database session runs in.
//
// The canonical columns are `timestamp` without a time zone. A value the
// application writes carries its own instant; a value left to the database's
// `now()` is stored as the session's wall time and read back as UTC, so under a
// session outside UTC it is hours off. The contract freeze compares a
// redemption's `redeemedAt` with a contract's `createdAt`, and the two have to
// come from the same clock for that comparison to mean anything.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { DrizzlePromoCodeRedemptionRepository } from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const SESSION_TIME_ZONE = 'Europe/Berlin';

let pool;
let berlin;
let repository;
let subscriptionId;
let promoCodeId;

before(async () => {
    ({ pool } = await openDisposableDatabase({ max: 2 }));
    berlin = new pg.Pool({
        connectionString: process.env.SAASICAT_TEST_DATABASE_URL,
        max: 2,
        options: `-c TimeZone=${SESSION_TIME_ZONE}`,
    });
    repository = new DrizzlePromoCodeRedemptionRepository(drizzle(berlin));

    const planVersionId = randomUUID();
    await pool.query(
        `INSERT INTO plan_versions
           ("id","planId","version","features","quotas","monthlyNet","yearlyNet","marketed",
            "changeNote","nonRegressive","publishedAt","createdAt","updatedAt")
         VALUES ($1,'PRO',1,'[]','{}','49.00','490.00',true,'seed',true,NOW(),NOW(),NOW())`,
        [planVersionId],
    );
    subscriptionId = randomUUID();
    await pool.query(
        `INSERT INTO subscriptions
           ("id","tenantId","plan","billingCycle","status","planVersionId","isPilot",
            "createdAt","updatedAt")
         VALUES ($1,'t1','PRO','MONTHLY','ACTIVE',$2,false,NOW(),NOW())`,
        [subscriptionId, planVersionId],
    );
    promoCodeId = randomUUID();
    await pool.query(
        `INSERT INTO promo_codes ("id","code","valueType","value","updatedAt")
         VALUES ($1,'WELCOME10','PERCENT','10.00',NOW())`,
        [promoCodeId],
    );
});

after(async () => {
    await berlin?.end();
    await pool?.end();
});

describe('a moment the adapter writes is the moment it was written', () => {
    test('the session really runs outside UTC', async () => {
        const { rows } = await berlin.query('SHOW TimeZone');
        assert.equal(rows[0].TimeZone, SESSION_TIME_ZONE);
    });

    test('a redemption is redeemed when it was written, not hours off', async () => {
        const before = new Date();
        const redemption = await repository.create({
            promoCodeId,
            subscriptionId,
            tenantId: 't1',
            appliedValueType: 'PERCENT',
            appliedValue: '10.00',
            appliedDurationType: 'ONCE',
            appliedDurationValue: null,
            startsAt: before,
            endsAt: null,
        });
        const after = new Date();

        const read = await repository.findBySubscription(subscriptionId);
        for (const [what, at] of [
            ['returned by create', redemption.redeemedAt],
            ['read back', read.redeemedAt],
        ]) {
            assert.ok(
                at >= before && at <= after,
                `${what}: ${at.toISOString()} is not between ${before.toISOString()} and ${after.toISOString()}`,
            );
        }
    });
});
