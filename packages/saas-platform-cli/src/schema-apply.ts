// schema-apply — Pure-Function-Helpers für den `saas-platform schema apply`-
// Befehl. Fügt fehlende `model X { ... }`-Blöcke aus einem Prisma-Fragment
// idempotent in eine bestehende `schema.prisma` ein.
//
// Bewusst kein `@prisma/internals`-Dep: für das Quickstart-Feature reicht
// eine regex-basierte Model-Block-Erkennung. Constraints/Indices-Konflikte
// werden NICHT erkannt — User reviewt manuell, was die CLI eingefügt hat.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

/** Liefert die Namen aller `model X { ... }`-Top-Level-Blöcke im Schema. */
export function extractModelNames(schema: string): string[] {
    const names: string[] = [];
    const lines = schema.split('\n');
    for (const line of lines) {
        const stripped = line.replace(/\/\/.*$/, '').trim();
        const match = stripped.match(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
        if (match) names.push(match[1]);
    }
    return names;
}

/**
 * Liefert alle `model X { ... }`-Blöcke aus einem Fragment als Map
 * `Name -> kompletter Block-Text inkl. öffnender/schließender Klammern`.
 *
 * Begrenzungslogik: Wir suchen `^model X {` (Zeilenanfang, evtl. mit
 * Leading-Whitespace) und schließen, sobald die Klammer-Tiefe wieder auf
 * 0 fällt. Strings/Kommentare innerhalb des Blocks zählen vereinfacht
 * nicht, was für Prisma-Schemas robust ist (keine geschweiften Klammern
 * in Strings, Kommentare nur `//`-style).
 */
export function extractModelBlocks(fragment: string): Map<string, string> {
    const blocks = new Map<string, string>();
    const lines = fragment.split('\n');
    let current: { name: string; lines: string[]; depth: number } | null = null;

    for (const rawLine of lines) {
        const stripped = rawLine.replace(/\/\/.*$/, '');
        if (!current) {
            const match = rawLine.match(/^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
            if (match) {
                const openCount = (stripped.match(/\{/g) ?? []).length;
                const closeCount = (stripped.match(/\}/g) ?? []).length;
                current = { name: match[1], lines: [rawLine], depth: openCount - closeCount };
                if (current.depth === 0) {
                    blocks.set(current.name, current.lines.join('\n'));
                    current = null;
                }
            }
            continue;
        }
        current.lines.push(rawLine);
        current.depth += (stripped.match(/\{/g) ?? []).length;
        current.depth -= (stripped.match(/\}/g) ?? []).length;
        if (current.depth <= 0) {
            blocks.set(current.name, current.lines.join('\n'));
            current = null;
        }
    }
    return blocks;
}

export interface ApplyResult {
    /** Anzahl Models, die hinzugefügt wurden. */
    added: string[];
    /** Anzahl Models, die schon vorhanden waren (kein Schreiben). */
    skipped: string[];
    /** Resultierender Schema-Text. Bei `added.length === 0` identisch zur Eingabe. */
    schema: string;
}

/**
 * Fügt fehlende Models aus `fragmentBlocks` ans Ende von `schema` an. Vorhandene
 * Models (gleicher Name) bleiben unverändert, werden in `skipped` gelistet.
 */
export function applyFragmentBlocks(
    schema: string,
    fragmentBlocks: Map<string, string>,
    options: { fragmentLabel?: string } = {},
): ApplyResult {
    const existing = new Set(extractModelNames(schema));
    const added: string[] = [];
    const skipped: string[] = [];
    const additions: string[] = [];
    for (const [name, block] of fragmentBlocks) {
        if (existing.has(name)) {
            skipped.push(name);
        } else {
            added.push(name);
            additions.push(block);
        }
    }
    if (additions.length === 0) {
        return { added, skipped, schema };
    }
    const header = options.fragmentLabel
        ? `\n\n// ============================================================\n// Eingefügt durch \`saas-platform schema apply\` aus ${options.fragmentLabel}\n// ============================================================\n`
        : `\n\n// Eingefügt durch \`saas-platform schema apply\`\n`;
    const trimmedSchema = schema.endsWith('\n') ? schema : schema + '\n';
    return {
        added,
        skipped,
        schema: trimmedSchema + header + additions.join('\n\n') + '\n',
    };
}
