-- Der Eigenbeleg als eigene Belegart
--
-- WARUM
--
-- Nicht jede Ausgabe bringt eine Rechnung mit. Ein Kauf von einer
-- Privatperson ueber Kleinanzeigen stellt keine; eine Quittung geht
-- verloren; ein Trinkgeld, ein Parkautomat, ein Automatenkauf geben
-- nichts heraus, was ein Steuerberater anfassen kann. Am 06.11.2026
-- lagen allein 43 solche Zahlungen offen.
--
-- Fuer diesen Fall gibt es den Eigenbeleg: Man schreibt selbst
-- auf, was man bezahlt hat, wofuer, an wen -- und WARUM es keinen
-- Fremdbeleg gibt. Dieser letzte Satz ist der entscheidende. Ohne ihn
-- ist es ein Zettel; mit ihm ist es ein Beleg.
--
-- WARUM EINE EIGENE ART UND NICHT 'sonstige'
--
-- Weil ein Eigenbeleg etwas anderes beweist als eine Rechnung. Eine
-- Rechnung bezeugt ein Dritter; einen Eigenbeleg bezeugt nur der, der
-- ihn geschrieben hat. Diese Unterscheidung muss in den Buechern
-- sichtbar bleiben -- fuer die Pruefung, und fuer die Frage "wie viel
-- von diesem Jahr steht nur auf meinem Wort?". Unter 'quittung' oder
-- 'sonstige' verschwindet sie.

BEGIN;

ALTER TABLE beleg DROP CONSTRAINT IF EXISTS beleg_art_check;
ALTER TABLE beleg ADD CONSTRAINT beleg_art_check
    CHECK (art IN ('rechnung','gutschrift','quittung','eigenbeleg',
                   'vertrag','bescheid','sonstige'));

-- Der Grund, warum kein Fremdbeleg vorliegt.
--
-- Pflicht bei einem Eigenbeleg (CHECK unten), sonst leer. Freitext und
-- keine Auswahlliste: Die Gruende sind zu verschieden, um sie
-- vorwegzunehmen, und eine erzwungene Auswahl verleitet zum
-- naechstbesten Haken.
ALTER TABLE beleg ADD COLUMN IF NOT EXISTS eigenbeleg_grund text;

-- Die Art der Aufwendung, in Worten: "Pizzaschneider fuer die
-- Gemeinschaftskueche", "Porto fuer die Kuendigung an Mieter A".
--
-- Das ist nicht die kostenart (die ordnet steuerlich ein), sondern das,
-- was gekauft wurde. Bei einer Rechnung steht es im Dokument; bei einem
-- Eigenbeleg muss es jemand sagen, sonst steht da nur ein Betrag.
ALTER TABLE beleg ADD COLUMN IF NOT EXISTS zweck text;

-- Wer den Beleg geschrieben hat, und wann.
--
-- Beim Eigenbeleg ist das Teil des Belegs selbst: Er traegt die
-- Unterschrift seines Erstellers, und wenn die Unterschrift auf Papier
-- fehlt, ist dieser Eintrag das, was an ihre Stelle tritt. angelegt_am
-- gibt es schon, erstellt_von fehlte.
ALTER TABLE beleg ADD COLUMN IF NOT EXISTS erstellt_von text;

-- Ein Eigenbeleg ohne Grund ist ein Zettel.
ALTER TABLE beleg DROP CONSTRAINT IF EXISTS beleg_eigenbeleg_braucht_grund;
ALTER TABLE beleg ADD CONSTRAINT beleg_eigenbeleg_braucht_grund
    CHECK (art <> 'eigenbeleg'
           OR (eigenbeleg_grund IS NOT NULL
               AND length(btrim(eigenbeleg_grund)) > 0
               AND zweck IS NOT NULL
               AND length(btrim(zweck)) > 0
               AND belegdatum IS NOT NULL
               AND betrag_brutto IS NOT NULL
               AND erstellt_von IS NOT NULL));

COMMIT;
