-- Mieterbereich
--
-- Mieter bekommen kein Passwort. Sie melden sich mit einem Einmallink an,
-- der an die im Mietvertrag hinterlegte Adresse geht. Gruende:
--   - Niemand verwaltet Passwoerter fuer Leute, die sich dreimal im Jahr
--     anmelden. Was dabei herauskommt, sind Zettel am Kuehlschrank.
--   - Die Adresse ist ohnehin der Nachweis: Wer sie liest, ist der Mieter.
--   - Es gibt nichts zu stehlen, was laenger als eine Stunde gilt.
--
-- Entscheidend ist die zweite Grenze: Row Level Security trennt Mandanten,
-- nicht Mieter voneinander. Innerhalb eines Mandanten wuerde ein Mieter mit
-- gesetztem app.mandant alles sehen. Deshalb bekommt der Mieterbereich keinen
-- allgemeinen Lesezugriff, sondern ausschliesslich diese Funktionen, die
-- jeweils ein Mietverhaeltnis als Parameter nehmen und nichts anderes
-- herausgeben. Der Anwendungscode kann die Grenze gar nicht vergessen,
-- weil es an ihm vorbei keinen Weg gibt.

BEGIN;

CREATE TABLE mieter_zugang (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id         uuid        NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
    mietverhaeltnis_id uuid        NOT NULL REFERENCES mietverhaeltnis(id) ON DELETE CASCADE,
    -- Nur der Hash. Wer die Datenbank liest, kann sich damit nicht anmelden.
    token_hash         text        NOT NULL UNIQUE,
    ablauf             timestamptz NOT NULL,
    eingeloest_am      timestamptz,
    angelegt_am        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mieter_zugang_mv_idx ON mieter_zugang (mietverhaeltnis_id);

ALTER TABLE mieter_zugang ENABLE ROW LEVEL SECURITY;
ALTER TABLE mieter_zugang FORCE  ROW LEVEL SECURITY;
CREATE POLICY mandant_trennung ON mieter_zugang
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

-- ---------------------------------------------------------------------------
-- Link anfordern
--
-- Legt den Zugang an, wenn zu der Adresse ein laufendes Mietverhaeltnis
-- existiert. Gibt nichts zurueck, wenn nicht -- die aufrufende Schicht
-- antwortet in beiden Faellen gleich, damit sich ueber dieses Formular nicht
-- herausfinden laesst, wer wo wohnt.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mieter_zugang_anfordern(
    p_email      text,
    p_token_hash text,
    p_minuten    int DEFAULT 60
)
RETURNS TABLE (mandant_id uuid, mietverhaeltnis_id uuid, anzeigename text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    treffer record;
BEGIN
    SELECT mv.id AS mv_id, mv.mandant_id AS m_id, k.anzeigename
      INTO treffer
      FROM kontakt_email ke
      JOIN kontakt k           ON k.id  = ke.kontakt_id
      JOIN mietverhaeltnis mv  ON mv.kontakt_id = k.id
     WHERE lower(ke.email) = lower(trim(p_email))
       AND mv.beginn <= current_date
       AND (mv.ende IS NULL OR mv.ende >= current_date)
     ORDER BY mv.beginn DESC
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Aeltere, noch offene Links derselben Person entwerten. Sonst sammeln
    -- sich bei mehrfachem Klicken gueltige Schluessel in alten Mails an.
    --
    -- Der Alias ist noetig, nicht Geschmack: Die Ausgabespalten dieser
    -- Funktion heissen genauso wie die Tabellenspalten, und plpgsql haelt
    -- ein unqualifiziertes mietverhaeltnis_id dann fuer mehrdeutig.
    UPDATE mieter_zugang mz
       SET ablauf = now()
     WHERE mz.mietverhaeltnis_id = treffer.mv_id
       AND mz.eingeloest_am IS NULL
       AND mz.ablauf > now();

    INSERT INTO mieter_zugang (mandant_id, mietverhaeltnis_id, token_hash, ablauf)
    VALUES (treffer.m_id, treffer.mv_id, p_token_hash,
            now() + make_interval(mins => greatest(5, least(p_minuten, 1440))));

    RETURN QUERY SELECT treffer.m_id, treffer.mv_id, treffer.anzeigename;
END;
$$;

-- ---------------------------------------------------------------------------
-- Link einloesen -- genau einmal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mieter_zugang_einloesen(p_token_hash text)
RETURNS TABLE (mandant_id uuid, mietverhaeltnis_id uuid, anzeigename text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH eingeloest AS (
        UPDATE mieter_zugang
           SET eingeloest_am = now()
         WHERE token_hash = p_token_hash
           AND eingeloest_am IS NULL
           AND ablauf > now()
        RETURNING mandant_id, mietverhaeltnis_id
    )
    SELECT e.mandant_id, e.mietverhaeltnis_id, k.anzeigename
      FROM eingeloest e
      JOIN mietverhaeltnis mv ON mv.id = e.mietverhaeltnis_id
      JOIN kontakt k          ON k.id  = mv.kontakt_id;
$$;

-- ---------------------------------------------------------------------------
-- Was ein Mieter sehen darf
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mieter_uebersicht(p_mv uuid)
RETURNS TABLE (
    anzeigename text,
    objekt      text,
    strasse     text,
    plz         text,
    ort         text,
    einheit     text,
    etage       text,
    beginn      date,
    kaltmiete   numeric,
    nebenkosten numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT k.anzeigename, o.name, o.strasse, o.plz, o.ort,
           e.bezeichnung, e.etage, mv.beginn, mv.kaltmiete, mv.nebenkosten
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
      JOIN objekt  o ON o.id = e.objekt_id
     WHERE mv.id = p_mv;
$$;

-- Nur die eigenen Vorgaenge, und von denen nur Kopfdaten. Der Nachrichten-
-- verlauf enthaelt interne Notizen und Agentenbegruendungen und bleibt
-- bewusst draussen.
CREATE OR REPLACE FUNCTION mieter_vorgaenge(p_mv uuid)
RETURNS TABLE (
    referenz     text,
    betreff      text,
    status       text,
    angelegt_am  timestamptz,
    geaendert_am timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT v.referenz, v.betreff, v.status, v.angelegt_am, v.geaendert_am
      FROM vorgang v
      JOIN mietverhaeltnis mv ON mv.kontakt_id = v.kontakt_id
     WHERE mv.id = p_mv
       AND v.heikel = false     -- Mahnwesen gehoert nicht in die Selbstansicht
     ORDER BY v.geaendert_am DESC
     LIMIT 50;
$$;

REVOKE ALL ON FUNCTION mieter_zugang_anfordern(text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION mieter_zugang_einloesen(text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION mieter_uebersicht(uuid)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION mieter_vorgaenge(uuid)                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION mieter_zugang_anfordern(text, text, int) TO stig_app;
GRANT EXECUTE ON FUNCTION mieter_zugang_einloesen(text)            TO stig_app;
GRANT EXECUTE ON FUNCTION mieter_uebersicht(uuid)                  TO stig_app;
GRANT EXECUTE ON FUNCTION mieter_vorgaenge(uuid)                   TO stig_app;

COMMIT;
