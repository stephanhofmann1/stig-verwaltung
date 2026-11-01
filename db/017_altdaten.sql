-- Altdatenuebernahme: die Felder, ohne die der Umzug Daten verliert
--
-- Das Schema bis 016 ist fuer Vorgaenge und Nachrichten gebaut und dort dem
-- Altsystem (westanlage9-vercel) voraus. Die Vermietungs- und Vertragsseite
-- fehlt dagegen ganz: Von den Feldern, die das Altsystem am Mietverhaeltnis
-- fuehrt, haben achtzehn kein Ziel in dieser Datenbank. Ein Import ohne
-- diese Migration ist kein unvollstaendiger Import, sondern ein
-- unumkehrbarer Verlust -- die Quelle ist ein unversionierter Blob.
--
-- Lackmustest der Vollstaendigkeit sind die zwei Dokumente, die das
-- Altsystem erzeugt und die Plattform weiter erzeugen muss:
--   api/_vertrag.js  Mietvertrag -- braucht Geburtsdatum, Geburtsort,
--                    Anschrift bei Vertragsschluss, Vertragsdatum,
--                    Befristung, Kuendigungsverzicht, Gesamtmiete,
--                    Moeblierungszuschlag, Kautionsraten
--   api/_wgb.js      Wohnungsgeberbestaetigung (§ 19 BMG) -- braucht den
--                    vollen Namen und den Meldezusatz
-- Fehlt ein Feld, laesst sich das Dokument nicht mehr erzeugen. Das ist
-- kein Komfortverlust, sondern der Zweck, zu dem die Daten existieren.
--
-- Abweichungen von der Analyse (/home/claude/abgleich-datenmodelle.md) sind
-- jeweils an der Stelle begruendet, an der sie auftreten.
--
-- Die Datei ist absichtlich wiederholbar: IF NOT EXISTS an jeder Spalte,
-- gepruefte ADD CONSTRAINT, WHERE-Bedingung an jedem UPDATE. Nicht weil der
-- Runner sie zweimal einspielen wuerde -- er merkt sich den Dateinamen --
-- sondern damit ein Lauf, der an einem unerwarteten Altbestand scheitert,
-- nach der Korrektur ohne Handarbeit wiederholt werden kann.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Kontakt: die Personenangaben, die im Vertrag stehen
-- ---------------------------------------------------------------------------
--
-- anzeigename kann nicht beides sein. Der Vertrag und die Meldebestaetigung
-- brauchen den Namen wie im Pass, die Willkommensmail und der Mieterbereich
-- den Rufnamen ("Hallo Max"). Das Altsystem fuehrt beides getrennt
-- (person.vollerName / person.name); anzeigename bleibt der Passname, weil
-- daran die Dokumente haengen.

ALTER TABLE kontakt
    ADD COLUMN IF NOT EXISTS rufname      text,
    ADD COLUMN IF NOT EXISTS geburtsdatum date,
    ADD COLUMN IF NOT EXISTS geburtsort   text,
    -- Aktuelle Postanschrift. Nicht nur fuer den Vertrag: eine Mahnung
    -- muss zustellbar sein, und bisher hat diese Datenbank zu keinem
    -- Kontakt -- auch zu keinem Handwerker -- eine Adresse.
    ADD COLUMN IF NOT EXISTS anschrift    text;

-- ---------------------------------------------------------------------------
-- 2. Mietverhaeltnis: Vertragsdaten
-- ---------------------------------------------------------------------------

