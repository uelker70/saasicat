// The fingerprint over the settings subtree.
//
// Over the RESOLVED values, not the file's text: a value may name an
// environment variable, so the same file resolves differently per environment
// — which is the point — and a hash over the text would report nothing when a
// production variable moved the notice period. That is exactly the change an
// operator most needs to be told about.

import { createHash } from 'node:crypto';
import { type AppliedSettingsValues, canonicalJson } from '@saasicat/core';

/** `sha256-<hex>` over the canonical JSON of the settings — order-independent. */
export function fingerprintOf(settings: AppliedSettingsValues): string {
    return `sha256-${createHash('sha256').update(canonicalJson(settings)).digest('hex')}`;
}
