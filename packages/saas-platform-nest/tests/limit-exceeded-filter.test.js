import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LimitExceededFilter } from '../dist/billing/index.js';
import { LimitExceededError } from '../dist/entitlement/index.js';

// LimitExceededFilter mappt domänen-neutrale `LimitExceededError` auf
// HTTP 402 (Payment Required) und ein konsistentes JSON-Body-Format. Tests
// stellen sicher, dass Konsumenten (vereinsfux/AutohausPro) das gleiche
// Antwortschema sehen — das Frontend wertet `dimension`, `used`, `max`
// für Upgrade-Hints aus.

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
    test('antwortet mit HTTP 402 + Standard-Body-Shape', () => {
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

    test('trägt die Quota-Dimension korrekt aus der Exception', () => {
        const filter = new LimitExceededFilter();
        const harness = buildHost();

        filter.catch(new LimitExceededError('storageGb', 10, 9.7), harness.host);

        assert.equal(harness.captured.body.dimension, 'storageGb');
        assert.equal(harness.captured.body.used, 9.7);
        assert.equal(harness.captured.body.max, 10);
    });

    test('lässt fließkomma-`used`/`max` für Storage durchlaufen', () => {
        // storageGb läuft mit Bruchteilen (e.g. 0.512 GiB für eine 512 MB-
        // Datei). Body darf das nicht runden.
        const filter = new LimitExceededFilter();
        const harness = buildHost({ url: '/api/v1/dms/upload' });

        filter.catch(new LimitExceededError('storageGb', 2.5, 2.49), harness.host);

        assert.equal(harness.captured.body.used, 2.49);
        assert.equal(harness.captured.body.max, 2.5);
    });

    test('robust bei fehlendem method/url im Request', () => {
        // Logger lesen `request.method ?? '?'` und `request.url ?? ''` — das
        // darf nicht crashen, auch wenn der Request ein leeres Objekt ist.
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