ALTER TABLE mietverhaeltnis
    -- Datum oben rechts im Vertrag. Nicht identisch mit beginn: unterschrieben
    -- wird vorher, manchmal Wochen vorher.
    ADD COLUMN IF NOT EXISTS vertrag_datum date,

    -- Nicht aus "ende IS NOT NULL" ableitbar: ende traegt auch einen
    -- Kuendigungstermin. Befristung heisst § 549 Abs. 2 Nr. 1 BGB und
    -- aendert den Wortlaut von § 2 des Vertrags.
    ADD COLUMN IF NOT EXISTS befristet boolean NOT NULL DEFAULT false,

    -- Aus dem Verzicht rechnet § 2 zwei Daten aus: wann eine ordentliche
    -- Kuendigung frueheste Wirkung hat und wann sie dafuer zugehen muss.
    -- Obergrenze vier Jahre, laenger ist nach BGH-Rechtsprechung unwirksam.
    ADD COLUMN IF NOT EXISTS kuendigungsverzicht_monate integer NOT NULL DEFAULT 0
        CHECK (kuendigungsverzicht_monate BETWEEN 0 AND 48),

    -- Der woertlich zugesagte Betrag aus § 3 und § 4. Ableiten waere falsch:
    -- was im Vertrag steht, steht dort auch dann, wenn die Summe der
    -- Bestandteile einen Cent daneben liegt.
    ADD COLUMN IF NOT EXISTS gesamtmiete numeric(10,2),

    -- Der Grund, warum lib/sollstellung.ts heute zu wenig stellt: dort wird
    -- kaltmiete + nebenkosten gerechnet, und der Zuschlag aus § 3 faellt
    -- heraus. Jeden Monat, bei jedem moeblierten Mietverhaeltnis.
    ADD COLUMN IF NOT EXISTS moeblierungszuschlag numeric(10,2),

    -- § 4: Ratenzahlung nach § 551 Abs. 2 BGB. Drei Raten sind der
    -- gesetzliche Anspruch und die Zahl, die im Vertragstext steht.
    ADD COLUMN IF NOT EXISTS kaution_raten smallint NOT NULL DEFAULT 1
        CHECK (kaution_raten BETWEEN 1 AND 3),

    -- Vertragsmerkmal, nicht Gebaeudemerkmal: dasselbe Zimmer kann
    -- unmoebliert vermietet werden.
    --
    -- Abweichung von der Analyse, die DEFAULT true vorschlaegt: unmoebliert
    -- ist der gesetzliche Normalfall, und ein Vorgabewert true wuerde jedem
    -- Mietverhaeltnis in Ludwigshafen und jedem kuenftigen Mandanten still
    -- eine Moeblierung samt Zuschlagstext unterstellen. Fuer Westanlage 9
    -- setzt der Import das Feld ausdruecklich.
    ADD COLUMN IF NOT EXISTS moebliert boolean NOT NULL DEFAULT false,

    -- Feld "zusatz" der Wohnungsgeberbestaetigung, z. B. "4. OG links
    -- (Studio-Apartment, Dachgeschoss)". Gehoert an das Mietverhaeltnis und
    -- nicht an die Einheit: der Text beschreibt, was in der Bestaetigung
    -- dieses Mieters steht, und weicht in der Praxis von bezeichnung ab.
    ADD COLUMN IF NOT EXISTS melde_zusatz text,

    -- Anschrift, die im Vertragskopf gedruckt wurde (person.anschriftVorher).
    --
    -- Abweichung von der Analyse, die dafuer kontakt.anschrift vorsieht:
    -- sobald der Mieter eingezogen ist, wird seine Anschrift die Westanlage 9.
    -- Steht die Vertragsanschrift nur am Kontakt, zeigt ein Nachdruck des
    -- Vertrags dann die Mietsache als Mieteradresse. Ein Dokument braucht den
    -- Stand von damals, die Post den von heute -- das sind zwei Felder.
    ADD COLUMN IF NOT EXISTS anschrift_vorher text,

    -- Das Altsystem fuehrt angelegt/geaendert, mietverhaeltnis bisher keinen
    -- Zeitstempel. Ohne ihn ist nach dem Import nicht mehr feststellbar, was
    -- uebernommen und was danach von Hand geaendert wurde.
    ADD COLUMN IF NOT EXISTS angelegt_am  timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS geaendert_am timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- 3. Statusmodell
-- ---------------------------------------------------------------------------
--
-- beginn/ende kennt drei Lagen, das Altsystem sechs. Die eine, die sich mit
-- Datumsspalten gar nicht ausdruecken laesst, ist die haeufigste in WGs:
-- gekuendigt, Auszugstermin haengt am Nachmieter.
--
--   ende = Pseudodatum  -> erzeugt eine Zusage, die niemand gegeben hat.
--          api/verfuegbarkeit.js leitet aus ende einen Monat ab und schreibt
--          ihn in Anschreiben ("belegt bis Dezember").
--   ende = NULL         -> heisst in dieser Datenbank "laeuft unbefristet
--          weiter". Das gekuendigte Zimmer wird damit unsichtbar.
--
-- Beides ist schlechter als der Zustand vorher. Also eine eigene Spalte.
--
-- 'interessent' kommt absichtlich nicht vor: ein Interessent ist kein
-- Mietverhaeltnis, sondern kontakt.rolle='interessent' plus ein vorgang --
-- und dort ist diese Datenbank dem Altsystem voraus (herkunft, kanalwechsel,
-- nachfass_anzahl aus db/005).

