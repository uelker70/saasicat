# @saasicat/cli

## 0.11.0

### Minor Changes

- bded377: Rename the CLI binary from `saas-platform` to `saasicat`.

    **Breaking for anyone invoking the binary by name.** `pnpm exec saas-platform …`
    becomes `pnpm exec saasicat …`. No alias is kept: nothing in this repo or in
    the known consumers (vereinsfux, autohauspro) calls the binary from a script,
    CI job or Dockerfile — both use `@saasicat/cli` as a library for its
    `nest-commander` commands and ship their own binary.

    The old name was the last user-facing place where the package still announced
    itself as "saas-platform" while shipping as `@saasicat/cli`, which made it
    easy to confuse this framework with the superseded `saas-platform-*` packages
    in the yada-services repo. The header comment `schema apply` writes into a
    consumer's `schema.prisma` now names `saasicat schema apply` too.

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
    runtime error. Run against the three schemas in this workspace, the new check
    finds five missing `PlanVersion`/`BundleVersion` fields in the NotesApp example
    itself, five in autohauspro, and two field mismatches in vereinsfux.

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
    zero-sum change: relaxing the spec simply moved the warning from vereinsfux to
    notesapp and autohauspro. Only one direction can actually break — a consumer
    column that is nullable where the spec is not, because platform code reads it
    with the spec's non-null type and a NULL row reaches it as `null`. The reverse
    is a deliberate tightening by the consumer, and if the platform ever wrote NULL
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
