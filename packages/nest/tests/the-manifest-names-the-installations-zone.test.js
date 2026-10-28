// The manifest names the installation's time zone, so the administration reads
// every day it shows in it: the zone `config/saas.yaml` names, and none where it
// names none — never an empty one, which the schema refuses.

// @requirement SC-ADM-048 — Every day the administration shows is a day of the installation

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

const zoneTakes = new Ajv2020({ strict: false }).compile(adminManifestSchema.properties.timeZone);

test('names the zone config/saas.yaml names, as the schema takes it', async () => {
    const manifest = await manifestOf(invoicingPlatform());

    assert.equal(manifest.timeZone, 'Europe/Berlin');
    assert.ok(zoneTakes(manifest.timeZone));
});

test('names none where the file names none, and the schema takes no empty one', async () => {
    const manifest = await manifestOf(
        invoicingPlatform({ tax: false, invoices: null, invoicing: null, payments: 'none' }),
    );

    assert.equal('timeZone' in manifest, false);
    assert.equal(zoneTakes(''), false);
});