ALTER TABLE mietverhaeltnis
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aktiv'
        CHECK (status IN ('vertrag_versendet','aktiv','gekuendigt','beendet'));

CREATE INDEX IF NOT EXISTS mietverhaeltnis_status_idx
    ON mietverhaeltnis (status);

-- ---------------------------------------------------------------------------
-- 4. Kuendigung
-- ---------------------------------------------------------------------------
--
-- Abweichung von der Minimalvariante der Analyse (nachmieter_gesucht und
-- gekuendigt_am als Spalten am Mietverhaeltnis): Kuendigungen sind
-- fristbehaftet und werden im Streitfall belegt -- bei Westanlage 9 war das
-- schon Thema. Eingangsdatum und Absender sind der Beleg; ein Bool ist es
-- nicht. Die Analyse nennt diese Variante selbst die saubere.
--
-- nachmieter_gesucht steht nur hier, nicht zusaetzlich am Mietverhaeltnis.
-- Dieselbe Angabe an zwei Stellen laeuft auseinander, und dann weiss niemand,
-- welche von beiden das Zimmer freigibt.

CREATE TABLE IF NOT EXISTS kuendigung (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id         uuid NOT NULL REFERENCES mandant(id) ON DELETE RESTRICT
                       DEFAULT aktueller_mandant(),
    mietverhaeltnis_id uuid NOT NULL,
    eingegangen_am     date NOT NULL,
    durch              text NOT NULL CHECK (durch IN ('mieter','vermieter')),

    -- Leer heisst: der Termin haengt am Nachmieter. Genau der Fall, den ende
    -- nicht ausdruecken kann. Steht der Termin fest, gehoert er zusaetzlich
    -- in mietverhaeltnis.ende -- erst dann darf die Website ein Datum nennen.
    zum_datum          date,

    -- Nur sinnvoll, solange kein Termin feststeht: das Zimmer wird angeboten,
    -- ohne ein Einzugsdatum zuzusagen (api/_daten.js, api/verfuegbarkeit.js).
    nachmieter_gesucht boolean NOT NULL DEFAULT false
        CONSTRAINT kuendigung_nachmieter_ohne_termin
        CHECK (nachmieter_gesucht = false OR zum_datum IS NULL),

    -- Eine zurueckgenommene Kuendigung bleibt als Beleg stehen, zaehlt aber
    -- nicht mehr. Loeschen waere das Vernichten eines Beweismittels.
    zurueckgenommen_am date,
    notizen            text,
    angelegt_am        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kuendigung_mv_idx      ON kuendigung (mietverhaeltnis_id);
CREATE INDEX IF NOT EXISTS kuendigung_mandant_idx ON kuendigung (mandant_id);

-- Hoechstens eine wirksame Kuendigung je Mietverhaeltnis. Sonst ist "die
-- Kuendigung" in jeder Abfrage mehrdeutig, und die Belegungslogik muesste
-- raten, welche gilt. Zwei gleichzeitige Kuendigungen erzwingen damit eine
-- ausdrueckliche Entscheidung statt stiller Willkuer.
CREATE UNIQUE INDEX IF NOT EXISTS kuendigung_wirksam_idx
    ON kuendigung (mietverhaeltnis_id) WHERE zurueckgenommen_am IS NULL;

ALTER TABLE kuendigung ENABLE ROW LEVEL SECURITY;
ALTER TABLE kuendigung FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE tablename = 'kuendigung' AND policyname = 'mandant_trennung') THEN
        CREATE POLICY mandant_trennung ON kuendigung
            USING (mandant_id = aktueller_mandant())
            WITH CHECK (mandant_id = aktueller_mandant());
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Einheit
-- ---------------------------------------------------------------------------
--
-- eltern_id ist die fehlende Ebene zwischen Objekt und Zimmer. Eine WG ist
-- mehr als eine Etage: im 2. OG laeuft ein Altmietverhaeltnis ueber die
-- ganze Etage. Es haengt an der Einheit "5er-WG 2. OG", und die fuenf Zimmer
-- darunter haben kein eigenes Mietverhaeltnis. Ohne die Kante gelten sie als
-- unbelegt -- fuenf vermietete Zimmer, oeffentlich als frei beworben.
--
-- Die Gruppierung fuer die Website (gruppe in api/_einheiten.js) ergibt sich
-- daraus: COALESCE(eltern.bezeichnung, einheit.bezeichnung). Keine eigene
-- Spalte -- heute steht die Zuordnung als Freitext in notizen, also eine
-- Fremdschluesselbeziehung in einem Kommentarfeld.

