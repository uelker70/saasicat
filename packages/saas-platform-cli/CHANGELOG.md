# @saasicat/cli

## 0.18.1

### Patch Changes

- @saasicat/spec@0.18.1
- @saasicat/types@0.18.1
- @saasicat/nest@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/spec@0.18.0
- @saasicat/types@0.18.0
- @saasicat/nest@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/nest@0.17.0
    - @saasicat/types@0.17.0
    - @saasicat/spec@0.17.0

## 0.16.0

### Patch Changes

- @saasicat/spec@0.16.0
- @saasicat/types@0.16.0
- @saasicat/nest@0.16.0

## 0.15.1

### Patch Changes

- Updated dependencies [de0fc7c]
    - @saasicat/nest@0.15.1
    - @saasicat/spec@0.15.1
    - @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [c970673]
    - @saasicat/nest@0.15.0
    - @saasicat/spec@0.15.0
    - @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [76d99a5]
    - @saasicat/nest@0.14.0
    - @saasicat/spec@0.14.0
    - @saasicat/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0
    - @saasicat/nest@0.13.0
    - @saasicat/spec@0.13.0

## 0.12.1

### Patch Changes

- da8aa64: Fix four parsing defects in `schema check`, all found by review of the previous
  two releases. Each let the check pass on a schema it should have flagged, or
  skip a declaration it should have compared.

    **Commented-out block attributes counted as present.** A consumer with
    `// @@unique([tenantId])` or `// @@map("subscriptions")` was reported `ok`,
    defeating exactly the correctness gate those attributes exist for. Attribute
    parsing now strips comments first. A production consumer had consequently
    never applied its canonical partial unique indexes at all.

    **A brace inside a string literal closed the model early.** `@default("}")`
    counted as structure, so every field below it looked missing — or spec fields
    after it were silently dropped and the check returned a false success. Brace
    counting now blanks string contents. `stripLineComment` became string-aware in
    the same move, so `@default("http://x")` no longer loses everything after `//`.

    **Indexed field arguments were skipped entirely.** In
    `@@index([title(sort: Desc)])` the capture stopped at the argument's closing
    paren before reaching `]`, so the index never entered the parsed set and a
    consumer lacking it got no finding. The field list is now matched to its
    closing bracket.

    **Unknown fragment selectors were silently discarded.** `--fragments=01,99`
    checked only fragment 01 and exited 0, so a typo in a CI gate left part of the
    schema surface unverified. Unknown selectors now fail with the available list.
    - @saasicat/spec@0.12.1
    - @saasicat/types@0.12.1
    - @saasicat/nest@0.12.1

## 0.12.0

### Minor Changes

- c78e1f0: `schema check` now compares block-level attributes too — `@@index`, `@@unique`
  and `@@map`.

    Comparing only fields and enum values left a whole class of divergence
    invisible. Multiple consumer schemas were missing declared indexes while
    still reporting "no drift". Worse, the same blind spot hid a missing
    `@@unique`: nothing in the field comparison can tell you that a constraint
    the platform relies on was never created.

    The two kinds are not treated alike. A missing index costs query time but
    breaks nothing, so it is reported as information and does not fail the run. A
    missing `@@unique` or a diverging `@@map` does fail: the platform relies on the
    constraint holding, and on finding the table under its canonical name.

    Attribute options and whitespace are normalised, so `@@index([a,b], map: "x")`
    matches `@@index([a, b])`. Indexes a consumer adds on top are never reported —
    same rule as for fields.

    Note the remaining gap: constraints Prisma's DSL cannot express at all (the
    partial unique indexes in `sql/constraints.postgres.sql`) still live outside
    any schema comparison. Consumers must apply them separately.

### Patch Changes

- @saasicat/spec@0.12.0
- @saasicat/types@0.12.0
- @saasicat/nest@0.12.0

## 0.11.0

### Minor Changes

- bded377: Rename the CLI binary from `saas-platform` to `saasicat`.

    **Breaking for anyone invoking the binary by name.** `pnpm exec saas-platform …`
    becomes `pnpm exec saasicat …`. No alias is kept: the audited integrations
    use `@saasicat/cli` as a library for their `nest-commander` commands and ship
    their own binary.

    The old name was the last user-facing place where the package still announced
    itself as "saas-platform" while shipping as `@saasicat/cli`, which made it
    easy to confuse this framework with superseded `saas-platform-*` packages.
    The header comment `schema apply` writes into a consumer's `schema.prisma`
    now names `saasicat schema apply` too.

    Deliberately unchanged: the DI token namespace (`Symbol.for('saas-platform/…')`,
    `Symbol.for('saas-platform-cli/…')`). Those strings are identity, not
    branding — renaming them would break token equality between package versions.
    CONTRIBUTING.md documents the namespace as historical.

