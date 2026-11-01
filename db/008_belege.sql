-- Belege.
--
-- Ziel: Jede Bankbewegung ist mit einem Beleg verbucht. Das ist die
-- Grundlage für die Steuererklärung und für den Abgleich Rechnung gegen
-- Kontoauszug.
--
-- Die meisten Belege kommen ohnehin als Mailanhang herein. Sie werden
-- beim Maileingang gesichert und bleiben mit ihrem Vorgang verbunden --
-- so steht später neben der Zahlung nicht nur die PDF, sondern auch der
-- Schriftwechsel, aus dem sie stammt.

BEGIN;

CREATE TABLE beleg (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    art             text        NOT NULL DEFAULT 'rechnung'
                    CHECK (art IN ('rechnung','gutschrift','quittung',
                                   'vertrag','bescheid','sonstige')),
    richtung        text        NOT NULL DEFAULT 'eingang'
                    CHECK (richtung IN ('eingang','ausgang')),

    -- Woher kommt der Beleg
    vorgang_id      uuid        REFERENCES vorgang(id)   ON DELETE SET NULL,
    nachricht_id    uuid        REFERENCES nachricht(id) ON DELETE SET NULL,
    anhang_id       uuid        REFERENCES anhang(id)    ON DELETE SET NULL,
    kontakt_id      uuid        REFERENCES kontakt(id)   ON DELETE SET NULL,

    -- Was steht drauf
    aussteller      text,
    belegnummer     text,
    belegdatum      date,
    betrag_brutto   numeric(12,2),
    waehrung        text        NOT NULL DEFAULT 'EUR',

    -- Steuerliche Einordnung; erst relevant, wenn gebucht wird
    objekt_id       uuid        REFERENCES objekt(id) ON DELETE SET NULL,
    umlagefaehig    boolean,
    kostenart       text,

    dateiname       text,
    ablage_pfad     text,
    notizen         text,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX beleg_vorgang_idx ON beleg (vorgang_id);
CREATE INDEX beleg_betrag_idx  ON beleg (betrag_brutto);
CREATE INDEX beleg_nummer_idx  ON beleg (lower(belegnummer));

-- Verknüpfung Buchung <-> Beleg. Eine Rechnung kann in Raten bezahlt
-- werden, eine Sammelüberweisung mehrere Rechnungen abdecken -- darum
-- auch hier eine eigene Tabelle mit Teilbeträgen.
CREATE TABLE belegbuchung (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buchung_id  uuid        NOT NULL REFERENCES buchung(id) ON DELETE CASCADE,
    beleg_id    uuid        NOT NULL REFERENCES beleg(id)   ON DELETE CASCADE,
    betrag      numeric(12,2) NOT NULL,
    sicherheit  text        NOT NULL DEFAULT 'sicher'
                CHECK (sicherheit IN ('sicher','unsicher','bestaetigt')),
    begruendung text,
    angelegt_am timestamptz NOT NULL DEFAULT now(),
    UNIQUE (buchung_id, beleg_id)
);
CREATE INDEX belegbuchung_buchung_idx ON belegbuchung (buchung_id);
CREATE INDEX belegbuchung_beleg_idx   ON belegbuchung (beleg_id);

-- Manche Bewegungen brauchen keinen Beleg: Mieteingänge, Umbuchungen
-- zwischen eigenen Konten. Das wird vermerkt statt ignoriert, damit die
-- Lückenliste am Ende wirklich leer werden kann.
ALTER TABLE buchung
    ADD COLUMN beleg_nicht_noetig boolean NOT NULL DEFAULT false,
    ADD COLUMN beleg_vermerk      text;

COMMIT;