ALTER TABLE einheit
    ADD COLUMN IF NOT EXISTS eltern_id uuid,

    -- Angebotspreis, nicht Mietpreis. Das sind zwei Dinge: der Mietpreis
    -- steht am Mietverhaeltnis und darf nach aussen nie sichtbar werden,
    -- der Angebotspreis muss es. Eine freie Einheit hat kein
    -- Mietverhaeltnis und deshalb heute keinen Preis -- ein Angebot ohne
    -- Preis.
    ADD COLUMN IF NOT EXISTS angebot_kaltmiete   numeric(10,2),
    ADD COLUMN IF NOT EXISTS angebot_nebenkosten numeric(10,2),

    ADD COLUMN IF NOT EXISTS vermarktung text NOT NULL DEFAULT 'anbieten'
        CHECK (vermarktung IN ('anbieten','nicht_anbieten','im_bau')),
    ADD COLUMN IF NOT EXISTS verfuegbar_ab date,

    -- Geht laut Kommentar in api/verfuegbarkeit.js woertlich in die
    -- Anschreiben der Lead-Automation. Inhalt, nicht Deko.
    ADD COLUMN IF NOT EXISTS vermarktungshinweis text,

    -- Beweislast beim Leerstand. api/verfuegbarkeit.js: "Der umgekehrte
    -- Default wuerde vermietete Zimmer als frei anbieten; genau das ist im
    -- September passiert." Solange die Altmieter ohne E-Mail-Adresse nicht
    -- erfasst sind, bleibt das false -- und nur dann darf aus "kein
    -- Mietverhaeltnis" ueberhaupt "frei" werden.
    ADD COLUMN IF NOT EXISTS belegung_gepflegt boolean NOT NULL DEFAULT false,

    -- Stabile Kurzkennung. bezeichnung ist der Anzeigename, und die Namen der
    -- beiden Systeme stimmen nicht ueberein ("5er-WG (1. OG)"/"Zimmer 3"
    -- gegen "Zimmer 1.3"). Ueber Anzeigenamen zu kuppeln heisst, die Kupplung
    -- bei jeder Umbenennung neu zu bauen.
    ADD COLUMN IF NOT EXISTS schluessel text;

