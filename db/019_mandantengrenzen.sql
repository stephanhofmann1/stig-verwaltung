-- Nachtrag zur Mandantenfaehigkeit: vier Eindeutigkeiten und die
-- Mieteransicht
--
-- Migration 010 hat drei global eindeutige Spalten auf den Mandanten
-- umgestellt (kontakt_email.email, vorgang.referenz, postfach.bezeichnung)
-- und dabei vier weitere uebersehen. Die Begruendung von damals gilt fuer
-- alle gleich und steht in 010 woertlich: "Zwei Vermieter mit demselben
-- Handwerker oder denselben Stadtwerken sind in einer Region der Normalfall,
-- nicht die Ausnahme."
--
-- Warum das jetzt dringend ist: Solange nur STIG auf der Plattform liegt,
-- faellt keine dieser Grenzen auf. Sie fallen beim ersten fremden Mandanten
-- auf -- also beim ersten Kunden, und dort als Fehlermeldung beim Anlegen
-- seiner eigenen Daten. Das ist der schlechteste Zeitpunkt.
--
-- Zwei der vier sind zusaetzlich ein Datenleck in der Gegenrichtung: Wer
-- beim Anlegen erfaehrt, dass eine Telefonnummer "schon vergeben" ist,
-- erfaehrt etwas ueber den Bestand eines anderen Vermieters.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Telefonnummer am Kontakt
-- ---------------------------------------------------------------------------
--
-- Derselbe Handwerker, dieselbe Nummer, zwei Vermieter. Bisher konnte der
-- zweite ihn nicht anlegen.

ALTER TABLE kontakt_telefon DROP CONSTRAINT IF EXISTS kontakt_telefon_nummer_e164_key;
ALTER TABLE kontakt_telefon ADD CONSTRAINT kontakt_telefon_nummer_e164_key
    UNIQUE (mandant_id, nummer_e164);

-- ---------------------------------------------------------------------------
-- 2. Kontobezeichnung
-- ---------------------------------------------------------------------------
--
-- "Girokonto" ist der wahrscheinlichste Name fuer das erste Konto eines
-- jeden Vermieters. Global eindeutig heisst: Genau einer auf der Plattform
-- darf ihn verwenden.

ALTER TABLE konto DROP CONSTRAINT IF EXISTS konto_bezeichnung_key;
ALTER TABLE konto ADD CONSTRAINT konto_bezeichnung_key
    UNIQUE (mandant_id, bezeichnung);

-- ---------------------------------------------------------------------------
-- 3. und 4. Dubletten-Erkennung bei Nachrichten
-- ---------------------------------------------------------------------------
--
-- Diese zwei Indizes verhindern, dass dieselbe Mail zweimal als Nachricht
-- landet. Das ist richtig und muss bleiben -- aber je Mandant.
--
-- Eine Message-ID ist laut RFC 5322 weltweit eindeutig, und daraus liesse
-- sich schliessen, ein globaler Index sei korrekt. Der Schluss ist falsch,
-- weil hier nicht die Nachricht eindeutig sein soll, sondern ihre Ablage:
-- Eine Mail an zwei Eingangsadressen zweier Mandanten -- ein Rundschreiben
-- der Stadtwerke, ein Anwalt im CC, eine an beide Vermieter gerichtete
-- Nachricht -- ist zweimal zuzustellen, nicht einmal. Bisher gewinnt, wessen
-- Worker zuerst laeuft; beim anderen verschwindet die Mail lautlos. Kein
-- Fehler, kein Protokolleintrag, nur eine Nachricht, die nie ankam.
--
-- Fuer die Dublettenerkennung innerhalb eines Mandanten aendert sich
-- nichts: Dort bleibt die Message-ID eindeutig.

DROP INDEX IF EXISTS nachricht_message_id_idx;
CREATE UNIQUE INDEX nachricht_message_id_idx
    ON nachricht (mandant_id, message_id) WHERE message_id IS NOT NULL;

DROP INDEX IF EXISTS nachricht_extern_id_idx;
CREATE UNIQUE INDEX nachricht_extern_id_idx
    ON nachricht (mandant_id, kanal, extern_id) WHERE extern_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Mieteransicht: die Miete, die der Mieter wirklich zahlt
-- ---------------------------------------------------------------------------
--
-- mieter_uebersicht (Migration 015) gibt kaltmiete und nebenkosten aus. Das
-- war die vollstaendige Miete, solange es keinen Moeblierungszuschlag gab.
-- Seit 017 gibt es ihn -- und fast alle WG-Zimmer sind moebliert vermietet.
--
-- Ein Mieter, der in seinem eigenen Bereich 540 EUR liest und 600 EUR
-- abbucht, haelt entweder die Abbuchung fuer falsch oder die Anzeige. Beides
-- endet als Rueckfrage, und die eine Variante, in der er sich auf die
-- Anzeige beruft, endet schlechter.
--
-- Ausgegeben wird deshalb beides: die Posten einzeln, damit die Herleitung
-- nachvollziehbar bleibt, und der geschuldete Gesamtbetrag. Vorrang hat die
-- im Vertrag zugesagte gesamtmiete -- geschuldet ist, was vereinbart wurde,
-- nicht was die Summe ergibt. Dieselbe Regel wie in lib/sollstellung.ts,
-- damit Mieteransicht und Sollstellung nie verschiedene Betraege nennen.

-- DROP davor, nicht CREATE OR REPLACE: Die Funktion bekommt zwei Spalten
-- mehr, und Postgres laesst die Rueckgabestruktur einer bestehenden Funktion
-- nicht ersetzen ("cannot change return type of existing function"). Der
-- DROP nimmt die Rechte mit, deshalb steht der GRANT unten erneut.
DROP FUNCTION IF EXISTS mieter_uebersicht(uuid);

CREATE FUNCTION mieter_uebersicht(p_mv uuid)
RETURNS TABLE (
    anzeigename  text,
    objekt       text,
    strasse      text,
    plz          text,
    ort          text,
    einheit      text,
    etage        text,
    beginn       date,
    kaltmiete    numeric,
    nebenkosten  numeric,
    moeblierung  numeric,
    gesamtmiete  numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT k.anzeigename, o.name, o.strasse, o.plz, o.ort,
           e.bezeichnung, e.etage, mv.beginn,
           mv.kaltmiete, mv.nebenkosten, mv.moeblierungszuschlag,
           COALESCE(
               NULLIF(mv.gesamtmiete, 0),
               COALESCE(mv.kaltmiete, 0)
                 + COALESCE(mv.nebenkosten, 0)
                 + COALESCE(mv.moeblierungszuschlag, 0)
           )
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
      JOIN objekt  o ON o.id = e.objekt_id
     WHERE mv.id = p_mv;
$$;

REVOKE ALL ON FUNCTION mieter_uebersicht(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mieter_uebersicht(uuid) TO stig_app;

COMMIT;
