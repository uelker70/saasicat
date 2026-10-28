// A ZIP archive of files stored as they are, written so that the same files at
// the same moment give the same bytes: every entry carries the time it is
// given rather than when it was written, the entries stand in the order they
// are given, and nothing else — no extra field, no comment, no host — goes in.
// Stored rather than deflated because the bytes of a deflate stream are the
// library's, and a different zlib would write a different archive of the same
// files.
//
// The fields are those of the ZIP application note (PKWARE APPNOTE 6.3.10),
// sections 4.3.7 (local header), 4.3.12 (central directory) and 4.3.16 (end of
// central directory). Without ZIP64 an archive holds at most 65 535 entries
// and 4 GiB; a count, size or offset beyond its field is refused by the
// buffer's own range check with a `RangeError` rather than wrapped.

import { crc32 } from 'node:zlib';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
/** Version 2.0 of the format, made on MS-DOS: what reads a stored file with a DOS time. */
const VERSION = 20;
const STORED = 0;
/** The first year a DOS date can name; its seven bits count from it. */
const FIRST_DOS_YEAR = 1980;
/** 1 January 1980, 00:00: the earliest time a DOS date and time name. */
const EARLIEST_DOS_TIME = { time: 0, date: (1 << 5) | 1 };

/** A file of the archive: its name inside it and its bytes. */
export interface StoredZipEntry {
    name: string;
    content: Uint8Array;
}

/** A time as a ZIP entry carries it: a clock's reading, without a zone. */
export interface StoredZipTime {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

/**
 * `time` as MS-DOS writes it, in two-second steps. A time before 1980 takes the
 * earliest one DOS names: an entry's time says when a file is from, and an
 * archive that names its moment in a file of its own loses nothing by it. A
 * year after 2107 does not fit the field and is refused with it.
 */
function dosTimeOf(time: StoredZipTime): { time: number; date: number } {
    if (time.year < FIRST_DOS_YEAR) return EARLIEST_DOS_TIME;
    return {
        time: (time.hour << 11) | (time.minute << 5) | Math.floor(time.second / 2),
        date: ((time.year - FIRST_DOS_YEAR) << 9) | (time.month << 5) | time.day,
    };
}

/**
 * The archive of `entries`, in that order, each stored as it is and dated
 * `time`. Throws a `RangeError` for more entries, or more bytes, than an
 * archive without ZIP64 holds.
 */
export function storedZipOf(entries: readonly StoredZipEntry[], time: StoredZipTime): Buffer {
    const { time: dosTime, date: dosDate } = dosTimeOf(time);
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const size = entry.content.byteLength;
        const checksum = crc32(entry.content);

        const local = Buffer.alloc(LOCAL_HEADER_BYTES);
        local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
        local.writeUInt16LE(VERSION, 4);
        // General purpose flags: none — the names are ASCII.
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(STORED, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(size, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(name.byteLength, 26);
        local.writeUInt16LE(0, 28);

        const central = Buffer.alloc(CENTRAL_HEADER_BYTES);
        central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
        central.writeUInt16LE(VERSION, 4);
        central.writeUInt16LE(VERSION, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(STORED, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(size, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(name.byteLength, 28);
        // Extra field, comment, disk number, internal and external attributes: none.
        central.writeUInt32LE(offset, 42);

        locals.push(local, name, Buffer.from(entry.content));
        centrals.push(central, name);
        offset += LOCAL_HEADER_BYTES + name.byteLength + size;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_BYTES);
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.byteLength, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}
