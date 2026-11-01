-- Ab wann gibt es für ein Objekt überhaupt Kontodaten?
--
-- Das ist keine Feinheit, sondern die Voraussetzung dafür, dass das Mahnwesen
-- benutzbar ist. Stand der Dinge (Dateianalyse vom 01.11.2026):
--
--   Welserstraße 10   Kontoeröffnung Volksbank Bühl am 01.12.2024
--   Westanlage 9      Kontoeröffnung Sparkasse Wetzlar am 13.06.2025
--   Augartenstraße 91 kein eigenes Konto; Hausgeld läuft über ein Privatkonto
--
-- Abgerechnet wird aber ab Januar 2024 (Welserstraße und Augartenstraße, so
-- von Stephan entschieden). Für Ludwigshafen entstehen damit elf Monate
-- Sollstellungen, zu denen es gar keine Zahlungsdaten geben *kann* -- die
-- Mieten 2024 flossen dem Voreigentümer zu und stehen auf keinem Konto von
-- Stephan.
--
-- Ohne diese Spalte sähe das Mahnwesen in jedem dieser Monate einen offenen
-- Betrag und würde daraus einen Rückstand von über zwanzig Monatsmieten
-- ableiten. Jeder Ludwigshafener Mieter wäre dann ein Fall für § 543 Abs. 2
-- Nr. 3 BGB -- ausgerechnet die langjährigen, die pünktlich zahlen.
--
-- NULL heißt: keine Zahlungsdaten. Das ist der Vorgabewert und die sichere
-- Richtung: ein Objekt, bei dem niemand das Datum gepflegt hat, mahnt nicht.
-- Lieber Schweigen als eine falsche Beschuldigung.

BEGIN;

ALTER TABLE objekt
    ADD COLUMN IF NOT EXISTS zahlungsdaten_ab date;

COMMENT ON COLUMN objekt.zahlungsdaten_ab IS
    'Erster Tag, ab dem Kontoumsätze vollständig vorliegen. NULL = keine '
    'Zahlungsdaten, dann wird für dieses Objekt nicht gemahnt.';

-- Die bekannten Werte. Nach Name, weil objekt keinen stabilen Schlüssel hat;
-- ILIKE, weil der Straßenname mal mit und mal ohne Hausnummer geschrieben ist.
UPDATE objekt SET zahlungsdaten_ab = date '2024-12-01'
 WHERE name ILIKE '%welser%' AND zahlungsdaten_ab IS NULL;

UPDATE objekt SET zahlungsdaten_ab = date '2025-06-13'
 WHERE name ILIKE '%westanlage%' AND zahlungsdaten_ab IS NULL;

-- Augartenstraße 91 bleibt bewusst NULL. Es gibt kein STIG-Konto dafür; die
-- vorhandenen Daten liegen auf einem Privatkonto und haben dort Lücken von
-- Januar 2024 bis Februar 2025. Solange das so ist, darf dort nicht gemahnt
-- werden. Wenn die Auszüge nachgereicht werden, ist das ein UPDATE.

COMMIT;
