BEGIN;

-- Welche Kontoauszüge eingelesen wurden -- und was dabei aufgefallen ist.
--
-- Der Anlass ist eine Frage, die sich beim Nachladen jedes Mal stellt:
-- "Habe ich diesen Zeitraum schon drin, und war die Datei vollständig?"
-- Beides liess sich bisher nicht beantworten. Die Buchungen selbst sagen
-- nur, was ANGEKOMMEN ist, nicht was gefehlt hat: Ein Volksbank-Export,
-- der stillschweigend bei 200 Umsätzen abschneidet, sieht hinterher aus
-- wie ein vollständiger Auszug über einen kürzeren Zeitraum.
--
-- Die Warnung dazu gab es schon -- aber nur einmal, in der Antwort auf den
-- Upload. Wer sie wegklickt, hat keine Möglichkeit mehr, sie
-- wiederzufinden. Eine Warnung, die über die Vollständigkeit der
-- Buchhaltung entscheidet, darf nicht flüchtig sein.
--
-- Darum wird jeder schreibende Import protokolliert: Zeitraum, Format,
-- Zahlen, Warnungen im Wortlaut, und ein eigenes Kennzeichen
-- `abgeschnitten` für den Fall, der Geld kostet.

CREATE TABLE IF NOT EXISTS auszug_import (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id      uuid        NOT NULL DEFAULT aktueller_mandant()
                                REFERENCES mandant(id) ON DELETE CASCADE,
    konto_id        uuid        NOT NULL REFERENCES konto(id) ON DELETE CASCADE,
    dateiname       text,
    format          text        NOT NULL,
    kodierung       text,
    zeitraum_von    date,
    zeitraum_bis    date,
    gelesen         integer     NOT NULL,
    neu             integer     NOT NULL,
    bereits_bekannt integer     NOT NULL,
    -- Im Wortlaut, nicht als Kennzeichen: Die Meldungen nennen Zahlen und
    -- Spaltennamen, die man spaeter braucht.
    warnungen       text[]      NOT NULL DEFAULT '{}',
    -- Herausgezogen, weil genau dieser Fall stillschweigend Buchungen
    -- verschluckt und sich deshalb nicht in einer Textliste verstecken darf.
    abgeschnitten   boolean     NOT NULL DEFAULT false,
    -- "geraten" heisst: keines der vier bekannten Formate, Spalten ueber
    -- die Ueberschriften erraten. Dann sind Betraege und Buchungstage
    -- nachzusehen, bevor darauf gemahnt wird.
    geraten         boolean     NOT NULL DEFAULT false,
    zeitpunkt       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auszug_import_konto_idx
    ON auszug_import (konto_id, zeitpunkt DESC);

ALTER TABLE auszug_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE auszug_import FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auszug_import_mandant ON auszug_import;
CREATE POLICY auszug_import_mandant ON auszug_import
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

-- Kein UPDATE: Ein Importprotokoll, das man nachtraeglich aendern kann,
-- ist als Nachweis der Vollstaendigkeit nichts wert.
GRANT SELECT, INSERT, DELETE ON auszug_import TO stig_app;

COMMENT ON COLUMN auszug_import.abgeschnitten IS
    'Der Export war vermutlich bei einer festen Zahl Umsaetze '
    'abgeschnitten (Volksbank: 200). Der Zeitraum sieht dann vollstaendig '
    'aus, ist es aber nicht.';
COMMENT ON COLUMN auszug_import.geraten IS
    'Format unbekannt, Spalten ueber die Ueberschriften erraten.';

COMMIT;
