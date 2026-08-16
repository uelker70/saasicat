// AdminError, toAdminError and adminErrorMessage — the one error shape the
// package works with, and the conversions into it.
//
// The cases are the shapes a consumer's HttpClient really produces: an axios
// rejection, one of the package's own `*ApiError` classes, a bare `Error`, a
// string. The point of the type is that none of them reaches page code.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    AdminError,
    DEFAULT_SA_LOCALE,
    HttpJsonError,
    SA_MESSAGES,
    adminErrorMessage,
    getJson,
    isAdminError,
    postJson,
    toAdminError,
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
        class BundlesApiError extends Error {
            constructor(status, body, message) {
                super(message);
                this.name = 'BundlesApiError';
                this.status = status;
                this.body = body;
            }
        }
        const err = toAdminError(
            new BundlesApiError(422, { code: 'STRICT_MODE_VIOLATIONS' }, 'Bundles API said no'),
        );
        assert.equal(err.status, 422);
        assert.equal(err.code, 'STRICT_MODE_VIOLATIONS');
        // The class's own message is a diagnostic, so it stays off `detail`.
        assert.equal(err.detail, undefined);
        assert.equal(err.message, 'Bundles API said no');
    });

    test('wraps a plain Error as status 0 and keeps its message as the detail', () => {
        const err = toAdminError(new TypeError('Failed to fetch'));
        assert.equal(err.status, 0);
        assert.equal(err.detail, 'Failed to fetch');
        assert.ok(err.cause instanceof TypeError);
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

    test('an axios rejection without a response is a transport failure, not a 0-status body', () => {
        const err = toAdminError(
            Object.assign(new Error('Network Error'), { config: { url: '/x', method: 'get' } }),
        );
        assert.equal(err.status, 0);
        assert.equal(err.detail, 'Network Error');
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

    test('a request that never produced a status is described as one that did not complete', () => {
        assert.equal(adminErrorMessage(new AdminError(), EN), EN.network);
        assert.equal(adminErrorMessage(null, EN), EN.network);
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
