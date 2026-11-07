-- Die stille Kopie je Mandant
--
-- WARUM AN DEN MANDANTEN UND NICHT IN DIE UMGEBUNG
--
-- Jede ausgehende Mail traegt eine stille Kopie, damit der Absender
-- nachvollziehen kann, ob sie wirklich draussen war (lib/versand.ts).
-- Die Adresse stand bisher in VERSAND_KOPIE bzw. LAGEBERICHT_AN -- und
-- das gilt fuer die ganze Installation. Sobald ein zweiter Mandant
-- Mails verschickt, bekaeme der erste eine verdeckte Kopie davon.
--
-- Das ist nicht nur unsauber, es ist die Art Fehler, die niemandem
-- auffaellt: Eine BCC-Zustellung meldet sich nicht. Der zweite Kunde
-- wuerde nie erfahren, dass seine Korrespondenz mitgelesen wird.
--
-- db/010 hat fuer Absenderadresse und -namen bereits eigene Spalten am
-- Mandanten (absender_email, absender_name) -- diese gehoert daneben.
--
-- WARUM NULL ETWAS ANDERES BEDEUTET ALS LEER
--
-- NULL heisst "nicht entschieden": Dann greift die Umgebung als
-- Rueckfallebene, damit die bestehende Installation weiterlaeuft, ohne
-- dass jemand erst etwas eintragen muss. Ein leerer String heisst
-- "ausdruecklich keine Kopie" -- eine Entscheidung, die die
-- Rueckfallebene ueberstimmt.

BEGIN;

ALTER TABLE mandant ADD COLUMN IF NOT EXISTS versand_kopie text;

COMMENT ON COLUMN mandant.versand_kopie IS
  'BCC-Adresse fuer jede ausgehende Mail dieses Mandanten. '
  'NULL = nicht entschieden, dann greift VERSAND_KOPIE/LAGEBERICHT_AN. '
  'Leer = ausdruecklich keine Kopie.';

-- Eine Adresse oder gar nichts. Ein Tippfehler ohne @ waere eine Kopie,
-- die lautlos nirgends ankommt -- und genau darum geht es hier nicht.
ALTER TABLE mandant DROP CONSTRAINT IF EXISTS mandant_versand_kopie_form;
ALTER TABLE mandant ADD CONSTRAINT mandant_versand_kopie_form
    CHECK (versand_kopie IS NULL
           OR versand_kopie = ''
           OR versand_kopie ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

COMMIT;
