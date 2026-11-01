-- Protokoll der zeitgesteuerten Laeufe
--
-- Viermal taeglich laufen Mailabruf, Agent, Nachfassen und Sollstellungen.
-- Bisher landete das Ergebnis nirgends: Der Zeitplaner in compose.yaml
-- schickte jede Antwort nach /dev/null, Fehler gingen als console.error in
-- das Containerlog, und niemand sieht Containerlogs.
--
-- Das ist der Unterschied zwischen "laeuft automatisch" und "laeuft
-- vermutlich". Ein Lauf, der seit drei Wochen an einem abgelaufenen Token
-- scheitert, verhaelt sich nach aussen genauso wie einer, der nichts zu tun
-- hatte -- beide schweigen. Auffallen wuerde es erst, wenn ein Mieter sich
-- beschwert, dass niemand auf seine Mail geantwortet hat.
--
-- Deshalb bekommt jeder Lauf je Mandant eine Zeile. Die Oberflaeche zeigt
-- sie unter /laeufe, und ein Lauf, der nicht stattgefunden hat, ist dort
-- als Luecke sichtbar -- was ein Protokoll, das nur Fehler schreibt, nicht
-- leisten kann.

BEGIN;

CREATE TABLE IF NOT EXISTS lauf (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id   uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                 DEFAULT aktueller_mandant(),
    -- 'mailabruf', 'agent', 'nachfassen', 'sollstellungen'. Absichtlich ohne
    -- CHECK: Ein neuer Lauf soll keine Migration brauchen, und ein Tippfehler
    -- im Namen faellt in der Uebersicht sofort auf.
    name         text        NOT NULL,
    begonnen_am  timestamptz NOT NULL DEFAULT now(),
    dauer_ms     integer,
    ok           boolean     NOT NULL,

    -- Was der Lauf getan hat, wie die Schnittstelle es zurueckgibt. jsonb,
    -- weil jeder Lauf etwas anderes zaehlt und eine Spalte je Kennzahl
    -- bedeuten wuerde, bei jeder neuen Zahl zu migrieren.
    ergebnis     jsonb,

    -- Gefuellt nur bei ok = false. Die Meldung, nicht der Stapel: Letzterer
    -- enthaelt Pfade und Umgebungswerte und gehoert nicht in eine Tabelle,
    -- die die Oberflaeche anzeigt.
    fehler       text,

    -- Etwas, das ein Mensch ansehen muss, obwohl der Lauf geklappt hat --
    -- etwa eine Mietabweichung zwischen Vertrag und Einzelposten. Steht hier
    -- etwas, zeigt die Uebersicht die Zeile hervorgehoben.
    hinweise     text[]      NOT NULL DEFAULT '{}'
);

-- Die Uebersicht fragt immer "die letzten Laeufe", oft je Art.
CREATE INDEX IF NOT EXISTS lauf_zeit_idx ON lauf (begonnen_am DESC);
CREATE INDEX IF NOT EXISTS lauf_name_zeit_idx ON lauf (name, begonnen_am DESC);

-- Nur die mit Befund: die Abfrage, die eine Warnlampe braucht.
CREATE INDEX IF NOT EXISTS lauf_befund_idx ON lauf (begonnen_am DESC)
    WHERE ok = false OR cardinality(hinweise) > 0;

ALTER TABLE lauf ENABLE ROW LEVEL SECURITY;
ALTER TABLE lauf FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE tablename = 'lauf' AND policyname = 'mandant_trennung') THEN
        CREATE POLICY mandant_trennung ON lauf
            USING (mandant_id = aktueller_mandant())
            WITH CHECK (mandant_id = aktueller_mandant());
    END IF;
END $$;

-- db/011 vergibt Vorgabeprivilegien nur fuer Tabellen, die danach entstehen.
-- Diese entsteht danach -- der Grant steht trotzdem hier, damit die Datei
-- auch auf einem Stand funktioniert, auf dem die Vorgabe nicht gegriffen hat.
GRANT SELECT, INSERT, UPDATE, DELETE ON lauf TO stig_app;

-- ---------------------------------------------------------------------------
-- Aufraeumen
-- ---------------------------------------------------------------------------
--
-- Vier Laeufe, zweimal taeglich, je Mandant: rund 240 Zeilen im Monat und
-- Mandant. Das waechst langsam, aber es waechst ohne Ende. 90 Tage reichen,
-- um "lief das letzte Quartal durch?" zu beantworten; wer weiter zurueck
-- muss, hat ein anderes Problem als ein Protokoll.
--
-- SECURITY DEFINER, damit der Lauf selbst aufraeumen kann, ohne dass die
-- Anwendungsrolle ein allgemeines Loeschrecht ueber Mandantengrenzen braucht.
-- Die Funktion raeumt ausdruecklich nur im aktuellen Mandanten.
CREATE OR REPLACE FUNCTION lauf_aufraeumen(p_tage int DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    weg integer;
BEGIN
    DELETE FROM lauf
     WHERE mandant_id = aktueller_mandant()
       AND begonnen_am < now() - make_interval(days => greatest(7, p_tage));
    GET DIAGNOSTICS weg = ROW_COUNT;
    RETURN weg;
END;
$$;

REVOKE ALL ON FUNCTION lauf_aufraeumen(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lauf_aufraeumen(int) TO stig_app;

COMMIT;
