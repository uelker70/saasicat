// A diagnostic does not change when the operator switches language.
//
// `markPlatformError` states that a class's `message` is for the log, and
// `toAdminError` acts on it by dropping that message rather than showing it.
// Five throw sites built theirs through the i18n layer, so the promise was
// false in both directions: the text was written for a person, and it came out
// in whatever language the shell spoke — German for `DEFAULT_SA_LOCALE`, in a
// repository whose rule is that every developer-facing string is English.
//
// The structural half of this is in `diagnostics-are-not-translated.test.js`.
// This half runs the seams: the same failure in two locales has to produce the
// same diagnostic, and the sentence a user sees has to come from the catalog
// and differ between them. Both directions matter — a diagnostic that is
// merely English everywhere would also pass a "no German" check while still
// being the wrong text to show.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from 'vue';

import {
    SA_MESSAGES,
    SUPER_ADMIN_I18N_KEY,
    adminErrorMessage,
    createSuperAdminI18n,
    useCatalogEntries,
    useDiscovery,
    useMarketingProjections,
    usePromotions,
} from '../dist/index.js';

/** Answers every request with one status and an empty JSON body. */
const answering = (status) => () =>
    Promise.resolve({
        status,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '{}',
    });

/** Runs a composable inside a shell that speaks `locale`. */
function inLocale(locale, run) {
    const app = createApp({});
    app.provide(SUPER_ADMIN_I18N_KEY, createSuperAdminI18n({ locale, persist: false }));
    return app.runWithContext(run);
}

/**
 * The seams whose diagnostics were built from the catalog. Each one captures
 * its failure into `error` instead of rejecting, which is the shape a page
 * really holds.
 */
const seams = [
    ['useDiscovery.load', (http) => useDiscovery({ endpoint: '/api/admin/discovery', http })],
    [
        'useDiscovery.rescan',
        (http) => {
            const view = useDiscovery({ endpoint: '/api/admin/discovery', http });
            return { ...view, load: view.rescan };
        },
    ],
    [
        'useCatalogEntries.load',
        (http) => useCatalogEntries({ adminEndpoint: '/api/admin', projectKey: 'p', http }),
    ],
    [
        'usePromotions.load',
        (http) => usePromotions({ adminEndpoint: '/api/admin', projectKey: 'p', http }),
    ],
    [
        'useMarketingProjections.load',
        (http) =>
            useMarketingProjections({
                adminEndpoint: '/api/admin',
                filter: { projectKey: 'p' },
                http,
            }),
    ],
];

/** Loads the seam in one locale and returns the error it captured. */
async function failIn(locale, build) {
    const view = inLocale(locale, () => build(answering(500)));
    await view.load();
    return view.error.value;
}

describe('the diagnostic of a failing seam does not depend on the UI language', () => {
    for (const [name, build] of seams) {
        test(`${name} says the same thing in German and in English`, async () => {
            const de = await failIn('de', build);
            const en = await failIn('en', build);
            assert.ok(de instanceof Error, `${name} must capture an error`);
            assert.equal(
                de.message,
                en.message,
                `${name}: the diagnostic changed with the locale — it is built from the catalog`,
            );
            // Ruling out the trivial way to pass: a diagnostic that is the
            // empty string, or one that never mentions what happened.
            assert.match(de.message, /HTTP 500/);
        });

        test(`${name} shows the operator the catalog's sentence, in their language`, async () => {
            const de = await failIn('de', build);
            assert.equal(
                adminErrorMessage(de, SA_MESSAGES.de.errors),
                SA_MESSAGES.de.errors.server,
            );
            assert.equal(
                adminErrorMessage(de, SA_MESSAGES.en.errors),
                SA_MESSAGES.en.errors.server,
            );
            assert.notEqual(SA_MESSAGES.de.errors.server, SA_MESSAGES.en.errors.server);
            assert.notEqual(adminErrorMessage(de, SA_MESSAGES.de.errors), de.message);
        });
    }
});
