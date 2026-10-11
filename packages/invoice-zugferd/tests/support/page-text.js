// The text a person reads on each page of a rendered invoice, as a PDF reader
// extracts it: each run of glyphs mapped back to characters through the
// ToUnicode table of the font it is set in. Enough for the files this renderer
// writes — one run per `Tj`, a font's table as `bfchar` entries — and nothing
// more.

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

/** Every page's runs of text, top of the content to the bottom. */
export async function pageTexts(bytes) {
    const pdf = await PDFDocument.load(bytes);
    return pdf.getPages().map((page) => {
        const fonts = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
        const maps = new Map();
        for (const [name] of fonts.entries()) {
            const font = fonts.lookup(name, PDFDict);
            maps.set(name.asString(), unicodeOf(text(font.lookup(PDFName.of('ToUnicode')))));
        }
        const contents = page.node.Contents();
        const streams =
            contents instanceof PDFArray
                ? contents.asArray().map((_, index) => contents.lookup(index))
                : [contents];
        const runs = [];
        let font;
        for (const line of streams.map(text).join('\n').split('\n')) {
            if (line.endsWith(' Tf')) font = maps.get(line.split(' ')[0]);
            if (line.startsWith('<') && line.endsWith('> Tj')) {
                const hex = line.slice(1, -4);
                let run = '';
                for (let at = 0; at < hex.length; at += 4) {
                    run += font.get(parseInt(hex.slice(at, at + 4), 16)) ?? '�';
                }
                runs.push(run);
            }
        }
        return runs;
    });
}
