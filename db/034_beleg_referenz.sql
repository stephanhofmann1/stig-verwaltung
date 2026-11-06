BEGIN;

-- Referenznummern am Beleg
--
-- ANLASS
--
-- Am 05.11.2026 lagen 229 Belege im Portal und 162 offene
-- Amazon-Abbuchungen auf dem Konto. Zugeordnet wurde davon nichts. Der
-- Grund war weder Technik noch Datenqualitaet, sondern eine falsche
-- Annahme: Der Abgleich sucht die BELEGNUMMER im Verwendungszweck.
--
-- Im Verwendungszweck steht aber:
--
--     304-2954807-8841912 Amazon.de 3UQ5C3CMI8RC7RAF
--
-- Das ist die Bestellnummer und eine Zahlungsreferenz. Die
-- Rechnungsnummer (DE65XW869AEUD) steht dort NIE. Gesucht wurde also
-- etwas, das es an dieser Stelle nicht gibt -- und das bei jedem
-- einzelnen der 162 Vorgaenge.
--
-- WARUM EINE EIGENE TABELLE UND KEINE ZWEITE SPALTE
--
-- Eine Spalte `bestellnummer` wuerde Amazon loesen und sonst nichts. Die
-- Bank schreibt bei jedem Zahlungsempfaenger etwas anderes in den
-- Verwendungszweck:
--
--   Amazon      Bestellnummer und Zahlungsreferenz
--   Versorger   Kundennummer oder Vertragskonto
--   Stadtkasse  Kassenzeichen
--   Handwerker  Rechnungsnummer, manchmal mit Praefix
--
-- Ein Beleg kann mehrere davon tragen, und welche davon in der
-- Abbuchung auftaucht, entscheidet der Zahlungsempfaenger, nicht wir.
-- Deshalb: beliebig viele Referenzen je Beleg, jede mit ihrer Art.
--
-- `normiert` ist der Vergleichswert: Grossbuchstaben, ohne Bindestrich,
-- Schraegstrich, Punkt und Leerzeichen. "304-2954807-8841912" und
-- "3042954807 8841912" sind dieselbe Nummer, und welche Schreibweise im
-- Auszug landet, haengt an der Bank. Ohne diese Spalte muesste jeder
-- Vergleich beide Seiten zur Laufzeit putzen -- und einer der beiden
-- wuerde irgendwann vergessen.

-- Zielspalte fuer den zusammengesetzten Fremdschluessel. Muster aus
-- db/029 und db/031: in einem DO-Block, damit die Migration auch auf
-- einer Datenbank laeuft, auf der sie schon einmal lief.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'beleg_id_mandant_key'
  ) THEN
    ALTER TABLE beleg ADD CONSTRAINT beleg_id_mandant_key UNIQUE (id, mandant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS beleg_referenz (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id  uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                     DEFAULT aktueller_mandant(),

    -- Fremdschluessel unten als zusammengesetzter Schluessel ueber
    -- (beleg_id, mandant_id): Eine Referenz darf nicht auf einen Beleg
    -- eines anderen Mandanten zeigen, auch wenn jemand dessen Kennung
    -- kennt.
    beleg_id    uuid NOT NULL,

    art         text NOT NULL CHECK (art IN (
                  'bestellnummer',     -- Amazon: 304-2954807-8841912
                  'zahlungsreferenz',  -- Amazon: 3UQ5C3CMI8RC7RAF
                  'rechnungsnummer',
                  'kundennummer',
                  'vertragsnummer',
                  'kassenzeichen'      -- Stadtkasse
                )),

    -- Wie sie im Beleg steht, fuer die Anzeige.
    wert        text NOT NULL CHECK (length(wert) BETWEEN 4 AND 64),

    -- Wie verglichen wird: Grossbuchstaben, ohne Trennzeichen.
    normiert    text NOT NULL CHECK (length(normiert) BETWEEN 4 AND 64),

    angelegt_am timestamptz NOT NULL DEFAULT now(),

    -- Dieselbe Nummer zweimal am selben Beleg ist ein Versehen. Die
    -- UNIQUE fuehrt mit mandant_id, wie jede UNIQUE in diesem Schema.
    UNIQUE (mandant_id, beleg_id, art, normiert)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'beleg_referenz_beleg_fk'
  ) THEN
    ALTER TABLE beleg_referenz
      ADD CONSTRAINT beleg_referenz_beleg_fk
      FOREIGN KEY (beleg_id, mandant_id)
      REFERENCES beleg (id, mandant_id) ON DELETE CASCADE;
  END IF;
END $$;

-- Gesucht wird immer ueber den normierten Wert.
CREATE INDEX IF NOT EXISTS beleg_referenz_normiert_idx
    ON beleg_referenz (normiert);
CREATE INDEX IF NOT EXISTS beleg_referenz_beleg_idx
    ON beleg_referenz (beleg_id);

ALTER TABLE beleg_referenz ENABLE ROW LEVEL SECURITY;
ALTER TABLE beleg_referenz FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beleg_referenz_mandant ON beleg_referenz;
CREATE POLICY beleg_referenz_mandant ON beleg_referenz
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

COMMIT;
