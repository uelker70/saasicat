# Design tokens

Every `--sa-*` the admin UI declares, by layer. The rules for using them —
which layer to read, what may not appear where, and the contrast floor a
role has to clear — are in the
[design guide](../explanation/design-guide.md).

Generated from `packages/ui-vue/src/ui/theme`. Do not edit by hand:
`node scripts/gen-docs/index.mjs --write`.

## Layer 1 — primitives

The raw palette and the raw steps. Literals live here and nowhere else. Read these only when you are defining a role of your own.

| Token              | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| `--sa-white`       | `#ffffff`                                             |
| `--sa-black`       | `#000000`                                             |
| `--sa-neutral-25`  | `#fbfbfd`                                             |
| `--sa-neutral-50`  | `#f8fafc`                                             |
| `--sa-neutral-100` | `#f1f5f9`                                             |
| `--sa-neutral-200` | `#e2e8f0`                                             |
| `--sa-neutral-300` | `#cbd5e1`                                             |
| `--sa-neutral-400` | `#94a3b8`                                             |
| `--sa-neutral-450` | `#7c8aa0`                                             |
| `--sa-neutral-500` | `#64748b`                                             |
| `--sa-neutral-600` | `#475569`                                             |
| `--sa-neutral-700` | `#334155`                                             |
| `--sa-neutral-800` | `#1e293b`                                             |
| `--sa-neutral-900` | `#0f172a`                                             |
| `--sa-neutral-950` | `#0b1220`                                             |
| `--sa-neutral-975` | `#070d18`                                             |
| `--sa-blue-50`     | `#eff6ff`                                             |
| `--sa-blue-100`    | `#dbeafe`                                             |
| `--sa-blue-200`    | `#bfdbfe`                                             |
| `--sa-blue-300`    | `#93c5fd`                                             |
| `--sa-blue-500`    | `#3b82f6`                                             |
| `--sa-blue-600`    | `#2563eb`                                             |
| `--sa-blue-700`    | `#1d4ed8`                                             |
| `--sa-blue-800`    | `#1e40af`                                             |
| `--sa-brand-blue`  | `#3f6bff`                                             |
| `--sa-green-50`    | `#ecfdf5`                                             |
| `--sa-green-100`   | `#d1fae5`                                             |
| `--sa-green-200`   | `#a7f3d0`                                             |
| `--sa-green-500`   | `#10b981`                                             |
| `--sa-green-700`   | `#047857`                                             |
| `--sa-green-800`   | `#065f46`                                             |
| `--sa-amber-50`    | `#fffbeb`                                             |
| `--sa-amber-100`   | `#fef3c7`                                             |
| `--sa-amber-200`   | `#fde68a`                                             |
| `--sa-amber-300`   | `#fcd34d`                                             |
| `--sa-amber-400`   | `#fbbf24`                                             |
| `--sa-amber-500`   | `#f59e0b`                                             |
| `--sa-amber-600`   | `#d97706`                                             |
| `--sa-amber-700`   | `#b45309`                                             |
| `--sa-amber-800`   | `#92400e`                                             |
| `--sa-red-50`      | `#fef2f2`                                             |
| `--sa-red-100`     | `#fee2e2`                                             |
| `--sa-red-200`     | `#fecaca`                                             |
| `--sa-red-300`     | `#fca5a5`                                             |
| `--sa-red-500`     | `#ef4444`                                             |
| `--sa-red-600`     | `#dc2626`                                             |
| `--sa-red-700`     | `#b91c1c`                                             |
| `--sa-red-800`     | `#991b1b`                                             |
| `--sa-indigo-50`   | `#eef2ff`                                             |
| `--sa-indigo-100`  | `#e0e7ff`                                             |
| `--sa-indigo-200`  | `#c7d2fe`                                             |
| `--sa-indigo-400`  | `#818cf8`                                             |
| `--sa-indigo-700`  | `#4338ca`                                             |
| `--sa-violet-50`   | `#ede9fe`                                             |
| `--sa-violet-200`  | `#ddd6fe`                                             |
| `--sa-violet-500`  | `#8b5cf6`                                             |
| `--sa-violet-700`  | `#6d28d9`                                             |
| `--sa-sky-50`      | `#f0f9ff`                                             |
| `--sa-sky-200`     | `#bae6fd`                                             |
| `--sa-sky-500`     | `#0ea5e9`                                             |
| `--sa-sky-700`     | `#0369a1`                                             |
| `--sa-font-head`   | `'Plus Jakarta Sans', 'Inter', system-ui, sans-serif` |
| `--sa-font-body`   | `'Inter', system-ui, sans-serif`                      |
| `--sa-font-mono`   | `ui-monospace, 'SF Mono', Menlo, monospace`           |

