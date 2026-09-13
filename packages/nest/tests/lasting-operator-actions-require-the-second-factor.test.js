// @requirement SC-SEC-013 — The platform's own routes with lasting consequences check the second factor themselves

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GuardsConsumer, GuardsContextCreator } from '@nestjs/core/guards/index.js';
import { Test } from '@nestjs/testing';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { AdminModule, MfaGuard, MfaService, REQUIRE_MFA_KEY } from '../dist/admin/index.js';
import { PlanCatalogImporterModule } from '../dist/billing/index.js';
import { SaaSiCatModule, SuperAdminGuard } from '../dist/platform/index.js';

import {
    GUARDS,
    SignedInGuard,
    controllersIn,
    everythingOnOptions,
    handlersOf,
    isOperatorRoute,
} from './helpers/operator-routes.js';

// The operator actions whose consequences outlast the request. Written out,
// because "lasting" is a judgement no metadata carries; the test that no other
// route asks for the second factor keeps the list from drifting the other way.
const LASTING = [
    'DELETE admin/catalog/plans/:id/purge',
    'POST admin/catalog/bundle-versions/:id/publish',
    'POST admin/catalog/plan-versions/:id/publish',
    'POST admin/catalog/plan-versions/:id/terminate',
    'POST admin/tenants/:slug/reactivate',
    'POST admin/tenants/:slug/suspend',
];
const TENANT_STATE = ['POST admin/tenants/:slug/reactivate', 'POST admin/tenants/:slug/suspend'];
const IMPORT = 'POST admin/billing/plan-catalog/import';

const CODE = '123456';
const OPERATOR = { id: 'operator', role: 'SUPER_ADMIN' };
const OPERATOR_WITHOUT_MFA = { id: 'without-mfa', role: 'SUPER_ADMIN' };
const TENANT_USER = { id: 'tenant-user', role: 'TENANT_ADMIN', tenantId: 't-1' };

/**
 * A second factor every identified caller except `OPERATOR_WITHOUT_MFA` has set
 * up, answering to `CODE`, and to no caller it cannot name.
 */
class FakeMfaService {
    async isEnabled(userId) {
        return typeof userId === 'string' && userId !== OPERATOR_WITHOUT_MFA.id;
    }
    async verify({ userId, code }) {
        return typeof userId === 'string' && code === CODE;
    }
}

const PORT = {};

/**
 * A port that has every method, for services that check their repositories
 * when they are constructed. Nothing here calls them: only guards run.
 */
const ANSWERS_EVERYTHING = new Proxy(
    {},
    { get: (_, key) => (typeof key === 'symbol' || key === 'then' ? undefined : async () => null) },
);

/** The fixture with every port able to construct its service. */
function bootable(options = everythingOnOptions()) {
    const persistence = Object.fromEntries(
        Object.entries(options.persistence).map(([group, ports]) =>
            group === 'capabilities'
                ? [group, ports]
                : [
                      group,
                      Object.fromEntries(Object.keys(ports).map((k) => [k, ANSWERS_EVERYTHING])),
                  ],
        ),
    );
    return { ...options, persistence };
}

function operatorHandlers(root) {
    return controllersIn(root).filter(isOperatorRoute).flatMap(handlersOf);
}

const requiresMfa = ({ handler }) => Reflect.getMetadata(REQUIRE_MFA_KEY, handler) === true;
const guardsOnHandler = ({ handler }) => Reflect.getMetadata(GUARDS, handler) ?? [];

async function compile(imports) {
    return Test.createTestingModule({ imports })
        .overrideProvider(MfaService)
        .useValue(new FakeMfaService())
        .compile();
}

/**
 * The guard chain Nest's router builds for one handler — global, class, then
 * method — run for one request.
 *
 * Built with Nest's own context creator rather than by reading metadata, because
 * the order of those three layers is Nest's and is the thing under test. The
 * creator resolves a guard from the module that mounts the controller, and
 * silently drops one it cannot find, so each chain is checked for the guards it
 * must contain before anything is concluded from it passing.
 */
