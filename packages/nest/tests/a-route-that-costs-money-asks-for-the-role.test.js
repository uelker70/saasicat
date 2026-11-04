// @requirement SC-ADM-026 — The administrator changes what the tenant pays; billing needs the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';

import * as billing from '../dist/billing/index.js';
import * as payments from '../dist/payments/index.js';

const {
    BillingPermissionGuard,
    ComposedTenantAuthGuard,
    TenantAdminGuard,
    buildTenantSubscriptionBundlesController,
} = billing;

// Who of a tenant's users may do what, held over every tenant route the
// packages ship (`SC-ADM-026`): reading and previewing are everyone's who is
// signed in, so a user who cannot change the plan can still see what a change
// would cost and ask the administrator for it; changing what the tenant pays —
// a plan change, a booking, a cancellation, an end at once — is the tenant's
// administrator's; and the billing area, reading and changing alike, is
// whoever's who holds the billing permission.
//
// The controllers are read off the two entries — every export whose class
// guards include the tenant's authentication — and the add-ons' controller the
// factory builds, so a tenant controller added next year is held to the same
// rule without being listed. A route that writes nothing although it is a POST
// is one whose last path segment names a question, `preview` or `prices`.

/** Nest's own metadata keys. */
const GUARDS = '__guards__';
const ROUTE_PATH = 'path';
const ROUTE_METHOD = 'method';

/** Nest's `RequestMethod` numbering, for the one we care to name. */
const GET = 0;

/** The last path segments that ask a question rather than record an answer. */
const QUESTIONS = new Set(['preview', 'prices']);

/** Every tenant controller the entries export, and the one the factory builds. */
function tenantControllers() {
    const exported = new Set(
        [...Object.values(billing), ...Object.values(payments)].filter(
            (value) =>
                typeof value === 'function' &&
                (Reflect.getMetadata(GUARDS, value) ?? []).includes(ComposedTenantAuthGuard),
        ),
    );
    return [...exported, buildTenantSubscriptionBundlesController()];
}

/**
 * Every handler of every tenant controller, with what guards it. Nest runs a
 * class's guards and then the handler's, so a route is guarded by both:
 * `guards` holds the two together, `ownGuards` the handler's alone.
 */
function routes() {
    return tenantControllers().flatMap((controller) => {
        const classGuards = Reflect.getMetadata(GUARDS, controller) ?? [];
        const prototype = controller.prototype;
        return Object.getOwnPropertyNames(prototype).flatMap((name) => {
            const handler = prototype[name];
            if (name === 'constructor' || typeof handler !== 'function') return [];
            const method = Reflect.getMetadata(ROUTE_METHOD, handler);
            if (method === undefined) return [];
            const path = String(Reflect.getMetadata(ROUTE_PATH, handler));
            const ownGuards = Reflect.getMetadata(GUARDS, handler) ?? [];
            return [
                {
                    route: `${controller.name}.${name}`,
                    method,
                    path,
                    guards: [...classGuards, ...ownGuards],
                    ownGuards,
                    billingArea: classGuards.includes(BillingPermissionGuard),
                },
            ];
        });
    });
}

/** Whether a route only asks: a GET, or a POST whose last path segment is a question. */
const asks = ({ method, path }) =>
    method === GET || QUESTIONS.has(path.split('/').filter(Boolean).at(-1) ?? '');

const all = routes();
const outsideBilling = all.filter((route) => !route.billingArea);

describe('who of a tenant may do what', () => {
    test('the tenant controllers are found, and each route carries its metadata', () => {
        // Every rule below iterates this list, and on an empty one they all
        // pass — a renamed metadata key or an export that stopped being found
        // would read as "everything is guarded".
        const controllers = new Set(all.map(({ route }) => route.split('.')[0]));
        for (const name of [
            'TenantBillingController',
            'FeatureWithdrawalTenantController',
            'GeneratedTenantSubscriptionBundlesController',
            'TenantPaymentMethodController',
            'TenantBillingDetailsController',
            'TenantInvoicesController',
        ]) {
            assert.ok(controllers.has(name), `${name} is not among the tenant controllers`);
        }
        assert.ok(all.length >= 25, `only ${all.length} routes found`);
    });

    test('every route that writes asks for the tenant administrator', () => {
        for (const route of outsideBilling) {
            if (asks(route)) continue;
            assert.ok(
                route.guards.includes(TenantAdminGuard),
                `${route.route} (${route.path}) changes something and does not ask for the role`,
            );
        }
    });

    test('every route that only reads or previews is open to every signed-in user', () => {
        for (const route of outsideBilling) {
            if (!asks(route)) continue;
            assert.ok(
                !route.guards.includes(TenantAdminGuard),
                `${route.route} (${route.path}) only asks, and asks for the role`,
            );
        }
    });

    test('the billing area asks for the billing permission and nothing beside it, reading included', () => {
        // A handler's guards run after its class's rather than instead of
        // them, so one added here narrows the area from whoever holds the
        // permission to whoever also passes the added guard.
        const billingArea = all.filter((route) => route.billingArea);
        assert.ok(billingArea.length >= 8, `only ${billingArea.length} billing routes found`);
        for (const route of billingArea) {
            assert.equal(
                route.ownGuards.length,
                0,
                `${route.route} adds guards of its own on top of the billing permission`,
            );
            assert.ok(
                !route.guards.includes(TenantAdminGuard),
                `${route.route} asks for the administrator's role beside the billing permission`,
            );
        }
    });

    test('the routes the split is about are among them, each on its side', () => {
        // The counter-check to the rules above, which are satisfied vacuously
        // where a route disappears or is renamed out of the set they apply to.
        const find = (route) => {
            const found = all.find((each) => each.route === route);
            assert.ok(found, `${route} is gone`);
            return found;
        };
        for (const route of [
            'TenantBillingController.previewPlanChange',
            'FeatureWithdrawalTenantController.previewEnd',
            'FeatureWithdrawalTenantController.previewBookingEnd',
            'GeneratedTenantSubscriptionBundlesController.preview',
        ]) {
            assert.ok(!find(route).guards.includes(TenantAdminGuard), `${route} asks for the role`);
        }
        for (const route of [
            'TenantBillingController.changePlan',
            'TenantBillingController.cancelSubscription',
            'FeatureWithdrawalTenantController.end',
            'GeneratedTenantSubscriptionBundlesController.add',
            'GeneratedTenantSubscriptionBundlesController.cancel',
            'GeneratedTenantSubscriptionBundlesController.reactivate',
        ]) {
            assert.ok(
                find(route).guards.includes(TenantAdminGuard),
                `${route} does not ask for the role`,
            );
        }
    });
});
