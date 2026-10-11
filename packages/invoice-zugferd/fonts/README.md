# Fonts

Roboto Regular and Bold, version 2.138, unhinted, from `roboto-unhinted.zip`
of the [googlefonts/roboto release v2.138][release] (tag commit `0e11861e`).
They are under the Apache License 2.0, whose text is `LICENSE` beside them;
later versions of Roboto moved to the SIL Open Font License, which the licence
check of this repository does not accept (`SC-SEC-012`).

The renderer embeds the glyphs an invoice uses into its PDF/A-3, which the
standard requires of every font a document shows.

## Changed from the release

These two files are not the published ones. They were cut down to the
characters a business letter in Latin, Greek or Cyrillic script needs, so that
each weighs about 130 KB instead of 350 KB:

- Basic Latin to Latin Extended-B, the IPA extensions, spacing modifiers and
  combining marks, and Latin Extended Additional (`U+0000`–`U+036F`,
  `U+1E00`–`U+1EFF`);
- Greek and Coptic, Cyrillic and its supplement (`U+0370`–`U+052F`);
- punctuation, super- and subscripts, currency, letterlike signs, number
  forms, arrows and mathematical operators (`U+2000`–`U+22FF`);
- the Latin ligatures as characters (`U+FB00`–`U+FB06`).

Polytonic Greek, the historic and phonetic extensions and the other scripts
Roboto covers are gone; the renderer shows a character neither font has as
`?`. The OpenType layout tables (`GSUB`, `GPOS`, `GDEF`) and the glyph names
are gone too: pdf-lib sets each character's own glyph at its own advance and
reads neither. Every outline, advance and name record that stayed is the
release's. With [fontTools] 4.60.1, from the release files:

```bash
pyftsubset Roboto-Regular.ttf \
    --unicodes='U+0000-052F,U+1E00-1EFF,U+2000-22FF,U+FB00-FB06' \
    --layout-features='' --no-layout-closure --drop-tables+=GSUB,GPOS,GDEF \
    --glyph-names=false --notdef-outline --name-IDs='*' --name-languages='*' \
    --output-file=fonts/Roboto-Regular.ttf
```

and the same for `Roboto-Bold.ttf`.

[release]: https://github.com/googlefonts/roboto/releases/tag/v2.138
[fontTools]: https://github.com/fonttools/fonttools