## Layer 2 — scales

Sizes, identical in every theme. Spacing, type, radii, shadows, z-index and motion. A component reads these directly.

| Token                  | Value               |
| ---------------------- | ------------------- |
| `--sa-space-0`         | `0`                 |
| `--sa-space-1`         | `2px`               |
| `--sa-space-2`         | `4px`               |
| `--sa-space-3`         | `8px`               |
| `--sa-space-4`         | `12px`              |
| `--sa-space-5`         | `16px`              |
| `--sa-space-6`         | `20px`              |
| `--sa-space-7`         | `24px`              |
| `--sa-space-8`         | `32px`              |
| `--sa-space-9`         | `40px`              |
| `--sa-space-10`        | `48px`              |
| `--sa-space-11`        | `64px`              |
| `--sa-gap-inline`      | `var(--sa-space-3)` |
| `--sa-gap-stack`       | `var(--sa-space-5)` |
| `--sa-pad-page`        | `var(--sa-space-6)` |
| `--sa-pad-section`     | `var(--sa-space-6)` |
| `--sa-pad-control`     | `var(--sa-space-3)` |
| `--sa-pad-cell`        | `var(--sa-space-4)` |
| `--sa-text-2xs`        | `10px`              |
| `--sa-text-xs`         | `11px`              |
| `--sa-text-sm`         | `12px`              |
| `--sa-text-md`         | `13px`              |
| `--sa-text-lg`         | `15px`              |
| `--sa-text-xl`         | `18px`              |
| `--sa-text-2xl`        | `22px`              |
| `--sa-text-3xl`        | `28px`              |
| `--sa-text-4xl`        | `32px`              |
| `--sa-leading-2xs`     | `1.4`               |
| `--sa-leading-xs`      | `1.45`              |
| `--sa-leading-sm`      | `1.5`               |
| `--sa-leading-md`      | `1.55`              |
| `--sa-leading-lg`      | `1.5`               |
| `--sa-leading-xl`      | `1.4`               |
| `--sa-leading-2xl`     | `1.3`               |
| `--sa-leading-3xl`     | `1.25`              |
| `--sa-leading-4xl`     | `1.15`              |
| `--sa-weight-regular`  | `400`               |
| `--sa-weight-medium`   | `500`               |
| `--sa-weight-semibold` | `600`               |
| `--sa-weight-bold`     | `700`               |
| `--sa-tracking-tight`  | `-0.02em`           |
| `--sa-tracking-normal` | `0`                 |
| `--sa-tracking-wide`   | `0.04em`            |
| `--sa-tracking-wider`  | `0.06em`            |
| `--sa-radius-section`  | `14px`              |
| `--sa-radius-card`     | `12px`              |
| `--sa-radius-head`     | `10px`              |
| `--sa-radius-tile`     | `10px`              |
| `--sa-radius-field`    | `8px`               |
| `--sa-radius-control`  | `7px`               |
| `--sa-radius-badge`    | `5px`               |
| `--sa-radius-pill`     | `999px`             |
| `--sa-z-base`          | `0`                 |
| `--sa-z-sticky`        | `100`               |
| `--sa-z-drawer`        | `3000`              |
| `--sa-z-overlay`       | `5900`              |
| `--sa-z-dialog`        | `6000`              |
| `--sa-z-toast`         | `9500`              |

## Layer 3 — roles

What a colour is _for_. This is the layer a consumer overrides, and
the only one that differs between themes. Both themes declare the same
keys — a role in one and not the other is a page that goes unreadable
the moment somebody flips the switch.

