// A TrueType font with every glyph's data padded to an even length, so that
// the subset of it pdf-lib embeds shows every glyph.
//
// fontkit, which pdf-lib subsets with, writes a subset's `loca` table in the
// short format wherever its offsets are small enough, and the short format
// stores each offset halved. A font whose glyph data has odd lengths — Roboto
// has nearly a thousand — then gets odd offsets halved and rounded, and every
// glyph after the first odd one is read from the wrong place: the page shows
// a few letters, and validators find nothing wrong with the file. Padding the
// data first makes every offset even. Nothing about a glyph changes: the
// padding lies after its data, where no outline reads.
//
// The renderer pads every font it embeds. Exported for an application that
// embeds a TrueType font with pdf-lib itself, which meets the same fault.
//
// A font without `glyf` — CFF outlines — is returned as it came.

/** Where a table lies in the font. */
interface TableRecord {
    tag: string;
    offset: number;
    length: number;
}

/** OpenType's checksum of a table: its big-endian 32-bit words, summed. */
function checksum(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let sum = 0;
    for (let at = 0; at < bytes.byteLength; at += 4) {
        // A table is padded to whole words with zeroes, which add nothing.
        let word = 0;
        for (let i = 0; i < 4; i += 1) {
            word = (word << 8) | (at + i < bytes.byteLength ? view.getUint8(at + i) : 0);
        }
        sum = (sum + (word >>> 0)) >>> 0;
    }
    return sum;
}

function tablesOf(font: Uint8Array): { view: DataView; tables: TableRecord[] } {
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const count = view.getUint16(4);
    const tables: TableRecord[] = [];
    for (let i = 0; i < count; i += 1) {
        const at = 12 + i * 16;
        tables.push({
            tag: String.fromCharCode(...font.subarray(at, at + 4)),
            offset: view.getUint32(at + 8),
            length: view.getUint32(at + 12),
        });
    }
    return { view, tables };
}

/** `font`, its glyph data padded to even lengths and its `loca` in the long format. */
export function withEvenGlyphs(font: Uint8Array): Uint8Array {
    const { view, tables } = tablesOf(font);
    const table = (tag: string) => tables.find((each) => each.tag === tag);
    const head = table('head');
    const maxp = table('maxp');
    const loca = table('loca');
    const glyf = table('glyf');
    if (!head || !maxp || !loca || !glyf) return font;

    const glyphs = view.getUint16(maxp.offset + 4);
    const longLoca = view.getInt16(head.offset + 50) === 1;
    const offsetOf = (index: number) =>
        longLoca
            ? view.getUint32(loca.offset + index * 4)
            : view.getUint16(loca.offset + index * 2) * 2;

    const pieces: Uint8Array[] = [];
    const offsets: number[] = [0];
    let length = 0;
    for (let index = 0; index < glyphs; index += 1) {
        const data = font.subarray(
            glyf.offset + offsetOf(index),
            glyf.offset + offsetOf(index + 1),
        );
        const padded = new Uint8Array(data.byteLength + (data.byteLength % 2));
        padded.set(data);
        pieces.push(padded);
        length += padded.byteLength;
        offsets.push(length);
    }
    const newGlyf = new Uint8Array(length);
    pieces.reduce((at, piece) => {
        newGlyf.set(piece, at);
        return at + piece.byteLength;
    }, 0);
    const newLoca = new Uint8Array(offsets.length * 4);
    const locaView = new DataView(newLoca.buffer);
    offsets.forEach((offset, index) => locaView.setUint32(index * 4, offset));
    // A copy: the caller's bytes stay as they were, and a Node `Buffer`'s
    // `slice` would share them.
    const newHead = new Uint8Array(font.subarray(head.offset, head.offset + head.length));
    const headView = new DataView(newHead.buffer, newHead.byteOffset, newHead.byteLength);
    headView.setInt16(50, 1);
    // Summed over the whole font once it is written, below.
    headView.setUint32(8, 0);

    const data = new Map<string, Uint8Array>(
        tables.map((each) => [each.tag, font.subarray(each.offset, each.offset + each.length)]),
    );
    data.set('glyf', newGlyf);
    data.set('loca', newLoca);
    data.set('head', newHead);

    return writeFont(font, tables, data);
}

/** A font of `data`, its tables in the order `tables` gives, with every checksum recomputed. */
function writeFont(
    original: Uint8Array,
    tables: TableRecord[],
    data: Map<string, Uint8Array>,
): Uint8Array {
    const directory = 12 + tables.length * 16;
    const padded = (size: number) => size + ((4 - (size % 4)) % 4);
    const size = tables.reduce(
        (sum, each) => sum + padded(data.get(each.tag)!.byteLength),
        directory,
    );
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    // The sfnt version and the search fields depend on the number of tables only.
    out.set(original.subarray(0, 12));

    let at = directory;
    let headAt = 0;
    tables.forEach((each, index) => {
        const bytes = data.get(each.tag)!;
        const record = 12 + index * 16;
        out.set(original.subarray(record, record + 4), record);
        view.setUint32(record + 4, checksum(bytes));
        view.setUint32(record + 8, at);
        view.setUint32(record + 12, bytes.byteLength);
        out.set(bytes, at);
        if (each.tag === 'head') headAt = at;
        at += padded(bytes.byteLength);
    });
    view.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
    return out;
}
