// The OpenAPI document and the reference implementation, against each other.
//
// `admin-api.openapi.yaml` calls itself the normative contract every
// implementation must fulfil, and `@saasicat/nest` is the reference one. Until
// this file existed the two had drifted apart in both directions at once: the
// document described a plan-catalog-from-file API and an MFA enrolment
// endpoint that no code serves, put the dashboard at `/dashboard/stats` while
// every client calls `/stats/dashboard`, and said nothing about first-run
// setup, the subscription list or the catalog import. A stranger implementing
// against it built routes nobody calls and called routes nobody serves.
//
// Not every documented operation is the platform's to serve. The tenant model
// belongs to the application, so tenant lifecycle, user administration and the
// promo-code detail view are answered by the consuming app — the same split
// `@saasicat/ui-vue`'s resource layer already records. Those operations say so
// in the document with `x-served-by: app`, and this file holds that marker
// honest in both directions: an app-served operation the platform does serve
// is as wrong as a platform operation nobody implements.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(ROOT, 'packages/spec/admin-api.openapi.yaml');
const NEST_SRC = join(ROOT, 'packages/nest/src');

/** The prefix `servers.url` carries; paths in the document are relative to it. */
const ADMIN = 'admin';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Both patterns have a single quantifier over a negated class and cannot
// backtrack: `@Controller(` … first `)`.
const CONTROLLER = /@Controller\(([^)]*)\)/;
const ROUTE = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/;
const STRING_LITERAL = /^(['"`])(.*)\1$/;

function sourceFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (entry.endsWith('.ts')) out.push(path);
    }
    return out;
}

/** The literal a decorator argument carries, or null when it is an expression. */
function literalArgument(argument) {
    const trimmed = argument.trim();
    if (trimmed === '') return '';
    const first = trimmed.split(',')[0].trim();
    return STRING_LITERAL.exec(first)?.[2] ?? null;
}

/** `admin/catalog/plans` + `:id/versions` → `/catalog/plans/{id}/versions`. */
function toDocumentedPath(base, sub) {
    const segments = `${base}/${sub}`
        .split('/')
        .filter(Boolean)
        .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment));
    assert.equal(segments[0], ADMIN);
    return `/${segments.slice(1).join('/')}`;
}

/**
 * Every admin route the reference implementation registers, plus the
 * controllers whose path is computed rather than written down.
 *
 * A computed path cannot be resolved by reading the source, so it is reported
 * rather than skipped: a check that quietly drops what it cannot express is
 * how a whole controller goes unmeasured.
 */
export function implementedRoutes() {
    const routes = new Map();
    const computed = [];

    for (const file of sourceFiles(NEST_SRC)) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('@Controller(')) continue;

        let base = null;
        text.split('\n').forEach((line, index) => {
            const code = line.trim();
            if (code.startsWith('//') || code.startsWith('*')) return;

            const controller = CONTROLLER.exec(code);
            if (controller) {
                base = literalArgument(controller[1]);
                if (base === null) {
                    computed.push({ file: relativeToRoot(file), line: index + 1 });
                }
                return;
            }

            const route = ROUTE.exec(code);
            if (!route || base === null) return;
            if (base !== ADMIN && !base.startsWith(`${ADMIN}/`)) return;

            const sub = literalArgument(route[2]);
            assert.notEqual(
                sub,
                null,
                `computed route path in ${relativeToRoot(file)}:${index + 1}`,
            );
            const key = `${route[1].toUpperCase()} ${toDocumentedPath(base, sub)}`;
            if (!routes.has(key)) routes.set(key, `${relativeToRoot(file)}:${index + 1}`);
        });
    }

    return { routes, computed };
}

function relativeToRoot(path) {
    return path.slice(ROOT.length + 1);
}

/** Every operation the document describes, and who it says serves it. */
export function documentedOperations() {
    const document = parse(readFileSync(SPEC, 'utf8'));
    const operations = new Map();
    for (const [path, item] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(item)) {
            if (!HTTP_METHODS.includes(method)) continue;
            operations.set(
                `${method.toUpperCase()} ${path}`,
                operation['x-served-by'] ?? 'platform',
            );
        }
    }
    return { document, operations };
}

describe('the OpenAPI document describes the implementation', () => {
    const { routes, computed } = implementedRoutes();
    const { document, operations } = documentedOperations();
    const appServed = [...operations].filter(([, by]) => by === 'app').map(([key]) => key);

    test('both sweeps reach what they claim to read', () => {
        // Every assertion below is vacuously true on an empty set.
        assert.ok(routes.size > 60, `only ${routes.size} admin routes found in the sources`);
        assert.ok(operations.size > 60, `only ${operations.size} operations found in the document`);
        assert.ok(appServed.length > 0, 'no app-served operation found — the marker reads nothing');
        assert.ok(
            document.servers?.[0]?.url.endsWith(`/${ADMIN}`),
            'the server URL no longer ends in the prefix the paths are relative to',
        );
    });

    test('every admin route the platform serves is documented', () => {
        const undocumented = [...routes]
            .filter(([key]) => !operations.has(key))
            .map(([key, where]) => `${key} (${where})`);
        assert.deepEqual(undocumented, [], `Undocumented routes:\n${undocumented.join('\n')}`);
    });

    test('every documented operation is served by the platform or declared app-served', () => {
        const unimplemented = [...operations]
            .filter(([key, by]) => by === 'platform' && !routes.has(key))
            .map(([key]) => key);
        assert.deepEqual(
            unimplemented,
            [],
            'Documented but served by nothing. Implement it, delete it, or mark it\n' +
                `x-served-by: app with the reason:\n${unimplemented.join('\n')}`,
        );
    });

    test('nothing is marked app-served that the platform actually serves', () => {
        const wrong = appServed.filter((key) => routes.has(key));
        assert.deepEqual(wrong, [], `Marked app-served but implemented here:\n${wrong.join('\n')}`);
    });

    test('a controller with a computed path says which document covers it', () => {
        const undeclared = computed.filter(({ file }) => {
            const head = readFileSync(join(ROOT, file), 'utf8').split('\n', 30).join('\n');
            return !head.includes('openapi-scope:');
        });
        assert.deepEqual(
            undeclared.map(({ file, line }) => `${file}:${line}`),
            [],
            'A controller whose path is computed cannot be checked against the document.\n' +
                'Say in its first lines which contract covers it, as `openapi-scope: …`.',
        );
    });
});
