// Where an installation offers its operator to retire a plan version: the
// routes exist where announcements can be kept, and the capability that tells
// the administration to show the action is set only where the operator's terms
// are confirmed to allow it as well — elsewhere the route refuses with a code.
// And an installation whose terms are confirmed, but which has nowhere to keep
// an announcement, does not start.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
    BUNDLE_VERSION_RETIREMENT_CAPABILITY,
    VERSION_RETIREMENT_CAPABILITY,
} from '@saasicat/core';

import { AdminManifestService } from '../dist/admin/index.js';
import {
    BundleVersionRetirementService,
    RetirementMoveService,
    RetirementReminderService,
    RetirementSwitchService,
    VersionRetirementService,
} from '../dist/billing/index.js';
import { PlanVersionsService } from '../dist/catalog/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import {
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
} from './helpers/operator-routes.js';

const ROUTES = [
    'GET admin/catalog/plan-versions/:id/retirement',
    'POST admin/catalog/plan-versions/:id/retirement',
    'GET admin/catalog/version-retirements',
];

/** The full installation, changed where `change` says. */
function installation(change = (options) => options) {
    return change(everythingOnOptions());
}

const withoutNotices = (options) => {
    const { versionNotices: _, ...tenantBilling } = options.tenantBilling;
    return { ...options, tenantBilling };
};
const bundleWithoutRetirements = (options) => {
    const { versionRetirements: _, ...tenantBilling } = options.persistence.tenantBilling;
    return { ...options, persistence: { ...options.persistence, tenantBilling } };
};
const catalogWithoutOperatorRoutes = (options) => ({
    ...options,
    catalog: { ...options.catalog, adminControllers: false },
});
const termsConfirmed = (options) => ({
    ...options,
    planCatalog: {
        ...options.planCatalog,
        tenantBilling: {
            ...options.planCatalog.tenantBilling,
            orderlyRetirement: { termsConfirmed: true },
        },
    },
});

async function started(options) {
    const root = SaaSiCatModule.forRoot(bootable(options));
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const routes = controllersIn(root)
        .flatMap(handlersOf)
        .map(({ route }) => route)
        .filter((route) => ROUTES.includes(route));
    return { moduleRef, manifest, routes };
}

// @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
describe('retiring a version is offered', () => {
    test('where announcements are kept and the terms are confirmed: routes and capability', async () => {
        const { moduleRef, manifest, routes } = await started(installation(termsConfirmed));

        assert.deepEqual(routes, ROUTES);
        assert.equal(manifest.capabilities[VERSION_RETIREMENT_CAPABILITY], true);
        assert.ok(moduleRef.get(VersionRetirementService, { strict: false }));
        assert.ok(
            manifest.audit.actions.some((action) => action.key === 'PLAN_VERSION_RETIRE'),
            'and the audit log names what it records',
        );
        await moduleRef.close();
    });

    test('while the terms are not confirmed: the routes, but no capability', async () => {
        const { moduleRef, manifest, routes } = await started(installation());

        assert.deepEqual(routes, ROUTES);
        assert.equal(manifest.capabilities[VERSION_RETIREMENT_CAPABILITY], undefined);
        await moduleRef.close();
    });

    // Unconfirmed, because confirmed terms with nowhere to keep an announcement
    // refuse the start — a case of its own below.
    for (const [without, change] of [
        ['version notices', withoutNotices],
        ['a place to keep announcements', bundleWithoutRetirements],
    ]) {
        test(`not without ${without}: neither the routes nor the capability`, async () => {
            const { moduleRef, manifest, routes } = await started(installation(change));

            assert.deepEqual(routes, []);
            assert.equal(manifest.capabilities[VERSION_RETIREMENT_CAPABILITY], undefined);
            await moduleRef.close();
        });
    }

    test("not without the catalogue's operator routes, terms confirmed or not", async () => {
        const { moduleRef, manifest, routes } = await started(
            installation((options) => termsConfirmed(catalogWithoutOperatorRoutes(options))),
        );

        assert.deepEqual(routes, []);
        assert.equal(manifest.capabilities[VERSION_RETIREMENT_CAPABILITY], undefined);
        await moduleRef.close();
    });
});

