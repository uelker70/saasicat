// The text a person reads on each page of a rendered invoice, as a PDF reader
// extracts it: each run of glyphs mapped back to characters through the
// ToUnicode table of the font it is set in, where it stands, and how wide it
// is by the widths the font declares. Enough for the files this renderer
// writes — one run per `Tj` after its `Tf` and `Tm`, a font's table as
// `bfchar` entries, its widths as `[first [w …]]` groups — and nothing more.

import { PDFArray, PDFDict, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

const text = (stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode());

/** A ToUnicode table's `bfchar` entries: `<0001> <0041>` maps glyph 1 to `A`. */
function unicodeOf(cmap) {
    const map = new Map();
    let inside = false;
    for (const line of cmap.split('\n')) {
        if (line.endsWith('beginbfchar')) inside = true;
        else if (line === 'endbfchar') inside = false;
        else if (inside) {
            const [glyph, unicode] = line.split(' ').map((hex) => hex.slice(1, -1));
            map.set(parseInt(glyph, 16), String.fromCodePoint(parseInt(unicode, 16)));
        }
    }
    return map;
}

/** A CID font's `W` array, `[first [w1 w2 …] …]`: glyph `first + i` is `wi` thousandths of the size wide. */
function widthsOf(array) {
    const widths = new Map();
    for (let index = 0; index < array.size(); index += 2) {
        const first = array.lookup(index).asNumber();
        const group = array.lookup(index + 1, PDFArray);
        group.asArray().forEach((_, offset) => {
            widths.set(first + offset, group.lookup(offset).asNumber());
        });
    }
    return widths;
}

/** Every page's runs of text, top of the content to the bottom: what each says, where it starts and how wide it is. */
export async function pageRuns(bytes) {
    const pdf = await PDFDocument.load(bytes);
    return pdf.getPages().map((page) => {
        const fonts = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
        const known = new Map();
        for (const [name] of fonts.entries()) {
            const font = fonts.lookup(name, PDFDict);
            const descendant = font
                .lookup(PDFName.of('DescendantFonts'), PDFArray)
                .lookup(0, PDFDict);
            known.set(name.asString(), {
                characters: unicodeOf(text(font.lookup(PDFName.of('ToUnicode')))),
                widths: widthsOf(descendant.lookup(PDFName.of('W'), PDFArray)),
            });
        }
        const contents = page.node.Contents();
        const streams =
            contents instanceof PDFArray
                ? contents.asArray().map((_, index) => contents.lookup(index))
                : [contents];
        const runs = [];
        let font;
        let size;
        let at;
        for (const line of streams.map(text).join('\n').split('\n')) {
            const parts = line.split(' ');
            if (line.endsWith(' Tf')) [font, size] = [known.get(parts[0]), Number(parts[1])];
            if (line.endsWith(' Tm')) at = { x: Number(parts[4]), y: Number(parts[5]) };
            if (line.startsWith('<') && line.endsWith('> Tj')) {
                const hex = line.slice(1, -4);
                let run = '';
                let width = 0;
                for (let index = 0; index < hex.length; index += 4) {
                    const glyph = parseInt(hex.slice(index, index + 4), 16);
                    run += font.characters.get(glyph) ?? '\uFFFD';
                    width += ((font.widths.get(glyph) ?? 0) * size) / 1000;
                }
                runs.push({ text: run, x: at.x, y: at.y, size, width });
            }
        }
        return runs;
    });
}

/** Every page's runs of text, top of the content to the bottom. */
export async function pageTexts(bytes) {
    return (await pageRuns(bytes)).map((runs) => runs.map((run) => run.text));
}