function chainFor(moduleRef, { controller, handler }) {
    const container = moduleRef.container;
    const mounted = [...container.getModules()].find(([, module]) =>
        module.controllers.has(controller),
    );
    assert.ok(mounted, `${controller.name} is not mounted`);
    const instance = moduleRef.get(controller, { strict: false });
    const guards = new GuardsContextCreator(container, container.applicationConfig).create(
        instance,
        handler,
        mounted[0],
    );
    return {
        guards,
        run: (user, code) =>
            new GuardsConsumer().tryActivate(
                guards,
                [{ user, headers: code === undefined ? {} : { 'x-mfa-code': code } }, {}],
                instance,
                handler,
                'http',
            ),
    };
}

function refusedWith(ExceptionType, code, label) {
    return (error) => {
        assert.ok(error instanceof ExceptionType, `${label}: ${error}`);
        assert.equal(error.getResponse().code, code, label);
        return true;
    };
}

let skipMfa;
before(() => {
    // The CI bypass would make every chain below pass; it is not what is tested.
    skipMfa = process.env.SAAS_PLATFORM_SKIP_MFA;
    delete process.env.SAAS_PLATFORM_SKIP_MFA;
});
after(() => {
    if (skipMfa !== undefined) process.env.SAAS_PLATFORM_SKIP_MFA = skipMfa;
});

describe('which routes the platform mounts ask for the second factor', () => {
    const handlers = operatorHandlers(SaaSiCatModule.forRoot(everythingOnOptions()));

    test('the walk reaches every lasting action', () => {
        const routes = handlers.map((h) => h.route);
        assert.deepEqual(
            LASTING.filter((route) => !routes.includes(route)),
            [],
            routes.join('\n'),
        );
    });

    test('each one carries the check on its handler, not in the chain an integrator passes', () => {
        for (const entry of handlers.filter((h) => LASTING.includes(h.route))) {
            assert.equal(requiresMfa(entry), true, entry.route);
            assert.ok(guardsOnHandler(entry).includes(MfaGuard), entry.route);
        }
    });

    test('no other route asks for it', () => {
        const marked = handlers
            .filter((h) => requiresMfa(h) || guardsOnHandler(h).includes(MfaGuard))
            .map((h) => h.route)
            .sort();
        assert.deepEqual(marked, LASTING);
    });
});

describe('what the chain Nest builds does with a request', () => {
    let moduleRef;
    let handlers;

    before(async () => {
        const root = SaaSiCatModule.forRoot(bootable());
        handlers = operatorHandlers(root);
        moduleRef = await compile([root]);
    });
    after(() => moduleRef?.close());

    const lasting = () => handlers.filter((h) => LASTING.includes(h.route));

    test('each chain holds the role check before the second factor', () => {
        assert.equal(lasting().length, LASTING.length);
        for (const entry of lasting()) {
            const { guards } = chainFor(moduleRef, entry);
            const superAdmin = guards.findIndex((g) => g instanceof SuperAdminGuard);
            const mfa = guards.findIndex((g) => g instanceof MfaGuard);
            assert.ok(superAdmin >= 0, `${entry.route}: no SuperAdminGuard in the chain`);
            assert.ok(
                mfa > superAdmin,
                `${entry.route}: MfaGuard at ${mfa}, role at ${superAdmin}`,
            );
        }
    });

    test('the platform administrator without a code is refused by name', async () => {
        for (const entry of lasting()) {
            await assert.rejects(
                () => chainFor(moduleRef, entry).run(OPERATOR),
                refusedWith(UnauthorizedException, AUTH_ERROR_CODES.MFA_REQUIRED, entry.route),
            );
        }
    });

    test('a wrong code is refused, and the right one passes', async () => {
        for (const entry of lasting()) {
            await assert.rejects(
                () => chainFor(moduleRef, entry).run(OPERATOR, '654321'),
                refusedWith(UnauthorizedException, AUTH_ERROR_CODES.MFA_FAILED, entry.route),
            );
            assert.equal(await chainFor(moduleRef, entry).run(OPERATOR, CODE), true, entry.route);
        }
    });

    test('an operator who has not set up a second factor is refused rather than let through', async () => {
        for (const entry of lasting()) {
            await assert.rejects(
                () => chainFor(moduleRef, entry).run(OPERATOR_WITHOUT_MFA, CODE),
                refusedWith(UnauthorizedException, AUTH_ERROR_CODES.MFA_NOT_SET_UP, entry.route),
            );
        }
    });

    test('a caller named by `userId` rather than `id` is checked under that name', async () => {
        // The shape the platform's admin controllers already read the actor
        // from; a check that knew only `id` would look up nobody.
        const byUserId = { userId: 'operator', platformRole: 'SUPER_ADMIN' };
        for (const entry of lasting()) {
            assert.equal(await chainFor(moduleRef, entry).run(byUserId, CODE), true, entry.route);
        }
    });

    test('a platform administrator the request does not name is refused as unauthenticated', async () => {
        for (const entry of lasting()) {
            await assert.rejects(
                () => chainFor(moduleRef, entry).run({ role: 'SUPER_ADMIN' }, CODE),
                refusedWith(UnauthorizedException, AUTH_ERROR_CODES.NOT_AUTHENTICATED, entry.route),
            );
        }
    });

    test('a tenant user meets the role check, even holding a valid code', async () => {
        for (const entry of lasting()) {
            await assert.rejects(
                () => chainFor(moduleRef, entry).run(TENANT_USER, CODE),
                refusedWith(ForbiddenException, AUTH_ERROR_CODES.SUPER_ADMIN_REQUIRED, entry.route),
            );
        }
    });

    test('every other operator route lets the platform administrator through without a code', async () => {
        const others = handlers.filter((h) => !LASTING.includes(h.route));
        assert.ok(others.length > LASTING.length, 'the probe reached too few routes');
        for (const entry of others) {
            assert.equal(await chainFor(moduleRef, entry).run(OPERATOR), true, entry.route);
        }
    });
});

