// AdminError, toAdminError and adminErrorMessage — the one error shape the
// package works with, and the conversions into it.
//
// The cases are the shapes a consumer's HttpClient really produces: an axios
// rejection, one of the package's own `*ApiError` classes, a bare `Error`, a
// string. The point of the type is that none of them reaches page code.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApp } from 'vue';

import {
    AdminError,
    BootLoader,
    BundlesApiError,
    PlansApiError,
    DEFAULT_SA_LOCALE,
    HttpJsonError,
    ManifestLoadError,
    ManifestLoader,
    SA_MESSAGES,
    adminErrorMessage,
    defaultHttpClient,
    getJson,
    isAdminError,
    isEmptyResponse,
    isTransportFailure,
    markEmptyResponse,
    markTransportFailure,
    postJson,
    toAdminError,
    useBundleVersions,
    useBundles,
    useCatalogEntries,
    useDiscovery,
    useMarketingProjections,
    usePlanVersions,
    usePlans,
    usePromotions,
    useTenantSubscriptionBundles,
} from '../dist/index.js';

const EN = SA_MESSAGES.en.errors;
/** What the composables resolve without an i18n provider. */
const FALLBACK_ERRORS = SA_MESSAGES[DEFAULT_SA_LOCALE].errors;

function httpReturning({ status = 200, body = {}, unparseable = false } = {}) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            headers: { get: () => null },
            json: async () => {
                if (unparseable) throw new SyntaxError('Unexpected end of JSON input');
                return body;
            },
            text: async () => (unparseable ? '<html>502</html>' : JSON.stringify(body)),
        });
    };
    return { http, calls };
}

describe('AdminError', () => {
    test('defaults to status 0 — a request that never produced one', () => {
        const err = new AdminError();
        assert.equal(err.status, 0);
        assert.equal(err.name, 'AdminError');
        assert.ok(err instanceof Error);
    });

    test('the diagnostic message names the request, the status and the code', () => {
        const err = new AdminError({
            status: 403,
            code: 'FEATURE_NOT_INCLUDED',
            method: 'GET',
            url: '/api/v1/admin/tenants',
        });
        assert.equal(err.message, 'GET /api/v1/admin/tenants → HTTP 403 (FEATURE_NOT_INCLUDED)');
    });

    test('the diagnostic carries the detail when there is one', () => {
        const err = new AdminError({ status: 409, detail: 'Version already published' });
        assert.equal(err.message, 'HTTP 409: Version already published');
    });

    test('an explicit message overrides the derived one', () => {
        const err = new AdminError({ status: 500, message: 'custom' });
        assert.equal(err.message, 'custom');
    });

    test('cause is preserved', () => {
        const cause = new Error('root');
        assert.equal(new AdminError({ cause }).cause, cause);
    });
});

describe('isAdminError', () => {
    test('recognises an instance', () => {
        assert.equal(isAdminError(new AdminError({ status: 404 })), true);
    });

    test('rejects a plain error, a look-alike object, and nothing at all', () => {
        assert.equal(isAdminError(new Error('nope')), false);
        assert.equal(isAdminError({ status: 404, code: 'X' }), false);
        assert.equal(isAdminError(null), false);
        assert.equal(isAdminError(undefined), false);
        assert.equal(isAdminError('boom'), false);
    });
});

describe('isEmptyResponse', () => {
    test('recognises what a throw site marked, and nothing else', () => {
        // A predicate over whatever was caught, so it has to survive the
        // values a `catch` really produces — a thrown string, a thrown
        // nothing — not just the errors this package raises.
        assert.equal(isEmptyResponse(markEmptyResponse(new Error('no body'))), true);
        assert.equal(isEmptyResponse(new PlansApiError(0, null, 'Plans API responded')), false);
        assert.equal(isEmptyResponse(new Error('plain')), false);
        assert.equal(isEmptyResponse({ status: 0, emptyResponse: true }), false);
        assert.equal(isEmptyResponse(null), false);
        assert.equal(isEmptyResponse(undefined), false);
        assert.equal(isEmptyResponse('boom'), false);
    });

    test('the marker is not enumerable, so it does not leak into a log line', () => {
        const err = markEmptyResponse(new PlansApiError(0, null, 'Create returned no body'));
        assert.deepEqual(Object.keys(err), Object.keys(new PlansApiError(0, null, 'x')));
    });
});

