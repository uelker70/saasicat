// The two rules that need a CSS parser rather than a JavaScript one.
//
// `pnpm tokens` counts what is already there and ratchets it down; ESLint reads
// TypeScript and templates. Neither can answer "is this declaration's value a
// token" — that is a question about a CSS value, and it is the question the
// three-layer token system exists to make answerable (ADR 0009).
//
// Scope is where a literal is always a mistake: a page arranges and binds, a
// feature carries a domain, an internal component renders part of one. None of
// them decides what a colour is. `src/ui/` holds the primitives, and
// `src/ui/theme/` is where literals are the entire point.

/**
 * Values that are not tokens and should never be.
 *
 * `0` has no unit to tokenise. `currentColor` and `inherit` defer to something
 * that already decided. `transparent` and `none` are absences. Percentages and
 * `1px` are layout arithmetic rather than design steps — `100%` of a parent is
 * not a value a scale could hold, and a hairline is a hairline.
 */
const NOT_A_DESIGN_DECISION =
    '/^(0|none|inherit|initial|unset|revert|auto|transparent|currentColor|[0-9.]+%|1px)$/';

/**
 * Reads a custom property, or composes ones it reads.
 *
 * Any `var(`, not only `--sa-`: `@saasicat/ui-vue-tenant` declares
 * component-local aliases (`--sp-text-muted: var(--sa-color-fg-muted)`) so a
 * consumer can move one component without reaching into the role layer. Where
 * a custom property gets its value is `theme-layer-discipline`'s question; this
 * rule asks only whether the declaration reads one.
 */
const READS_A_TOKEN = '/(var\\(--|color-mix\\(|calc\\()/';

/**
 * Colour and depth: at zero literals since the phase-1 migration, so a literal
 * here is a regression and fails the build.
 */
const SETTLED = [
    'color',
    'background',
    'background-color',
    'border-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'box-shadow',
    'fill',
    'stroke',
    'font-size',
];

/**
 * Spacing, radii and tracking: not migrated yet.
 *
 * The layout pass is a single connected change — around 956 of the spacing
 * values sit notation-identical on a twelve-rung ladder and the rest have to
 * snap, moving layout — so half-migrated is worse than either end. Until then
 * these warn, and `pnpm lint:css` carries the measured count as a ceiling that
 * only moves down. A rule that fails on the day it lands teaches people to
 * disable it.
 */
const RATCHETED = ['letter-spacing', 'border-radius', 'gap', 'row-gap', 'column-gap'];

/**
 * The five breakpoints, as the only widths a media query may name.
 *
 * A breakpoint cannot be a custom property: `@media` conditions are evaluated
 * before custom properties resolve. This is the one place in the design system
 * where an allow-list is the mechanism rather than a smell, and the values are
 * Quasar's own bands — which is what keeps a platform page and a consumer's
 * page breaking at the same width.
 */
const BREAKPOINTS = [
    '599.98px',
    '600px',
    '1023.98px',
    '1024px',
    '1439.98px',
    '1440px',
    '1919.98px',
    '1920px',
];

/** A number with a unit: `12px`, `0.5rem`, `1.5em`. One quantifier, no overlap. */
const MEASUREMENT_LITERAL = '/^[0-9.]+(px|rem|em)/';

const allowed = (properties) =>
    Object.fromEntries(
        properties.map((property) => [property, [READS_A_TOKEN, NOT_A_DESIGN_DECISION]]),
    );

export default {
    ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/.integration-tmp/**', '**/.claude/**'],
    // Stylelint refuses a configuration with no top-level rules. The two that
    // matter are scoped below; these are the two that hold everywhere, and both
    // are about a value nobody can read rather than about taste.
    rules: {
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates'] }],
    },
    overrides: [
        { files: ['**/*.vue'], customSyntax: 'postcss-html' },
        {
            files: [
                'packages/ui-vue/src/pages/**/*.{vue,css}',
                'packages/ui-vue/src/features/**/*.{vue,css}',
                'packages/ui-vue/src/internal/**/*.{vue,css}',
                'packages/ui-vue-tenant/src/**/*.{vue,css}',
            ],
            rules: {
                'declaration-property-value-allowed-list': [
                    allowed(SETTLED),
                    {
                        message:
                            'Read a token. The roles are in docs/reference/design-tokens.md; a ' +
                            'value that is not one of them is invisible in dark mode until ' +
                            'somebody looks at that page in dark mode.',
                    },
                ],
                // The ratcheted half, as a disallowed-list rather than a
                // second allowed-list: two entries of one rule cannot carry two
                // severities, and a number with a unit is exactly the shape a
                // literal takes here. `0` has no unit and stays allowed.
                'declaration-property-value-disallowed-list': [
                    Object.fromEntries(
                        RATCHETED.map((property) => [property, [MEASUREMENT_LITERAL]]),
                    ),
                    {
                        severity: 'warning',
                        message:
                            'A raw measurement. The scale is in ' +
                            'docs/reference/design-tokens.md — `--sa-space-*`, `--sa-radius-*`, ' +
                            '`--sa-tracking-*`. Warned rather than failed until the layout pass ' +
                            'lands; the ceiling in `pnpm lint:css` only moves down.',
                    },
                ],
                'media-feature-name-value-allowed-list': [
                    { '/^(min|max)-width$/': BREAKPOINTS },
                    {
                        message:
                            'Use one of the five breakpoints. A page that breaks at its own ' +
                            'width stops lining up with the ones beside it.',
                    },
                ],
            },
        },
    ],
};
