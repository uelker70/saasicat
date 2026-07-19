import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CliContextService, CliError } from '../dist/index.js';

function buildHarness({
    isProduction = false,
    user = null,
    mfaEnabled = false,
    mfaVerifyResult = false,
} = {}) {
    const config = {
        adminEmailEnvVar: 'TEST_ADMIN_EMAIL',
        mfaSkipEnvVar: 'TEST_SKIP_MFA',
        isProductionEnvironment: () => isProduction,
    };
    const users = {
        findByEmail: async () => user,
        findById: async () => null,
        countActive: async () => 0,
        listForTenant: async () => ({ items: [], page: 1, pageSize: 0, total: 0 }),
        resetPassword: async () => {},
        hasRole: async () => false,
    };
    const mfaCalls = [];
    const mfa = {
        isEnabled: async () => mfaEnabled,
        verify: async (input) => {
            mfaCalls.push(input);
            return mfaVerifyResult;
        },
        setup: async () => ({ secret: 's', otpauthUri: 'u' }),
        disable: async () => {},
    };
    const auditCalls = [];
    const audit = {
        log: async (input) => {
            auditCalls.push(input);
        },
        fromCli: ({ id, email }) => ({
            userId: id,
            email,
            source: 'cli',
            context: 'test-host',
        }),
        actorTag: () => 'cli:x:y',
        fromWebRequest: () => ({}),
    };
    const svc = new CliContextService(config, users, mfa, audit);
    return { svc, mfa, mfaCalls, audit, auditCalls };
}

describe('CliContextService.resolveIdentity', () => {
    test('akzeptiert --as Flag', () => {
        const { svc } = buildHarness();
        const id = svc.resolveIdentity('Taci@Example.com');
        assert.equal(id.email, 'taci@example.com');
        assert.match(id.actor, /^cli:taci@example\.com:/);
    });

    test('fällt auf Env-Var zurück', () => {
        const old = process.env.TEST_ADMIN_EMAIL;
        process.env.TEST_ADMIN_EMAIL = 'env@example.com';
        try {
            const { svc } = buildHarness();
            const id = svc.resolveIdentity();
            assert.equal(id.email, 'env@example.com');
        } finally {
            if (old === undefined) delete process.env.TEST_ADMIN_EMAIL;
            else process.env.TEST_ADMIN_EMAIL = old;
        }
    });

    test('wirft NO_IDENTITY mit Exit-Code 2, wenn nichts gesetzt', () => {
        const old = process.env.TEST_ADMIN_EMAIL;
        delete process.env.TEST_ADMIN_EMAIL;
        try {
            const { svc } = buildHarness();
            assert.throws(
                () => svc.resolveIdentity(),
                (err) =>
                    err instanceof CliError && err.code === 'NO_IDENTITY' && err.exitCode === 2,
            );
        } finally {
            if (old !== undefined) process.env.TEST_ADMIN_EMAIL = old;
        }
    });

    test('--as überschreibt Env-Var', () => {
        const old = process.env.TEST_ADMIN_EMAIL;
        process.env.TEST_ADMIN_EMAIL = 'env@example.com';
        try {
            const { svc } = buildHarness();
            const id = svc.resolveIdentity('flag@example.com');
            assert.equal(id.email, 'flag@example.com');
        } finally {
            if (old === undefined) delete process.env.TEST_ADMIN_EMAIL;
            else process.env.TEST_ADMIN_EMAIL = old;
        }
    });
});

describe('CliContextService.ensureSuperAdmin', () => {
    const id = { email: 'a@b.de', host: 'h', actor: 'cli:a@b.de:h' };

    test('akzeptiert SUPER_ADMIN-User', async () => {
        const { svc } = buildHarness({
            user: {
                id: 'u1',
                email: 'a@b.de',
                platformRole: 'SUPER_ADMIN',
                isActive: true,
                deletedAt: null,
                lastLoginAt: null,
            },
        });
        const u = await svc.ensureSuperAdmin(id);
        assert.equal(u.id, 'u1');
    });

    test('lehnt nicht-existierenden User ab (USER_NOT_FOUND, exit 2)', async () => {
        const { svc } = buildHarness({ user: null });
        await assert.rejects(
            svc.ensureSuperAdmin(id),
            (err) => err instanceof CliError && err.code === 'USER_NOT_FOUND' && err.exitCode === 2,
        );
    });

    test('lehnt deaktivierten User ab', async () => {
        const { svc } = buildHarness({
            user: {
                id: 'u1',
                email: 'a@b.de',
                platformRole: 'SUPER_ADMIN',
                isActive: false,
                deletedAt: null,
                lastLoginAt: null,
            },
        });
        await assert.rejects(svc.ensureSuperAdmin(id), CliError);
    });

    test('lehnt non-SUPER_ADMIN ab (NOT_SUPER_ADMIN)', async () => {
        const { svc } = buildHarness({
            user: {
                id: 'u1',
                email: 'a@b.de',
                platformRole: 'TENANT_ADMIN',
                isActive: true,
                deletedAt: null,
                lastLoginAt: null,
            },
        });
        await assert.rejects(svc.ensureSuperAdmin(id), (err) => err.code === 'NOT_SUPER_ADMIN');
    });
});

