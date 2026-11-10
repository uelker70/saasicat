// What serving tenants wires in for the subscriptions that end, and the
// configuration it refuses: an end nobody can record is a deletion day nobody
// is told (`SC-CANC-027`).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
    SubscriptionEndCron,
    SubscriptionEndService,
    TrialEndService,
} from '../dist/billing/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import { SaaSiCatModule, findViolations } from '../dist/platform/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';

/** The platform's options with `subscriptionEnds` as given, and the bundle's store kept or not. */
function withEnds(subscriptionEnds, { bundleKeepsEnds = true } = {}) {
    const options = everythingOnOptions();
    const { subscriptionEnds: store, ...core } = options.persistence.core;
    return {
        ...options,
        persistence: {
            ...options.persistence,
            core: bundleKeepsEnds ? { ...core, subscriptionEnds: store } : core,
        },
        tenantBilling: subscriptionEnds
            ? { ...options.tenantBilling, subscriptionEnds }
            : options.tenantBilling,
    };
}

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the configuration the ends need', () => {
    const violations = (options) =>
        findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } })
            .map((violation) => violation.id)
            .filter((id) => id.startsWith('subscription-ends.'));

    test('serving tenants with nowhere to keep the ends, the start is refused, naming the rule', () => {
        assert.deepEqual(violations(withEnds(undefined, { bundleKeepsEnds: false })), [
            'subscription-ends.requires-store',
        ]);
    });

    test("the bundle's store, or one named, is enough", () => {
        assert.deepEqual(violations(withEnds(undefined)), []);
        assert.deepEqual(violations(withEnds({ store: {} }, { bundleKeepsEnds: false })), []);
    });

    test('without tenant billing, nothing is asked for', () => {
        const { tenantBilling: _off, ...options } = withEnds(undefined, { bundleKeepsEnds: false });
        assert.deepEqual(violations(options), []);
    });
});

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('an installation that serves tenants', () => {
    async function compiled(options) {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(options))],
        }).compile();
        // Nest answers a provider nobody registered with an exception, not null.
        const find = (type) => {
            try {
                return moduleRef.get(type, { strict: false });
            } catch (error) {
                if (error?.constructor?.name === 'UnknownElementException') return null;
                throw error;
            }
        };
        return {
            service: find(SubscriptionEndService),
            cron: find(SubscriptionEndCron),
            trials: find(TrialEndService),
        };
    }

    test('records the ends every quarter of an hour unless told not to', async () => {
        const on = await compiled(withEnds(undefined));
        assert.ok(on.service instanceof SubscriptionEndService);
        assert.ok(on.cron instanceof SubscriptionEndCron);
        assert.ok(on.trials instanceof TrialEndService, 'and the way an application ends a trial');

        const own = await compiled(withEnds({ includeCron: false }));
        assert.ok(
            own.service instanceof SubscriptionEndService,
            'callable from a scheduler of its own',
        );
        assert.equal(own.cron, null);
    });

    test('refuses to start where the file says nothing of the end, naming the setting', async () => {
        const options = withEnds(undefined);
        const { endOfSubscription: _missing, ...tenantBilling } = options.planCatalog.tenantBilling;
        await assert.rejects(
            compiled({ ...options, planCatalog: { ...options.planCatalog, tenantBilling } }),
            /tenantBilling\.endOfSubscription/,
        );
    });
});
