---
'@saasicat/cli': minor
---

Rename the CLI binary from `saas-platform` to `saasicat`.

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
