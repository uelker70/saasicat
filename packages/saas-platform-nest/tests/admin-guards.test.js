import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AdminAuditService,
    MfaGuard,
    MfaService,
    REQUIRE_MFA_KEY,
    RequireMfa,
    SuperAdminGuard,
} from '../dist/admin/index.js';

function buildContext({ user, headers = {} }) {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ user, headers }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
    };
}

describe('SuperAdminGuard', () => {
    const guard = new SuperAdminGuard();

    test('accepts SUPER_ADMIN', () => {
        assert.equal(guard.canActivate(buildContext({ user: { role: 'SUPER_ADMIN' } })), true);
    });

    test('rejects TENANT_ADMIN', () => {
        assert.throws(
            () => guard.canActivate(buildContext({ user: { role: 'TENANT_ADMIN' } })),
            /Nur SUPER_ADMIN-Rolle erlaubt/,
        );
    });

    test('rejects a missing user', () => {
        assert.throws(() => guard.canActivate(buildContext({})), /Nicht authentifiziert/);
    });
});

describe('MfaService — TOTP setup + verify', () => {
    function buildPort() {
        const store = new Map();
        return {
            store,
            port: {
                async getSecret(userId) {
                    return store.get(userId) ?? null;
                },
                async setSecret(userId, secret) {
                    if (secret === null) store.delete(userId);
                    else store.set(userId, secret);
                },
                async isEnabled(userId) {
                    return store.has(userId);
                },
            },
        };
    }

    test('setup() generates secret + otpauth URI and persists via port', async () => {
        const { port, store } = buildPort();
        const svc = new MfaService(port);
        const result = await svc.setup('u1', 'taci@example.com', 'DemoApp');
        assert.ok(result.secret);
        assert.match(result.otpauthUri, /^otpauth:\/\/totp\//);
        assert.equal(store.get('u1'), result.secret);
    });

    test('verify() rejects when no secret exists', async () => {
        const { port } = buildPort();
        const svc = new MfaService(port);
        assert.equal(await svc.verify({ userId: 'u1', code: '123456' }), false);
    });

    test('verify() rejects an invalid code', async () => {
        const { port } = buildPort();
        const svc = new MfaService(port);
        await svc.setup('u1', 'taci@example.com', 'DemoApp');
        assert.equal(await svc.verify({ userId: 'u1', code: '000000' }), false);
    });

    test('disable() deletes the secret', async () => {
        const { port, store } = buildPort();
        const svc = new MfaService(port);
        await svc.setup('u1', 'taci@example.com', 'DemoApp');
        await svc.disable('u1');
        assert.equal(store.has('u1'), false);
    });

    test('isEnabled() reflects port state', async () => {
        const { port } = buildPort();
        const svc = new MfaService(port);
        assert.equal(await svc.isEnabled('u1'), false);
        await svc.setup('u1', 'a', 'X');
        assert.equal(await svc.isEnabled('u1'), true);
    });
});

describe('MfaGuard — RequireMfa decorator + header check', () => {
    function buildReflector(required) {
        return { getAllAndOverride: () => required };
    }
    function buildMfaService(opts) {
        return {
            isEnabled: async () => opts.enabled ?? false,
            verify: async () => opts.verifyResult ?? false,
        };
    }

    test('SetMetadata decorator sets REQUIRE_MFA_KEY', () => {
        // Smoke: RequireMfa() returns a SetMetadata function
        const dec = RequireMfa();
        assert.equal(typeof dec, 'function');
        assert.ok(REQUIRE_MFA_KEY); // exported
    });

    test('passes through when endpoint is not MFA-required', async () => {
        const guard = new MfaGuard(buildReflector(false), buildMfaService({}));
        assert.equal(await guard.canActivate(buildContext({})), true);
    });

    function expectReason(promise, reason) {
        return assert.rejects(promise, (err) => {
            const r = err?.response?.reason ?? err?.getResponse?.()?.reason;
            return r === reason;
        });
    }

    test('NOT_AUTHENTICATED on missing user', async () => {
        const guard = new MfaGuard(buildReflector(true), buildMfaService({}));
        await expectReason(guard.canActivate(buildContext({})), 'NOT_AUTHENTICATED');
    });

    test('MFA_NOT_SET_UP when port enabled=false', async () => {
        const guard = new MfaGuard(buildReflector(true), buildMfaService({ enabled: false }));
        await expectReason(
            guard.canActivate(buildContext({ user: { id: 'u1' } })),
            'MFA_NOT_SET_UP',
        );
    });

    test('MFA_REQUIRED when no X-Mfa-Code header', async () => {
        const guard = new MfaGuard(buildReflector(true), buildMfaService({ enabled: true }));
        await expectReason(guard.canActivate(buildContext({ user: { id: 'u1' } })), 'MFA_REQUIRED');
    });

    test('MFA_FAILED on invalid code', async () => {
        const guard = new MfaGuard(
            buildReflector(true),
            buildMfaService({ enabled: true, verifyResult: false }),
        );
        await expectReason(
            guard.canActivate(
                buildContext({
                    user: { id: 'u1' },
                    headers: { 'x-mfa-code': '000000' },
                }),
            ),
            'MFA_FAILED',
        );
    });

    test('accepts a valid code', async () => {
        const guard = new MfaGuard(
            buildReflector(true),
            buildMfaService({ enabled: true, verifyResult: true }),
        );
        const result = await guard.canActivate(
            buildContext({
                user: { id: 'u1' },
                headers: { 'x-mfa-code': '482159' },
            }),
        );
        assert.equal(result, true);
    });

    test('bypass with SAAS_PLATFORM_SKIP_MFA=1 in non-prod', async () => {
        const oldSkip = process.env.SAAS_PLATFORM_SKIP_MFA;
        const oldEnv = process.env.NODE_ENV;
        process.env.SAAS_PLATFORM_SKIP_MFA = '1';
        process.env.NODE_ENV = 'development';
        try {
            const guard = new MfaGuard(buildReflector(true), buildMfaService({ enabled: false }));
            assert.equal(await guard.canActivate(buildContext({})), true);
        } finally {
            process.env.SAAS_PLATFORM_SKIP_MFA = oldSkip;
            process.env.NODE_ENV = oldEnv;
        }
    });

    test('no bypass in production', async () => {
        const oldSkip = process.env.SAAS_PLATFORM_SKIP_MFA;
        const oldEnv = process.env.NODE_ENV;
        process.env.SAAS_PLATFORM_SKIP_MFA = '1';
        process.env.NODE_ENV = 'production';
        try {
            const guard = new MfaGuard(buildReflector(true), buildMfaService({ enabled: false }));
            await expectReason(
                guard.canActivate(buildContext({ user: { id: 'u1' } })),
                'MFA_NOT_SET_UP',
            );
        } finally {
            process.env.SAAS_PLATFORM_SKIP_MFA = oldSkip;
            process.env.NODE_ENV = oldEnv;
        }
    });
});

describe('AdminAuditService', () => {
    function buildPort() {
        const calls = [];
        return {
            calls,
            port: {
                async write(input) {
                    calls.push(input);
                },
            },
        };
    }

    test('actorTag formats source:email:context', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        assert.equal(
            svc.actorTag({
                userId: 'u1',
                email: 'taci@example.com',
                source: 'cli',
                context: 'laptop',
            }),
            'cli:taci@example.com:laptop',
        );
    });

    test('log() writes through and appends the actor tag to changes', async () => {
        const { port, calls } = buildPort();
        const svc = new AdminAuditService(port);
        await svc.log({
            actor: {
                userId: 'u1',
                email: 'a@b.de',
                source: 'web',
                context: 'sess-1',
            },
            entity: 'PromoCode',
            entityId: 'pc-1',
            action: 'PROMO_CODE_CREATED',
            changes: { code: 'BLACK25' },
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].entity, 'PromoCode');
        assert.equal(calls[0].entityId, 'pc-1');
        assert.equal(calls[0].action, 'PROMO_CODE_CREATED');
        assert.equal(calls[0].changes.code, 'BLACK25');
        assert.equal(calls[0].changes.actor, 'web:a@b.de:sess-1');
    });

    test('fromWebRequest builds AdminActor with source=web', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        const a = svc.fromWebRequest({ id: 'u1', email: 'a@b.de' }, 'sess-1');
        assert.equal(a.source, 'web');
        assert.equal(a.email, 'a@b.de');
        assert.equal(a.context, 'sess-1');
    });

    test('fromWebRequest falls back to "unknown" when there is no session', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        const a = svc.fromWebRequest({ id: 'u1', email: 'a@b.de' });
        assert.equal(a.context, 'unknown');
    });

    test('fromCli builds AdminActor with source=cli + hostname', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        const a = svc.fromCli({ id: 'u1', email: 'a@b.de' });
        assert.equal(a.source, 'cli');
        assert.ok(a.context.length > 0);
    });
});
