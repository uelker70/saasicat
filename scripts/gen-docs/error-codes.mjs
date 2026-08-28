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
        'It falls back in four steps, and the order is the point: your catalogue,',
        'the shipped one for the active locale, the English `message` the backend',
        'sent, and only then the bare code. The third step is why `message` stays on',
        'the wire — a code you have not translated yet shows English prose, never an',
        'empty line. For a blocker that matters: an empty one leaves someone with a',
        'disabled button and no reason.',
        '',
        '```ts',
        "import { ERROR_MESSAGES_DE, resolveErrorMessage } from '@saasicat/core';",
        '',
        '// `body` is the JSON the platform returned; `OWN_MESSAGES` is yours.',
        'resolveErrorMessage(body, OWN_MESSAGES, ERROR_MESSAGES_DE);',
        '```',
        '',
        'Put that in one place rather than at each `catch`:',
        '[`examples/notesapp/web/src/services/platform-errors.ts`](../../examples/notesapp/web/src/services/platform-errors.ts)',
        'is the whole seam, and the two call sites next to it show what a component',
        'then asks for — text, not a body to take apart.',
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
