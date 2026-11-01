-- Mandantenfaehigkeit
--
-- Bis hierher war die Datenbank fuer genau einen Vermieter gebaut. Ab jetzt
-- traegt jede Zeile einen Mandanten, und Postgres selbst sorgt dafuer, dass
-- niemand ueber die Grenze sieht.
--
-- Warum Row Level Security und nicht "WHERE mandant_id = ...":
-- Eine WHERE-Bedingung muss man bei jeder kuenftigen Abfrage mitdenken,
-- fuer immer. Eine vergessene reicht, und ein Vermieter sieht die Mieter
-- eines anderen. Mit RLS weigert sich die Datenbank. Die Anwendung setzt
-- pro Anfrage SET LOCAL app.mandant, danach ist das Thema erledigt.
--
-- Wichtig: Der Eigentuemer einer Tabelle umgeht RLS standardmaessig. Die
-- Anwendung verbindet sich als "stig" und ist zugleich Eigentuemer --
-- deshalb FORCE ROW LEVEL SECURITY. Ohne das waere die ganze Uebung wirkungslos.

BEGIN;

-- ---------------------------------------------------------------------------
-- Der Mandant
-- ---------------------------------------------------------------------------

CREATE TABLE mandant (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL,            -- "STIG Immobilien eGbR"
    kuerzel         text        NOT NULL UNIQUE,     -- "stig" -- fuer Adressen
    -- Eigener Nummernkreis: Kunde B soll nicht an seiner ersten Vorgangsnummer
    -- ablesen koennen, wie viele Vorgaenge alle anderen zusammen haben.
    vorgang_zaehler bigint      NOT NULL DEFAULT 0,
    absender_email  text,                            -- je Mandant eigener Versand
    absender_name   text,
    aktiv           boolean     NOT NULL DEFAULT true,
    angelegt_am     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mandant (name, kuerzel, absender_email, absender_name)
VALUES ('STIG Immobilien eGbR', 'stig',
        'verwaltung@stig-immobilien.de', 'STIG Immobilien');

-- Wird weiter unten als Vorgabewert jeder mandant_id-Spalte gebraucht und
-- muss deshalb vor den Spalten existieren.
--
-- Ohne gesetztes app.mandant liefert current_setting(...,true) NULL, und
-- NULL = irgendwas ist nie wahr. Eine vergessene Zuweisung fuehrt damit zu
-- "keine Zeilen" statt zu "alle Zeilen" -- der Fehler faellt sofort auf,
-- statt still Daten zu vermischen.
CREATE OR REPLACE FUNCTION aktueller_mandant() RETURNS uuid AS $$
    SELECT nullif(current_setting('app.mandant', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- mandant_id ueberall
--
-- Auch auf die Kindtabellen, obwohl sie ueber Fremdschluessel am Elternteil
-- haengen. Eine RLS-Policy braucht ein Praedikat auf der Zeile selbst; ein
-- Unterabfrage-Join waere langsam und leicht falsch zu schreiben.
--
-- Die Spalte bekommt aktueller_mandant() als Vorgabewert. Damit muessen die
-- bestehenden INSERT-Anweisungen im Code nicht angefasst werden: Sie nennen
-- mandant_id nicht, und die Datenbank setzt den Mandanten der laufenden
-- Transaktion ein. Nur Faelle, die ausdruecklich fuer einen anderen Mandanten
-- schreiben, muessen ihn angeben -- und die scheitern an der Policy, falls er
-- nicht zum Kontext passt.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    t text;
    m uuid;
BEGIN
    SELECT id INTO m FROM mandant WHERE kuerzel = 'stig';

    FOREACH t IN ARRAY ARRAY[
        'objekt','einheit','kontakt','kontakt_email','kontakt_telefon',
        'mietverhaeltnis','vorgang','nachricht','anhang','protokoll',
        'konto','buchung','sollstellung','zuordnung','zahlerkennung',
        'beleg','belegbuchung','postfach'
    ] LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN mandant_id uuid REFERENCES mandant(id) ON DELETE RESTRICT', t);
        EXECUTE format('UPDATE %I SET mandant_id = %L', t, m);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN mandant_id SET NOT NULL', t);
        EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN mandant_id SET DEFAULT aktueller_mandant()', t);
        EXECUTE format('CREATE INDEX %I ON %I (mandant_id)', t || '_mandant_idx', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Eindeutigkeiten, die global waren und es nicht bleiben duerfen
-- ---------------------------------------------------------------------------

-- Zwei Vermieter mit demselben Handwerker oder denselben Stadtwerken sind
-- in einer Region der Normalfall, nicht die Ausnahme. Global eindeutig
-- haette das Anlegen des zweiten Kontakts schlicht abgelehnt.
ALTER TABLE kontakt_email DROP CONSTRAINT kontakt_email_email_key;
ALTER TABLE kontakt_email ADD CONSTRAINT kontakt_email_email_key
    UNIQUE (mandant_id, email);

ALTER TABLE vorgang DROP CONSTRAINT vorgang_referenz_key;
ALTER TABLE vorgang ADD CONSTRAINT vorgang_referenz_key
    UNIQUE (mandant_id, referenz);

-- ---------------------------------------------------------------------------
-- Nummernkreis je Mandant
--
-- Ersetzt die bisherige globale Identity-Spalte als Quelle der Referenz.
-- nummer bleibt als technische Reihenfolge erhalten.
-- ---------------------------------------------------------------------------

ALTER TABLE vorgang ADD COLUMN mandant_nummer bigint;

-- Bestand nachtragen: in Reihenfolge der Anlage durchnummerieren.
WITH neu AS (
    SELECT id, row_number() OVER (PARTITION BY mandant_id ORDER BY angelegt_am, nummer) AS n
      FROM vorgang
)
UPDATE vorgang v SET mandant_nummer = neu.n FROM neu WHERE neu.id = v.id;

UPDATE mandant m SET vorgang_zaehler =
    COALESCE((SELECT max(mandant_nummer) FROM vorgang v WHERE v.mandant_id = m.id), 0);

CREATE OR REPLACE FUNCTION setze_referenz() RETURNS trigger AS $$
BEGIN
    IF NEW.mandant_nummer IS NULL THEN
        -- Zaehler im Mandanten hochsetzen. UPDATE ... RETURNING sperrt die
        -- Zeile, zwei gleichzeitige Eingaenge bekommen also nie dieselbe Nummer.
        UPDATE mandant SET vorgang_zaehler = vorgang_zaehler + 1
         WHERE id = NEW.mandant_id
        RETURNING vorgang_zaehler INTO NEW.mandant_nummer;
    END IF;
    IF NEW.referenz IS NULL THEN
        NEW.referenz := 'V-' || lpad(NEW.mandant_nummer::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE vorgang ALTER COLUMN mandant_nummer SET NOT NULL;
ALTER TABLE vorgang ADD CONSTRAINT vorgang_mandant_nummer_key
    UNIQUE (mandant_id, mandant_nummer);

-- postfach: die Bezeichnung war global eindeutig.
ALTER TABLE postfach DROP CONSTRAINT postfach_bezeichnung_key;
ALTER TABLE postfach ADD CONSTRAINT postfach_bezeichnung_key
    UNIQUE (mandant_id, bezeichnung);

-- ---------------------------------------------------------------------------
-- Benutzer
--
-- Bisher stand die Anmeldung als BENUTZER=name:scrypt$... in der Umgebung.
-- Das traegt fuer zwei Personen, nicht fuer Kunden. Verfahren (scrypt) und
-- Cookie-Signatur bleiben wie sie sind, nur die Quelle wechselt.
--
-- Die Rolle wird tragend, sobald Mieter dazukommen: Ein Mieter ist
-- angemeldet, darf aber nichts aus der Verwaltung sehen. "Angemeldet" allein
-- genuegt ab hier nicht mehr als Zugangspruefung.
-- ---------------------------------------------------------------------------

CREATE TABLE benutzer (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id         uuid        NOT NULL REFERENCES mandant(id) ON DELETE CASCADE,
    name               text        NOT NULL,
    email              text,
    passwort_hash      text,                       -- scrypt$salz$hash; leer bei Mietern
    rolle              text        NOT NULL DEFAULT 'verwalter'
                       CHECK (rolle IN ('verwalter','lesen','mieter')),
    -- Nur bei rolle='mieter' gesetzt: woran haengt der Zugang.
    mietverhaeltnis_id uuid        REFERENCES mietverhaeltnis(id) ON DELETE CASCADE,
    aktiv              boolean     NOT NULL DEFAULT true,
    letzte_anmeldung   timestamptz,
    angelegt_am        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (mandant_id, name),
    CHECK (rolle <> 'mieter' OR mietverhaeltnis_id IS NOT NULL),
    CHECK (rolle =  'mieter' OR passwort_hash IS NOT NULL)
);

CREATE INDEX benutzer_mandant_idx ON benutzer (mandant_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'objekt','einheit','kontakt','kontakt_email','kontakt_telefon',
        'mietverhaeltnis','vorgang','nachricht','anhang','protokoll',
        'konto','buchung','sollstellung','zuordnung','zahlerkennung',
        'beleg','belegbuchung','postfach','benutzer'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY mandant_trennung ON %I USING (mandant_id = aktueller_mandant())
             WITH CHECK (mandant_id = aktueller_mandant())', t);
    END LOOP;
END $$;

-- Die Mandantentabelle selbst: jeder sieht nur den eigenen Eintrag.
-- Ohne gesetzten Mandanten ist sie leer -- auch die Liste der Kunden ist
-- eine Information, die niemanden ausser uns etwas angeht.
ALTER TABLE mandant ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandant FORCE  ROW LEVEL SECURITY;
CREATE POLICY mandant_selbst ON mandant USING (id = aktueller_mandant());

-- Eigene Rolle fuer Wartung und Onboarding, die an RLS vorbei darf.
-- Die Anwendung benutzt sie nie.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stig_admin') THEN
        CREATE ROLE stig_admin NOLOGIN BYPASSRLS;
    END IF;
END $$;

COMMIT;
