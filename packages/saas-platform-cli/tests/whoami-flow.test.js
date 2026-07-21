import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WhoAmIFlow } from '../dist/index.js';

const SUPER_ADMIN = {
    id: 'u1',
    email: 'taci@example.com',
    platformRole: 'SUPER_ADMIN',
    isActive: true,
    deletedAt: null,
    lastLoginAt: null,
};

function buildHarness({
    isProduction = false,
    user = SUPER_ADMIN,
    mfaEnabled = true,
    skipEnvSet = false,
} = {}) {
    const config = {
        adminEmailEnvVar: 'TEST_ADMIN_EMAIL',
        mfaSkipEnvVar: 'TEST_SKIP_MFA',
        isProductionEnvironment: () => isProduction,
    };
    const ctx = {
        resolveIdentity: () => ({
            email: 'taci@example.com',
            host: 'host',
            actor: 'cli:taci@example.com:host',
        }),
        ensureSuperAdmin: async () => {
            if (!user) {
                const e = new Error('not found');
                throw e;
            }
            return user;
        },
    };
    const mfa = { isEnabled: async () => mfaEnabled };
    const oldSkip = process.env.TEST_SKIP_MFA;
    if (skipEnvSet) process.env.TEST_SKIP_MFA = '1';
    else delete process.env.TEST_SKIP_MFA;
    return {
        flow: new WhoAmIFlow(config, ctx, mfa),
        cleanup: () => {
            if (oldSkip === undefined) delete process.env.TEST_SKIP_MFA;
            else process.env.TEST_SKIP_MFA = oldSkip;
        },
    };
}

describe('WhoAmIFlow.run', () => {
    test('SUPER_ADMIN with MFA → full diagnosis', async () => {
        const { flow, cleanup } = buildHarness();
        try {
            const r = await flow.run();
            assert.equal(r.email, 'taci@example.com');
            assert.equal(r.userId, 'u1');
            assert.equal(r.isSuperAdmin, true);
            assert.equal(r.mfaEnabled, true);
            assert.equal(r.isProduction, false);
            assert.equal(r.mfaSkipActive, false);
        } finally {
            cleanup();
        }
    });

    test('user not found → isSuperAdmin=false, no crash', async () => {
        const { flow, cleanup } = buildHarness({ user: null });
        try {
            const r = await flow.run();
            assert.equal(r.userId, null);
            assert.equal(r.isSuperAdmin, false);
            assert.equal(r.mfaEnabled, false);
        } finally {
            cleanup();
        }
    });

    test('production is detected', async () => {
        const { flow, cleanup } = buildHarness({ isProduction: true });
        try {
            const r = await flow.run();
            assert.equal(r.isProduction, true);
            assert.equal(r.mfaSkipActive, false);
        } finally {
            cleanup();
        }
    });

    test('MFA skip visible in non-prod', async () => {
        const { flow, cleanup } = buildHarness({ skipEnvSet: true });
        try {
            const r = await flow.run();
            assert.equal(r.mfaSkipActive, true);
        } finally {
            cleanup();
        }
    });

    test('MFA skip NOT active in production', async () => {
        const { flow, cleanup } = buildHarness({ skipEnvSet: true, isProduction: true });
        try {
            const r = await flow.run();
            assert.equal(r.mfaSkipActive, false);
        } finally {
            cleanup();
        }
    });
});

describe('WhoAmIFlow.formatResult', () => {
    test('shows SUPER_ADMIN checkmark + MFA status', () => {
        const { flow, cleanup } = buildHarness();
        try {
            const out = flow.formatResult({
                email: 'a@b.de',
                host: 'h',
                actor: 'cli:a@b.de:h',
                userId: 'u1',
                isSuperAdmin: true,
                mfaEnabled: true,
                isProduction: false,
                mfaSkipActive: false,
            });
            assert.match(out, /SUPER_ADMIN ✓/);
            assert.match(out, /MFA konfiguriert: ✓/);
            assert.doesNotMatch(out, /MFA-Bypass aktiv/);
        } finally {
            cleanup();
        }
    });

    test('shows bypass warning when active', () => {
        const { flow, cleanup } = buildHarness();
        try {
            const out = flow.formatResult({
                email: 'a@b.de',
                host: 'h',
                actor: 'cli:a@b.de:h',
                userId: 'u1',
                isSuperAdmin: true,
                mfaEnabled: false,
                isProduction: false,
                mfaSkipActive: true,
            });
            assert.match(out, /MFA-Bypass aktiv/);
        } finally {
            cleanup();
        }
    });
});
