# Maintaining releases

For maintainers with an npm login. Everything else about a release happens in the release workflow
(`release.yml`), which runs on every push to `main` and publishes whatever the merged changesets
produce. How to write a changeset and which level to pick is in
[CONTRIBUTING.md](../../CONTRIBUTING.md#versioning-and-releases-changesets-fixed-group).

Every step below ends on the npm registry, and **a published version cannot be taken back.**

## The release line

All packages form one Changesets fixed group. It is in pre mode with the tag `rc`, recorded in
`.changeset/pre.json` and opened by `pnpm changeset pre enter rc`; every changeset level releases
the next `1.0.0-rc.N`.

`pnpm changeset pre exit` leaves pre mode, and the next release is the stable `1.0.0`. That is the
maintainer's decision (#339), taken once and deliberately — never as part of an ordinary change.

## A new package needs one manual first publish

The release workflow publishes through npm trusted publishing (GitHub OIDC, no token). That works
only for a package that exists on npm and lists this repository's release workflow as its trusted
publisher; it cannot _create_ one. The registry answers the first `PUT` with `404`, the run fails,
and every other package in the group is published regardless.

So adding a package to the fixed group takes one step outside the repository, done once by a
maintainer with an npm login before the first release that contains the package:

```bash
pnpm -r build                    # no package builds itself on publish
cd packages/<package>
# The version the RELEASE will carry, read off the open version PR — not
# whatever this branch happens to say. `pnpm publish` ships the manifest as it
# finds it, and this edit is for the tarball only: it is put back below, and
# never committed, where it would fight the bump Changesets makes.
npm pkg set version=1.0.0-rc.<N>
pnpm publish --access public --tag rc --no-git-checks
git checkout -- package.json
```

Each line is there for a reason:

- **The build.** No package here has `prepublishOnly`, `prepack` or `prepare`, so publishing from a
  fresh clone packs an empty `dist/` and puts out a version that exports nothing.
- **The version.** Read it off the open version PR, not off `packages/<package>/package.json` on
  your branch. Publish what the branch says, and the release still finds its own target version
  absent: its first `PUT` is still a create and still fails, and the registry holds a second
  version nobody wanted. This edit is the one time a `version` field is touched by hand, and it is
  never committed.
- **`pnpm publish`, never `npm publish`.** Every package depends on its siblings through
  `workspace:^`, a protocol only the workspace understands: pnpm replaces it with the concrete
  version while it packs, npm ships it verbatim. A tarball carrying
  `"@saasicat/core": "workspace:^"` installs nowhere — `pnpm install` answers
  `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` in any other repository. npm refuses to delete a package's only
  version, so such a tarball can only be superseded and deprecated.
  `tests/a-first-publish-resolves-its-workspace-deps.test.js` holds this instruction to what the
  packages actually depend on, so it does not outlive its reason.
- **`--tag rc`** while the group is in pre mode, and no `--tag` otherwise.
- **`--no-git-checks`**, because the version line leaves the tree dirty on purpose, and pnpm's
  default refusal (`ERR_PNPM_GIT_UNCLEAN`) would land on the one command that matters.
- **`git checkout`** puts the manifest back. It answers `pathspec … did not match any file(s)` when
  the manifest is not tracked yet — publishing from the branch that adds the package. The publish
  has happened either way; put the temporary version back by hand.

Then check the registry:

- `npm view <package>@<version>` can answer `404` for about a quarter of an hour after a successful
  publish. Verify against the registry before saying the version is there, and verify its
  `dependencies` while you are at it.
- Do not rely on the registry pointing `latest` at the first version. Read `dist-tags` and add the
  one that is missing: until its first stable release, a package that never had a regular release
  sits at `latest` and `rc` on the newest candidate, which is where Changesets puts it on every
  release. Without `latest`, `npm install @saasicat/<package>` answers
  `ETARGET No matching version found`.

    ```bash
    npm dist-tag add @saasicat/<package>@<version> <tag>
    ```

### Set the trusted publisher for the release that will use it

On npmjs.com → the package → Settings → Trusted Publisher, enter this repository and the workflow
`release.yml`. Under "Allowed actions", allow `npm publish` as well: the workflow publishes
directly, and a new configuration always allows `npm stage publish` but leaves direct publishing to
your choice.

npm expires a new configuration that has not completed a publish within two days
([trusted publishers](https://docs.npmjs.com/trusted-publishers/)), and a hand-published version
validates nothing — the release that carries it skips the package as already published. So set the
configuration up for the first release that publishes the package itself, the one after the
release carrying the hand-published version: create it, or delete and recreate one that has lapsed,
within the two days before merging that release's version PR, and read the run's log for the
package.

Without a valid configuration the package's publish fails after every other package is published:
the registry answers `E404` on its `PUT`, and npm names `ENEEDAUTH` for a configuration whose
repository or workflow does not match. Changesets treats an already-published version as done, so
the repair is to publish the version the run wanted by hand, as above, and re-run the failed job —
and, since that publish validates nothing either, to set the configuration up again within the two
days before the next release that publishes the package itself.

## Move `rc` after each candidate release

Until a package's first stable release, Changesets in pre mode publishes a package that never had a
regular release to the `latest` dist-tag instead of the pre-release tag, so its `rc` keeps pointing
at the previous candidate. After each candidate release, move the tag by hand for each such package:

```bash
npm dist-tag add @saasicat/<package>@<version> rc
```

Otherwise `pnpm add @saasicat/*@rc` installs a mixed set of candidates. The workflow's OIDC token
can publish but not tag, which is why this is not automated.

The consumer-facing account of the break is [Upgrade to 1.0](upgrade-to-1.0.md), and the codemod it
names is `saasicat codemod v1`.
