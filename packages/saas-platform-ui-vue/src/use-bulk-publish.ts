// useBulkPublish — Bulk-Publish-Modal-Orchestration.
//
// SuperAdmin wählt N Drafts aus der Versions-Page-Liste, gibt eine gemeinsame
// `changeNote` ein und triggert den Publish. Die Plattform-Composable führt
// die Publishes **parallel** aus und tracked pro Draft den Status (pending/
// publishing/published/failed) — das Modal rendert eine Live-Tabelle mit
// Fortschrittsbalken pro Item.
//
// Was die Plattform NICHT macht: TOTP-Code-Eingabe + MFA-Header-Setzen.
// Das tut die Konsumenten-Shell (Quasar-Modal o. ä.) und reicht den
// `mfaCode`-Parameter durch.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.6 (4.12).

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from './types.js';

export type BulkItemKind = 'plan';

export type BulkItemStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface BulkPublishItem {
    /** Composite-ID: `<kind>:<draftId>`. Eindeutig im Bulk-Set. */
    key: string;
    kind: BulkItemKind;
    draftId: string;
    /** Anzeige-Label im Modal (z. B. "STANDARD v3"). */
    label: string;
    status: BulkItemStatus;
    error?: string;
    /** Server-Antwort bei status='published'. */
    result?: unknown;
}

export interface UseBulkPublishOptions {
    /**
     * Endpoint-Mapping je Kind. **Pflicht** — Plattform kennt den
     * App-globalPrefix nicht (AutohausPro: `/api/admin/...`, vereinsfux:
     * `/api/v1/admin/...`), Konsumenten liefern daher die volle URL je Kind.
     */
    endpoints: Record<BulkItemKind, (draftId: string) => string>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
}

export interface UseBulkPublishResult {
    items: Ref<BulkPublishItem[]>;
    /** Anteil bereits abgeschlossener Items (0..1). */
    progress: ComputedRef<number>;
    /** Liefert `true`, sobald alle Items entweder `published` oder `failed` sind. */
    done: ComputedRef<boolean>;
    /** Anzahl erfolgreicher Publishes. */
    successCount: ComputedRef<number>;
    /** Anzahl fehlgeschlagener Publishes. */
    failureCount: ComputedRef<number>;
    /** Setzt das Bulk-Set neu — z. B. nach Modal-Open. */
    setItems: (items: Array<Omit<BulkPublishItem, 'status'>>) => void;
    /**
     * Triggert den Bulk-Publish. `changeNote` ist Pflicht für alle
     * Drafts; `mfaCode` ist optional, wird im `X-Mfa-Code`-Header
     * gesendet wenn vorhanden.
     */
    run: (input: { changeNote: string; mfaCode?: string }) => Promise<void>;
}

export function useBulkPublish(options: UseBulkPublishOptions): UseBulkPublishResult {
    if (!options?.endpoints) {
        throw new Error(
            'useBulkPublish: `endpoints` ist Pflicht (Mapping plan → URL-Builder). ' +
                'Plattform hat keinen Default, weil Apps unterschiedliche ' +
                'globalPrefix-Konventionen haben.',
        );
    }
    const http = options.http ?? defaultHttpClient();
    const endpoints = options.endpoints;
    const items = ref<BulkPublishItem[]>([]) as Ref<BulkPublishItem[]>;

    const successCount = computed(() => items.value.filter((i) => i.status === 'published').length);
    const failureCount = computed(() => items.value.filter((i) => i.status === 'failed').length);
    const progress = computed(() => {
        if (items.value.length === 0) return 0;
        const done = successCount.value + failureCount.value;
        return done / items.value.length;
    });
    const done = computed(
        () =>
            items.value.length > 0 &&
            items.value.every((i) => i.status === 'published' || i.status === 'failed'),
    );

    function setItems(next: Array<Omit<BulkPublishItem, 'status'>>): void {
        items.value = next.map((i) => ({ ...i, status: 'pending' as BulkItemStatus }));
    }

    async function publishOne(
        item: BulkPublishItem,
        body: { changeNote: string },
        mfaCode?: string,
    ): Promise<void> {
        item.status = 'publishing';
        try {
            const url = endpoints[item.kind](item.draftId);
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;
            if (mfaCode) headers['X-Mfa-Code'] = mfaCode;
            const res = await http(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            if (res.status >= 200 && res.status < 300) {
                item.result = await res.json();
                item.status = 'published';
            } else {
                item.error = `HTTP ${res.status}: ${await res.text()}`;
                item.status = 'failed';
            }
        } catch (err) {
            item.error = err instanceof Error ? err.message : String(err);
            item.status = 'failed';
        }
    }

    async function run(input: { changeNote: string; mfaCode?: string }): Promise<void> {
        const note = input.changeNote.trim();
        if (note.length === 0) {
            // Markiere alle Items als failed mit klarer Begründung.
            for (const item of items.value) {
                item.status = 'failed';
                item.error = 'changeNote ist Pflicht beim Publish.';
            }
            return;
        }
        // Parallele Publishes — Server enforct Optimistic-Lock pro Draft.
        await Promise.all(
            items.value.map((item) => publishOne(item, { changeNote: note }, input.mfaCode)),
        );
    }

    return {
        items,
        progress,
        done,
        successCount,
        failureCount,
        setItems,
        run,
    };
}
