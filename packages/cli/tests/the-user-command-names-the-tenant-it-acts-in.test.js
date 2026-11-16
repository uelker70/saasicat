// What `<app> user …` writes to the audit log, read where the application
// stores it: the real command, CLI context and audit service over a recording
// `AuditPort`, with only the application's user stores stood in for.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminAuditService } from '@saasicat/nest';

import { CliContextService, UserCommands } from '../dist/index.js';

const OPERATOR = {
    id: 'user-ops',
    email: 'ops@example.com',
    platformRole: 'SUPER_ADMIN',
    isActive: true,
    deletedAt: null,
};

const ADMIN = { id: 'user-new-admin', email: 'new-admin@example.com' };

function setUp() {
    const written = [];
    const auditPort = {
        async write(entry) {
            written.push(entry);
        },
    };
    const config = {
        adminEmailEnvVar: 'TEST_ADMIN_EMAIL',
        mfaSkipEnvVar: 'TEST_SKIP_MFA',
        isProductionEnvironment: () => false,
    };
    const operators = { findByEmail: async () => OPERATOR };
    const mfa = { isEnabled: async () => true, verify: async () => true };
    const ctx = new CliContextService(config, operators, mfa, new AdminAuditService(auditPort));
    ctx.prompt = async () => '123456';
    const users = {
        async reassignTenantAdmin() {
            return { user: ADMIN, tenantId: 'tenant-7', created: false, previousRole: 'MEMBER' };
        },
        async triggerPasswordReset() {
            return { user: ADMIN };
        },
        async deactivate() {
            return ADMIN;
        },
    };
    const command = new UserCommands(ctx, users);
    const run = async (args, flags) => {
        const log = console.log;
        console.log = () => {};
        try {
            await command.run(args, { as: OPERATOR.email, reason: 'ticket 42', ...flags });
        } finally {
            console.log = log;
        }
    };
    return { run, written };
}

// @requirement SC-AUD-021 — An audit entry names the tenant it concerns, so the tenant's deletion takes it along
describe('the user command names a tenant only where it acts in one', () => {
    test('a new administrator given to a tenant names the tenant the application answered with', async () => {
        const { run, written } = setUp();
        await run(['reassign-admin', 'acme'], { to: ADMIN.email });
        assert.equal(written.length, 1);
        assert.equal(written[0].entityId, ADMIN.id);
        assert.equal(written[0].tenantId, 'tenant-7');
    });

    test('a password reset of a person found by e-mail address names no tenant', async () => {
        const { run, written } = setUp();
        await run(['reset-password', ADMIN.email], {});
        assert.equal(written.length, 1);
        assert.equal(written[0].action, 'USER_PASSWORD_RESET_TRIGGERED');
        assert.equal(written[0].tenantId, undefined);
    });

    test('a deactivation of a person found by e-mail address names no tenant', async () => {
        const { run, written } = setUp();
        await run(['deactivate', ADMIN.email], {});
        assert.equal(written.length, 1);
        assert.equal(written[0].action, 'USER_DEACTIVATED');
        assert.equal(written[0].tenantId, undefined);
    });
});