// @requirement SC-ADM-005 — Actions with lasting consequences need the second factor and an explicit confirmation
describe('suspending and reactivating a tenant', () => {
    test('an override of the administration guards that leaves the check out does not leave it out', async () => {
        const root = SaaSiCatModule.forRoot({
            ...bootable(),
            adminResources: { guards: [SignedInGuard] },
        });
        const moduleRef = await compile([root]);
        try {
            const tenantState = operatorHandlers(root).filter((h) =>
                TENANT_STATE.includes(h.route),
            );
            assert.equal(tenantState.length, TENANT_STATE.length);
            for (const entry of tenantState) {
                assert.equal(guardsOnHandler(entry).includes(SuperAdminGuard), false, entry.route);
                await assert.rejects(
                    () => chainFor(moduleRef, entry).run(OPERATOR),
                    refusedWith(UnauthorizedException, AUTH_ERROR_CODES.MFA_REQUIRED, entry.route),
                );
                assert.equal(
                    await chainFor(moduleRef, entry).run(OPERATOR, CODE),
                    true,
                    entry.route,
                );
            }
        } finally {
            await moduleRef.close();
        }
    });
});

describe('the catalogue import, a module wired by hand', () => {
    const importer = (guards) =>
        PlanCatalogImporterModule.forRoot({ sink: PORT, controller: { guards } });
    const admin = () =>
        AdminModule.forRoot({ mfaPort: PORT, auditPort: PORT, rlsBypassPort: PORT, global: true });
    const importHandler = (root) => {
        const found = controllersIn(root)
            .flatMap(handlersOf)
            .filter((h) => h.route === IMPORT);
        assert.equal(found.length, 1);
        return found[0];
    };

    test('asks for the second factor, whatever guards it was given', async () => {
        const root = importer([SignedInGuard, SuperAdminGuard]);
        const moduleRef = await compile([admin(), root]);
        try {
            const entry = importHandler(root);
            await assert.rejects(
                () => chainFor(moduleRef, entry).run(OPERATOR),
                refusedWith(UnauthorizedException, AUTH_ERROR_CODES.MFA_REQUIRED, entry.route),
            );
            assert.equal(await chainFor(moduleRef, entry).run(OPERATOR, CODE), true);
        } finally {
            await moduleRef.close();
        }
    });

    test('with no guards, nothing establishes a caller and the import is refused', async () => {
        const root = importer([]);
        const moduleRef = await compile([admin(), root]);
        try {
            await assert.rejects(
                () => chainFor(moduleRef, importHandler(root)).run(undefined, CODE),
                refusedWith(UnauthorizedException, AUTH_ERROR_CODES.NOT_AUTHENTICATED, IMPORT),
            );
        } finally {
            await moduleRef.close();
        }
    });

    test('without the second factor available, it does not start', async () => {
        await assert.rejects(
            () => Test.createTestingModule({ imports: [importer([SignedInGuard])] }).compile(),
            /MfaGuard|MfaService/,
        );
    });
});