-- ---------------------------------------------------------------------------
-- 6. Bedingungen ueber mehrere Spalten
-- ---------------------------------------------------------------------------
--
-- Eine Schleife, weil Postgres kein ADD CONSTRAINT IF NOT EXISTS kennt und
-- die Datei wiederholbar bleiben soll. Begruendung je Bedingung daneben.

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES

      -- Ein Ende vor dem Beginn ist kein Mietverhaeltnis. Fehlt bisher.
      ('mietverhaeltnis','mv_ende_nach_beginn',
       'CHECK (ende IS NULL OR ende >= beginn)'),

      -- Schliesst die stille Luecke des Altmodells: dort kann status
      -- 'beendet' ohne ende stehen, und dann faellt die Einheit in
      -- verfuegbarkeit.js durch alle Zweige in "belegt, ohneDatensatz" --
      -- also auf Dauer unsichtbar.
      ('mietverhaeltnis','mv_beendet_braucht_ende',
       'CHECK (status <> ''beendet'' OR ende IS NOT NULL)'),

      -- Befristet ohne Enddatum ist unbefristet. § 2 des Vertrags wuerde
      -- sonst "befristet bis" ohne Datum drucken.
      ('mietverhaeltnis','mv_befristet_braucht_ende',
       'CHECK (befristet = false OR ende IS NOT NULL)'),

      -- Idempotenz des Imports. Ohne diesen natuerlichen Schluessel legt ein
      -- zweiter Lauf alles ein zweites Mal an, und die Sollstellungen
      -- verdoppeln sich -- UNIQUE (mietverhaeltnis_id, monat) aus db/007
      -- schuetzt nur innerhalb eines Mietverhaeltnisses, nicht gegen ein
      -- zweites Mietverhaeltnis derselben Person in derselben Einheit.
      ('mietverhaeltnis','mietverhaeltnis_natuerlich_key',
       'UNIQUE (einheit_id, kontakt_id, beginn)'),

      -- Zielspalten fuer die zusammengesetzten Fremdschluessel weiter unten.
      ('mietverhaeltnis','mietverhaeltnis_id_mandant_key',
       'UNIQUE (id, mandant_id)'),
      ('einheit','einheit_id_objekt_mandant_key',
       'UNIQUE (id, objekt_id, mandant_id)'),

      -- Die Kuendigung muss zum selben Mandanten gehoeren wie das
      -- Mietverhaeltnis.
      --
      -- Abweichung von der Analyse, die das als durch RLS erledigt ansieht:
      -- Fremdschluesselpruefungen laufen im System und unterliegen RLS
      -- nicht. Eine Policy prueft nur die mandant_id der Zeile selbst, nicht
      -- die des Verweisziels. Eine fremde Zeile waere unsichtbar und der
      -- Verweis trotzdem gueltig. Zusammengesetzter Fremdschluessel statt
      -- Vertrauen.
      ('kuendigung','kuendigung_mv_fk',
       'FOREIGN KEY (mietverhaeltnis_id, mandant_id)
        REFERENCES mietverhaeltnis (id, mandant_id) ON DELETE CASCADE'),

      -- Dasselbe fuer die Elternkante, zusaetzlich auf dasselbe Objekt: eine
      -- WG in einem anderen Haus kann kein Zimmer dieses Hauses sperren.
      --
      -- NO ACTION, nicht RESTRICT: RESTRICT prueft sofort und wuerde auch
      -- dann greifen, wenn Eltern- und Kindzeile in derselben Anweisung
      -- geloescht werden -- DELETE FROM objekt (ON DELETE CASCADE aus db/001)
      -- wuerde damit scheitern. NO ACTION prueft am Ende der Anweisung und
      -- verweigert nur das, was wirklich gemeint ist: eine WG zu loeschen und
      -- ihre Zimmer stillschweigend freizugeben.
      ('einheit','einheit_eltern_fk',
       'FOREIGN KEY (eltern_id, objekt_id, mandant_id)
        REFERENCES einheit (id, objekt_id, mandant_id) ON DELETE NO ACTION'),

      ('einheit','einheit_kein_selbstbezug',
       'CHECK (eltern_id IS DISTINCT FROM id)'),

      -- "Im Bau" ohne Termin und ohne Satz ergibt ein Angebot, zu dem die
      -- Lead-Automation nichts schreiben kann.
      ('einheit','einheit_im_bau_braucht_hinweis',
       'CHECK (vermarktung <> ''im_bau''
               OR verfuegbar_ab IS NOT NULL
               OR vermarktungshinweis IS NOT NULL)'),

      ('einheit','einheit_schluessel_key',
       'UNIQUE (objekt_id, schluessel)')

    ) AS v(tab, name, def) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.name) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', r.tab, r.name, r.def);
        END IF;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS einheit_eltern_idx ON einheit (eltern_id);

-- ---------------------------------------------------------------------------
-- 7. geaendert_am am Mietverhaeltnis pflegen
-- ---------------------------------------------------------------------------
--
-- Eigene Funktion statt touch_vorgang(): die schreibt von einer Kindzeile in
-- die Elternzeile, hier geht es um die Zeile selbst. BEFORE UPDATE, damit der
-- Wert nicht von aussen uebergangen werden kann.

CREATE OR REPLACE FUNCTION touch_geaendert_am() RETURNS trigger AS $$
BEGIN
    NEW.geaendert_am := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mietverhaeltnis_touch ON mietverhaeltnis;
