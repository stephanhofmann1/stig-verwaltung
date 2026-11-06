-- Ein Benutzer, mehrere Mandanten
--
-- WARUM
--
-- Stephan verwaltet die STIG Immobilien eGbR gemeinsam mit Igor, und er
-- will daneben eine private Steuerablage. Beides im selben Mandanten
-- hiesse: Igor koennte an die privaten Belege. Zwei getrennte Zugaenge
-- hiessen: zum Wechseln ab- und wieder anmelden.
--
-- Also bleibt die Trennung, wo sie ist -- zwei Mandanten, zwei Datensaetze,
-- RLS dazwischen --, und nur der Weg hinein wird bequemer: Ein Benutzer
-- darf in mehr als einem Mandanten arbeiten, und die Sitzung merkt sich,
-- in welchem er gerade ist.
--
-- WAS SICH NICHT AENDERT
--
-- Der Mandant der laufenden Transaktion kommt weiter aus dem unterschrieb-
-- enen Sitzungscookie, nie aus einem Wert, den der Browser mitschickt. Der
-- Wechsel stellt das Cookie neu aus -- und vorher prueft der Server hier in
-- der Datenbank, ob der Zugang ueberhaupt besteht. Ein Browser, der eine
-- fremde Mandanten-Kennung schickt, bekommt kein neues Cookie.
--
-- DIE SPALTE HEISST ABSICHTLICH NICHT mandant_id
--
-- In diesem Schema bedeutet mandant_id ueberall "diese Zeile gehoert jenem
-- Mandanten", und darauf sitzt die RLS-Policy. Hier bedeutet der Wert etwas
-- anderes: "dieser Benutzer darf in jenen Mandanten". Die Zeile muss gerade
-- dann lesbar sein, wenn man noch NICHT in diesem Mandanten ist. Haette die
-- Spalte den gewohnten Namen, wuerde ihr beim naechsten Aufraeumen jemand
-- die gewohnte Policy verpassen -- und damit genau den Fall sperren, fuer
-- den die Tabelle existiert.

BEGIN;

CREATE TABLE benutzer_zugang (
    benutzer_id      uuid        NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    ziel_mandant_id  uuid        NOT NULL REFERENCES mandant(id)  ON DELETE CASCADE,
    -- Die Rolle gilt je Mandant. Jemand kann im eigenen Haus verwalten und
    -- im fremden nur lesen. Mieter stehen hier nie: Ein Mieterzugang haengt
    -- an einem Mietverhaeltnis und hat in einem zweiten Mandanten nichts zu
    -- suchen.
    rolle            text        NOT NULL DEFAULT 'verwalter'
                     CHECK (rolle IN ('verwalter','lesen')),
    angelegt_am      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (benutzer_id, ziel_mandant_id)
);

CREATE INDEX benutzer_zugang_ziel_idx ON benutzer_zugang (ziel_mandant_id);

