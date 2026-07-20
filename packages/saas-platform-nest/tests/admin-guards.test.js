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

    test('akzeptiert SUPER_ADMIN', () => {
        assert.equal(guard.canActivate(buildContext({ user: { role: 'SUPER_ADMIN' } })), true);
    });

    test('lehnt TENANT_ADMIN ab', () => {
        assert.throws(
            () => guard.canActivate(buildContext({ user: { role: 'TENANT_ADMIN' } })),
            /Nur SUPER_ADMIN-Rolle erlaubt/,
        );
    });

    test('lehnt fehlenden User ab', () => {
        assert.throws(() => guard.canActivate(buildContext({})), /Nicht authentifiziert/);
    });
});

describe('MfaService — TOTP-Setup + Verify', () => {
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

    test('setup() generiert Secret + otpauth-URI und persistiert via Port', async () => {
        const { port, store } = buildPort();
        const svc = new MfaService(port);
        const result = await svc.setup('u1', 'taci@example.com', 'DemoApp');
        assert.ok(result.secret);
        assert.match(result.otpauthUri, /^otpauth:\/\/totp\//);
        assert.equal(store.get('u1'), result.secret);
    });

    test('verify() lehnt ab, wenn kein Secret vorhanden', async () => {
        const { port } = buildPort();
        const svc = new MfaService(port);
        assert.equal(await svc.verify({ userId: 'u1', code: '123456' }), false);
    });

    test('verify() lehnt ungültigen Code ab', async () => {
        const { port } = buildPort();
        const svc = new MfaService(port);
        await svc.setup('u1', 'taci@example.com', 'DemoApp');
        assert.equal(await svc.verify({ userId: 'u1', code: '000000' }), false);
    });

    test('disable() löscht das Secret', async () => {
        const { port, store } = buildPort();
        const svc = new MfaService(port);
        await svc.setup('u1', 'taci@example.com', 'DemoApp');
        await svc.disable('u1');
        assert.equal(store.has('u1'), false);
    });

    test('isEnabled() spiegelt Port-State', async () => {
        const { port } = buildPort();
        const svc = new MfaService(port);
        assert.equal(await svc.isEnabled('u1'), false);
        await svc.setup('u1', 'a', 'X');
        assert.equal(await svc.isEnabled('u1'), true);
    });
});

describe('MfaGuard — RequireMfa-Decorator + Header-Check', () => {
    function buildReflector(required) {
        return { getAllAndOverride: () => required };
    }
    function buildMfaService(opts) {
        return {
            isEnabled: async () => opts.enabled ?? false,
            verify: async () => opts.verifyResult ?? false,
        };
    }

    test('SetMetadata-Decorator setzt REQUIRE_MFA_KEY', () => {
        // Smoke: RequireMfa() liefert eine SetMetadata-Funktion zurück
        const dec = RequireMfa();
        assert.equal(typeof dec, 'function');
        assert.ok(REQUIRE_MFA_KEY); // exportiert
    });

    test('passiert durch, wenn Endpoint nicht MFA-pflichtig', async () => {
        const guard = new MfaGuard(buildReflector(false), buildMfaService({}));
        assert.equal(await guard.canActivate(buildContext({})), true);
    });

    function expectReason(promise, reason) {
        return assert.rejects(promise, (err) => {
            const r = err?.response?.reason ?? err?.getResponse?.()?.reason;
            return r === reason;
        });
    }

    test('NOT_AUTHENTICATED bei fehlendem User', async () => {
        const guard = new MfaGuard(buildReflector(true), buildMfaService({}));
        await expectReason(guard.canActivate(buildContext({})), 'NOT_AUTHENTICATED');
    });

    test('MFA_NOT_SET_UP, wenn Port enabled=false', async () => {
        const guard = new MfaGuard(buildReflector(true), buildMfaService({ enabled: false }));
        await expectReason(
            guard.canActivate(buildContext({ user: { id: 'u1' } })),
            'MFA_NOT_SET_UP',
        );
    });

    test('MFA_REQUIRED, wenn kein X-Mfa-Code-Header', async () => {
        const guard = new MfaGuard(buildReflector(true), buildMfaService({ enabled: true }));
        await expectReason(guard.canActivate(buildContext({ user: { id: 'u1' } })), 'MFA_REQUIRED');
    });

    test('MFA_FAILED bei ungültigem Code', async () => {
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

    test('akzeptiert validen Code', async () => {
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

    test('Bypass mit SAAS_PLATFORM_SKIP_MFA=1 in non-prod', async () => {
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

    test('Bypass NICHT in production', async () => {
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

    test('actorTag formatiert source:email:context', () => {
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

    test('log() schreibt durch und hängt actor-Tag in changes', async () => {
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

    test('fromWebRequest baut AdminActor mit source=web', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        const a = svc.fromWebRequest({ id: 'u1', email: 'a@b.de' }, 'sess-1');
        assert.equal(a.source, 'web');
        assert.equal(a.email, 'a@b.de');
        assert.equal(a.context, 'sess-1');
    });

    test('fromWebRequest fällt auf "unknown" zurück, wenn keine Session', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        const a = svc.fromWebRequest({ id: 'u1', email: 'a@b.de' });
        assert.equal(a.context, 'unknown');
    });

    test('fromCli baut AdminActor mit source=cli + Hostname', () => {
        const { port } = buildPort();
        const svc = new AdminAuditService(port);
        const a = svc.fromCli({ id: 'u1', email: 'a@b.de' });
        assert.equal(a.source, 'cli');
        assert.ok(a.context.length > 0);
    });
});
