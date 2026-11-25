// That the tenant's state moved because of something done on this page, said to
// every reader of it on the page. A page reads the state in more than one
// place — the banner above every page, the plan section of an ended
// subscription — and each reads it on its own clock; a return taken out in one
// would otherwise leave the other showing the tenant held back until its next
// read.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Tells every reader of the tenant's state on the page to read it again. */
export function announceTenantAccessChanged(): void {
    for (const listener of listeners) listener();
}

/** Hears every announcement; returns what stops hearing it. */
export function onTenantAccessChanged(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