describe('isTransportFailure', () => {
    test('recognises what a client marked, and nothing else', () => {
        assert.equal(isTransportFailure(markTransportFailure(new TypeError('fetch failed'))), true);
        // The class the guess used to key on, unmarked: a null dereference.
        assert.equal(isTransportFailure(new TypeError('Cannot read properties of null')), false);
        assert.equal(isTransportFailure(new Error('plain')), false);
        assert.equal(isTransportFailure({ status: 0 }), false);
        assert.equal(isTransportFailure(null), false);
        assert.equal(isTransportFailure('boom'), false);
    });

    test('marking a non-object is a no-op rather than a second failure', () => {
        // `markTransportFailure` sits inside a `catch`, and a client is free to
        // reject with a string. Throwing there would replace the failure with
        // one about the failure.
        assert.equal(markTransportFailure('down'), 'down');
        assert.equal(isTransportFailure('down'), false);
    });

    test('the marker is not enumerable, so it does not leak into a log line', () => {
        const err = markTransportFailure(new TypeError('Failed to fetch'));
        assert.deepEqual(Object.keys(err), Object.keys(new TypeError('Failed to fetch')));
    });
});

describe('toAdminError', () => {
    test('passes an AdminError through untouched', () => {
        const err = new AdminError({ status: 404 });
        assert.equal(toAdminError(err), err);
    });

    test('reads an axios rejection: status, code, body, url and method', () => {
        const err = toAdminError({
            message: 'Request failed with status code 403',
            config: { url: '/api/v1/admin/plans', method: 'patch' },
            response: {
                status: 403,
                data: { code: 'PLAN_LOCKED', message: 'Plan is locked' },
            },
        });
        assert.equal(err.status, 403);
        assert.equal(err.code, 'PLAN_LOCKED');
        assert.equal(err.url, '/api/v1/admin/plans');
        assert.equal(err.method, 'PATCH');
        assert.equal(err.detail, 'Plan is locked');
        assert.deepEqual(err.body, { code: 'PLAN_LOCKED', message: 'Plan is locked' });
    });

    test('a status-bearing error with an unreadable body has no detail at all', () => {
        const err = toAdminError({
            message: 'Request failed with status code 500',
            response: { status: 500, data: '' },
        });
        assert.equal(err.status, 500);
        assert.equal(err.detail, undefined);
        assert.equal(adminErrorMessage(err, EN), EN.server);
    });

    test('joins a NestJS ValidationPipe message array instead of stringifying it', () => {
        const err = toAdminError({
            response: {
                status: 400,
                data: {
                    statusCode: 400,
                    error: 'Bad Request',
                    message: ['email must be an email', 'password is too short'],
                },
            },
        });
        assert.equal(err.detail, 'email must be an email, password is too short');
        assert.equal(err.status, 400);
    });

    test('reads one of the package’s own API errors, which carry status and body', () => {
        const err = toAdminError(
            new BundlesApiError(422, { code: 'STRICT_MODE_VIOLATIONS' }, 'Bundles API said no'),
        );
        assert.equal(err.status, 422);
        assert.equal(err.code, 'STRICT_MODE_VIOLATIONS');
        // The class's own message is a diagnostic, so it stays off `detail`.
        assert.equal(err.detail, undefined);
        assert.equal(err.message, 'Bundles API said no');
    });

    test('an answer that was empty is not a connection problem', () => {
        // The sentinel a mutation throws when a 2xx carried no body. Both
        // cases have no HTTP status to report, so both were `status: 0` and
        // both were told to check the connection. They need opposite words:
        // this one may already have happened.
        //
        // `markEmptyResponse` is how the throw site says which it is — see
        // the suite at the bottom of this file for the same case driven
        // through the composable that really raises it.
        const err = toAdminError(
            markEmptyResponse(new PlansApiError(0, null, 'Create returned no body')),
        );
        assert.equal(err.emptyResponse, true);
        assert.equal(adminErrorMessage(err, EN), EN.emptyResponse);
        assert.notEqual(EN.emptyResponse, EN.network);
        // The diagnostic is still on `message`, for the log.
        assert.equal(err.message, 'Create returned no body');
    });

    test('a consumer client rejecting with status 0 is not an empty response', () => {
        // A custom `HttpClient` may reject with a transport error that happens
        // to carry `status: 0`. Inferring from the number alone told that
        // operator the change might have been applied, for a request that
        // never left.
        const err = toAdminError({ status: 0, message: 'Network Error' });
        assert.equal(err.emptyResponse, false);
        // Its own wording survives — the platform does not overrule a message
        // a consumer's client chose. What it must not do is claim the server
        // answered and the change may have landed.
        assert.equal(adminErrorMessage(err, EN), 'Network Error');
        assert.notEqual(adminErrorMessage(err, EN), EN.emptyResponse);
    });

    test('a manifest 304 that survives to be thrown is a diagnostic like any other', () => {
        // The brand says "this message is a diagnostic", and it says it per
        // class — which holds only while no throw site of such a class writes
        // something a person is meant to act on. One did:
        // `ManifestLoadError(304, '… call clearCache() and reload')` was an
        // instruction, addressed to whoever was looking at the admin screen,
        // who has neither a console nor a loader handle. `ManifestLoader` now
        // performs that recovery itself (see `manifest-loader.test.js`), so
        // the 304 that still reaches here is a server that answered one to an
        // unconditional request — nothing an operator can do, and the catalog
        // is the right voice for it.
        const err = toAdminError(
            new ManifestLoadError(304, 'Manifest endpoint answered HTTP 304 unconditionally'),
        );
        assert.equal(err.detail, undefined);
        assert.equal(err.message, 'Manifest endpoint answered HTTP 304 unconditionally');
        assert.equal(adminErrorMessage(err, EN), 'The request failed (HTTP 304).');
    });

    test('a real HTTP failure is not an empty response', () => {
        const err = toAdminError(new PlansApiError(403, {}, 'Plans API responded with HTTP 403'));
        assert.equal(err.emptyResponse, false);
        assert.equal(adminErrorMessage(err, EN), EN.forbidden);
    });

    test('a declared transport failure keeps its diagnostic off detail, so the catalog answers', () => {
        // `fetch` rejects with a TypeError whose text is the browser's, in
        // English, whatever the UI speaks. As `detail` it would out-rank
        // `msgs.network` — the one sentence that tells the operator what to do.
        // Which TypeErrors those are is declared by the client, not guessed
        // from the class; see the suite below for the case the guess got wrong.
        const err = toAdminError(markTransportFailure(new TypeError('Failed to fetch')));
        assert.equal(err.status, 0);
        assert.equal(err.detail, undefined);
        assert.equal(err.transportFailure, true);
        assert.equal(err.emptyResponse, false, 'nothing was answered at all');
        assert.equal(err.message, 'Failed to fetch');
        assert.ok(err.cause instanceof TypeError);
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('an axios failure with no response is transport too', () => {
        // Read from the shape rather than from a brand, and deliberately: that
        // shape is axios's documented network-failure form, and a library
        // cannot be asked to mark itself.
        const err = toAdminError(
            Object.assign(new Error('Network Error'), { config: { url: '/x', method: 'get' } }),
        );
        assert.equal(err.status, 0);
        assert.equal(err.detail, undefined);
        assert.equal(err.transportFailure, true);
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('but an error from app code keeps its message — that IS what was said', () => {
        const err = toAdminError(new Error('Plan is locked'));
        assert.equal(err.status, 0);
        assert.equal(err.detail, 'Plan is locked');
        assert.equal(adminErrorMessage(err, EN), 'Plan is locked');
    });

    test('wraps a thrown string', () => {
        const err = toAdminError('boom');
        assert.equal(err.status, 0);
        assert.equal(err.detail, 'boom');
    });

    test('survives a thrown nothing', () => {
        for (const value of [null, undefined, 42, {}]) {
            const err = toAdminError(value);
            assert.equal(err.status, 0);
            assert.equal(err.detail, undefined);
        }
    });
});

describe('a transport failure is declared by the client, not read off the class', () => {
    // `err instanceof TypeError` stood in for "the request failed in transit"
    // and was the third guess in this file to be wrong about a fact nothing in
    // the error carries. `TypeError` is also every ordinary null or undefined
    // dereference, so a bug in page code was reported to the operator as a
    // connection problem — sending them after their router for a defect in the
    // software.

    test('a null dereference is not a connection problem', () => {
        let caught;
        try {
            const rows = null;
            rows.map((row) => row);
        } catch (err) {
            caught = err;
        }
        assert.ok(caught instanceof TypeError);

        const err = toAdminError(caught);
        assert.equal(err.transportFailure, false);
        assert.notEqual(adminErrorMessage(err, EN), EN.network);
        // Nor is the engine's text something to put on an admin screen: it is
        // a stack-trace line. It stays on `message`, where a log reads it.
        assert.equal(err.detail, undefined);
        assert.match(err.message, /Cannot read properties of null/);
        assert.equal(adminErrorMessage(err, EN), EN.unexpected);
    });

    test('a real fetch failure still says "check your connection"', async () => {
        // Through the client the package ships, against a port nothing listens
        // on: `fetch` rejects with `TypeError: fetch failed`, which IS a
        // transport failure — the case the guess got right and that has to keep
        // working now that the answer comes from a brand instead.
        const err = await getJson(defaultHttpClient(), 'http://127.0.0.1:1/nothing-here').then(
            () => null,
            (e) => e,
        );
        assert.ok(err instanceof TypeError, `expected a fetch TypeError, got ${err}`);
        assert.equal(isTransportFailure(err), true, 'the client marks what it could not send');
        assert.equal(toAdminError(err).transportFailure, true);
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('a malformed URL is a transport failure too, not an unknown one', async () => {
        const err = await getJson(defaultHttpClient(), 'not a url').then(
            () => null,
            (e) => e,
        );
        assert.ok(err instanceof TypeError);
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('the client passes a response through untouched', async () => {
        // The marking sits in a `catch`; a resolved request must not notice it.
        const calls = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            calls.push({ url, init });
            return { status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
        };
        try {
            assert.deepEqual(await getJson(defaultHttpClient(), '/x'), { ok: true });
            assert.equal(calls.length, 1);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe('toAdminError and consumer errors', () => {
    test('a consumer error carrying a status keeps its message', () => {
        // `Object.assign(new Error('Quota exhausted'), { status: 429 })` from an
        // injected HttpClient says something the operator needs. Only this
        // package's own classes carry diagnostics there, and they are branded —
        // shape alone could not tell the two apart, and two attempts to guess
        // (a zero status, then a class-name suffix) each caught consumer errors.
        const err = toAdminError(Object.assign(new Error('Quota exhausted'), { status: 429 }));
        assert.equal(err.status, 429);
        assert.equal(err.detail, 'Quota exhausted');
        assert.equal(adminErrorMessage(err, EN), 'Quota exhausted');
    });

    test('a consumer error merely NAMED like ours is still a consumer error', () => {
        class MyApiError extends Error {
            constructor(message) {
                super(message);
                this.name = 'MyApiError';
                this.status = 0;
            }
        }
        const err = toAdminError(new MyApiError('Network Error'));
        assert.equal(err.emptyResponse, false);
    });
});

describe('emptyResponse is read off the throw site, not off the class', () => {
    // The cases below run the real throw sites rather than hand-built errors,
    // because the defect they cover was invisible to a hand-built one: every
    // fixture that asserted "status 0 is not an empty response" used an error
    // this package had not raised, and the branded classes were only ever
    // constructed at their sentinel sites. A class raised at both kinds of
    // site is exactly the state no fixture rendered.

    /**
     * An `HttpClient` that reports a transport failure by RESOLVING with
     * `status: 0` instead of rejecting. `HttpClient` is a bare function type
     * whose doc invites an axios wrapper, and that is what XHR and axios do —
     * `status === 0` for a network error, a CORS rejection or an abort.
     */
    const resolvesZero = () =>
        Promise.resolve({
            status: 0,
            headers: { get: () => null },
            json: async () => null,
            text: async () => '',
        });

    /** Composable options for such a client, plus whatever the seam requires. */
    const withZero = (extra) => ({ adminEndpoint: '/api/admin', http: resolvesZero, ...extra });

    test('a mutation the server answered without a body is an empty response', async () => {
        // 204 to a POST that has to return the created row: the call reached
        // the server, the server accepted it, and the row is missing. The
        // change may well have been applied — that is what the wording says.
        const { add } = useTenantSubscriptionBundles({
            billingEndpoint: '/api/v1',
            http: httpReturning({ status: 204 }).http,
        });
        const err = await add({ bundleVersionId: 'bv-1' }).then(
            () => null,
            (e) => e,
        );
        assert.ok(err, 'add() must reject when the body is missing');
        assert.equal(toAdminError(err).emptyResponse, true);
        assert.equal(adminErrorMessage(err, EN), EN.emptyResponse);
    });

    test('a boot GET a client resolved as status 0 never reached the server', async () => {
        // `BootLoader.load()` is a read-only GET behind `status !== 200`, so
        // the zero goes straight into a branded error. Inferring the sentinel
        // from `status === 0 && isPlatformError(err)` told the operator of a
        // pre-login boot failure to go check whether a change had been
        // applied — for a request that never left the machine, on a screen
        // that changes nothing.
        const err = await new BootLoader({ endpoint: '/api/admin/boot', http: resolvesZero })
            .load()
            .then(
                () => null,
                (e) => e,
            );
        assert.ok(err instanceof Error);
        assert.equal(err.status, 0);
        assert.equal(toAdminError(err).emptyResponse, false);
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('a manifest GET a client resolved as status 0 never reached the server', async () => {
        // `ManifestLoader.acceptFresh` has the same `status !== 200` shape.
        const err = await new ManifestLoader({
            endpoint: '/api/admin/manifest',
            http: resolvesZero,
            storage: { get: () => null, set: () => {}, remove: () => {} },
        })
            .load()
            .then(
                () => null,
                (e) => e,
            );
        assert.ok(err instanceof Error);
        assert.equal(toAdminError(err).emptyResponse, false);
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('nor did a mutation a client resolved as status 0 — on any of the surfaces', async () => {
        // The loaders were fixed one round earlier; the mutation sentinels were
        // not, and they are the half that matters most. Every one of them read
        // `if (!created)` — true both when the server answered without a body
        // and when the client never got an answer at all — and then said "the
        // change may have been applied" about a POST that never left the
        // machine.
        //
        // Driven through the real composables, one per JSON seam in the
        // package, because a hand-built error cannot show this: the sentinel is
        // only wrong in the presence of the fall-through above it.
        const app = createApp({});
        const seams = [
            ['usePlans.create', () => usePlans(withZero({ projectKey: 'p' })).create({})],
            [
                'usePlanVersions.createDraft',
                () => usePlanVersions(withZero({ planId: 'pv' })).createDraft({}),
            ],
            ['useBundles.create', () => useBundles(withZero({ projectKey: 'p' })).create({})],
            [
                'useBundleVersions.createDraft',
                () => useBundleVersions(withZero({ bundleId: 'b' })).createDraft({}),
            ],
            [
                'useCatalogEntries.reviewFeature',
                () => useCatalogEntries(withZero({ projectKey: 'p' })).reviewFeature('f', {}),
            ],
            ['usePromotions.create', () => usePromotions(withZero({ projectKey: 'p' })).create({})],
            [
                'useMarketingProjections.create',
                () => useMarketingProjections(withZero({ filter: { projectKey: 'p' } })).create({}),
            ],
            [
                'useTenantSubscriptionBundles.add',
                () =>
                    useTenantSubscriptionBundles({
                        billingEndpoint: '/api/v1',
                        http: resolvesZero,
                    }).add({ bundleVersionId: 'bv-1' }),
            ],
        ];

        for (const [name, mutate] of seams) {
            const err = await app.runWithContext(mutate).then(
                () => null,
                (e) => e,
            );
            assert.ok(err instanceof Error, `${name} must reject`);
            const admin = toAdminError(err);
            assert.equal(admin.emptyResponse, false, `${name}: nothing was answered at all`);
            assert.equal(admin.transportFailure, true, `${name}: the request did not go out`);
            assert.equal(adminErrorMessage(err, EN), EN.network, name);
        }
    });

    test('a discovery load a client resolved as status 0 never reached the server', async () => {
        // `useDiscovery` captures the error into a ref instead of rejecting,
        // and that ref is what a page renders — so this is the shape a
        // consumer actually hands to `adminErrorMessage`. `runWithContext`
        // gives its `inject()` an app to resolve against, the way a mount
        // would; without one Vue warns and the catalog silently falls back.
        const discovery = createApp({}).runWithContext(() =>
            useDiscovery({ endpoint: '/api/admin/discovery', http: resolvesZero }),
        );
        await discovery.load();
        const err = discovery.error.value;
        assert.ok(err instanceof Error);
        assert.equal(err.status, 0);
        assert.equal(toAdminError(err).emptyResponse, false);
        assert.equal(adminErrorMessage(err, FALLBACK_ERRORS), FALLBACK_ERRORS.network);
    });
});

describe('toAdminError and rejections that are not Errors', () => {
    test('a plain object keeps the message it carries', () => {
        // The same information reaches the operator either way: a client that
        // rejects with `{ code, message }` says as much as one that attaches a
        // status to an Error, and the status-bearing branch already shows it.
        const err = toAdminError({ code: 'QUOTA', message: 'Quota exhausted' });
        assert.equal(err.detail, 'Quota exhausted');
        assert.equal(err.code, 'QUOTA');
        assert.equal(adminErrorMessage(err, EN), 'Quota exhausted');
    });

    test('an Error from another realm is such an object', () => {
        // `instanceof` is per realm, so this misses the branch above. Its
        // message is still the failing side's words.
        const foreign = vm.runInNewContext("new Error('Plan is locked')");
        assert.equal(foreign instanceof Error, false);
        assert.equal(adminErrorMessage(toAdminError(foreign), EN), 'Plan is locked');
    });

    test('an object with nothing readable falls through to the generic wording', () => {
        assert.equal(adminErrorMessage(toAdminError({}), EN), EN.unexpected);
        assert.equal(adminErrorMessage(toAdminError(null), EN), EN.unexpected);
    });

    test('a non-string message is not a message', () => {
        assert.equal(toAdminError({ message: { nested: true } }).detail, undefined);
    });
});

describe('adminErrorMessage', () => {
    test('what the failing side said outranks anything the platform could guess', () => {
        const err = new AdminError({ status: 403, detail: 'Plan is locked' });
        assert.equal(adminErrorMessage(err, EN), 'Plan is locked');
    });

    test('maps the statuses that have their own wording', () => {
        const cases = [
            [400, EN.validation],
            [401, EN.unauthorized],
            [403, EN.forbidden],
            [404, EN.notFound],
            [409, EN.conflict],
            [422, EN.validation],
            [429, EN.rateLimited],
            [500, EN.server],
            [503, EN.server],
        ];
        for (const [status, expected] of cases) {
            assert.equal(
                adminErrorMessage(new AdminError({ status }), EN),
                expected,
                `HTTP ${status}`,
            );
        }
    });

    test('any other status falls through to the generic template, with the number in it', () => {
        assert.equal(
            adminErrorMessage(new AdminError({ status: 418 }), EN),
            'The request failed (HTTP 418).',
        );
    });

    test('a failure nothing knows anything about says so, rather than blaming the network', () => {
        // No text, no status, and no seam that declared what happened. "Check
        // your connection" used to be the answer here and it was a guess — the
        // one that made a null dereference look like a router problem. The
        // three sentences for a statusless failure are now reached only on
        // purpose: `network` when a client marked the request as unsent,
        // `emptyResponse` when a throw site marked the body as missing, and
        // this one when neither did.
        assert.equal(adminErrorMessage(new AdminError(), EN), EN.unexpected);
        assert.equal(adminErrorMessage(null, EN), EN.unexpected);
        assert.notEqual(EN.unexpected, EN.network);
        assert.notEqual(EN.unexpected, EN.emptyResponse);
    });

    test('a seam that declares the request never went out gets the network wording', () => {
        const err = new AdminError({ transportFailure: true });
        assert.equal(adminErrorMessage(err, EN), EN.network);
    });

    test('converts before formatting, so an axios rejection needs no pre-processing', () => {
        const message = adminErrorMessage({ response: { status: 404, data: {} } }, EN);
        assert.equal(message, EN.notFound);
    });

    test('German is a complete alternative, not a fallback to English', () => {
        const de = SA_MESSAGES.de.errors;
        assert.equal(adminErrorMessage(new AdminError({ status: 401 }), de), de.unauthorized);
        assert.notEqual(de.unauthorized, EN.unauthorized);
    });
});

describe('HttpJsonError is AdminError', () => {
    test('the two names are one class, so an existing instanceof check keeps working', () => {
        assert.equal(HttpJsonError, AdminError);
        assert.ok(new AdminError({ status: 404 }) instanceof HttpJsonError);
    });
});

describe('getJson / postJson raise AdminError', () => {
    test('a non-2xx carries status, code, detail, url and method', async () => {
        const { http } = httpReturning({
            status: 409,
            body: { code: 'SETUP_ALREADY_DONE', message: 'A SuperAdmin already exists' },
        });
        await assert.rejects(getJson(http, '/api/v1/admin/setup'), (err) => {
            assert.ok(isAdminError(err));
            assert.equal(err.status, 409);
            assert.equal(err.code, 'SETUP_ALREADY_DONE');
            assert.equal(err.detail, 'A SuperAdmin already exists');
            assert.equal(err.url, '/api/v1/admin/setup');
            assert.equal(err.method, 'GET');
            return true;
        });
    });

    test('postJson reports its own method', async () => {
        const { http, calls } = httpReturning({ status: 400, body: { message: 'bad' } });
        await assert.rejects(postJson(http, '/api/v1/admin/setup', { a: 1 }), (err) => {
            assert.equal(err.method, 'POST');
            return true;
        });
        assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));
    });

    test('an error body that is not JSON does not become a second failure', async () => {
        const { http } = httpReturning({ status: 502, unparseable: true });
        await assert.rejects(getJson(http, '/x'), (err) => {
            assert.equal(err.status, 502);
            assert.equal(err.code, undefined);
            assert.equal(err.body, undefined);
            return true;
        });
    });

    test('a validation rejection keeps its constraints — the array is joined here too', async () => {
        // The two paths that build an AdminError read the body the same way.
        // They did not for one release: this one accepted only a string, so a
        // ValidationPipe rejection arrived with no detail at all and the
        // operator saw the generic fallback instead of what was wrong.
        const { http } = httpReturning({
            status: 400,
            body: {
                statusCode: 400,
                error: 'Bad Request',
                message: ['email must be an email', 'password is too short'],
            },
        });
        await assert.rejects(postJson(http, '/api/v1/admin/setup', {}), (err) => {
            assert.equal(err.detail, 'email must be an email, password is too short');
            assert.equal(
                adminErrorMessage(err, FALLBACK_ERRORS),
                'email must be an email, password is too short',
            );
            return true;
        });
    });

    test('a 2xx still returns the parsed body', async () => {
        const { http } = httpReturning({ status: 200, body: { ok: true } });
        assert.deepEqual(await getJson(http, '/x'), { ok: true });
    });
});
