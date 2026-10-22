// The operator's terms as the tests name them: a PDF of their own, and a
// `terms` block naming it by its absolute path, since a catalogue assembled in
// code has no file to stand beside.

import { fileURLToPath } from 'node:url';

import { termsVersionChanged } from '@saasicat/core';

/** The PDF of version `2026-10`, a few bytes that begin as every PDF does. */
export const TERMS_PDF = fileURLToPath(new URL('../fixtures/terms-2026-10.pdf', import.meta.url));

/** `config/saas.yaml#terms`, naming that PDF. */
export const TERMS = { version: '2026-10', file: TERMS_PDF };

/**
 * An archive of the terms in memory, kept as the persistence contract holds
 * the shipped ones to keep it: the same checksum again is the same write,
 * another one is refused and the first stays. `problem` is what
 * `protectionProblem` answers.
 */
export function aTermsArchive({ problem = null } = {}) {
    const versions = new Map();
    return {
        versions,
        stores: 0,
        async store(terms) {
            this.stores += 1;
            const kept = versions.get(terms.version);
            if (kept && kept.checksum !== terms.checksum) {
                throw termsVersionChanged(terms.version, kept.checksum, terms.checksum);
            }
            if (!kept) versions.set(terms.version, structuredClone(terms));
        },
        async read(version) {
            return structuredClone(versions.get(version) ?? null);
        },
        protectionProblem: async () => problem,
    };
}
