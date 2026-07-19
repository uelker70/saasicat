import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError, MfaSetupFlow } from '../dist/index.js';

const SUPER_ADMIN = {
    id: 'u1',
    email: 'taci@example.com',
    platformRole: 'SUPER_ADMIN',
    isActive: true,
    deletedAt: null,
    lastLoginAt: null,
};

function buildHarness({
    user = SUPER_ADMIN,
    mfaEnabled = false,
    setupResult = { secret: 'BASE32SECRET', otpauthUri: 'otpauth://totp/x' },
} = {}) {
    const setupCalls = [];
    const auditCalls = [];
    const ctx = {
        resolveIdentity: () => ({
            email: 'taci@example.com',
            host: 'host',
            actor: 'cli:taci@example.com:host',
        }),
        ensureSuperAdmin: async () => user,
        prompt: async () => 'no',
        log: async (input) => {
            auditCalls.push(input);
        },
    };
    const mfa = {
        isEnabled: async () => mfaEnabled,
        setup: async (userId, label, issuer) => {
            setupCalls.push({ userId, label, issuer });
            return setupResult;
        },
        verify: async () => true,
        disable: async () => {},
    };
    return {
        flow: new MfaSetupFlow(ctx, mfa),
        ctx,
        mfa,
        setupCalls,
        auditCalls,
    };
}

describe('MfaSetupFlow.run — Erst-Setup', () => {
    test('liefert Secret + otpauthUri für SUPER_ADMIN', async () => {
        const { flow, setupCalls, auditCalls } = buildHarness();
        const result = await flow.run({ issuer: 'AutohausPro SuperAdmin' });
        assert.equal(result.secret, 'BASE32SECRET');
        assert.equal(result.otpauthUri, 'otpauth://totp/x');
        assert.equal(result.userEmail, 'taci@example.com');
        assert.equal(setupCalls.length, 1);
        assert.equal(setupCalls[0].issuer, 'AutohausPro SuperAdmin');
        // Audit-Log: erstes Setup → MFA_SETUP_COMPLETED
        assert.equal(auditCalls.length, 1);
        assert.equal(auditCalls[0].action, 'MFA_SETUP_COMPLETED');
        assert.equal(auditCalls[0].entity, 'User');
    });

    test('Audit-Log enthält issuer in changes', async () => {
        const { flow, auditCalls } = buildHarness();
        await flow.run({ issuer: 'vereinsfux SuperAdmin' });
        assert.deepEqual(auditCalls[0].changes, { issuer: 'vereinsfux SuperAdmin' });
    });
});

describe('MfaSetupFlow.run — Re-Setup', () => {
    test('lehnt Re-Setup ohne Bestätigung ab (MFA_SETUP_ABORTED)', async () => {
        const { flow } = buildHarness({ mfaEnabled: true });
        // ctx.prompt liefert "no" — abgelehnt
        await assert.rejects(
            flow.run({ issuer: 'X' }),
            (err) =>
                err instanceof CliError && err.code === 'MFA_SETUP_ABORTED' && err.exitCode === 1,
        );
    });

    test('akzeptiert Re-Setup mit "yes"-Antwort und audit MFA_SETUP_RESET', async () => {
        const harness = buildHarness({ mfaEnabled: true });
        harness.ctx.prompt = async () => 'yes';
        const result = await harness.flow.run({ issuer: 'X' });
        assert.equal(result.secret, 'BASE32SECRET');
        assert.equal(harness.auditCalls.length, 1);
        assert.equal(harness.auditCalls[0].action, 'MFA_SETUP_RESET');
    });

    test('akzeptiert Re-Setup mit force=true ohne prompt', async () => {
        const harness = buildHarness({ mfaEnabled: true });
        let promptCalled = false;
        harness.ctx.prompt = async () => {
            promptCalled = true;
            return 'no';
        };
        const result = await harness.flow.run({ issuer: 'X', force: true });
        assert.equal(promptCalled, false);
        assert.equal(result.secret, 'BASE32SECRET');
        assert.equal(harness.auditCalls[0].action, 'MFA_SETUP_RESET');
    });
});

describe('MfaSetupFlow.formatSetupResult', () => {
    test('liefert mehrzeilige Anleitung mit Secret + URI', () => {
        const { flow } = buildHarness();
        const formatted = flow.formatSetupResult({
            secret: 'BASE32',
            otpauthUri: 'otpauth://totp/foo',
            userId: 'u1',
            userEmail: 'taci@example.com',
        });
        assert.match(formatted, /MFA-Setup für taci@example\.com/);
        assert.match(formatted, /Secret \(Base32\): {2}BASE32/);
        assert.match(formatted, /otpauth-URI: {6}otpauth:\/\/totp\/foo/);
        assert.match(formatted, /Authenticator/);
    });
});
