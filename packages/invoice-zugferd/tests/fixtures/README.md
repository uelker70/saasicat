# A font whose glyph data has odd lengths

`Roboto-Regular-odd-glyphs.ttf` is Roboto Regular 2.138 from the release
`fonts/README.md` names, cut down to Basic Latin, Latin-1 and a few signs, and
written without padding its glyph data, as the release itself is: 82 of its
212 glyphs have an odd length, so its `loca` table has the long format. It is
the kind of font pdf-lib's subsetting breaks, and an application may pass one.
The shipped fonts are not of that kind, because fontTools pads the glyph data
of a font small enough to use the short format. Apache License 2.0, `LICENSE`
beside it. With fontTools 4.60.1:

```python
from fontTools import subset
from fontTools.ttLib import TTFont

options = subset.Options()
options.layout_features = []
options.drop_tables += ['GSUB', 'GPOS', 'GDEF']
options.glyph_names = False
options.name_IDs = ['*']
options.name_languages = ['*']
options.notdef_outline = True
font = TTFont('Roboto-Regular.ttf')
subsetter = subset.Subsetter(options)
subsetter.populate(
    unicodes=[*range(0x20, 0x7F), *range(0xA0, 0x100), 0x2013, 0x2018, 0x2019,
              0x201C, 0x201D, 0x201E, 0x2026, 0x20AC],
)
subsetter.subset(font)
font['glyf'].padding = 0
font.save('Roboto-Regular-odd-glyphs.ttf')
```