CREATE TRIGGER mietverhaeltnis_touch
    BEFORE UPDATE ON mietverhaeltnis
    FOR EACH ROW EXECUTE FUNCTION touch_geaendert_am();

-- ---------------------------------------------------------------------------
-- 8. Bestand nacharbeiten
-- ---------------------------------------------------------------------------
--
-- Die Spalten allein nuetzen nichts: eltern_id ist die Gruppierung der
-- Website, und solange sie leer ist, hat jede Einheit ihre eigene Karte und
-- kein Zimmer einen Angebotspreis. Die Zuordnung steht bereits in der
-- Datenbank -- als Freitext in einheit.notizen, der genau der bezeichnung
-- der WG-Zeile entspricht. Mehr als diese Gleichheit wird hier nicht
-- geraten.
--
-- Laeuft als Superuser (so ruft migrieren.sh psql auf), also ohne gesetztes
-- app.mandant. aktueller_mandant() liefert dann NULL, und DEFAULT
-- aktueller_mandant() wuerde an NOT NULL scheitern -- mandant_id wird beim
-- INSERT deshalb von der Elternzeile uebernommen statt dem Vorgabewert
-- ueberlassen.

UPDATE einheit z
   SET eltern_id = w.id
  FROM einheit w
 WHERE w.objekt_id   = z.objekt_id
   AND w.art         = 'gemeinschaft'
   AND w.bezeichnung = z.notizen
   AND z.eltern_id IS NULL;

-- Jetzt steht die Zuordnung zweimal da. Der Freitext muss weg, sonst laufen
-- Spalte und Kommentar auseinander und niemand weiss, welcher gilt.
UPDATE einheit z
   SET notizen = NULL
  FROM einheit w
 WHERE w.id = z.eltern_id
   AND z.notizen = w.bezeichnung;

-- Zimmer 10: entsteht durch die Teilung der Gewerbeflaeche und fehlt in
-- db/006. Ohne die Zeile ist das Zimmer fuer die Plattform nicht vorhanden,
-- waehrend die Website es schon anbietet.
INSERT INTO einheit (objekt_id, mandant_id, bezeichnung, etage, art, eltern_id,
                     angebot_kaltmiete, angebot_nebenkosten,
                     vermarktung, verfuegbar_ab, vermarktungshinweis)
SELECT w.objekt_id, w.mandant_id, 'Zimmer 10', 'EG', 'wohnen', w.id,
       400, 90, 'im_bau', DATE '2026-11-01',
       'Umbau laeuft - Trockenbau und Sanitaer noch offen'
  FROM einheit w
 WHERE w.objekt_id = '11111111-1111-1111-1111-111111111111'
   AND w.bezeichnung = '9er-WG'
   AND w.art = 'gemeinschaft'
ON CONFLICT (objekt_id, bezeichnung) DO NOTHING;

-- Angebotspreise aus api/_einheiten.js. Nur dort, wo noch keiner steht --
-- ein spaeter von Hand gepflegter Preis darf von einem Wiederholungslauf
-- nicht ueberschrieben werden.
UPDATE einheit e
   SET angebot_kaltmiete   = v.kalt,
       angebot_nebenkosten = v.nk
  FROM (VALUES
        ('Zimmer 1', 600, 90), ('Zimmer 2', 500, 90), ('Zimmer 3', 500, 90),
        ('Zimmer 4', 500, 90), ('Zimmer 5', 600, 90), ('Zimmer 6', 500, 90),
        ('Zimmer 7', 500, 90), ('Zimmer 8', 500, 90), ('Zimmer 9', 500, 90),
        -- 1. OG: Zimmer 5 regulaer 600 + 90. Am 26.10.2026 kurzzeitig
        -- gesenkt, am 01.11.2026 zurueckgesetzt. Die am 01.11. genannten
        -- 650 EUR sind eine Zusage an bestimmte Interessenten und gehoeren
        -- in deren Mietverhaeltnis, nicht in den Angebotspreis.
        ('Zimmer 1.1', 400, 90), ('Zimmer 1.2', 500, 90), ('Zimmer 1.3', 500, 90),
        ('Zimmer 1.4', 500, 90), ('Zimmer 1.5', 600, 90),
        ('Zimmer 2.1', 500, 90), ('Zimmer 2.2', 500, 90), ('Zimmer 2.3', 500, 90),
        ('Zimmer 2.4', 500, 90), ('Zimmer 2.5', 500, 90),
        ('Zimmer 3.1', 400, 90), ('Zimmer 3.2', 500, 90), ('Zimmer 3.3', 500, 90),
        ('Zimmer 3.4', 500, 90),
        ('Single-Apartment 3. OG',  750,  90),
        ('3-Zimmer-Wohnung DG',    2000, 350),
        ('1-Zimmer-Apartment DG',   750,  90)
       ) AS v(bez, kalt, nk)
 WHERE e.objekt_id = '11111111-1111-1111-1111-111111111111'
   AND e.bezeichnung = v.bez
   AND e.angebot_kaltmiete IS NULL;

