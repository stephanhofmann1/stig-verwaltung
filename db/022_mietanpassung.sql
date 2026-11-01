-- Mietanpassungen: welcher Betrag galt ab wann
--
-- Bisher kennt ein Mietverhaeltnis genau einen Betrag. Das genuegt, solange
-- nur der laufende Monat gestellt wird -- und faellt auseinander, sobald
-- rueckwirkend abgerechnet wird.
--
-- Der Anlass: Stephan will ab Januar 2024 abrechnen und alle Kontoauszuege
-- einlesen. Mit einem einzigen Betrag je Mietverhaeltnis haette jeder Monat
-- seit 2024 den HEUTIGEN Betrag bekommen. Bei Cem Oezdil waeren das
-- zweieinhalb Jahre zu 944 Euro gewesen, obwohl die Mieterhoehung erst zum
-- 01.07.2026 wirksam wurde -- rund 7.900 Euro Forderung, die es nie gab.
-- Dasselbe bei zwei Mietverhaeltnissen in Ludwigshafen und bei jedem Zimmer, das in der Zeit
-- den Mieter gewechselt hat.
--
-- Sollstellungen werden nach ihrer Erzeugung nie ueberschrieben (richtig so:
-- was gestellt und vielleicht bezahlt ist, bleibt stehen). Ein zu hoher
-- Betrag von damals liesse sich also nicht mehr korrigieren -- er wuerde
-- dauerhaft als Rueckstand stehen und das Mahnwesen darauf ansetzen.
--
-- Deshalb bekommt die Miete eine Zeitachse.

BEGIN;

CREATE TABLE IF NOT EXISTS mietanpassung (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id         uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                       DEFAULT aktueller_mandant(),
    mietverhaeltnis_id uuid NOT NULL REFERENCES mietverhaeltnis(id) ON DELETE CASCADE,

    -- Erster Tag, ab dem dieser Betrag gilt. Der Betrag gilt bis zur
    -- naechsten Anpassung oder bis zum Ende des Mietverhaeltnisses.
    gilt_ab            date        NOT NULL,

    -- Dieselben vier Posten wie am Mietverhaeltnis. gesamtmiete hat
    -- Vorrang, wenn gesetzt -- geschuldet ist, was vereinbart wurde.
    kaltmiete          numeric(10,2),
    nebenkosten        numeric(10,2),
    moeblierungszuschlag numeric(10,2),
    gesamtmiete        numeric(10,2),

    -- Woher die Aenderung kommt. Kein CHECK: Die Liste waechst, und ein
    -- unbekannter Wert ist harmlos -- er steht nur in der Begruendung.
    grund              text        NOT NULL DEFAULT 'vertrag',

    -- Fundstelle. Bei einer Mieterhoehung das Schreiben und sein Datum,
    -- bei einer Vereinbarung die Nachricht. Wer in fuenf Jahren fragt,
    -- warum ab Juli 2026 ein anderer Betrag galt, findet es hier.
    beleg              text,

    angelegt_am        timestamptz NOT NULL DEFAULT now(),

    -- Zwei Betraege ab demselben Tag waeren nicht entscheidbar.
    UNIQUE (mietverhaeltnis_id, gilt_ab),

    -- Eine Anpassung ohne jeden Betrag ist ein leerer Eintrag, der still
    -- die Miete auf null setzen wuerde.
    CONSTRAINT mietanpassung_braucht_betrag
        CHECK (kaltmiete IS NOT NULL OR gesamtmiete IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS mietanpassung_mv_idx
    ON mietanpassung (mietverhaeltnis_id, gilt_ab DESC);

ALTER TABLE mietanpassung ENABLE ROW LEVEL SECURITY;
ALTER TABLE mietanpassung FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE tablename = 'mietanpassung' AND policyname = 'mandant_trennung') THEN
        CREATE POLICY mandant_trennung ON mietanpassung
            USING (mandant_id = aktueller_mandant())
            WITH CHECK (mandant_id = aktueller_mandant());
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON mietanpassung TO stig_app;

-- ---------------------------------------------------------------------------
-- Der Betrag zu einem Stichtag
-- ---------------------------------------------------------------------------
--
-- Gibt die Posten zurueck, die am Stichtag galten: die juengste Anpassung
-- mit gilt_ab <= Stichtag. Gibt es keine, gelten die Werte am
-- Mietverhaeltnis selbst -- so verhalten sich alle Mietverhaeltnisse ohne
-- Historie genau wie bisher.
CREATE OR REPLACE FUNCTION miete_am(p_mv uuid, p_tag date)
RETURNS TABLE (
    kaltmiete            numeric,
    nebenkosten          numeric,
    moeblierungszuschlag numeric,
    gesamtmiete          numeric,
    quelle               text
)
LANGUAGE sql
STABLE
AS $$
    -- Die Klammern sind Pflicht: Ein ORDER BY ... LIMIT gehoert sonst zum
    -- UNION als Ganzem und nicht zum einzelnen Zweig -- Postgres weist das
    -- als Syntaxfehler ab.
    (
      SELECT a.kaltmiete, a.nebenkosten, a.moeblierungszuschlag, a.gesamtmiete,
             'anpassung ab ' || a.gilt_ab::text ||
             coalesce(' (' || a.grund || ')', '') AS quelle
        FROM mietanpassung a
       WHERE a.mietverhaeltnis_id = p_mv
         AND a.gilt_ab <= p_tag
       ORDER BY a.gilt_ab DESC
       LIMIT 1
    )

    UNION ALL

    (
      SELECT mv.kaltmiete, mv.nebenkosten, mv.moeblierungszuschlag,
             mv.gesamtmiete, 'Mietverhaeltnis'
        FROM mietverhaeltnis mv
       WHERE mv.id = p_mv
         AND NOT EXISTS (SELECT 1 FROM mietanpassung a2
                          WHERE a2.mietverhaeltnis_id = p_mv
                            AND a2.gilt_ab <= p_tag)
    )
$$;

REVOKE ALL ON FUNCTION miete_am(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION miete_am(uuid, date) TO stig_app;

COMMIT;
