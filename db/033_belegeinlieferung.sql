BEGIN;

-- Sammel-Einlieferung von Belegen
--
-- ANLASS
--
-- Am 05.11.2026 lagen 297 Belege auf dem Mac -- 211 Amazon-Rechnungen des
-- Geschaeftskontos, 86 eingescannte Rechnungen aus den Projektordnern --
-- und im Portal stand die Gegenseite: 603 Ausgabenbewegungen ohne einen
-- einzigen Beleg. Der Abgleich (lib/belegabgleich.ts) war gebaut und lief
-- ins Leere, weil es nichts abzugleichen gab.
--
-- Der vorhandene Weg (api/belege/upload) nimmt 20 Dateien je Formular und
-- verlangt dazwischen eine Sichtung. Fuer 297 Dateien waere das eine
-- Stunde Klicken, und beim fuenfzehnten Durchgang sieht niemand mehr hin.
-- Eine Sichtung, die ermuedet, ist keine.
--
-- WAS DIE SICHTUNG ERSETZT
--
-- Der Grund fuer die Sichtung bleibt richtig: Aus diesen Zahlen entsteht
-- die Buchfuehrung, und ein falsch gelesener Betrag fiele spaeter
-- niemandem auf, weil ihn niemand nachrechnet. Weggelassen wird deshalb
-- nicht die Pruefung, sondern der Mensch darin.
--
-- An seine Stelle treten ZWEI unabhaengige Auswertungen desselben
-- Belegs. Das Regelwerk im Portal liest den Beleg beim Einliefern selbst
-- (lib/belege.ts). Dazu darf die Lieferung eine Beifuegung mitbringen --
-- eine vorab erstellte Einordnung je Datei. Stimmen Betrag und Datum aus
-- beiden Quellen ueberein, ist das ein Beleg mit zwei Zeugen. Stimmen sie
-- nicht, wird die Zeile trotzdem angelegt -- aber mit `abweichung`
-- gefuellt, und der Abgleich laesst sie liegen. Ein Beleg, der fehlt,
-- faellt auf; ein Beleg, der falsch dasteht, nicht. Deshalb lieber
-- eingebucht und markiert als weggelassen.
--
-- WARUM EINE LIEFERTABELLE UND KEINE WARTESCHLANGE
--
-- Eine Warteschlange mit Zustaenden ('offen', 'uebernommen') waere die
-- Sichtung in Tabellenform -- und sie wuerde sich fuellen, weil niemand
-- sie leert. Was hier gebraucht wird, ist kein Posteingang, sondern ein
-- Protokoll: welche Lieferung wann kam, was darin war, was abgelehnt
-- wurde und warum. Dasselbe Muster wie auszug_import (db/028), und aus
-- demselben Grund: Ein Import ohne Protokoll ist nicht nachvollziehbar,
-- und beim naechsten Mal weiss keiner mehr, ob eine Datei schon drin war.
--
-- MANDANTENFAEHIGKEIT
--
-- Muster aus db/010, db/027, db/029, db/031 und db/032: mandant_id mit
-- DEFAULT aktueller_mandant(), Policy mit USING und WITH CHECK, ENABLE
-- *und* FORCE ROW LEVEL SECURITY. Ohne FORCE ist die Uebung wirkungslos,
-- weil die Anwendung sich als Eigentuemer der Tabellen verbindet und den
-- RLS damit standardmaessig umgeht.
--
-- Die UNIQUE fuehrt mit mandant_id, wie jede UNIQUE in diesem Schema.
-- db/019 ist ein ganzer Nachtrag, weil db/010 vier davon uebersehen hat.

