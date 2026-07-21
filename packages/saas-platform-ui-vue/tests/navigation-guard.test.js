// buildNavigationGuard — tests for auth and manifest guard behavior.
//
// Focus: manifest load errors must NOT silently fail open when the
// consumer sets `errorRoute`. This test prevents the drift of
// `.catch(() => undefined)` slipping back into the path.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationGuard } from '../dist/index.js';

function makeRoute(path, meta = {}) {
    return { path, meta, fullPath: path };
}

describe('buildNavigationGuard — auth path', () => {
    test('returns null when neither authGuard nor manifestGuard is set', () => {
        const guard = buildNavigationGuard({});
        assert.equal(guard, null);
    });

    test('redirects to onUnauthenticated() when isAuthenticated is false', async () => {
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => false,
                onUnauthenticated: () => '/login',
            },
        });
        const result = await guard(makeRoute('/admin'));
        assert.equal(result, '/login');
    });

    test('lets public routes bypass the auth guard', async () => {
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => false,
                onUnauthenticated: () => '/login',
            },
        });
        const result = await guard(makeRoute('/login', { public: true }));
        assert.equal(result, true);
    });

    test('redirects to onUnauthenticated when isSuperAdmin is false', async () => {
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

describe('buildNavigationGuard — manifest fail-closed', () => {
    test('redirects to errorRoute when ensureLoaded rejects and errorRoute is set', async () => {
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

    test('avoids redirect loop: when the current route is already errorRoute, returns true', async () => {
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

    test('falls back to render-allow + console.error when NO errorRoute is set', async () => {
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
            assert.ok(captured, 'console.error was not called');
            assert.match(String(captured[0]), /\[SuperAdmin\] manifest load failed/);
        } finally {
            console.error = originalError;
        }
    });

    test('lets the render through when ensureLoaded resolves successfully', async () => {
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
