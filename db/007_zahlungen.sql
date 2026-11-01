-- Zahlungen und Mietenbuch.
--
-- Die Zuordnungsregeln stammen aus dem Kontoabgleich vom 12.10.2026 ueber
-- zwoelf Monate. Sie sind der Grund, warum hier nichts blind automatisch
-- verbucht wird:
--   * mehrere Mieter zahlen am Monatsletzten fuer den Folgemonat
--   * Ueberweisungen laufen unter fremdem Namen ein (Angehoerige, Dritte)
--   * Auslandszahlungen haben statt Verwendungszweck eine Adresszeile
--   * Barzahlungen tauchen in keinem Auszug auf
--   * der Sparkassen-Export hat keine Saldospalte

BEGIN;

-- --- Konten -----------------------------------------------------------------

CREATE TABLE konto (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bezeichnung text NOT NULL,
    objekt_id   uuid REFERENCES objekt(id) ON DELETE SET NULL,
    art         text NOT NULL DEFAULT 'bank' CHECK (art IN ('bank','barkasse')),
    iban_kurz   text,                -- nur die letzten Stellen, nie die volle IBAN
    notizen     text,
    UNIQUE (bezeichnung)
);

-- --- Buchungen --------------------------------------------------------------

CREATE TABLE buchung (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    konto_id        uuid        NOT NULL REFERENCES konto(id) ON DELETE CASCADE,
    buchungstag     date        NOT NULL,
    valuta          date,
    betrag          numeric(12,2) NOT NULL,       -- positiv = Eingang
    waehrung        text        NOT NULL DEFAULT 'EUR',
    absender        text,                          -- Name laut Auszug
    verwendungszweck text,
    -- Fingerabdruck gegen Doppelimport desselben Auszugs
    fingerabdruck   text        NOT NULL,
    importiert_am   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (konto_id, fingerabdruck)
);
CREATE INDEX buchung_tag_idx ON buchung (buchungstag DESC);

-- --- Sollstellung: welche Miete ist wann faellig ----------------------------

CREATE TABLE sollstellung (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mietverhaeltnis_id  uuid NOT NULL REFERENCES mietverhaeltnis(id) ON DELETE CASCADE,
    monat               date NOT NULL,            -- immer der 1. des Monats
    betrag              numeric(10,2) NOT NULL,
    notizen             text,
    UNIQUE (mietverhaeltnis_id, monat)
);
CREATE INDEX sollstellung_monat_idx ON sollstellung (monat);

-- --- Zuordnung: Buchung deckt Sollstellung ---------------------------------
-- Eine Buchung kann mehrere Monate decken, ein Monat aus mehreren Buchungen
-- bestehen. Darum eine eigene Tabelle statt einer Spalte.

CREATE TABLE zuordnung (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buchung_id      uuid        NOT NULL REFERENCES buchung(id) ON DELETE CASCADE,
    sollstellung_id uuid        NOT NULL REFERENCES sollstellung(id) ON DELETE CASCADE,
    betrag          numeric(10,2) NOT NULL,
    sicherheit      text        NOT NULL DEFAULT 'sicher'
                    CHECK (sicherheit IN ('sicher','unsicher','bestaetigt')),
    begruendung     text,
    bestaetigt_am   timestamptz,
    angelegt_am     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (buchung_id, sollstellung_id)
);
CREATE INDEX zuordnung_buchung_idx ON zuordnung (buchung_id);
CREATE INDEX zuordnung_soll_idx    ON zuordnung (sollstellung_id);

-- --- Zahlerkennungen --------------------------------------------------------
-- Lernt die Faelle, die sich nicht aus dem Namen ergeben:
-- "ein Elternteil zahlt fuer das Kind", "JLU Giessen zahlt Kaution".

CREATE TABLE zahlerkennung (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kontakt_id  uuid NOT NULL REFERENCES kontakt(id) ON DELETE CASCADE,
    muster      text NOT NULL,          -- Text, der im Absender oder Zweck steht
    feld        text NOT NULL DEFAULT 'beide'
                CHECK (feld IN ('absender','verwendungszweck','beide')),
    notizen     text,
    UNIQUE (kontakt_id, muster)
);

-- Zahlt dieser Mieter typischerweise am Monatsletzten fuer den Folgemonat?
ALTER TABLE mietverhaeltnis
    ADD COLUMN zahlt_im_voraus boolean NOT NULL DEFAULT false,
    ADD COLUMN zahlungsnotiz   text;

COMMIT;
