-- Ab wann die Plattform abrechnet
--
-- Die Sollstellung lief bisher ab mietverhaeltnis.beginn. Das ist richtig
-- fuer ein Mietverhaeltnis, das in dieser Plattform entsteht -- und falsch
-- fuer jedes, das vorher schon lief.
--
-- Beim Import der Altdaten am 01.11.2026 hat genau das zugeschlagen: 1.094
-- Sollstellungen auf einen Schlag. Ein Mietverhaeltnis in Ludwigshafen besteht seit Juli 2007 in der
-- Welserstrasse, ein weiteres seit 2009 im Dachgeschoss. Der Lauf hat fuer
-- jeden Monat seither eine Forderung angelegt -- im aeltesten Fall rund 232 Monate
-- zu 630 Euro, also etwa 146.000 Euro, denen keine einzige Zahlung
-- gegenuebersteht. Der Kontoabgleich haette daraus einen Rueckstand
-- gemacht, das Mahnwesen eine Mahnung, und am Ende waere ein Schreiben an
-- jemanden gegangen, der seit achtzehn Jahren puenktlich zahlt.
--
-- Die Buchfuehrung dieser Plattform beginnt nicht mit dem Mietverhaeltnis,
-- sondern mit der Uebernahme. Was davor war, steht in den Unterlagen des
-- Voreigentuemers und gehoert nicht hierher.

BEGIN;

ALTER TABLE mietverhaeltnis
    -- Erster Monat, fuer den diese Plattform eine Sollstellung erzeugt.
    -- NULL heisst: ab beginn -- der Normalfall fuer alles, was hier
    -- entsteht. Gesetzt wird die Spalte beim Import von Altbestaenden.
    ADD COLUMN IF NOT EXISTS abrechnung_ab date;

-- Bedingung, kein blosser Kommentar: Ein Abrechnungsbeginn vor dem
-- Mietbeginn ergibt keinen Sinn und waere ein Tippfehler, der still
-- Forderungen fuer eine Zeit erzeugt, in der niemand dort wohnte.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'mv_abrechnung_nach_beginn') THEN
        ALTER TABLE mietverhaeltnis ADD CONSTRAINT mv_abrechnung_nach_beginn
            CHECK (abrechnung_ab IS NULL OR abrechnung_ab >= beginn);
    END IF;
END $$;

COMMENT ON COLUMN mietverhaeltnis.abrechnung_ab IS
    'Erster Monat, fuer den die Plattform Soll stellt. NULL = ab beginn. '
    'Fuer uebernommene Altmietverhaeltnisse auf den Uebernahmezeitpunkt setzen.';

COMMIT;
