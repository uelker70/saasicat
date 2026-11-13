// Wherever tenants are served, every notice the platform decides is due goes
// through one port the application names, and into one record: the reminders
// before a tenant's data is deleted — which no tenant can be spared, so the
// start needs the port (`SC-CANC-022`) — the version notices where they are
// on, and what collecting an invoice tells its subscriber.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
    FeatureWithdrawalService,
    InvoiceCollectionService,
    SubscriberChargeService,
    TenantBillingModule,
    VersionNoticeService,
    VersionRetirementService,
} from '../dist/billing/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import { SaaSiCatModule, findViolations } from '../dist/platform/index.js';
import { FakeSubscriptionEndRepository } from '../dist/testing/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

/** The platform's options with `notices` as given, and the bundle's record kept or not. */
function withNotices(notices, { bundleKeepsNotices = true, versionNotices } = {}) {
    const options = everythingOnOptions();
    const { notices: _wired, ...tenantBilling } = options.tenantBilling;
    const { subscriptionNotices, ...tenantSlice } = options.persistence.tenantBilling;
    if (notices !== undefined) tenantBilling.notices = notices;
    if (versionNotices !== undefined) tenantBilling.versionNotices = versionNotices;
    return {
        ...options,
        persistence: {
            ...options.persistence,
            tenantBilling: bundleKeepsNotices
                ? { ...tenantSlice, subscriptionNotices }
                : tenantSlice,
        },
        tenantBilling,
    };
}

const violationsOf = (options) =>
    findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } }).filter(
        (violation) => violation.id.startsWith('subscription-notices.'),
    );

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the notice port, which serving tenants cannot start without', () => {
    test('left out, the start is refused with one sentence naming the option, the port and why', () => {
        const [violation, ...more] = violationsOf(withNotices(undefined));
        assert.deepEqual(more, []);
        assert.equal(violation?.id, 'subscription-notices.requires-port');
        const message = String(violation?.message);
        assert.match(message, /`tenantBilling\.notices\.port` is missing/);
        assert.match(message, /SubscriptionNoticePort/);
        assert.match(message, /learn the day its data is deleted from them/);
        assert.equal(message.split('. ').length, 1, 'one sentence');
    });

    test('passed to the version notices instead, the refusal says where it goes', () => {
        const [violation] = violationsOf(
            withNotices(undefined, { versionNotices: { port: sendingPort() } }),
        );
        assert.match(
            String(violation?.message),
            /`tenantBilling\.versionNotices` takes no port: the one port every notice goes through is `tenantBilling\.notices\.port`/,
        );
    });

    test('given, nothing is refused', () => {
        assert.deepEqual(violationsOf(withNotices({ port: sendingPort() })), []);
    });

    test('without tenant billing, it is not asked for', () => {
        const { tenantBilling: _off, ...options } = withNotices(undefined);
        assert.deepEqual(violationsOf(options), []);
    });

    test('tenant billing wired by hand with the ends and without it does not start, naming the option and the port', () => {
        assert.throws(
            () =>
                TenantBillingModule.forRoot({
                    ...HAND_WIRED,
                    subscriptionEnds: {
                        store: new FakeSubscriptionEndRepository(),
                        export: anExport(),
                    },
                }),
            /TenantBillingModule: `notices` is missing: .*SubscriptionNoticePort/,
        );
    });

    test('tenant billing wired by hand with the version notices and without it does not start', () => {
        assert.throws(
            () => TenantBillingModule.forRoot({ ...HAND_WIRED, versionNotices: {} }),
            /TenantBillingModule: `versionNotices` needs `notices`/,
        );
    });
});

// @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
describe('the record of the notices', () => {
    test('with nowhere to keep it, the start is refused, naming the rule', () => {
        assert.deepEqual(
            violationsOf(withNotices({ port: sendingPort() }, { bundleKeepsNotices: false })).map(
                (violation) => violation.id,
            ),
            ['subscription-notices.requires-record'],
        );
    });

    test("the bundle's record, or one named, is enough", () => {
        assert.deepEqual(violationsOf(withNotices({ port: sendingPort() })), []);
        assert.deepEqual(
            violationsOf(
                withNotices(
                    { port: sendingPort(), record: noticeRecord() },
                    { bundleKeepsNotices: false },
                ),
            ),
            [],
        );
    });

    test('tenant billing wired by hand with a port and no record does not start, naming it', () => {
        assert.throws(
            () => TenantBillingModule.forRoot({ ...HAND_WIRED, notices: { port: sendingPort() } }),
            /TenantBillingModule: `notices\.record` is missing/,
        );
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the port and the record, named once', () => {
    /** Every service that sends or records a notice, compiled over `options`. */
    async function compiled(options) {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(options)],
        }).compile();
        const get = (type) => moduleRef.get(type, { strict: false });
        return {
            moduleRef,
            versionNotices: get(VersionNoticeService),
            retirements: get(VersionRetirementService),
            withdrawals: get(FeatureWithdrawalService),
            collections: get(InvoiceCollectionService),
            charges: get(SubscriberChargeService),
        };
    }

    test('reach every service that sends or records a notice', async () => {
        const port = sendingPort();
        const record = noticeRecord();
        const options = bootable(withNotices({ port, record }, { versionNotices: {} }));
        const { moduleRef, ...services } = await compiled(options);

        for (const [name, service] of Object.entries(services)) {
            assert.equal(service.notices, record, `${name} records in the record named`);
        }
        for (const name of ['versionNotices', 'retirements', 'withdrawals']) {
            assert.equal(services[name].sender.port, port, `${name} sends through the port named`);
        }
        await moduleRef.close();
    });

    test("where no record is named, the bundle's is the one every service records in", async () => {
        const record = noticeRecord();
        const options = bootable(withNotices({ port: sendingPort() }, { versionNotices: {} }));
        options.persistence.tenantBilling.subscriptionNotices = record;
        const { moduleRef, ...services } = await compiled(options);

        for (const [name, service] of Object.entries(services)) {
            assert.equal(service.notices, record, `${name} records in the bundle's record`);
        }
        await moduleRef.close();
    });
});

/** Tenant billing's own ports, as an application wiring it by hand passes them. */
const HAND_WIRED = {
    authGuards: [class Guard {}],
    subscriptionUsagePort: {},
    usageSnapshotPort: {},
    subscriptionWritePort: {},
};
