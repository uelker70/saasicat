import { onScopeDispose, ref, type Ref } from 'vue';

/** Where a drag currently stands, for the row markup to read. */
export interface RowReorder {
    /** The row being dragged, by index, or `null` while nothing is. */
    readonly draggingIndex: Ref<number | null>;
    /** The position the row would take on release, or `null`. */
    readonly targetIndex: Ref<number | null>;
    /** Starts a drag from a handle. Call from `pointerdown`. */
    start(index: number, event: PointerEvent): void;
}

/**
 * Dragging a row to a new position, by pointer.
 *
 * Written here rather than taken from a library, and the reason is the shape of
 * the thing being dragged: the rows are `display: contents` inside a CSS grid,
 * so a row has no box of its own to lift, drag or animate. Every sortable list
 * library moves an element; here there is no element to move — what moves is
 * the meaning of five sibling cells. So this drags nothing and only decides
 * WHERE a release would land, leaving the drawing to two CSS classes.
 *
 * Pointer events rather than HTML5 drag-and-drop, because the latter does not
 * fire on touch at all. `setPointerCapture` keeps the gesture with the handle
 * even when the pointer leaves it, which on a 24px handle is most of the drag.
 *
 * The keyboard path is not here: it is one line in the component
 * (`@keydown.up`/`.down` → `reorder(i, i ± 1)`), needs none of this machinery,
 * and WCAG 2.2 SC 2.5.7 requires it to exist independently of the pointer.
 *
 * @param rowCount   How many rows there are, read at drag time.
 * @param handleOf   The element for a row index — the drop target's geometry is
 *                   measured from the handles, since the rows have no box.
 * @param onDrop     Called with the release, only when it changes something.
 */
export function useRowReorder(
    rowCount: () => number,
    handleOf: (index: number) => HTMLElement | null,
    onDrop: (from: number, to: number) => void,
): RowReorder {
    const draggingIndex = ref<number | null>(null);
    const targetIndex = ref<number | null>(null);

    /**
     * Where the dragged row would land, as an index in the list AFTER it is
     * taken out.
     *
     * The scan itself answers a different question — "before which row would
     * this be inserted?", an index in the list as it stands. The two agree
     * going up and differ by one going down, because everything between the
     * dragged row and the insertion point shifts up by one when it leaves.
     * Reading the first as the second moved a downward drag one row too far,
     * and made an 11px twitch inside the dragged row's own handle count as a
     * move to the row below.
     */
    function positionAt(clientY: number, from: number): number {
        // Handles are in DOM order, so the first midpoint below the pointer is
        // the insertion point.
        const count = rowCount();
        let insertAt = count;
        for (let index = 0; index < count; index++) {
            const rect = handleOf(index)?.getBoundingClientRect();
            if (rect && clientY < rect.top + rect.height / 2) {
                insertAt = index;
                break;
            }
        }
        return insertAt > from ? insertAt - 1 : insertAt;
    }

    function onMove(event: PointerEvent): void {
        if (draggingIndex.value === null) return;
        targetIndex.value = positionAt(event.clientY, draggingIndex.value);
    }

    function onUp(): void {
        const from = draggingIndex.value;
        const to = targetIndex.value;
        stop();
        if (from !== null && to !== null && from !== to) onDrop(from, to);
    }

    function stop(): void {
        draggingIndex.value = null;
        targetIndex.value = null;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', stop);
    }

    function start(index: number, event: PointerEvent): void {
        // Left button only: a right-click drag would start a gesture the
        // browser is about to interrupt with its own menu.
        if (event.button !== 0) return;
        event.preventDefault();
        draggingIndex.value = index;
        targetIndex.value = index;
        (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', stop);
    }

    // The listeners live on `document`, so nothing else takes them down when
    // the page goes away mid-drag.
    onScopeDispose(stop);

    return { draggingIndex, targetIndex, start };
}