CREATE TABLE IF NOT EXISTS beleg_lieferung (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id      uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                         DEFAULT aktueller_mandant(),

    -- Name des eingelieferten Archivs, wie er ankam. Nur zur Anzeige.
    dateiname       text NOT NULL,

    -- Groesse des Archivs, nicht der entpackten Dateien.
    groesse_bytes   bigint NOT NULL CHECK (groesse_bytes >= 0),

    -- Inhaltshash des Archivs. Dieselbe Lieferung zweimal ist immer ein
    -- Versehen -- ein doppelt abgeschickter Upload, ein wiederholter
    -- Versuch nach einem Zeitablauf. Die Bedingung erkennt sie am INHALT,
    -- nicht am Namen.
    marke           text NOT NULL,

    enthalten       integer NOT NULL DEFAULT 0 CHECK (enthalten       >= 0),
    uebernommen     integer NOT NULL DEFAULT 0 CHECK (uebernommen     >= 0),
    abgelehnt       integer NOT NULL DEFAULT 0 CHECK (abgelehnt       >= 0),
    -- Angelegt, aber mit Abweichung zwischen den beiden Auswertungen.
    auffaellig      integer NOT NULL DEFAULT 0 CHECK (auffaellig      >= 0),

    -- Je abgelehnte Datei ein Eintrag mit Grund. Wer wissen will, warum
    -- von 297 Dateien nur 290 ankamen, soll es hier finden und nicht im
    -- Anwendungsprotokoll suchen muessen.
    bericht         jsonb NOT NULL DEFAULT '[]'::jsonb,

    angelegt_am     timestamptz NOT NULL DEFAULT now(),

    UNIQUE (mandant_id, marke)
);

ALTER TABLE beleg_lieferung ENABLE ROW LEVEL SECURITY;
ALTER TABLE beleg_lieferung FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beleg_lieferung_mandant ON beleg_lieferung;
CREATE POLICY beleg_lieferung_mandant ON beleg_lieferung
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());


-- --- Was am Beleg selbst dazukommt ------------------------------------------

-- Aus welcher Lieferung der Beleg stammt. NULL heisst: einzeln
-- hochgeladen oder aus einer Mail entstanden, also wie bisher.
--
-- Kein CASCADE: Wer ein Lieferprotokoll loescht, soll damit nicht 297
-- Belege aus der Buchfuehrung reissen. Die beiden haben verschiedene
-- Lebensdauern -- das Protokoll ist Verwaltung, der Beleg ist Beweis.
ALTER TABLE beleg ADD COLUMN IF NOT EXISTS lieferung_id uuid
    REFERENCES beleg_lieferung(id) ON DELETE SET NULL;

-- Worin die beiden Auswertungen sich nicht einig waren. NULL heisst
-- einig, und nur dann darf der Abgleich diesen Beleg selbsttaetig
-- zuordnen.
--
-- Der Text nennt beide Werte, nicht nur die Tatsache der Abweichung:
-- "Betrag: Regelwerk 45,44 / Beifuegung 45,54". Eine Markierung ohne
-- Zahlen zwingt dazu, den Beleg erneut zu lesen -- und genau das soll
-- sie ersparen.
ALTER TABLE beleg ADD COLUMN IF NOT EXISTS abweichung text;

-- Anschaffung mit mehrjaehriger Nutzung oder sofort abziehbarer Aufwand?
--
-- Die Frage entscheidet der Steuerberater, aber sie muss am Beleg
-- vermerkt sein, sonst muss er 300 Belege erneut durchsehen, um sie zu
-- stellen. Ein Kuehlschrank fuer 478 EUR, ein Waschtrockner fuer 328 EUR
-- und eine Tuerklingel fuer 70 EUR stehen sonst in derselben Spalte wie
-- eine Packung Schraubendreher.
--
-- NULL heisst ungeklaert und ist der ehrliche Ausgangszustand. Ein
-- Vorschlag, der sich im Zweifel auf "nein" festlegt, waere im Export
-- nicht von einer gepruerten Entscheidung zu unterscheiden.
ALTER TABLE beleg ADD COLUMN IF NOT EXISTS anlagegut boolean;

CREATE INDEX IF NOT EXISTS beleg_lieferung_idx ON beleg (lieferung_id);
CREATE INDEX IF NOT EXISTS beleg_abweichung_idx ON beleg (abweichung)
    WHERE abweichung IS NOT NULL;

COMMIT;
