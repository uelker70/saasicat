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

describe('buildNavigationGuard — expired session vs broken manifest', () => {
    // Reported from a running app: the admin bootstraps with a stale token,
    // `isAuthenticated()` sees a token in localStorage and passes, and the very
    // next request — GET /admin/manifest — comes back 401. The guard then sent
    // the operator to the fail-closed error page, which says "the manifest
    // could not be loaded" and offers Reload / Logout. Both statements are
    // wrong: the manifest is fine, the session is not, and the way out is the
    // login form.
    //
    // `isAuthenticated()` checking only for the presence of a token is the
    // common consumer implementation, so this is the normal path after a token
    // expires, not an edge case.

    function guardWith(status) {
        return buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                onUnauthenticated: () => '/login',
            },
            manifestGuard: {
                ensureLoaded: async () => {
                    throw Object.assign(new Error(`HTTP ${status}`), { status });
                },
                errorRoute: '/admin-error',
            },
        });
    }

    test('401 from the manifest load routes to login, not to the error page', async () => {
        const result = await guardWith(401)(makeRoute('/admin'));
        assert.equal(result, '/login');
    });

    test('403 is treated the same way', async () => {
        const result = await guardWith(403)(makeRoute('/admin'));
        assert.equal(result, '/login');
    });

    test('a genuine manifest failure still fails closed to the error page', async () => {
        const result = await guardWith(500)(makeRoute('/admin'));
        assert.equal(result, '/admin-error');
    });

    test('an error without a status stays on the fail-closed path', async () => {
        const guard = buildNavigationGuard({
            authGuard: { isAuthenticated: () => true, onUnauthenticated: () => '/login' },
            manifestGuard: {
                ensureLoaded: async () => {
                    throw new Error('network down');
                },
                errorRoute: '/admin-error',
            },
        });
        assert.equal(await guard(makeRoute('/admin')), '/admin-error');
    });

    test('without an authGuard a 401 still reaches the error page', async () => {
        // Nothing to redirect to — failing closed remains the correct outcome.
        const guard = buildNavigationGuard({
            manifestGuard: {
                ensureLoaded: async () => {
                    throw Object.assign(new Error('HTTP 401'), { status: 401 });
                },
                errorRoute: '/admin-error',
            },
        });
        assert.equal(await guard(makeRoute('/admin')), '/admin-error');
    });
});

describe('buildNavigationGuard — no login loop on a persistent manifest 401', () => {
    // Reported from a running app, and caused by the redirect above.
    //
    // A consumer's `onUnauthenticated()` typically CLEARS the session:
    //
    //     onUnauthenticated: () => { useAuthStore().logout(); return '/login'; }
    //
    // So routing every manifest 401 there is only correct while logging in
    // again can actually fix it. When it cannot — the account has no admin
    // role, the manifest endpoint is misconfigured, the backend is down — the
    // user is thrown into an unbreakable circle: log in → /admin → 401 →
    // logged out → /login → log in → …
    //
    // The second attempt must therefore fail closed to the error page: it
    // names the problem and, crucially, leaves the session alone.

    function guardWithPersistent401() {
        const logouts = [];
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                onUnauthenticated: () => {
                    logouts.push('logout');
                    return '/login';
                },
            },
            manifestGuard: {
                ensureLoaded: async () => {
                    throw Object.assign(new Error('HTTP 401'), { status: 401 });
                },
                errorRoute: '/admin-error',
            },
        });
        return { guard, logouts };
    }

    test('first 401 offers a re-login, the second stops the circle', async () => {
        const { guard, logouts } = guardWithPersistent401();

        assert.equal(await guard(makeRoute('/admin')), '/login');
        assert.equal(await guard(makeRoute('/admin')), '/admin-error');
        assert.equal(await guard(makeRoute('/admin')), '/admin-error');

        // Exactly one forced logout — not one per attempt.
        assert.deepEqual(logouts, ['logout']);
    });

    test('a successful load re-arms the redirect for a later expiry', async () => {
        let fail = true;
        const logouts = [];
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                onUnauthenticated: () => {
                    logouts.push('logout');
                    return '/login';
                },
            },
            manifestGuard: {
                ensureLoaded: async () => {
                    if (fail) throw Object.assign(new Error('HTTP 401'), { status: 401 });
                },
                errorRoute: '/admin-error',
            },
        });

        assert.equal(await guard(makeRoute('/admin')), '/login'); // token expired
        fail = false;
        assert.equal(await guard(makeRoute('/admin')), true); // logged in again
        fail = true;
        // A much later expiry has to be offered a re-login again, not be
        // treated as a continuation of the first one.
        assert.equal(await guard(makeRoute('/admin')), '/login');
        assert.deepEqual(logouts, ['logout', 'logout']);
    });
    test('concurrent navigations on one rejection share the login redirect', async () => {
        // Two protected navigations can overlap, and `ensureLoaded()` hands
        // both the SAME in-flight promise — so both reject with the identical
        // error. Counting that as two attempts spent the one-shot re-login on
        // a single expiry and sent the newer navigation to the error page.
        const rejection = Object.assign(new Error('HTTP 401'), { status: 401 });
        let inflight = null;
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                onUnauthenticated: () => '/login',
            },
            manifestGuard: {
                ensureLoaded: () => {
                    // Mirrors createManifestStore(): one shared promise.
                    inflight ??= Promise.reject(rejection);
                    return inflight;
                },
                errorRoute: '/admin-error',
            },
        });

        const [first, second] = await Promise.all([
            guard(makeRoute('/admin')),
            guard(makeRoute('/admin/tenants')),
        ]);

        assert.equal(first, '/login');
        assert.equal(second, '/login', 'the second waiter must not fail closed on the same 401');
    });

    test('a cached error instance does not resurrect the login loop', async () => {
        // A store that keeps one Error and rethrows it on every failed request
        // is a perfectly reasonable implementation — and it defeats any check
        // based on error identity: every later 401 would look like a concurrent
        // waiter, `onUnauthenticated()` would fire forever, and the loop this
        // budget exists to break would be back. The attempt is identified by
        // the promise instead, which `ensureLoaded()` recreates per load.
        const cached = Object.assign(new Error('HTTP 401'), { status: 401 });
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                onUnauthenticated: () => '/login',
            },
            manifestGuard: {
                ensureLoaded: () => Promise.reject(cached),
                errorRoute: '/admin-error',
            },
        });

        assert.equal(await guard(makeRoute('/admin')), '/login');
        assert.equal(
            await guard(makeRoute('/admin')),
            '/admin-error',
            'the same Error object across separate loads must not buy a second re-login',
        );
    });

    test('a later, different rejection still fails closed', async () => {
        // The one-shot budget has to survive: a fresh failure after the login
        // attempt is a new error object and must reach the error page.
        const guard = buildNavigationGuard({
            authGuard: {
                isAuthenticated: () => true,
                onUnauthenticated: () => '/login',
            },
            manifestGuard: {
                ensureLoaded: () => {
                    return Promise.reject(Object.assign(new Error('HTTP 401'), { status: 401 }));
                },
                errorRoute: '/admin-error',
            },
        });

        assert.equal(await guard(makeRoute('/admin')), '/login');
        assert.equal(await guard(makeRoute('/admin')), '/admin-error');
    });
});
