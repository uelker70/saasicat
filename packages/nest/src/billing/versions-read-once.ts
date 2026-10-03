// Reading the same add-on versions over and over: a retirement meets the same
// few versions for every subscription or booking it reaches.

import type { BundleRepository, BundleVersionRow } from '@saasicat/core';

type VersionSource = Pick<BundleRepository, 'findVersionById'>;

/** The versions `source` reads, each read once. */
export function onceEach(source: VersionSource): VersionSource;
export function onceEach(source: VersionSource | null): VersionSource | null;
export function onceEach(source: VersionSource | null): VersionSource | null {
    if (!source) return null;
    const read = new Map<string, Promise<BundleVersionRow | null>>();
    return {
        findVersionById(id: string) {
            const known = read.get(id);
            if (known) return known;
            const fresh = source.findVersionById(id);
            read.set(id, fresh);
            return fresh;
        },
    };
}
