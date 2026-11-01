-- Stand des Mailabrufs.
--
-- IMAP vergibt je Postfach fortlaufende UIDs. Wir merken uns die hoechste
-- bereits verarbeitete, damit bei jedem Lauf nur Neues geholt wird.
-- Die uidvalidity gehoert dazu: aendert der Anbieter sie, sind alle alten
-- UIDs wertlos und es muss von vorn begonnen werden.

BEGIN;

CREATE TABLE postfach (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bezeichnung     text        NOT NULL UNIQUE,
    ordner          text        NOT NULL DEFAULT 'INBOX',
    letzte_uid      bigint      NOT NULL DEFAULT 0,
    uidvalidity     bigint,
    letzter_lauf    timestamptz,
    letzter_fehler  text,
    aktiv           boolean     NOT NULL DEFAULT true,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO postfach (bezeichnung, ordner) VALUES ('standard', 'INBOX');

COMMIT;
