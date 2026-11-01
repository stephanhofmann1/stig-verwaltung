-- Adressen -> Mandant
--
-- Henne-Ei-Problem: Eine eingehende Mail muss einem Mandanten zugeordnet
-- werden, bevor einer feststeht. Nachschlagen laesst sich das nur in einer
-- Tabelle, die ohne gesetzten Mandanten lesbar ist -- die Tabelle "mandant"
-- ist es per Policy ausdruecklich nicht.
--
-- Diese Tabelle ist deshalb bewusst von RLS ausgenommen. Sie enthaelt nichts
-- Schuetzenswertes: nur, welche Empfaengeradresse zu welchem Mandanten
-- gehoert. Keine Namen, keine Mieter, keine Betraege.

BEGIN;

CREATE TABLE mandant_adresse (
    adresse     text PRIMARY KEY,                 -- immer klein geschrieben
    mandant_id  uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
    art         text NOT NULL DEFAULT 'eingang'
                CHECK (art IN ('eingang','absender','website')),
    angelegt_am timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mandant_adresse_mandant_idx ON mandant_adresse (mandant_id);

-- Kleinschreibung erzwingen, damit das Nachschlagen nie an der
-- Gross-/Kleinschreibung des Absenders scheitert.
ALTER TABLE mandant_adresse
    ADD CONSTRAINT mandant_adresse_klein CHECK (adresse = lower(adresse));

INSERT INTO mandant_adresse (adresse, mandant_id, art)
SELECT 'verwaltung@stig-immobilien.de', id, 'eingang' FROM mandant WHERE kuerzel = 'stig';

INSERT INTO mandant_adresse (adresse, mandant_id, art)
SELECT 'westanlage9.de', id, 'website' FROM mandant WHERE kuerzel = 'stig';

GRANT SELECT ON mandant_adresse TO stig_app;

COMMIT;
