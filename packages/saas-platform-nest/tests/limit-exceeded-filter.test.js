import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LimitExceededFilter } from '../dist/billing/index.js';
import { LimitExceededError } from '../dist/entitlement/index.js';

// LimitExceededFilter maps the domain-neutral `LimitExceededError` onto
// HTTP 402 (Payment Required) and a consistent JSON body format. The tests
// ensure that all consumers see the same
// response schema — the frontend reads `dimension`, `used`, `max`
// to build upgrade hints.

function buildHost({ method = 'POST', url = '/api/v1/members' } = {}) {
    let captured = null;
    const response = {
        status(code) {
            return {
                send(body) {
                    captured = { code, body };
                },
            };
        },
    };
    const host = {
        switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => ({ method, url }),
        }),
    };
    return {
        host,
        get captured() {
            return captured;
        },
    };
}

describe('LimitExceededFilter', () => {
    test('responds with HTTP 402 + standard body shape', () => {
        const filter = new LimitExceededFilter();
        const harness = buildHost();
        const error = new LimitExceededError('members', 250, 250);

        filter.catch(error, harness.host);

        assert.deepEqual(harness.captured, {
            code: 402,
            body: {
                statusCode: 402,
                error: 'PaymentRequired',
                reason: 'LIMIT_EXCEEDED',
                dimension: 'members',
                used: 250,
                max: 250,
                message: 'Limit für members erreicht: 250/250.',
            },
        });
    });

    test('carries the quota dimension correctly from the exception', () => {
        const filter = new LimitExceededFilter();
        const harness = buildHost();

        filter.catch(new LimitExceededError('storageGb', 10, 9.7), harness.host);

        assert.equal(harness.captured.body.dimension, 'storageGb');
        assert.equal(harness.captured.body.used, 9.7);
        assert.equal(harness.captured.body.max, 10);
    });

    test('lets floating-point `used`/`max` pass through for storage', () => {
        // storageGb works with fractional values (e.g. 0.512 GiB for a 512 MB
        // file). The body must not round this.
        const filter = new LimitExceededFilter();
        const harness = buildHost({ url: '/api/v1/dms/upload' });

        filter.catch(new LimitExceededError('storageGb', 2.5, 2.49), harness.host);

        assert.equal(harness.captured.body.used, 2.49);
        assert.equal(harness.captured.body.max, 2.5);
    });

    test('robust when method/url are missing from the request', () => {
        // The logger reads `request.method ?? '?'` and `request.url ?? ''` — this
        // must not crash, even when the request is an empty object.
        const filter = new LimitExceededFilter();
        let captured = null;
        const host = {
            switchToHttp: () => ({
                getResponse: () => ({
                    status: () => ({ send: (b) => (captured = b) }),
                }),
                getRequest: () => ({}),
            }),
        };

        assert.doesNotThrow(() => filter.catch(new LimitExceededError('users', 3, 3), host));
        assert.equal(captured.dimension, 'users');
    });
});
