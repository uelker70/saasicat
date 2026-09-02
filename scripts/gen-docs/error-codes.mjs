// `docs/reference/error-codes.md` — every code a platform error carries.
//
// The code is the contract; the message is a fallback a consumer overlays. A
// reader arrives here with a code they saw in a response, so the page is sorted
// by catalogue and lists the shipped English text beside each one.
//
// Derived from `@saasicat/core`'s dist, which is where the catalogues live —
// the page cannot fall behind them, which is the whole reason it is generated.

const CATALOGUES = [
    ['SETUP_ERROR_CODES', 'Setup', 'The first-run bootstrap endpoints.'],
    ['AUTH_ERROR_CODES', 'Authentication and MFA', 'Sign-in, TOTP enrolment and verification.'],
    ['REGISTRATION_ERROR_CODES', 'Registration', 'Self-registration and onboarding.'],
    ['CATALOG_ERROR_CODES', 'Catalogue', 'Plans, versions, bundles, marketing entries.'],
    ['BILLING_ERROR_CODES', 'Billing', 'Subscriptions, plan changes, entitlements.'],
    ['CONTRACT_ERROR_CODES', 'Contracts', 'Checkout offers and subscription contracts.'],
    ['PROMO_ERROR_CODES', 'Promo codes', 'Redemption, validity and limits.'],
    ['SETTINGS_ERROR_CODES', 'Settings', 'The record of the applied configuration.'],
];

export const TARGET = 'docs/reference/error-codes.md';

export async function render({ core }) {
    const messages = core.ERROR_MESSAGES_EN;
    const platform = new Set(Object.values(core.PLATFORM_ERROR_CODES));
    const seen = new Set();
    const sections = [];

    for (const [name, title, blurb] of CATALOGUES) {
        const catalogue = core[name];
        if (!catalogue) throw new Error(`@saasicat/core no longer exports ${name}`);

        const rows = Object.values(catalogue)
            .sort()
            .map((code) => {
                seen.add(code);
                const text = messages[code];
                if (text === undefined) throw new Error(`no English message for ${code}`);
                return `| \`${code}\` | ${escapeCell(text)} |`;
            });

        sections.push(
            `## ${title}\n\n${blurb}\n\n` +
                `| Code | Shipped English text |\n| ---- | -------------------- |\n${rows.join('\n')}`,
        );
    }

    const orphans = [...platform].filter((code) => !seen.has(code)).sort();
    if (orphans.length) {
        throw new Error(
            `codes in PLATFORM_ERROR_CODES but in no catalogue on this page: ${orphans.join(', ')}`,
        );
    }

    return [
        '# Error codes',
        '',
        'Every code a platform error carries, with the English text shipped for it.',
        '',
        '**The code is the contract, not the message.** Resolve your own translation',
        'by code — `resolveErrorMessage` takes a consumer catalogue and falls back to',
        'the text below. Renaming or removing a code is a breaking change; rewording',
        'a message is not.',
        '',
        `Generated from \`@saasicat/core\` — ${seen.size} codes. Do not edit by hand:`,
        '`node scripts/gen-docs/index.mjs --write`.',
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}

/** A pipe inside a table cell ends the cell. */
function escapeCell(text) {
    return text.replaceAll('|', '\\|');
}