-- ---------------------------------------------------------------------------
-- RLS: zu, und zwar ganz
--
-- Hier steht bewusst KEINE Policy. Das Hausmuster (ENABLE + FORCE + Policy
-- auf aktueller_mandant()) passt nicht: Es wuerde genau das verbieten, was
-- die Tabelle leisten soll -- einen Blick auf einen Mandanten, in dem man
-- noch nicht ist.
--
-- ENABLE ohne Policy heisst: Die Anwendungsrolle (stig_app) sieht keine
-- einzige Zeile, auch nicht die eigenen. FORCE bleibt absichtlich AUS, damit
-- der Eigentuemer der Tabelle an RLS vorbeisieht -- und nur er. Der einzige
-- Weg hinein ist die Funktion weiter unten: SECURITY DEFINER, mit
-- festgenageltem search_path, und sie gibt nichts heraus als die Liste der
-- Mandanten, in denen dieser eine Benutzer arbeiten darf.
--
-- Waere FORCE gesetzt, griffe die Policy auch beim Eigentuemer, und die
-- Funktion saehe ebenfalls nichts. Das ist kein Versehen, sondern der Grund.
-- ---------------------------------------------------------------------------
ALTER TABLE benutzer_zugang ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Das Fenster: welche Mandanten stehen diesem Benutzer offen?
--
-- Zugeschnitten wie anmelde_daten() in db/013: ein Name herein, eine Liste
-- heraus, kein LIKE, keine anderen Spalten. Der Heimatmandant ist immer
-- dabei -- dort steht die Benutzerzeile, dort gilt die Rolle aus benutzer.
--
-- Mieter bekommen eine leere Liste. Nicht weil es nichts gaebe, sondern
-- damit ein Mieterzugang den Umschalter nie zu sehen bekommt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zugaenge_fuer(p_name text, p_heimat uuid)
RETURNS TABLE (mandant_id uuid, name text, kuerzel text, rolle text, heimat boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    WITH ich AS (
        SELECT b.id, b.rolle
          FROM benutzer b
         WHERE lower(b.name) = lower(p_name)
           AND b.mandant_id = p_heimat
           AND b.aktiv
           AND b.rolle <> 'mieter'
    )
    -- Der Heimatmandant.
    SELECT m.id, m.name, m.kuerzel, ich.rolle, true
      FROM ich, mandant m
     WHERE m.id = p_heimat AND m.aktiv
    UNION ALL
    -- Die zusaetzlich freigegebenen.
    SELECT m.id, m.name, m.kuerzel, z.rolle, false
      FROM ich
      JOIN benutzer_zugang z ON z.benutzer_id = ich.id
      JOIN mandant m         ON m.id = z.ziel_mandant_id
     WHERE m.aktiv AND m.id <> p_heimat
     ORDER BY 5 DESC, 2;
$$;

REVOKE ALL ON FUNCTION zugaenge_fuer(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zugaenge_fuer(text, uuid) TO stig_app;

-- ---------------------------------------------------------------------------
-- Einen weiteren Mandanten anlegen und sich selbst freigeben
--
-- WARUM NICHT EINFACH HIER IN DER WANDERUNG
--
-- Der private Mandant eines Menschen samt seinem Namen gehoert nicht in
-- den Quelltext. Eine Wanderung liegt in git und wird bei jedem Einspielen
-- erneut gelesen -- sie ist der falsche Ort fuer die Daten eines Einzelnen.
-- Also kann ein Verwalter sich selbst einen weiteren Mandanten anlegen.
--
-- Das passt auch zum Zweck der Plattform: Sie soll anderen Betrieben
-- angeboten werden koennen, und dann legt jeder seine eigenen an.
--
-- WARUM DIE PRUEFUNG HIER STEHT UND NICHT IN DER ANWENDUNG
--
-- Die Funktion gibt jemandem Zugriff auf einen Mandanten. Stuende die
-- Rechtepruefung in der Anwendung, waere die Funktion eine offene Tuer fuer
-- jeden, der sie aufrufen kann -- und sie laeuft unter dem Eigentuemer.
-- Also prueft sie selbst: Es muss ein aktiver Verwalter dieses Namens im
-- angegebenen Heimatmandanten geben, und freigegeben wird genau dieser
-- Benutzer und niemand sonst. Die Anwendung kann keinen fremden Namen
-- einsetzen, ohne dessen Heimatmandanten zu kennen -- und beides kommt
-- aus dem unterschriebenen Sitzungscookie, nicht aus der Anfrage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mandant_anlegen(
    p_name    text,
    p_kuerzel text,
    p_benutzer text,
    p_heimat  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_benutzer uuid;
    v_neu      uuid;
BEGIN
    SELECT b.id INTO v_benutzer
      FROM benutzer b
     WHERE lower(b.name) = lower(p_benutzer)
       AND b.mandant_id = p_heimat
       AND b.aktiv
       AND b.rolle = 'verwalter';

    IF v_benutzer IS NULL THEN
        RAISE EXCEPTION 'nicht berechtigt';
    END IF;

    INSERT INTO mandant (name, kuerzel)
    VALUES (btrim(p_name), lower(btrim(p_kuerzel)))
    RETURNING id INTO v_neu;

    INSERT INTO benutzer_zugang (benutzer_id, ziel_mandant_id, rolle)
    VALUES (v_benutzer, v_neu, 'verwalter');

    RETURN v_neu;
END;
$$;

REVOKE ALL ON FUNCTION mandant_anlegen(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mandant_anlegen(text, text, text, uuid) TO stig_app;

COMMIT;