describe('CliContextService.requireMfa', () => {
    test('Bypass: SKIP=1 + non-prod', async () => {
        const old = process.env.TEST_SKIP_MFA;
        process.env.TEST_SKIP_MFA = '1';
        try {
            const { svc, mfaCalls } = buildHarness({ isProduction: false });
            await svc.requireMfa('u1');
            assert.equal(mfaCalls.length, 0);
        } finally {
            if (old === undefined) delete process.env.TEST_SKIP_MFA;
            else process.env.TEST_SKIP_MFA = old;
        }
    });

    test('Bypass NICHT in Production', async () => {
        const oldSkip = process.env.TEST_SKIP_MFA;
        const oldReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        process.env.TEST_SKIP_MFA = '1';
        process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = '000000';
        try {
            const { svc } = buildHarness({
                isProduction: true,
                mfaEnabled: false,
            });
            await assert.rejects(
                svc.requireMfa('u1'),
                (err) => err.code === 'MFA_NOT_SET_UP' && err.exitCode === 3,
            );
        } finally {
            if (oldSkip === undefined) delete process.env.TEST_SKIP_MFA;
            else process.env.TEST_SKIP_MFA = oldSkip;
            if (oldReply === undefined) delete process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
            else process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = oldReply;
        }
    });

    test('MFA_NOT_SET_UP, wenn Plattform-MfaService isEnabled=false', async () => {
        const oldReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = '000000';
        try {
            const { svc } = buildHarness({ mfaEnabled: false });
            await assert.rejects(svc.requireMfa('u1'), (err) => err.code === 'MFA_NOT_SET_UP');
        } finally {
            if (oldReply === undefined) delete process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
            else process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = oldReply;
        }
    });

    test('MFA_FAILED bei ungültigem Code', async () => {
        const oldReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = '000000';
        try {
            const { svc, mfaCalls } = buildHarness({
                mfaEnabled: true,
                mfaVerifyResult: false,
            });
            await assert.rejects(
                svc.requireMfa('u1'),
                (err) => err.code === 'MFA_FAILED' && err.exitCode === 3,
            );
            assert.equal(mfaCalls.length, 1);
            assert.equal(mfaCalls[0].userId, 'u1');
        } finally {
            if (oldReply === undefined) delete process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
            else process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = oldReply;
        }
    });

    test('akzeptiert validen Code', async () => {
        const oldReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = '482159';
        try {
            const { svc } = buildHarness({
                mfaEnabled: true,
                mfaVerifyResult: true,
            });
            await svc.requireMfa('u1');
        } finally {
            if (oldReply === undefined) delete process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
            else process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = oldReply;
        }
    });
});

describe('CliContextService.ensureProductionConfirmation', () => {
    test('skipt in non-prod automatisch', async () => {
        const { svc } = buildHarness({ isProduction: false });
        await svc.ensureProductionConfirmation();
    });

    test('skipt mit yes=true in prod', async () => {
        const { svc } = buildHarness({ isProduction: true });
        await svc.ensureProductionConfirmation({ yes: true });
    });

    test('akzeptiert "production" als Antwort', async () => {
        const oldReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = 'production';
        try {
            const { svc } = buildHarness({ isProduction: true });
            await svc.ensureProductionConfirmation();
        } finally {
            if (oldReply === undefined) delete process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
            else process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = oldReply;
        }
    });

    test('lehnt andere Antworten ab (PRODUCTION_CONFIRM_ABORTED, exit 1)', async () => {
        const oldReply = process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
        process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = 'no';
        try {
            const { svc } = buildHarness({ isProduction: true });
            await assert.rejects(
                svc.ensureProductionConfirmation(),
                (err) => err.code === 'PRODUCTION_CONFIRM_ABORTED' && err.exitCode === 1,
            );
        } finally {
            if (oldReply === undefined) delete process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY;
            else process.env.SAAS_PLATFORM_CLI_PROMPT_REPLY = oldReply;
        }
    });
});

describe('CliContextService.log', () => {
    test('schreibt durch Plattform-AdminAuditService mit cli-Actor', async () => {
        const { svc, auditCalls } = buildHarness();
        await svc.log({
            identity: { email: 'a@b.de', host: 'h', actor: 'cli:a@b.de:h' },
            userId: 'u1',
            entity: 'PromoCode',
            entityId: 'pc-1',
            action: 'PROMO_CODE_CREATED',
            changes: { code: 'BLACK25' },
        });
        assert.equal(auditCalls.length, 1);
        assert.equal(auditCalls[0].entity, 'PromoCode');
        assert.equal(auditCalls[0].action, 'PROMO_CODE_CREATED');
        assert.equal(auditCalls[0].actor.source, 'cli');
        assert.equal(auditCalls[0].actor.userId, 'u1');
    });
});

describe('CliError', () => {
    test('hat code, message und exitCode', () => {
        const e = new CliError('FOO', 'bar', 7);
        assert.equal(e.name, 'CliError');
        assert.equal(e.code, 'FOO');
        assert.equal(e.message, 'bar');
        assert.equal(e.exitCode, 7);
    });
});
