// A moment the adapter writes is the moment it was written, whatever time zone
// the database session — or the application's host — runs in.
//
// The canonical columns are `timestamp` without a time zone. A value the
// application writes through Drizzle carries its own instant; a value left to
// the database's `now()` is stored as the session's wall time and read back as
// UTC, and a `Date` handed to the driver as a raw parameter is serialised in
// the process's zone, whose offset the column then drops. Under either zone
// outside UTC such a moment is hours off. The contract freeze compares a
// redemption's `redeemedAt` with a contract's `createdAt`, and a plan version
// ends at its `endsAt`: both need one clock.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { DrizzlePlanRepository, DrizzlePromoCodeRedemptionRepository } from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const ZONE = 'Europe/Berlin';
// The application's host outside UTC as well, for the raw parameters.
process.env.TZ = ZONE;

const UPGRADE_STEP = new URL(
    '../../sql/1.0-a-redemption-is-redeemed-in-utc.postgres.sql',
    import.meta.url,
);

let pool;
let berlin;
let redemptions;
let planVersionId;
let promoCodeId;

/** A UTC instant as the literal a `timestamp` column stores it as. */
const utcWallTime = (at) => at.toISOString().replace('T', ' ').replace('Z', '');

/** A subscription of a tenant of its own — one subscription per tenant. */
async function aSubscription() {
    const id = randomUUID();
    await pool.query(
        `INSERT INTO subscriptions
           ("id","tenantId","plan","billingCycle","status","planVersionId","isPilot",
            "createdAt","updatedAt")
         VALUES ($1,$2,'PRO','MONTHLY','ACTIVE',$3,false,NOW(),NOW())`,
        [id, randomUUID(), planVersionId],
    );
    return id;
}

function assertBetween(what, at, from, to) {
    assert.ok(
        at >= from && at <= to,
        `${what}: ${at.toISOString()} is not between ${from.toISOString()} and ${to.toISOString()}`,
    );
}

before(async () => {
    ({ pool } = await openDisposableDatabase({ max: 2 }));
    berlin = new pg.Pool({
        connectionString: process.env.SAASICAT_TEST_DATABASE_URL,
        max: 2,
        options: `-c TimeZone=${ZONE}`,
    });
    redemptions = new DrizzlePromoCodeRedemptionRepository(drizzle(berlin));

    planVersionId = randomUUID();
    await pool.query(
        `INSERT INTO plan_versions
           ("id","planId","version","features","quotas","monthlyNet","yearlyNet","marketed",
            "changeNote","nonRegressive","publishedAt","createdAt","updatedAt")
         VALUES ($1,'PRO',1,'[]','{}','49.00','490.00',true,'seed',true,NOW(),NOW(),NOW())`,
        [planVersionId],
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
        assert.equal(rows[0].TimeZone, ZONE);
    });

    test('a redemption is redeemed when it was written, not hours off', async () => {
        const subscriptionId = await aSubscription();
        const from = new Date();
        const redemption = await redemptions.create({
            promoCodeId,
            subscriptionId,
            tenantId: 't1',
            appliedValueType: 'PERCENT',
            appliedValue: '10.00',
            appliedDurationType: 'ONCE',
            appliedDurationValue: null,
            startsAt: from,
            endsAt: null,
        });
        const to = new Date();

        const read = await redemptions.findBySubscription(subscriptionId);
        assertBetween('returned by create', redemption.redeemedAt, from, to);
        assertBetween('read back', read.redeemedAt, from, to);
    });
});

describe('a terminated plan version ends when it ends, not hours before', () => {
    const endingIn = async (planId, ms) => {
        const endsAt = new Date(Date.now() + ms);
        await pool.query(
            `INSERT INTO plan_versions
               ("id","planId","version","features","quotas","monthlyNet","yearlyNet","marketed",
                "changeNote","nonRegressive","publishedAt","endsAt","createdAt","updatedAt")
             VALUES ($1,$2,1,'[]','{}','49.00','490.00',true,'seed',true,NOW(),
                     $3::timestamp,NOW(),NOW())`,
            [randomUUID(), planId, utcWallTime(endsAt)],
        );
        return endsAt;
    };

    test('the latest live version is live until it ends', async () => {
        await endingIn('ENDS-IN-AN-HOUR', 60 * 60 * 1000);

        const live = await new DrizzlePlanRepository(drizzle(berlin)).findLatestLivePlanVersion(
            'ENDS-IN-AN-HOUR',
        );

        assert.ok(live, 'a version ending in an hour is not live');
    });

    test('a version is bookable at a moment before it ends', async () => {
        const endsAt = await endingIn('ENDS-LATER', 60 * 60 * 1000);
        const repository = new DrizzlePlanRepository(drizzle(berlin), { validityWindows: true });

        const bookable = await repository.findActivePlanVersion(
            'ENDS-LATER',
            new Date(endsAt.getTime() - 30 * 60 * 1000),
        );

        assert.ok(bookable, 'a version half an hour before its end is not bookable');
    });
});

describe('the upgrade step moves a redemption written before this version to UTC', () => {
    test('once, and a second run leaves it where the first put it', async () => {
        const subscriptionId = await aSubscription();
        // Written the way the adapter used to: `redeemedAt` left to `now()`.
        const from = new Date();
        await berlin.query(
            `INSERT INTO promo_code_redemptions
               ("id","promoCodeId","subscriptionId","tenantId","appliedValueType","appliedValue",
                "appliedDurationType","startsAt")
             VALUES ($1,$2,$3,'t1','PERCENT','10.00','ONCE',NOW())`,
            [randomUUID(), promoCodeId, subscriptionId],
        );
        const to = new Date();
        const redeemedAt = async () =>
            (await redemptions.findBySubscription(subscriptionId)).redeemedAt;
        const written = await redeemedAt();
        assert.ok(written > to, `the old write is not off at all: ${written.toISOString()}`);

        const step = readFileSync(UPGRADE_STEP, 'utf8');
        await berlin.query(step);
        const converted = await redeemedAt();
        await berlin.query(step);

        assertBetween('after the step', converted, from, to);
        assert.equal((await redeemedAt()).toISOString(), converted.toISOString());
    });
});
