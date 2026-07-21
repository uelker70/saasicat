import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDiscoveryController } from '../dist/discovery/index.js';

// DiscoveryController: GET /admin/discovery — returns a discovery snapshot with
// ETag caching. We instantiate the controller class directly with a fake
// scanner and a fake HttpResponse spy, without spinning up a NestJS test
// module.

function makeFakeScanner(snapshot) {
    return {
        getSnapshot: () => snapshot,
    };
}

function makeFakeRes() {
    const headers = new Map();
    let statusCode = 200;
    return {
        header: (name, value) => {
            headers.set(name, value);
        },
        status: (code) => {
            statusCode = code;
        },
        get headers() {
            return headers;
        },
        get statusCode() {
            return statusCode;
        },
    };
}

const SNAPSHOT = Object.freeze({
    schemaVersion: 1,
    scannedAt: '2026-05-12T10:00:00.000Z',
    app: { key: 'clubapp', version: '0.42.1' },
    capabilities: [
        {
            capabilityKey: 'invoice.create',
            label: 'Rechnung erstellen',
            feature: 'INVOICE_MANAGEMENT',
            bundle: null,
            status: 'active',
            kind: 'endpoint',
            owner: null,
            replacementKey: null,
            removalPlannedAt: null,
            reason: null,
            declaredAt: 'InvoiceController.create',
        },
    ],
    features: [{ featureKey: 'INVOICE_MANAGEMENT', capabilityKeys: ['invoice.create'] }],
    bundles: [],
    quotas: [],
    hash: 'sha256-deadbeefcafef00d',
});

function buildController(snapshot = SNAPSHOT) {
    const ControllerClass = buildDiscoveryController([]);
    return new ControllerClass(makeFakeScanner(snapshot));
}

describe('DiscoveryController — GET /admin/discovery', () => {
    test('returns the discovery snapshot as the body', () => {
        const controller = buildController();
        const res = makeFakeRes();
        const body = controller.getDiscovery(undefined, res);

        assert.equal(body, SNAPSHOT);
        assert.equal(res.statusCode, 200);
    });

    // The ETag contains both the hash AND scannedAt, so that a re-scan without
    // data changes still lets the client pull a fresh snapshot (otherwise
    // `scannedAt` would be stale on a 304).
    const ETAG = `"${SNAPSHOT.hash}-${SNAPSHOT.scannedAt}"`;

    test('sets the ETag header with snapshot.hash + scannedAt', () => {
        const controller = buildController();
        const res = makeFakeRes();
        controller.getDiscovery(undefined, res);

        assert.equal(res.headers.get('ETag'), ETAG);
    });

    test('returns HTTP 304 + null body on an If-None-Match match', () => {
        const controller = buildController();
        const res = makeFakeRes();
        const body = controller.getDiscovery(ETAG, res);

        assert.equal(body, null);
        assert.equal(res.statusCode, 304);
        // The ETag header is still set (RFC 9110 permits it on a 304)
        assert.equal(res.headers.get('ETag'), ETAG);
    });

    test('returns the full snapshot when If-None-Match does not match', () => {
        const controller = buildController();
        const res = makeFakeRes();
        const body = controller.getDiscovery('"sha256-anderes"', res);

        assert.equal(body, SNAPSHOT);
        assert.equal(res.statusCode, 200);
    });

    test('ignores an empty If-None-Match header', () => {
        const controller = buildController();
        const res = makeFakeRes();
        const body = controller.getDiscovery('', res);

        assert.equal(body, SNAPSHOT);
        assert.equal(res.statusCode, 200);
    });
});
