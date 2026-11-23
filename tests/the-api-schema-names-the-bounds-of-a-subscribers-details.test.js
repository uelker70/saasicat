import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
    INVOICE_CANCELLATION_REASON_MAX_LENGTH,
    INVOICE_SUBSCRIBER_DETAILS,
    invoiceCorrectionMaxLengthOf,
    LEGAL_IDENTITY_FIELDS,
    SUBSCRIBER_INVOICE_EMAIL_MAX_LENGTH,
    subscriberIdentityMaxLengthOf,
} from '../packages/core/dist/index.js';

// The platform measures a subscriber's details, a cancellation's reason and
// the address it is delivered to itself; the admin API schema is what an
// integrator reads those bounds from. Each number here is taken from the
// constant the platform measures with, so the schema cannot keep a bound the
// platform no longer holds.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = parse(readFileSync(join(ROOT, 'packages/spec/admin-api.openapi.yaml'), 'utf8'));
const CANCELLATION = SPEC.components.schemas.AdminInvoiceCancellation.properties;

/** The request body of `POST /subscribers/{id}/identity`. */
function identityCorrectionBody() {
    const path = Object.keys(SPEC.paths).find((key) => key.endsWith('/identity'));
    assert.ok(path, 'the identity correction route is in the schema');
    return SPEC.paths[path].post.requestBody.content['application/json'].schema.properties;
}

const maxLengthsOf = (properties, fields) =>
    Object.fromEntries(fields.map((field) => [field, properties[field]?.maxLength]));

describe('the admin API schema names the bounds the platform holds', () => {
    test("each detail of an invoice's correction its own", () => {
        assert.deepEqual(
            Object.keys(CANCELLATION.corrections.properties).sort(),
            [...INVOICE_SUBSCRIBER_DETAILS].sort(),
        );
        assert.deepEqual(
            maxLengthsOf(CANCELLATION.corrections.properties, INVOICE_SUBSCRIBER_DETAILS),
            Object.fromEntries(
                INVOICE_SUBSCRIBER_DETAILS.map((detail) => [
                    detail,
                    invoiceCorrectionMaxLengthOf(detail),
                ]),
            ),
        );
    });

    test("a cancellation's reason and the address it is delivered to", () => {
        assert.deepEqual(
            [CANCELLATION.reason.maxLength, CANCELLATION.deliverTo.maxLength],
            [INVOICE_CANCELLATION_REASON_MAX_LENGTH, SUBSCRIBER_INVOICE_EMAIL_MAX_LENGTH],
        );
    });

    test('each detail of a correction of the legal identity', () => {
        assert.deepEqual(
            maxLengthsOf(identityCorrectionBody(), LEGAL_IDENTITY_FIELDS),
            Object.fromEntries(
                LEGAL_IDENTITY_FIELDS.map((field) => [field, subscriberIdentityMaxLengthOf(field)]),
            ),
        );
    });
});