-- Die Gewerbeflaeche wird nicht vermietet und darf auch im Leerstand nicht
-- als frei erscheinen.
UPDATE einheit
   SET vermarktung = 'nicht_anbieten'
 WHERE objekt_id = '11111111-1111-1111-1111-111111111111'
   AND bezeichnung = 'Gewerbeflaeche EG'
   AND vermarktung = 'anbieten';

-- Kurzkennungen. Schema: <objekt>-<etage>-<einheit>.
--
-- Die Analyse empfiehlt zusaetzlich, "Zimmer 1".."Zimmer 9" in "Zimmer 0.1"..
-- umzubenennen. Bewusst nicht: genau dafuer gibt es schluessel. Der
-- Anzeigename traegt danach nichts mehr, und eine Umbenennung wuerde jede
-- bestehende Bezugnahme entwerten -- Vorgaenge, Notizen, Mailverkehr, in dem
-- "Zimmer 7" steht.
UPDATE einheit e
   SET schluessel = m.s
  FROM (VALUES
        ('9er-WG',                  'w9-eg-wg'),
        ('5er-WG 1. OG',            'w9-1og-wg'),
        ('5er-WG 2. OG',            'w9-2og-wg'),
        ('4er-WG 3. OG',            'w9-3og-wg'),
        ('Single-Apartment 3. OG',  'w9-3og-apartment'),
        ('3-Zimmer-Wohnung DG',     'w9-dg-wohnung'),
        -- Das Altsystem fuehrt diese Wohnung als "Studio-Apartment
        -- (4. OG links)", die Website als "1-Zimmer-Apartment - DG". Dass
        -- es dieselbe Einheit ist, ist naheliegend, aber aus dem Code nicht
        -- belegbar; DG und 4. OG werden uneinheitlich benutzt. Der
        -- Schluessel haelt sich deshalb an die Angabe dieser Datenbank
        -- (etage = 'DG') und behauptet die Gleichsetzung nicht.
        ('1-Zimmer-Apartment DG',   'w9-dg-apartment'),
        ('Gewerbeflaeche EG',       'w9-eg-gewerbe')
       ) AS m(bez, s)
 WHERE e.objekt_id = '11111111-1111-1111-1111-111111111111'
   AND e.bezeichnung = m.bez
   AND e.schluessel IS NULL;

UPDATE einheit e
   SET schluessel = CASE
         WHEN e.bezeichnung ~ '^Zimmer [0-9]+$'   THEN 'w9-eg-z'  || substring(e.bezeichnung from 8)
         WHEN e.bezeichnung ~ '^Zimmer 1\.[0-9]$' THEN 'w9-1og-z' || right(e.bezeichnung, 1)
         WHEN e.bezeichnung ~ '^Zimmer 2\.[0-9]$' THEN 'w9-2og-z' || right(e.bezeichnung, 1)
         WHEN e.bezeichnung ~ '^Zimmer 3\.[0-9]$' THEN 'w9-3og-z' || right(e.bezeichnung, 1)
       END
 WHERE e.objekt_id = '11111111-1111-1111-1111-111111111111'
   AND e.bezeichnung ~ '^Zimmer '
   AND e.schluessel IS NULL;

-- Welserstrasse 10 bekommt keine Schluessel: "Wohnung 1".."Wohnung 8" aus
-- db/006 sind Platzhalter ("Zuschnitt noch einzutragen"). Ein Schluessel auf
-- einer Nummerierung, die sich noch aendert, ist schlechter als keiner.

COMMIT;