- bded377: Add `saasicat schema check` — reports what a consumer's `schema.prisma`
  is missing relative to the canonical prisma-fragments, and exits 1 on drift so
  CI can gate on it.

    `schema apply` only ever adds whole models: it carries no enums, and a model
    that already exists is skipped rather than updated. After a package upgrade a
    consumer schema therefore falls behind silently, and the gap only surfaces as a
    runtime error. Run against reference and consumer schemas, the new check
    finds missing `PlanVersion`/`BundleVersion` fields and field mismatches that
    were previously invisible.

    The check distinguishes two situations that look alike:

    - A field or enum value missing from a declaration the consumer **does** carry
      fails the check — platform code reads it with the spec's type. Type,
      optionality and list changes fail for the same reason.
    - A model or enum the consumer does not carry at all is reported as
      information. Not adopting a fragment is a decision, not drift.

    Fields a consumer adds on top of a platform model are never reported:
    extending them is supported, so a drift check has to tolerate it. Replacing a
    spec `String` with a locally declared enum stays allowed too — the fragments
    document that substitution explicitly.

    The block parser `schema apply` used moved to `prisma-blocks.ts` and now
    handles `enum` declarations as well; `extractModelNames`/`extractModelBlocks`
    keep their signatures.

### Patch Changes

- bded377: Align `PromoCode.createdById` with the types the platform already publishes, and
  stop `schema check` from flagging consumers that are stricter than the spec.

    The prisma fragment declared `createdById String` (NOT NULL) while
    `PromoCodeRecord.createdById` in `@saasicat/types` is `string | null` — the read
    contract explicitly allows a missing creator, so the column must too. Creation
    is unaffected: `CreatePromoCodeData.createdById` stays `string`. The fragment
    and the generated `reference-schema.postgres.sql` now say `String?` / `TEXT`.

    `schema check` treated nullability as a symmetric mismatch, which made this a
    zero-sum change: relaxing the spec simply moved the warning between consumer
    schemas. Only one direction can actually break — a consumer column that is
    nullable where the spec is not, because platform code reads it with the
    spec's non-null type and a NULL row reaches it as `null`. The reverse is a
    deliberate tightening by the consumer, and if the platform ever wrote NULL
    there the insert would fail loudly rather than silently. Only the breaking
    direction is reported now.

- Updated dependencies [bded377]
    - @saasicat/spec@0.11.0
    - @saasicat/types@0.11.0
    - @saasicat/nest@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [30ec6c6]
    - @saasicat/nest@0.10.1
    - @saasicat/spec@0.10.1
    - @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [7145f07]
    - @saasicat/nest@0.10.0
    - @saasicat/spec@0.10.0
    - @saasicat/types@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0
    - @saasicat/nest@0.9.0
    - @saasicat/spec@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/spec@0.8.0
    - @saasicat/types@0.8.0
    - @saasicat/nest@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/nest@0.7.0
    - @saasicat/spec@0.7.0
    - @saasicat/types@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [98274fe]
- Updated dependencies [0c08fc3]
    - @saasicat/spec@0.6.0
    - @saasicat/types@0.6.0
    - @saasicat/nest@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/spec@0.5.0
- @saasicat/types@0.5.0
- @saasicat/nest@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [5802454]
    - @saasicat/nest@0.4.0
    - @saasicat/spec@0.4.0
    - @saasicat/types@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0
    - @saasicat/spec@0.3.0
    - @saasicat/nest@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/spec@0.2.1
- @saasicat/types@0.2.1
- @saasicat/nest@0.2.1

## 0.2.0

### Patch Changes

- 32cca3b: Replace two backtracking-prone regexes with linear string scans (CodeQL `js/polynomial-redos`): the Prisma `//`-comment strip in `schema apply` and the trailing-slash trim of the billing `apiPrefix`. `@saasicat/ui-vue` now exports `trimTrailingSlashes`.
- Updated dependencies [db10ab9]
- Updated dependencies [c94b1fe]
    - @saasicat/spec@0.2.0
    - @saasicat/types@0.2.0
    - @saasicat/nest@0.2.0
