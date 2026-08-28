// The example's own client sends what the example's own guards demand.
//
// `examples/notesapp/web` sent `x-demo-tenant` and nothing else, while
// `TenantAdminGuard` reads `platformRole` on every tenant route that changes
// what the tenant pays. Every one of them answered 403 `TENANT_ADMIN_REQUIRED`,
// so the whole "Change plan" flow was unreachable in the application consumers
// copy from.
//
// The set is deliberately not counted here. It was five when this was written
// and is eight since booking, cancelling and reactivating an add-on joined it —
// a number in a comment is wrong the first time the thing it counts grows. Nothing caught it: the schema check compares models, the page suites
// mount components against stubs, and no test drives the tenant surface against
// the running backend.
//
// Both ends are read from source rather than restated here. The roles come out
// of the guard's own set; the header comes out of the client's interceptor. A
// test that named `TENANT_ADMIN` itself would keep passing on the day the guard
// stops accepting it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'packages/nest/src/billing/tenant-admin.guard.ts');
const CLIENT = join(ROOT, 'examples/notesapp/web/src/services/http.ts');
const ADMIN_CLIENT = join(ROOT, 'examples/notesapp/admin/src/services/http.ts');

/** The roles `TenantAdminGuard` lets through, from its own declaration. */
function acceptedRoles() {
    const source = readFileSync(GUARD, 'utf8');
    const at = source.indexOf('ADMIN_ROLES');
    assert.notEqual(at, -1, 'TenantAdminGuard no longer declares ADMIN_ROLES — update this test');
    const open = source.indexOf('[', at);
    const close = source.indexOf(']', open);
    assert.ok(open !== -1 && close !== -1, 'ADMIN_ROLES is no longer an array literal');
    return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * A file's code with its comments removed.
 *
 * The first version of this scanned the raw text, and an apostrophe in a prose
 * comment — "their tenant's admin" — opened a quote that swallowed everything
 * after it. The test then reported the header as missing while the file was
 * sending it, which is the wrong answer in the more expensive direction.
 */
function withoutComments(file) {
    const text = readFileSync(file, 'utf8');
    let code = '';
    let at = 0;
    while (at < text.length) {
        const line = text.indexOf('//', at);
        const block = text.indexOf('/*', at);
        const next = line === -1 ? block : block === -1 ? line : Math.min(line, block);
        if (next === -1) {
            code += text.slice(at);
            break;
        }
        code += text.slice(at, next);
        if (next === line) {
            const end = text.indexOf('\n', next);
            at = end === -1 ? text.length : end;
        } else {
            const end = text.indexOf('*/', next + 2);
            at = end === -1 ? text.length : end + 2;
        }
    }
    return code;
}

/**
 * The header names a file actually ASSIGNS, with the values it assigns them.
 *
 * Not the literals it contains. The first version of this test asked whether
 * `'x-demo-role'` appeared anywhere in the file, and its own counter-check
 * passed with the assignment deleted — the two constants were still declared
 * above it. A guard that is satisfied in the damage case is decoration.
 *
 * Constants are resolved because the file names them rather than inlining
 * them, which is also how a reader would follow it.
 */
function headersAssignedIn(file) {
    const code = withoutComments(file);
    const constants = new Map(
        [...code.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
    );
    const resolve = (token) => constants.get(token.trim()) ?? token.trim().replace(/^'|'$/g, '');

    const assigned = new Map();
    // Either side may be a constant or a quoted literal, and a literal here
    // contains a hyphen (`'x-demo-role'`) — a character class of identifier
    // characters missed exactly that, and reported the admin app as sending no
    // role while it was sending one. One quantifier per alternative, each
    // closed by a fixed delimiter.
    for (const [, key, value] of code.matchAll(
        /headers\s*\[\s*('[^']*'|[A-Za-z0-9_$]+)\s*\]\s*=\s*('[^']*'|[A-Za-z0-9_$]+)/g,
    )) {
        assigned.set(resolve(key), resolve(value));
    }
    return assigned;
}

describe('the notesapp clients present a role the platform accepts', () => {
    const roles = acceptedRoles();

    test('the guard still names roles', () => {
        // Vacuously true against an empty set, which is what a refactor of the
        // guard into a decorator would leave behind.
        assert.ok(roles.length > 0, 'no roles read from TenantAdminGuard');
        assert.ok(roles.includes('SUPER_ADMIN'));
    });

    for (const [label, file] of [
        ['the tenant web app', CLIENT],
        ['the admin app', ADMIN_CLIENT],
    ]) {
        test(`${label} assigns the role header`, () => {
            assert.ok(
                headersAssignedIn(file).has('x-demo-role'),
                `${label} never assigns \`x-demo-role\`. Without it \`platformRole\` is ` +
                    'undefined and every route behind TenantAdminGuard answers 403 ' +
                    'TENANT_ADMIN_REQUIRED.',
            );
        });

        test(`${label} assigns a role the guard accepts`, () => {
            const sent = headersAssignedIn(file).get('x-demo-role');
            assert.ok(
                sent && roles.includes(sent),
                `${label} sends \`${sent}\`, which is not one of ${roles.join(', ')} — the ` +
                    'roles the guard lets through. A role it does not know reads as no role.',
            );
        });
    }
});
