// buildNavigationGuard — Tests für Auth- und Manifest-Guard-Verhalten.
//
// Schwerpunkt: Manifest-Load-Fehler dürfen NICHT silent fail-open sein,
// wenn der Konsument `errorRoute` setzt. Dieser Test verhindert die
// Drift, dass `.catch(() => undefined)` zurück in den Pfad rutscht.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationGuard } from '../dist/index.js';

function makeRoute(path, meta = {}) {
    return { path, meta, fullPath: path };
}

describe('buildNavigationGuard — Auth-Pfad', () => {
    test('liefert null, wenn weder authGuard noch manifestGuard gesetzt sind', () => {
        const guard = buildNavigationGuard({});
        assert.equal(guard, null);
    });

    test('redirectet auf onUnauthenticated(), wenn isAuthenticated false', async () => {
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => false,
                onUnauthenticated: () => '/login',
            },
        });
        const result = await guard(makeRoute('/admin'));
        assert.equal(result, '/login');
    });

    test('lässt public-Routen am Auth-Guard vorbei', async () => {
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => false,
                onUnauthenticated: () => '/login',
            },
        });
        const result = await guard(makeRoute('/login', { public: true }));
        assert.equal(result, true);
    });

    test('redirectet auf onUnauthenticated, wenn isSuperAdmin false', async () => {
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                isSuperAdmin: () => false,
                onUnauthenticated: () => '/login',
            },
        });
        const result = await guard(makeRoute('/admin'));
        assert.equal(result, '/login');
    });
});

describe('buildNavigationGuard — Manifest-Fail-Closed', () => {
    test('redirectet auf errorRoute, wenn ensureLoaded rejected und errorRoute gesetzt ist', async () => {
        const guard = buildNavigationGuard({
            manifestGuard: {
                ensureLoaded: async () => {
                    throw new Error('manifest down');
                },
                errorRoute: '/admin/error',
            },
        });
        const result = await guard(makeRoute('/admin/tenants'));
        assert.equal(result, '/admin/error');
    });

    test('vermeidet Redirect-Loop: wenn aktuelle Route bereits errorRoute ist, wird true zurückgegeben', async () => {
        const guard = buildNavigationGuard({
            manifestGuard: {
                ensureLoaded: async () => {
                    throw new Error('still down');
                },
                errorRoute: '/admin/error',
            },
        });
        const result = await guard(makeRoute('/admin/error'));
        assert.equal(result, true);
    });

    test('fällt auf Render-Allow + console.error zurück, wenn KEIN errorRoute gesetzt ist', async () => {
        const originalError = console.error;
        let captured = null;
        console.error = (...args) => {
            captured = args;
        };
        try {
            const guard = buildNavigationGuard({
                manifestGuard: {
                    ensureLoaded: async () => {
                        throw new Error('soft-fail');
                    },
                },
            });
            const result = await guard(makeRoute('/admin/tenants'));
            assert.equal(result, true);
            assert.ok(captured, 'console.error wurde nicht aufgerufen');
            assert.match(String(captured[0]), /\[SuperAdmin\] manifest load failed/);
        } finally {
            console.error = originalError;
        }
    });

    test('lässt Render durch, wenn ensureLoaded erfolgreich resolved', async () => {
        let calls = 0;
        const guard = buildNavigationGuard({
            manifestGuard: {
                ensureLoaded: async () => {
                    calls += 1;
                },
            },
        });
        const result = await guard(makeRoute('/admin/tenants'));
        assert.equal(result, true);
        assert.equal(calls, 1);
    });
});
