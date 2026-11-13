// What turning version notices on wires into an installation. They go through
// the port and the record every notice goes through (`tenantBilling.notices`),
// which `the-notices-are-wired-where-tenants-are-served.test.js` holds.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { VersionNoticeCron, VersionNoticeService } from '../dist/billing/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';

/** The platform's options with version notices shaped by `notices`, `false` for none. */
function withNotices(notices) {
    const options = everythingOnOptions();
    const { versionNotices, ...tenantBilling } = options.tenantBilling;
    return {
        ...options,
        tenantBilling:
            notices === false
                ? tenantBilling
                : { ...tenantBilling, versionNotices: { ...versionNotices, ...notices } },
    };
}

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