| Role                                       | Light                                                                          | Dark                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `--sa-color-bg-app`                        | `var(--sa-neutral-100)`                                                        | `var(--sa-neutral-975)`                                                        |
| `--sa-color-bg-surface`                    | `var(--sa-white)`                                                              | `var(--sa-neutral-900)`                                                        |
| `--sa-color-bg-surface-raised`             | `var(--sa-neutral-25)`                                                         | `var(--sa-neutral-800)`                                                        |
| `--sa-color-bg-sunken`                     | `var(--sa-neutral-50)`                                                         | `var(--sa-neutral-950)`                                                        |
| `--sa-color-bg-overlay`                    | `color-mix(in srgb, var(--sa-neutral-900) 55%, transparent)`                   | `color-mix(in srgb, var(--sa-black) 70%, transparent)`                         |
| `--sa-color-fg-heading`                    | `var(--sa-neutral-900)`                                                        | `var(--sa-neutral-50)`                                                         |
| `--sa-color-fg-body`                       | `var(--sa-neutral-800)`                                                        | `var(--sa-neutral-200)`                                                        |
| `--sa-color-fg-secondary`                  | `var(--sa-neutral-600)`                                                        | `var(--sa-neutral-300)`                                                        |
| `--sa-color-fg-muted`                      | `var(--sa-neutral-500)`                                                        | `var(--sa-neutral-400)`                                                        |
| `--sa-color-fg-subtle`                     | `var(--sa-neutral-450)`                                                        | `var(--sa-neutral-500)`                                                        |
| `--sa-color-fg-disabled`                   | `var(--sa-neutral-300)`                                                        | `var(--sa-neutral-600)`                                                        |
| `--sa-color-fg-on-accent`                  | `var(--sa-white)`                                                              | `var(--sa-white)`                                                              |
| `--sa-color-border`                        | `var(--sa-neutral-200)`                                                        | `var(--sa-neutral-700)`                                                        |
| `--sa-color-border-soft`                   | `var(--sa-neutral-100)`                                                        | `var(--sa-neutral-800)`                                                        |
| `--sa-color-border-strong`                 | `var(--sa-neutral-300)`                                                        | `var(--sa-neutral-600)`                                                        |
| `--sa-color-border-focus`                  | `var(--sa-color-accent)`                                                       | `var(--sa-color-accent)`                                                       |
| `--sa-color-accent`                        | `var(--q-primary, var(--sa-brand-blue))`                                       | `var(--q-primary, var(--sa-brand-blue))`                                       |
| `--sa-color-accent-strong`                 | `color-mix(in srgb, var(--sa-color-accent) 82%, var(--sa-black))`              | `color-mix(in srgb, var(--sa-color-accent) 82%, var(--sa-white))`              |
| `--sa-color-accent-surface`                | `color-mix(in srgb, var(--sa-color-accent) 8%, transparent)`                   | `color-mix(in srgb, var(--sa-color-accent) 16%, transparent)`                  |
| `--sa-color-accent-surface-soft`           | `color-mix(in srgb, var(--sa-color-accent) 4%, transparent)`                   | `color-mix(in srgb, var(--sa-color-accent) 8%, transparent)`                   |
| `--sa-color-accent-surface-strong`         | `color-mix( in srgb, var(--sa-color-accent) 10%, var(--sa-color-bg-surface) )` | `color-mix( in srgb, var(--sa-color-accent) 22%, var(--sa-color-bg-surface) )` |
| `--sa-color-accent-border`                 | `color-mix(in srgb, var(--sa-color-accent) 18%, transparent)`                  | `color-mix(in srgb, var(--sa-color-accent) 32%, transparent)`                  |
| `--sa-color-positive`                      | `var(--sa-green-700)`                                                          | `var(--sa-green-500)`                                                          |
| `--sa-color-positive-strong`               | `var(--sa-green-500)`                                                          | `var(--sa-green-500)`                                                          |
| `--sa-color-positive-fg`                   | `var(--sa-green-700)`                                                          | `var(--sa-green-200)`                                                          |
| `--sa-color-positive-surface`              | `var(--sa-green-50)`                                                           | `color-mix(in srgb, var(--sa-green-500) 14%, transparent)`                     |
| `--sa-color-positive-surface-strong`       | `var(--sa-green-100)`                                                          | `color-mix(in srgb, var(--sa-green-500) 24%, transparent)`                     |
| `--sa-color-positive-border`               | `var(--sa-green-200)`                                                          | `color-mix(in srgb, var(--sa-green-500) 36%, transparent)`                     |
| `--sa-color-warning`                       | `var(--sa-amber-700)`                                                          | `var(--sa-amber-400)`                                                          |
| `--sa-color-warning-strong`                | `var(--sa-amber-500)`                                                          | `var(--sa-amber-400)`                                                          |
| `--sa-color-warning-fg`                    | `var(--sa-amber-700)`                                                          | `var(--sa-amber-200)`                                                          |
| `--sa-color-warning-surface`               | `var(--sa-amber-50)`                                                           | `color-mix(in srgb, var(--sa-amber-500) 14%, transparent)`                     |
| `--sa-color-warning-surface-strong`        | `var(--sa-amber-100)`                                                          | `color-mix(in srgb, var(--sa-amber-500) 24%, transparent)`                     |
| `--sa-color-warning-border`                | `var(--sa-amber-200)`                                                          | `color-mix(in srgb, var(--sa-amber-500) 36%, transparent)`                     |
| `--sa-color-negative`                      | `var(--sa-red-600)`                                                            | `var(--sa-red-500)`                                                            |
| `--sa-color-negative-strong`               | `var(--sa-red-500)`                                                            | `var(--sa-red-500)`                                                            |
| `--sa-color-negative-fg`                   | `var(--sa-red-700)`                                                            | `var(--sa-red-300)`                                                            |
| `--sa-color-negative-surface`              | `var(--sa-red-50)`                                                             | `color-mix(in srgb, var(--sa-red-500) 14%, transparent)`                       |
| `--sa-color-negative-surface-strong`       | `var(--sa-red-100)`                                                            | `color-mix(in srgb, var(--sa-red-500) 24%, transparent)`                       |
| `--sa-color-negative-border`               | `var(--sa-red-200)`                                                            | `color-mix(in srgb, var(--sa-red-500) 36%, transparent)`                       |
| `--sa-color-info`                          | `var(--sa-blue-600)`                                                           | `var(--sa-blue-500)`                                                           |
| `--sa-color-info-strong`                   | `var(--sa-blue-500)`                                                           | `var(--sa-blue-500)`                                                           |
| `--sa-color-info-fg`                       | `var(--sa-blue-700)`                                                           | `var(--sa-blue-200)`                                                           |
| `--sa-color-info-surface`                  | `var(--sa-blue-50)`                                                            | `color-mix(in srgb, var(--sa-blue-500) 14%, transparent)`                      |
| `--sa-color-info-surface-strong`           | `var(--sa-blue-100)`                                                           | `color-mix(in srgb, var(--sa-blue-500) 24%, transparent)`                      |
| `--sa-color-info-border`                   | `var(--sa-blue-200)`                                                           | `color-mix(in srgb, var(--sa-blue-500) 36%, transparent)`                      |
| `--sa-color-scheduled`                     | `var(--sa-indigo-700)`                                                         | `var(--sa-indigo-400)`                                                         |
| `--sa-color-scheduled-strong`              | `var(--sa-indigo-400)`                                                         | `var(--sa-indigo-400)`                                                         |
| `--sa-color-scheduled-fg`                  | `var(--sa-indigo-700)`                                                         | `var(--sa-indigo-200)`                                                         |
| `--sa-color-scheduled-surface`             | `var(--sa-indigo-50)`                                                          | `color-mix(in srgb, var(--sa-indigo-400) 14%, transparent)`                    |
| `--sa-color-scheduled-surface-strong`      | `var(--sa-indigo-100)`                                                         | `color-mix(in srgb, var(--sa-indigo-400) 24%, transparent)`                    |
| `--sa-color-scheduled-border`              | `var(--sa-indigo-200)`                                                         | `color-mix(in srgb, var(--sa-indigo-400) 36%, transparent)`                    |
| `--sa-color-feature`                       | `var(--sa-violet-500)`                                                         | `var(--sa-violet-500)`                                                         |
| `--sa-color-feature-fg`                    | `var(--sa-violet-700)`                                                         | `var(--sa-violet-200)`                                                         |
| `--sa-color-feature-surface`               | `var(--sa-violet-50)`                                                          | `color-mix(in srgb, var(--sa-violet-500) 16%, transparent)`                    |
| `--sa-color-quota`                         | `var(--sa-sky-500)`                                                            | `var(--sa-sky-500)`                                                            |
| `--sa-color-quota-fg`                      | `var(--sa-sky-700)`                                                            | `var(--sa-sky-200)`                                                            |
| `--sa-color-quota-surface`                 | `var(--sa-sky-50)`                                                             | `color-mix(in srgb, var(--sa-sky-500) 16%, transparent)`                       |
| `--sa-color-quota-border`                  | `var(--sa-sky-200)`                                                            | `color-mix(in srgb, var(--sa-sky-500) 36%, transparent)`                       |
| `--sa-color-bundle`                        | `var(--sa-amber-500)`                                                          | `var(--sa-amber-500)`                                                          |
| `--sa-color-bundle-fg`                     | `var(--sa-amber-700)`                                                          | `var(--sa-amber-200)`                                                          |
| `--sa-color-bundle-surface`                | `var(--sa-amber-100)`                                                          | `color-mix(in srgb, var(--sa-amber-500) 16%, transparent)`                     |
| `--sa-color-identity-1`                    | `var(--sa-blue-700)`                                                           | `var(--sa-blue-300)`                                                           |
| `--sa-color-identity-2`                    | `var(--sa-violet-700)`                                                         | `var(--sa-violet-200)`                                                         |
| `--sa-color-identity-3`                    | `var(--sa-green-700)`                                                          | `var(--sa-green-200)`                                                          |
| `--sa-color-identity-4`                    | `var(--sa-amber-700)`                                                          | `var(--sa-amber-300)`                                                          |
| `--sa-color-identity-5`                    | `var(--sa-sky-700)`                                                            | `var(--sa-sky-200)`                                                            |
| `--sa-color-identity-6`                    | `var(--sa-red-700)`                                                            | `var(--sa-red-300)`                                                            |
| `--sa-color-identity-neutral`              | `var(--sa-neutral-500)`                                                        | `var(--sa-neutral-400)`                                                        |
| `--sa-color-inverse-bg`                    | `var(--sa-neutral-950)`                                                        | `var(--sa-neutral-950)`                                                        |
| `--sa-color-inverse-surface`               | `var(--sa-neutral-800)`                                                        | `var(--sa-neutral-800)`                                                        |
| `--sa-color-inverse-surface-soft`          | `var(--sa-neutral-600)`                                                        | `var(--sa-neutral-600)`                                                        |
| `--sa-color-inverse-fg`                    | `var(--sa-white)`                                                              | `var(--sa-white)`                                                              |
| `--sa-color-inverse-fg-muted`              | `var(--sa-neutral-300)`                                                        | `var(--sa-neutral-300)`                                                        |
| `--sa-color-inverse-accent`                | `var(--sa-amber-400)`                                                          | `var(--sa-amber-400)`                                                          |
| `--sa-color-inverse-accent-strong`         | `var(--sa-amber-600)`                                                          | `var(--sa-amber-600)`                                                          |
| `--sa-color-inverse-accent-surface`        | `color-mix(in srgb, var(--sa-amber-500) 15%, transparent)`                     | `color-mix(in srgb, var(--sa-amber-500) 15%, transparent)`                     |
| `--sa-color-inverse-accent-surface-strong` | `color-mix( in srgb, var(--sa-amber-500) 22%, transparent )`                   | `color-mix( in srgb, var(--sa-amber-500) 22%, transparent )`                   |
| `--sa-color-inverse-accent-fg`             | `var(--sa-neutral-900)`                                                        | `var(--sa-neutral-900)`                                                        |
| `--sa-color-inverse-danger`                | `var(--sa-red-700)`                                                            | `var(--sa-red-700)`                                                            |
| `--sa-color-inverse-danger-strong`         | `var(--sa-red-600)`                                                            | `var(--sa-red-600)`                                                            |
| `--sa-color-inverse-notice`                | `var(--sa-amber-600)`                                                          | `var(--sa-amber-600)`                                                          |
| `--sa-color-inverse-notice-strong`         | `var(--sa-amber-700)`                                                          | `var(--sa-amber-700)`                                                          |
| `--sa-color-inverse-fg-subtle`             | `color-mix(in srgb, var(--sa-white) 55%, transparent)`                         | `color-mix(in srgb, var(--sa-white) 55%, transparent)`                         |
| `--sa-color-inverse-border`                | `color-mix(in srgb, var(--sa-white) 8%, transparent)`                          | `color-mix(in srgb, var(--sa-white) 8%, transparent)`                          |
| `--sa-color-inverse-border-strong`         | `color-mix(in srgb, var(--sa-white) 16%, transparent)`                         | `color-mix(in srgb, var(--sa-white) 16%, transparent)`                         |
| `--sa-color-focus-ring`                    | `color-mix(in srgb, var(--sa-color-accent) 35%, transparent)`                  | `color-mix(in srgb, var(--sa-color-accent) 45%, transparent)`                  |
| `--sa-color-selection`                     | `color-mix(in srgb, var(--sa-color-accent) 22%, transparent)`                  | `color-mix(in srgb, var(--sa-color-accent) 30%, transparent)`                  |
| `--sa-shadow-ink`                          | `var(--sa-neutral-900)`                                                        | `var(--sa-black)`                                                              |
| `--sa-shadow-tint-1`                       | `color-mix(in srgb, var(--sa-shadow-ink) 6%, transparent)`                     | `color-mix(in srgb, var(--sa-shadow-ink) 24%, transparent)`                    |
| `--sa-shadow-tint-2`                       | `color-mix(in srgb, var(--sa-shadow-ink) 8%, transparent)`                     | `color-mix(in srgb, var(--sa-shadow-ink) 32%, transparent)`                    |
| `--sa-shadow-tint-3`                       | `color-mix(in srgb, var(--sa-shadow-ink) 12%, transparent)`                    | `color-mix(in srgb, var(--sa-shadow-ink) 44%, transparent)`                    |
| `--sa-shadow-tint-4`                       | `color-mix(in srgb, var(--sa-shadow-ink) 20%, transparent)`                    | `color-mix(in srgb, var(--sa-shadow-ink) 60%, transparent)`                    |
| `--sa-shadow-0`                            | `none`                                                                         | `none`                                                                         |
| `--sa-shadow-1`                            | `0 1px 2px var(--sa-shadow-tint-1)`                                            | `0 1px 2px var(--sa-shadow-tint-1)`                                            |
| `--sa-shadow-2`                            | `0 2px 6px var(--sa-shadow-tint-2)`                                            | `0 2px 6px var(--sa-shadow-tint-2)`                                            |
| `--sa-shadow-3`                            | `0 8px 20px var(--sa-shadow-tint-3)`                                           | `0 8px 20px var(--sa-shadow-tint-3)`                                           |
| `--sa-shadow-4`                            | `0 20px 48px var(--sa-shadow-tint-4)`                                          | `0 20px 48px var(--sa-shadow-tint-4)`                                          |
| `--sa-shadow-focus`                        | `0 0 0 3px var(--sa-color-focus-ring)`                                         | `0 0 0 3px var(--sa-color-focus-ring)`                                         |
| `--sa-elevation-tile`                      | `var(--sa-shadow-1)`                                                           | `var(--sa-shadow-1)`                                                           |
| `--sa-elevation-card`                      | `var(--sa-shadow-2)`                                                           | `var(--sa-shadow-2)`                                                           |
| `--sa-elevation-menu`                      | `var(--sa-shadow-3)`                                                           | `var(--sa-shadow-3)`                                                           |
| `--sa-elevation-dialog`                    | `var(--sa-shadow-4)`                                                           | `var(--sa-shadow-4)`                                                           |
