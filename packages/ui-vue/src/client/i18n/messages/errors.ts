// translation-catalogue: the German half of this file is German on purpose.
// What to tell a user when a request failed and the failing side said nothing
// itself. Each key answers one question — "what went wrong" — so none of them
// names an action; `common.errorLoadFailed` and its siblings do that.
//
// `adminErrorMessage()` reaches exactly one of these per error, and reaches a
// key here only when the response carried no message of its own.
//
// `network`, `emptyResponse` and `unexpected` all describe a request with no
// HTTP status and must not be swapped. The first two are reached only when a
// seam declared which one it was (`markTransportFailure`, `markEmptyResponse`);
// `unexpected` is what is left when nothing knows — including the JavaScript
// faults that used to be reported as connection problems.

import { defineMessages } from '../define.js';

export const errorsMessages = defineMessages(
    {
        network: 'Die Anfrage konnte nicht abgeschlossen werden. Bitte Verbindung prüfen.',
        emptyResponse:
            'Der Server hat nichts zurückgegeben. Bitte prüfen, ob die Änderung angekommen ist.',
        unauthorized: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
        forbidden: 'Für diese Aktion fehlt die Berechtigung.',
        notFound: 'Der angeforderte Eintrag existiert nicht mehr.',
        conflict: 'Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.',
        validation: 'Die Eingaben wurden nicht akzeptiert.',
        rateLimited: 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.',
        server: 'Der Server konnte die Anfrage nicht verarbeiten.',
        httpStatus: 'Die Anfrage ist fehlgeschlagen (HTTP {status}).',
        unexpected: 'Es ist ein unerwarteter Fehler aufgetreten. Bitte erneut versuchen.',
    },
    {
        network: 'The request could not be completed. Please check your connection.',
        emptyResponse: 'The server returned nothing. Please check whether the change was applied.',
        unauthorized: 'Your session has expired. Please sign in again.',
        forbidden: 'You do not have permission for this action.',
        notFound: 'The requested entry no longer exists.',
        conflict: 'The entry changed in the meantime. Please reload.',
        validation: 'The input was not accepted.',
        rateLimited: 'Too many requests. Please wait a moment and try again.',
        server: 'The server could not process the request.',
        httpStatus: 'The request failed (HTTP {status}).',
        unexpected: 'Something went wrong. Please try again.',
    },
);
