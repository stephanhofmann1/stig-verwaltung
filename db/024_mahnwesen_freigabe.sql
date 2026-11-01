-- Das Mahnwesen bleibt gesperrt, bis Stephan es ausdrücklich freigibt.
--
-- Entschieden am 01.11.2026: "das mahnwesen schalten wir erst live auf mein
-- Go. dafür muss alles sauber abgeglichen sein."
--
-- Das ist absichtlich eine Tabelle und keine Umgebungsvariable und kein
-- Vorgabewert im Code:
--
--   * Eine fehlende Zeile heißt "nicht freigegeben". Damit ist jeder Zustand,
--     den man nicht bedacht hat, der sichere: ein neuer Mandant, eine aus
--     dem Backup wiederhergestellte Datenbank, eine Migration, die jemand
--     vergessen hat. Überall bleibt das Mahnwesen aus.
--   * Die Freigabe steht je Mandant. Gibt Stephan sie für die Westanlage,
--     gilt sie nicht für Ludwigshafen -- dort ist der Abgleich ein anderer.
--   * Wer wann freigegeben hat, steht dabei. Ein Schreiben, das jemanden
--     beunruhigt, soll sich auf eine Entscheidung zurückführen lassen.
--
-- Eine Umgebungsvariable hätte das alles nicht geleistet: Sie gilt für alle
-- Mandanten zugleich, verschwindet bei einem neu aufgesetzten Container und
-- hinterlässt keine Spur, wer sie gesetzt hat.

BEGIN;

CREATE TABLE IF NOT EXISTS mahnwesen_freigabe (
    mandant_id     uuid PRIMARY KEY
                        REFERENCES mandant(id) ON DELETE CASCADE
                        DEFAULT aktueller_mandant(),
    freigegeben_am timestamptz NOT NULL DEFAULT now(),
    freigegeben_von text       NOT NULL,
    -- Woran die Freigabe hing. Gehört zur Entscheidung, nicht zur Zierde:
    -- "Abgleich bis 10/2026 geprüft, 0 unzugeordnete Eingänge".
    notiz          text
);

ALTER TABLE mahnwesen_freigabe ENABLE ROW LEVEL SECURITY;
ALTER TABLE mahnwesen_freigabe FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mahnwesen_freigabe_mandant ON mahnwesen_freigabe;
CREATE POLICY mahnwesen_freigabe_mandant ON mahnwesen_freigabe
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

GRANT SELECT, INSERT, DELETE ON mahnwesen_freigabe TO stig_app;

-- Kein UPDATE: Eine Freigabe wird nicht umgeschrieben, sondern
-- zurückgenommen (DELETE) und neu erteilt. Sonst stünde am Ende ein Datum,
-- an dem niemand mehr weiß, wofür es galt.

COMMENT ON TABLE mahnwesen_freigabe IS
    'Eine Zeile je Mandant = Mahnwesen freigegeben. Keine Zeile = gesperrt. '
    'Ohne Freigabe werden keine Mahnungen und Zahlungserinnerungen erzeugt.';

COMMIT;
