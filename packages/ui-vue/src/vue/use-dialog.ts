import { nextTick, onScopeDispose, ref, useId, watch, type Ref } from 'vue';

/**
 * The tabbable descendants of a panel, in document order.
 *
 * A selector list rather than a scan: `querySelectorAll` already walks the tree
 * in order, and the four control elements plus anything carrying an explicit
 * `tabindex` is what a dialog in this repository contains.
 *
 * Visibility is deliberately NOT part of it. Every way to ask a browser whether
 * an element is visible (`offsetParent`, `getClientRects`, `checkVisibility`)
 * answers from layout, and jsdom has none — the trap would then be untestable
 * at the level that proves it. What the dialogs here hide, they hide with
 * `v-if`, so a hidden control is not in the tree to begin with.
 */
const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * How many dialogs currently hold the scroll lock, and what `overflow` said
 * before the first of them took it.
 *
 * A counter rather than a boolean because closing an inner dialog must not give
 * the page back its scrollbar while an outer one is still open — the visible
 * symptom is the page jumping as the inner dialog closes.
 */
let scrollLocks = 0;
let overflowBeforeLock = '';

function lockScroll(): void {
    if (scrollLocks === 0) {
        overflowBeforeLock = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    scrollLocks += 1;
}

function unlockScroll(): void {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = overflowBeforeLock;
}

export interface UseDialogOptions {
    /** Whether the dialog is open. A getter, so the caller keeps the state. */
    open: () => boolean;
    /** The dialog asking to be closed — escape, or a click on the backdrop. */
    onClose: () => void;
    /**
     * Neither escape nor the backdrop closes it. For a dialog mid-request: the
     * request lands either way, and the user is left not knowing whether it did.
     */
    persistent?: () => boolean;
    /**
     * Where the panel is teleported. `'body'` unless the host says otherwise.
     *
     * This is the option Quasar does not have, and its absence is the reason
     * `SA_PORTAL_CLASS` exists in this repository: a dialog that always lands on
     * `document.body` lands outside whatever container carries the host's
     * theme, and the only repair left is a global selector.
     */
    to?: () => string | HTMLElement;
}

export interface Dialog {
    /** Bind on the panel element with `ref`. The trap reads it. */
    readonly panelRef: Ref<HTMLElement | null>;
    /** `v-bind` on the panel: the modal role and the name it is announced by. */
    readonly panelProps: Record<string, string>;
    /** `v-bind` on the backdrop: closes on a click that misses the panel. */
    readonly backdropProps: Record<string, unknown>;
    /** Put this on the heading `aria-labelledby` points at. */
    readonly titleId: string;
    /** The teleport target, resolved. */
    readonly teleportTo: Ref<string | HTMLElement>;
}

/**
 * Everything a modal dialog owes its user, and nothing about how it looks.
 *
 * Focus trap, focus return, escape, `aria-modal`, `aria-labelledby`, scroll
 * lock and a settable teleport target — the expensive half of a dialog, tested
 * once instead of once per dialog. What renders is the caller's markup on the
 * theme's tokens, which is what lets a component do this inside an application
 * that never installed a UI framework.
 *
 * Focus return needs nothing at the trigger. It reads `document.activeElement`
 * as the dialog opens, which is the element the user actually left — a `ref` on
 * a button would only be right when the dialog was opened by that button, and
 * two of the three here are opened from a row action that no longer exists by
 * the time the dialog closes.
 *
 * One dialog at a time is assumed for the escape key: the listener is on
 * `document`, so with two open both would close. This package never stacks two,
 * and a depth register would be machinery for a case nobody has.
 */
export function useDialog(options: UseDialogOptions): Dialog {
    const panelRef = ref<HTMLElement | null>(null);
    const teleportTo = ref<string | HTMLElement>(options.to?.() ?? 'body');
    const titleId = useId() ?? 'sa-dialog-title';

    const isPersistent = () => options.persistent?.() ?? false;

    /** The element focus goes back to, captured when the dialog opened. */
    let restoreFocusTo: HTMLElement | null = null;
    /** Whether this dialog currently holds the lock and the listener. */
    let engaged = false;

    function tabbablesInPanel(): HTMLElement[] {
        const panel = panelRef.value;
        if (!panel) return [];
        return [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter(
            (element) => !element.hasAttribute('hidden'),
        );
    }

    function onKeydown(event: KeyboardEvent): void {
        if (!engaged) return;

        if (event.key === 'Escape') {
            if (isPersistent()) return;
            event.preventDefault();
            options.onClose();
            return;
        }

        if (event.key !== 'Tab') return;
        const panel = panelRef.value;
        if (!panel) return;

        const tabbables = tabbablesInPanel();
        if (tabbables.length === 0) {
            // Nothing to move to; keep the caret on the panel rather than
            // letting the tab reach the page behind the backdrop.
            event.preventDefault();
            panel.focus();
            return;
        }

        const first = tabbables[0]!;
        const last = tabbables[tabbables.length - 1]!;
        const active = document.activeElement;
        const inside = active instanceof Node && panel.contains(active);

        if (event.shiftKey && (!inside || active === first || active === panel)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (!inside || active === last)) {
            event.preventDefault();
            first.focus();
        }
    }

    async function engage(): Promise<void> {
        if (engaged) return;
        engaged = true;
        restoreFocusTo =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        teleportTo.value = options.to?.() ?? 'body';
        lockScroll();
        document.addEventListener('keydown', onKeydown);
        // The panel is rendered by the same state change that opened the
        // dialog, so it does not exist yet on the tick this runs.
        await nextTick();
        panelRef.value?.focus();
    }

    function release(): void {
        if (!engaged) return;
        engaged = false;
        document.removeEventListener('keydown', onKeydown);
        unlockScroll();
        // No liveness check before this. An `isConnected` guard was here and a
        // counter-check found it proved nothing: `focus()` on a detached node
        // is a no-op, so the guarded and unguarded versions do the same thing.
        // The case it was written for is real — the row a dialog was opened
        // from can be gone by the time it closes — and what actually happens
        // then is that focus stays at `<body>`. That is pinned by a test rather
        // than described by a line that does not run.
        restoreFocusTo?.focus();
        restoreFocusTo = null;
    }

    watch(
        options.open,
        (open) => {
            if (open) void engage();
            else release();
        },
        { immediate: true },
    );

    onScopeDispose(release);

    return {
        panelRef,
        panelProps: {
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': titleId,
            tabindex: '-1',
        },
        backdropProps: {
            onClick: (event: MouseEvent) => {
                if (isPersistent()) return;
                if (event.target === event.currentTarget) options.onClose();
            },
        },
        titleId,
        teleportTo,
    };
}
