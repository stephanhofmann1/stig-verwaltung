-- STIG Verwaltung — Datenmodell
-- Postgres 16
--
-- Grundgedanke: Der VORGANG ist die Akte. Jede Nachricht (ein- und ausgehend)
-- haengt an genau einem Vorgang. Ein Vorgang gehoert optional zu einer Einheit
-- und hat einen oder mehrere Beteiligte (Mieter, Handwerker, Behoerde).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Stammdaten
-- ---------------------------------------------------------------------------

CREATE TABLE objekt (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL,              -- "Westanlage 9"
    strasse         text        NOT NULL,
    plz             text        NOT NULL,
    ort             text        NOT NULL,
    notizen         text,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE einheit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    objekt_id       uuid        NOT NULL REFERENCES objekt(id) ON DELETE CASCADE,
    bezeichnung     text        NOT NULL,              -- "Zimmer 7", "Gewerbe EG"
    etage           text,
    flaeche_qm      numeric(6,2),
    art             text        NOT NULL DEFAULT 'wohnen'
                    CHECK (art IN ('wohnen','gewerbe','gemeinschaft')),
    notizen         text,
    angelegt_am     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (objekt_id, bezeichnung)
);

-- Ein Kontakt ist jeder, mit dem wir mailen: Mieter, Handwerker, Behoerde,
-- Versorger. Die Rolle steht dran, damit die Klassifizierung sie nutzen kann.
CREATE TABLE kontakt (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anzeigename     text        NOT NULL,
    rolle           text        NOT NULL
                    CHECK (rolle IN ('mieter','handwerker','behoerde','versorger','interessent','sonstige')),
    firma           text,
    telefon         text,
    notizen         text,
    aktiv           boolean     NOT NULL DEFAULT true,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);

-- Ein Kontakt kann mehrere Adressen haben (privat/geschaeftlich, alte/neue).
CREATE TABLE kontakt_email (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kontakt_id      uuid        NOT NULL REFERENCES kontakt(id) ON DELETE CASCADE,
    email           text        NOT NULL,
    ist_primaer     boolean     NOT NULL DEFAULT false,
    UNIQUE (email)
);
CREATE INDEX kontakt_email_kontakt_idx ON kontakt_email (kontakt_id);

-- Mietverhaeltnis verbindet Kontakt und Einheit auf Zeit.
CREATE TABLE mietverhaeltnis (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    einheit_id      uuid        NOT NULL REFERENCES einheit(id) ON DELETE CASCADE,
    kontakt_id      uuid        NOT NULL REFERENCES kontakt(id) ON DELETE CASCADE,
    beginn          date        NOT NULL,
    ende            date,
    kaltmiete       numeric(10,2),
    nebenkosten     numeric(10,2),
    kaution         numeric(10,2),
    notizen         text
);
CREATE INDEX mietverhaeltnis_einheit_idx ON mietverhaeltnis (einheit_id);
CREATE INDEX mietverhaeltnis_kontakt_idx ON mietverhaeltnis (kontakt_id);

-- ---------------------------------------------------------------------------
-- Vorgaenge — das Herzstueck
-- ---------------------------------------------------------------------------

CREATE TABLE vorgang (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nummer          bigint      GENERATED ALWAYS AS IDENTITY,  -- menschenlesbar
    betreff         text        NOT NULL,
    kategorie       text        NOT NULL DEFAULT 'sonstige'
                    CHECK (kategorie IN (
                        'mieter','handwerker','behoerde','rechnung',
                        'interessent','mahnwesen','werbung','sonstige')),
    status          text        NOT NULL DEFAULT 'offen'
                    CHECK (status IN ('offen','wartet','erledigt')),
    -- heikel = niemals automatisch beantworten (Mahnung, Kuendigung, Fristen)
    heikel          boolean     NOT NULL DEFAULT false,
    objekt_id       uuid        REFERENCES objekt(id)  ON DELETE SET NULL,
    einheit_id      uuid        REFERENCES einheit(id) ON DELETE SET NULL,
    kontakt_id      uuid        REFERENCES kontakt(id) ON DELETE SET NULL,
    frist           date,
    angelegt_am     timestamptz NOT NULL DEFAULT now(),
    geaendert_am    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vorgang_status_idx   ON vorgang (status, geaendert_am DESC);
CREATE INDEX vorgang_kontakt_idx  ON vorgang (kontakt_id);
CREATE INDEX vorgang_einheit_idx  ON vorgang (einheit_id);

-- ---------------------------------------------------------------------------
-- Nachrichten
-- ---------------------------------------------------------------------------
-- richtung: 'ein'  = empfangen
--           'aus'  = von uns versendet
-- status:   'empfangen' | 'entwurf' | 'gesendet' | 'verworfen'
--
-- message_id / in_reply_to / references sind die echten RFC-5322-Header.
-- Sie entscheiden ueber die Threadzuordnung und muessen beim Versand
-- korrekt gesetzt werden, sonst reisst der Thread beim Empfaenger.

CREATE TABLE nachricht (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vorgang_id      uuid        NOT NULL REFERENCES vorgang(id) ON DELETE CASCADE,
    richtung        text        NOT NULL CHECK (richtung IN ('ein','aus')),
    status          text        NOT NULL DEFAULT 'empfangen'
                    CHECK (status IN ('empfangen','entwurf','gesendet','verworfen')),

    von_email       text        NOT NULL,
    von_name        text,
    an_emails       text[]      NOT NULL DEFAULT '{}',
    cc_emails       text[]      NOT NULL DEFAULT '{}',

    betreff         text        NOT NULL,
    koerper_text    text        NOT NULL,

    message_id      text,                              -- '<abc@host>'
    in_reply_to     text,
    referenzen      text[]      NOT NULL DEFAULT '{}',

    -- Herkunft des Entwurfs: 'agent' oder 'mensch'
    verfasst_von    text        CHECK (verfasst_von IN ('agent','mensch')),
    agent_notiz     text,                              -- Begruendung/Unsicherheit

    empfangen_am    timestamptz,
    gesendet_am     timestamptz,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX nachricht_message_id_idx
    ON nachricht (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX nachricht_vorgang_idx ON nachricht (vorgang_id, angelegt_am);
CREATE INDEX nachricht_entwurf_idx
    ON nachricht (status, angelegt_am DESC) WHERE status = 'entwurf';

CREATE TABLE anhang (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nachricht_id    uuid        NOT NULL REFERENCES nachricht(id) ON DELETE CASCADE,
    dateiname       text        NOT NULL,
    mime_typ        text,
    groesse_bytes   bigint,
    ablage_pfad     text        NOT NULL,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anhang_nachricht_idx ON anhang (nachricht_id);

-- ---------------------------------------------------------------------------
-- Protokoll — wer hat was wann freigegeben
-- ---------------------------------------------------------------------------

CREATE TABLE protokoll (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vorgang_id      uuid        REFERENCES vorgang(id) ON DELETE CASCADE,
    nachricht_id    uuid        REFERENCES nachricht(id) ON DELETE SET NULL,
    ereignis        text        NOT NULL,
    details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    zeitpunkt       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX protokoll_vorgang_idx ON protokoll (vorgang_id, zeitpunkt DESC);

-- ---------------------------------------------------------------------------
-- geaendert_am automatisch pflegen
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_vorgang() RETURNS trigger AS $$
BEGIN
    UPDATE vorgang SET geaendert_am = now() WHERE id = NEW.vorgang_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nachricht_touch_vorgang
    AFTER INSERT ON nachricht
    FOR EACH ROW EXECUTE FUNCTION touch_vorgang();

COMMIT;
