// The manifest tells the administration whether a contract needs its
// subscriber's full address: where a tax adapter decides, one without it is
// refused (`SC-PRIC-069`), so a screen that creates a subscriber — the pilot
// dialog — asks for it as required; without one it stays optional. The field
// is always served, and a manifest an application builds without it stays
// valid.

// @requirement SC-SPEC-010 — The operator gives a pilot's subscriber its address, required under a tax adapter

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adminManifestSchema } from '@saasicat/spec';
import Ajv2020 from 'ajv/dist/2020.js';

import { AdminManifestService } from '../dist/platform/index.js';
import { invoicingPlatform, started } from './helpers/invoicing-platform.js';

/** The manifest the platform serves for `options`. */
async function manifestOf(options) {
    const moduleRef = await started(options);
    try {
        return await moduleRef.get(AdminManifestService).getManifest();
    } finally {
        await moduleRef.close();
    }
}

const fieldTakes = (value) =>
    new Ajv2020({ strict: false }).compile(
        adminManifestSchema.properties.subscriberAddressRequired,
    )(value);

test('where a tax adapter decides, a contract needs the full address', async () => {
    const manifest = await manifestOf(invoicingPlatform());

    assert.equal(manifest.subscriberAddressRequired, true);
    assert.ok(fieldTakes(manifest.subscriberAddressRequired));
});

test('without a tax adapter, it does not — said, not left out', async () => {
    const manifest = await manifestOf(
        invoicingPlatform({ tax: false, invoices: null, invoicing: null, payments: 'none' }),
    );

    assert.equal(manifest.subscriberAddressRequired, false);
    assert.ok(fieldTakes(manifest.subscriberAddressRequired));
});

test('a manifest built without the field is still one the schema takes, and it takes no other answer', () => {
    assert.equal(adminManifestSchema.required.includes('subscriberAddressRequired'), false);
    assert.equal(fieldTakes('yes'), false);
    assert.equal(fieldTakes(null), false);
});
