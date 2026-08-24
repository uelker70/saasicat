# Brand assets

The images used for the project's identity. Nothing in the code loads them —
they are here for READMEs, release posts and issue threads that want the mark.

| File               | Size     | What it is                                                   |
| ------------------ | -------- | ------------------------------------------------------------ |
| `hero.png`         | 1100×619 | Wide title image: wordmark, tagline, three capability tiles. |
| `brand-sheet.png`  | 1200×636 | Signet at four sizes, colour variants, mascot poses.         |
| `mascot.png`       | 640×640  | The mascot on its own, transparent background.               |
| `favicon.png`      | 512×512  | Signet with a light backdrop, for a browser tab.             |
| `favicon-flat.png` | 512×512  | The same signet without the backdrop.                        |

## Adding or replacing one

They are re-encoded, not exported straight from the generator: the five
together were 6.9 MB, which is more than the source of several packages, in a
repository that is cloned far more often than these are looked at. A 128-entry
palette costs nothing visible on flat two-colour artwork and takes the set to
381 KB.

```bash
pnpm dlx sharp-cli --input new.png --output docs/brands \
    -f png --palette --colors 128 -c 9 resize 1200
```

`tests/repository-carries-no-heavy-binaries.test.js` fails above 200 KB for any
tracked binary, so a forgotten re-encode does not reach `main`.

Licensing follows the repository — see [LICENSE](../../LICENSE).
