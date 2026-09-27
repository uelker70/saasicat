// Which of the platform's routes a maintenance lock lets through.
//
// Derived from the module graph rather than listed: every controller a composer
// mounts is found, and the rule is read off its path. The administration passes
// — an operator who locked the application has to be able to come back and
// unlock it — and so does the status a tenant's page reads. Nothing else does:
// a tenant route marked by mistake would write while the migration runs.

// @requirement SC-OPS-013 — While the lock holds, no tenant request reaches the application

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { ALLOW_DURING_MAINTENANCE_KEY } from '../dist/index.js';
import { controllersIn, everythingOn, pathOf } from './helpers/operator-routes.js';

const allowed = (controller) =>
    Reflect.getMetadata(ALLOW_DURING_MAINTENANCE_KEY, controller) === true;
const isAdministration = (controller) =>
    pathOf(controller) === 'admin' || pathOf(controller).startsWith('admin/');
const STATUS_ROUTE = 'public';

describe('the routes a maintenance lock lets through', () => {
    const controllers = controllersIn(everythingOn());

    test('the graph mounts the administration, the tenant routes and the status route', () => {
        // Guards the two tests below against passing on an empty graph.
        assert.ok(controllers.filter(isAdministration).length >= 15);
        assert.ok(controllers.some((c) => pathOf(c).startsWith('billing')));
        assert.ok(controllers.some((c) => pathOf(c) === STATUS_ROUTE && allowed(c)));
    });

    test('every controller of the administration passes', () => {
        const locked = controllers
            .filter(isAdministration)
            .filter((c) => !allowed(c))
            .map((c) => `${c.name} (${pathOf(c)})`);
        assert.deepEqual(locked, []);
    });

    test('no other controller does, except the status a tenant’s page reads', () => {
        const through = controllers
            .filter((c) => !isAdministration(c) && allowed(c))
            .map((c) => pathOf(c));
        assert.deepEqual(through, [STATUS_ROUTE]);
    });
});