describe('where retiring is wired, it also takes effect', () => {
    // @requirement SC-SUB-031 — A subscription continues on the replacement at the date it was told
    test('the run that moves subscriptions at their date, and the switch, are there', async () => {
        const { moduleRef, manifest } = await started(installation(termsConfirmed));

        assert.ok(moduleRef.get(RetirementMoveService, { strict: false }));
        assert.ok(moduleRef.get(RetirementSwitchService, { strict: false }));
        const actions = manifest.audit.actions.map((action) => action.key);
        assert.ok(actions.includes('PLAN_VERSION_RETIREMENT_MOVE'), 'the audit log names the move');
        assert.ok(
            actions.includes('PLAN_VERSION_RETIREMENT_MOVE_FAILED'),
            'and a move that could not be made',
        );
        await moduleRef.close();
    });

    // @requirement SC-SUB-034 — Where staying put costs something, a subscription is reminded once
    test('the run that reminds subscriptions before their date is there', async () => {
        const { moduleRef } = await started(installation(termsConfirmed));

        assert.ok(moduleRef.get(RetirementReminderService, { strict: false }));
        await moduleRef.close();
    });

    // @requirement SC-PLAN-029 — A version subscriptions still move onto cannot end before they have
    test('the catalogue asks tenant billing before it ends a version, and nothing without it', async () => {
        const wired = await started(installation(termsConfirmed));
        const unwired = await started(installation(withoutNotices));

        assert.equal(
            wired.moduleRef.get(PlanVersionsService, { strict: false }).endingCheck,
            wired.moduleRef.get(VersionRetirementService, { strict: false }),
        );
        assert.equal(
            unwired.moduleRef.get(PlanVersionsService, { strict: false }).endingCheck,
            null,
        );
        await wired.moduleRef.close();
        await unwired.moduleRef.close();
    });
});

// @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
describe('terms confirmed to allow a retirement', () => {
    test('with nowhere to keep one, the installation does not start, naming the setting', async () => {
        await assert.rejects(
            () =>
                started(
                    installation((options) => termsConfirmed(bundleWithoutRetirements(options))),
                ),
            /orderlyRetirement\.termsConfirmed/,
        );
    });

    test('with a place to keep it, it starts', async () => {
        const { moduleRef } = await started(installation(termsConfirmed));
        await moduleRef.close();
    });

    test('unconfirmed, it starts without one too', async () => {
        const { moduleRef } = await started(installation(bundleWithoutRetirements));
        await moduleRef.close();
    });
});

const ADD_ON_ROUTES = [
    'GET admin/catalog/bundle-versions/:id/retirement',
    'POST admin/catalog/bundle-versions/:id/retirement',
    'GET admin/catalog/bundle-version-retirements',
];

const bundleWithoutAddOnRetirements = (options) => {
    const { bundleVersionRetirements: _, ...tenantBilling } = options.persistence.tenantBilling;
    return { ...options, persistence: { ...options.persistence, tenantBilling } };
};
const bundleWithoutBookings = (options) => {
    const { subscriptionBundleRepository: _, ...entitlement } = options.persistence.entitlement;
    return { ...options, persistence: { ...options.persistence, entitlement } };
};

/** The add-on routes an installation mounts, and what its manifest says. */
async function addOnsStarted(options) {
    const root = SaaSiCatModule.forRoot(bootable(options));
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const routes = controllersIn(root)
        .flatMap(handlersOf)
        .map(({ route }) => route)
        .filter((route) => ADD_ON_ROUTES.includes(route));
    return { moduleRef, manifest, routes };
}

// @requirement SC-BUN-038 — An add-on version is retired only off sale, onto a version of the same add-on on sale
describe('retiring an add-on version is offered', () => {
    test('where add-on announcements are kept and the terms are confirmed: routes and capability', async () => {
        const { moduleRef, manifest, routes } = await addOnsStarted(installation(termsConfirmed));

        assert.deepEqual(routes, ADD_ON_ROUTES);
        assert.equal(manifest.capabilities[BUNDLE_VERSION_RETIREMENT_CAPABILITY], true);
        assert.ok(moduleRef.get(BundleVersionRetirementService, { strict: false }));
        assert.ok(
            manifest.audit.actions.some((action) => action.key === 'BUNDLE_VERSION_RETIRE'),
            'and the audit log names what it records',
        );
        await moduleRef.close();
    });

    test('while the terms are not confirmed: the routes, but no capability', async () => {
        const { moduleRef, manifest, routes } = await addOnsStarted(installation());

        assert.deepEqual(routes, ADD_ON_ROUTES);
        assert.equal(manifest.capabilities[BUNDLE_VERSION_RETIREMENT_CAPABILITY], undefined);
        await moduleRef.close();
    });

    for (const [without, change] of [
        ['a place to keep add-on announcements', bundleWithoutAddOnRetirements],
        ['bookings to reach', bundleWithoutBookings],
    ]) {
        test(`not without ${without}, while plan versions still are`, async () => {
            const { moduleRef, manifest, routes } = await addOnsStarted(
                installation((options) => termsConfirmed(change(options))),
            );

            assert.deepEqual(routes, []);
            assert.equal(manifest.capabilities[BUNDLE_VERSION_RETIREMENT_CAPABILITY], undefined);
            assert.equal(manifest.capabilities[VERSION_RETIREMENT_CAPABILITY], true);
            await moduleRef.close();
        });
    }
});
