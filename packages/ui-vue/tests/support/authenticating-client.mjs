/**
 * An `HttpClient` that carries the app's Authorization header.
 *
 * Since the `getAuthToken` option was removed, the client is what authenticates
 * a request and it is the only thing that does — `one-way-to-authenticate.test.js`
 * holds that. The tests that used to hand a composable its own token still
 * assert the same property, a request goes out authenticated, but through the
 * seam that now owns it.
 *
 * Written as a wrapper rather than a fixed header so it keeps failing for the
 * right reasons: a composable that dropped the caller's headers, or replaced
 * them instead of adding to them, still breaks every assertion below it.
 *
 * `token` is read on each call, never at construction. A consumer builds its
 * client at module scope, long before anyone has logged in — a client that
 * captured the token once would work after a page refresh and 401 right after
 * login, which reads like a backend fault and is not.
 */
export function authenticating(http, token) {
    const read = typeof token === 'function' ? token : () => token;
    return (url, init = {}) => {
        const value = read();
        const headers = { ...(init.headers ?? {}) };
        if (value != null) headers.Authorization = `Bearer ${value}`;
        return http(url, { ...init, headers });
    };
}
