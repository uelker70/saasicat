// What turning version notices on wires into an installation, and the
// configuration it refuses: a notice nobody could record would be sent again by
// every run.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { VersionNoticeCron, VersionNoticeService } from '../dist/billing/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import { SaaSiCatModule, findViolations } from '../dist/platform/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';

/** The platform's options with version notices shaped by `notices`, `false` for none. */
function withNotices(notices, { bundleKeepsNotices = true } = {}) {
    const options = everythingOnOptions();
    const { versionNotices, ...tenantBilling } = options.tenantBilling;
    const { subscriptionNotices, ...tenantSlice } = options.persistence.tenantBilling;
    return {
        ...options,
        persistence: {
            ...options.persistence,
            tenantBilling: bundleKeepsNotices
                ? { ...tenantSlice, subscriptionNotices }
                : tenantSlice,
        },
        tenantBilling:
            notices === false
                ? tenantBilling
                : { ...tenantBilling, versionNotices: { ...versionNotices, ...notices } },
    };
}

describe('the configuration version notices need', () => {
    const violations = (options) =>
        findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } })
            .map((violation) => violation.id)
            .filter((id) => id.startsWith('version-notices.'));

    test('turned on with nowhere to record a notice, the start is refused, naming the rule', () => {
        assert.deepEqual(violations(withNotices({}, { bundleKeepsNotices: false })), [
            'version-notices.requires-notice-record',
        ]);
    });

    test('a bundle that keeps notices, or a record of its own, is enough', () => {
        assert.deepEqual(violations(withNotices({})), []);
        assert.deepEqual(
            violations(withNotices({ notices: {} }, { bundleKeepsNotices: false })),
            [],
        );
    });

    test('turned off, nothing is asked for', () => {
        assert.deepEqual(violations(withNotices(false, { bundleKeepsNotices: false })), []);
    });
});

describe('an installation with version notices', () => {
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
        return { service: find(VersionNoticeService), cron: find(VersionNoticeCron) };
    }

    test('runs them every quarter of an hour unless told not to', async () => {
        const on = await compiled(withNotices({ includeCron: undefined }));
        assert.ok(on.service instanceof VersionNoticeService);
        assert.ok(on.cron instanceof VersionNoticeCron);

        const own = await compiled(withNotices({ includeCron: false }));
        assert.ok(
            own.service instanceof VersionNoticeService,
            'callable from a scheduler of its own',
        );
        assert.equal(own.cron, null);
    });

    test('without them, has neither', async () => {
        const off = await compiled(withNotices(false));
        assert.equal(off.service, null);
        assert.equal(off.cron, null);
    });
});
