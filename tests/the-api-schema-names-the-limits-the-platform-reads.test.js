import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { CUSTOM_LIMITS_KEYS, readCustomLimits } from '../packages/core/dist/index.js';

// A tenant's negotiated limits are written by the application — its own admin
// route, `x-served-by: app` — and read by the platform. The route's contract
// is the normative schema; the reading is `readCustomLimits`. They drifted
// once: the schema said a flat map of integers while the platform read
// `{ quotas, features }`, so an application that followed the schema stored
// limits that were never applied.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = parse(readFileSync(join(ROOT, 'packages/spec/admin-api.openapi.yaml'), 'utf8'));
const SCHEMA = SPEC.components.schemas.CustomLimits;

// @requirement SC-ENTL-024 — Negotiated limits are applied, and a stored shape that cannot be read is reported
describe('the admin API schema for negotiated limits', () => {
    test('names exactly the keys the platform reads', () => {
        assert.deepEqual(Object.keys(SCHEMA.properties).sort(), [...CUSTOM_LIMITS_KEYS].sort());
        assert.equal(SCHEMA.additionalProperties, false, 'and allows no other');
    });

    test('every route that carries them refers to it', () => {
        const carriers = [];
        const visit = (node, path) => {
            if (!node || typeof node !== 'object') return;
            if (Object.hasOwn(node, 'customLimits')) carriers.push([path, node.customLimits]);
            for (const [key, child] of Object.entries(node)) visit(child, `${path}/${key}`);
        };
        visit(SPEC.paths, '#/paths');
        visit(SPEC.components.schemas, '#/components/schemas');

        assert.ok(carriers.length > 0, 'the scan found the fields it is about');
        for (const [path, schema] of carriers) {
            assert.deepEqual(schema, { $ref: '#/components/schemas/CustomLimits' }, path);
        }
    });

    test('a value written to the schema is read whole', () => {
        const written = { quotas: { users: 50, storage: -1 }, features: ['EXPORT'] };
        assert.deepEqual(readCustomLimits(written), { limits: written, unread: [] });
    });
});
