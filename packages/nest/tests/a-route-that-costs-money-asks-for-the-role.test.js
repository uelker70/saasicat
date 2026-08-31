// @requirement SC-ADM-013

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TenantAdminGuard,
    buildTenantSubscriptionBundlesController,
} from '../dist/billing/index.js';

// Booking an add-on, cancelling one and reactivating one change what a tenant
// pays. Until this file existed the controller carried `ComposedTenantAuthGuard`
// alone — authentication and tenant context, no role — and the factory's
// `extraGuards` defaulted to none. An installation that did not think to pass a
// role guard let every signed-in user of the tenant buy and cancel add-ons.
//
// None of the three applications built on this passed one, and the neighbouring
// controller names `TenantAdminGuard` on seven routes for the same class of
// action. So the default was the defect, not the consumers.
//
// The rule this file holds is deliberately the wider one: **every route that
// changes something asks for the role**, unless it is named below as an
// exception with its reason. A hand-written list of the three guarded routes
// would agree with itself forever and would not have caught the fourth one
// somebody adds next year.

/** Nest's own metadata keys. */
const GUARDS = '__guards__';
const ROUTE_PATH = 'path';
const ROUTE_METHOD = 'method';

/** Nest's `RequestMethod` numbering, for the two we care to name. */
const GET = 0;

/**
 * Routes that change nothing, with the reason each is a POST anyway.
 *
 * Both answer a question rather than record an answer: a consumer sends a body
 * because the question has parameters, not because it writes.
 */
const READ_ONLY_POSTS = new Map([
    ['prices', 'a price lookup writes nothing'],
    ['preview', 'a preview writes nothing'],
]);

/** Every handler on the generated controller, with its route metadata. */
function routes() {
    const prototype = buildTenantSubscriptionBundlesController().prototype;
    const found = [];
    for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(ROUTE_METHOD, handler);
        if (method === undefined) continue;
        found.push({
            name,
            method,
            path: Reflect.getMetadata(ROUTE_PATH, handler),
            guards: Reflect.getMetadata(GUARDS, handler) ?? [],
        });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
}

const all = routes();

describe('a route that costs money asks for the role', () => {
    test('the controller has routes, and each carries its metadata', () => {
        // Every assertion below iterates this list, and on an empty one they
        // all pass — a renamed metadata key or a factory that stopped
        // generating would read as "everything is guarded".
        assert.ok(all.length >= 6, `only ${all.length} routes found`);
        for (const route of all) {
            assert.equal(typeof route.path, 'string', `${route.name} carries no path`);
            assert.ok(route.method !== undefined, `${route.name} carries no HTTP method`);
        }
    });

    test('every writing route asks for the tenant administrator', () => {
        for (const route of all) {
            if (route.method === GET) continue;
            if (READ_ONLY_POSTS.has(route.name)) continue;
            assert.ok(
                route.guards.includes(TenantAdminGuard),
                `${route.name} changes something and does not ask for the role. ` +
                    'Add the guard, or name it in READ_ONLY_POSTS with the reason it writes nothing.',
            );
        }
    });

    test('the three that cost money are actually among them', () => {
        // The counter-check to the rule above: it is satisfied vacuously if the
        // writing routes disappear. These three are the reason the file exists,
        // so they are named — and a rename that loses one fails here rather
        // than quietly shrinking the set the rule applies to.
        const guarded = all.filter((r) => r.guards.includes(TenantAdminGuard)).map((r) => r.name);
        for (const name of ['add', 'cancel', 'reactivate']) {
            assert.ok(guarded.includes(name), `${name} no longer asks for the role`);
        }
    });

    test('reading and previewing stay open to every tenant user', () => {
        // The other half, and not a formality: a tenant who cannot see what
        // they booked, or what a booking would cost, cannot decide to ask an
        // administrator for it.
        for (const name of ['list', 'prices', 'preview']) {
            const route = all.find((r) => r.name === name);
            assert.ok(route, `${name} is gone`);
            assert.ok(
                !route.guards.includes(TenantAdminGuard),
                `${name} now asks for the role, and reading should not`,
            );
        }
    });
});
