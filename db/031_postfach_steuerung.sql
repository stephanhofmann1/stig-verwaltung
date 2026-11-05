BEGIN;

-- Steuerung des Postfachs: Herkunft, Entwurfsfassungen, Dauerweisungen
--
-- ANLASS
--
-- Die Mail-Funktion sollte das E-Mail-Postfach ersetzen und konnte es
-- nicht. Drei Dinge fehlten, und alle drei sind dieselbe Lücke aus
-- verschiedenen Richtungen: Der Mensch sah nicht, worauf die Automatik
-- ihre Entscheidung stützte, und konnte am Ergebnis nichts ändern außer
-- "freigeben" oder "nicht freigeben".
--
--   1. WORAUF BERUHT DAS. Die Einordnung ist Mustererkennung über
--      Stichwortregexe (app/lib/einordnung.ts). Welches Stichwort
--      getroffen hat, stand nirgends -- der Treffer wurde als
--      Wahrheitswert weggeworfen. Am 03.11.2026 landete eine Mail des
--      Messdienstleisters als Behördenpost in der Akte, weil sie "Geben
--      Sie mir Bescheid" enthielt. Sie wurde dadurch heikel markiert, der
--      Agent durfte dort keinen Entwurf mehr schreiben, und niemand
--      erfuhr, warum die Automatik aufhörte zu arbeiten. Der Schaden war
--      nicht die falsche Kategorie, sondern das Schweigen danach.
--      Dagegen: einordnung_stichwort, einordnung_fundstelle,
--      einordnung_quelle am Vorgang -- und kein_entwurf_code/_grund für
--      genau dieses Schweigen.
--
--   2. ANWEISEN UND NEU ERZEUGEN. Ein Entwurf, an dem man nur ja oder
--      nein sagen kann, ist kein Postfach. Künftig schreibt der Mensch in
--      eigenen Worten, was anders werden soll, und lässt neu erzeugen.
--      Der alte Text darf dabei nicht verschwinden: Bei einer Mahnung muss
--      nachvollziehbar bleiben, welcher Wortlaut wann entstand, und wer
--      eine Verschlechterung bemerkt, muss zurück können. Dafür
--      entwurf_fassung -- eine Tabelle, in die nur angefügt wird.
--
--   3. DAUERWEISUNGEN. Eine Korrektur, die man bei jeder Mail neu
--      eintippen muss, ist keine Hilfe. Weisungen stehen deshalb: für
--      alles, je Kategorie, je Kontakt. Dafür die Tabelle weisung.
--
-- MANDANTENFÄHIGKEIT -- der wichtigste Teil dieser Datei
--
-- Die Plattform wird anderen Firmen angeboten. Jede Tabelle hier trägt
-- deshalb mandant_id, eine Policy und FORCE ROW LEVEL SECURITY, nach dem
-- Muster aus db/010 und db/027. Begründung dort im Kopf; kurz: Der
-- Eigentümer der Tabellen umgeht RLS standardmäßig, und die Anwendung
-- verbindet sich als Eigentümer -- ohne FORCE ist die ganze Übung
-- wirkungslos. aktueller_mandant() liefert ohne gesetztes app.mandant
-- NULL, und NULL = irgendwas ist nie wahr: Eine vergessene Zuweisung
-- führt zu KEINEN Zeilen statt zu ALLEN.
--
-- Bei den Weisungen wiegt das schwerer als irgendwo sonst in diesem
-- Schema, denn ihr Text wandert in einen Prompt. Eine Weisung, die über
-- die Mandantengrenze gelesen wird, verändert die Geschäftskorrespondenz
-- eines fremden Unternehmens. Das ist der teuerste Fehler, den dieses
-- Produkt machen kann -- teurer als ein Leseleck, weil er nach außen
-- wirkt und beim Empfänger als Absicht des Absenders ankommt.
--
-- Jede UNIQUE-Bedingung führt mandant_id als erste Spalte. db/019 ist ein
-- ganzer Nachtrag, weil db/010 vier davon übersehen hat, und die
-- Begründung von dort gilt hier wörtlich: Die Grenze fällt erst beim
-- ersten fremden Kunden auf, dort als Fehlermeldung beim Anlegen seiner
-- eigenen Daten -- und wer beim Anlegen erfährt, dass etwas "schon
-- vergeben" ist, erfährt etwas über den Bestand eines anderen. "Bei
-- Handwerkern immer nach einem Termin fragen" muss zwei Kunden
-- gleichzeitig möglich sein.

-- ---------------------------------------------------------------------------
-- 1. Herkunft der Einordnung am Vorgang
-- ---------------------------------------------------------------------------
--
-- Warum am Vorgang und nicht nur im Protokoll: Das Protokoll ist eine
-- Liste von Ereignissen und wird gelesen, wenn jemand etwas sucht. Die
-- Frage "worauf beruht diese Einordnung" stellt sich aber dort, wo der
-- Entwurf steht, und zwar jedes Mal. Ein Wert, für den man erst in eine
-- andere Tabelle sehen muss, erscheint nicht auf der Oberfläche.

ALTER TABLE vorgang
    -- Woher die Kategorie kommt:
    --   regel   -- ein Stichwortmuster hat getroffen
    --   kontakt -- der Absender ist bekannt und hat eine Rolle
    --   keine   -- nichts hat getroffen, Absender unbekannt ('sonstige')
    --   mensch  -- von Hand berichtigt (siehe api/vorgang/[id])
    -- Nullbar: Vorgänge aus der Zeit vor dieser Migration haben keine
    -- Herkunft, und eine erfundene wäre schlimmer als eine fehlende.
    ADD COLUMN IF NOT EXISTS einordnung_quelle text
        CHECK (einordnung_quelle IN ('regel','kontakt','keine','mensch')),

    -- Der TATSÄCHLICH getroffene Text, nicht das Muster. "Bescheid" sagt
    -- nichts; "Geben Sie mir Bescheid" erklärt den Fehler vom 03.11. in
    -- einer Zeile.
    ADD COLUMN IF NOT EXISTS einordnung_stichwort text,

    -- Der Ausschnitt, in dem der Treffer stand. Die Fundstelle ist der
    -- Unterschied zwischen "irgendwo steht Bescheid" und "hier steht es,
    -- und so ist es gemeint".
    ADD COLUMN IF NOT EXISTS einordnung_fundstelle text,

    ADD COLUMN IF NOT EXISTS einordnung_am timestamptz,

    -- ---------------------------------------------------------------
    -- Warum KEIN Entwurf entstand. Das ist der Schaden vom 03.11.
    -- ---------------------------------------------------------------
    --   heikel          -- Sperre der Kategorie (db/001, lib/typen.ts)
    --   kein_schluessel -- ANTHROPIC_API_KEY fehlt, Stufe 2 fiel aus
    --   keine_regel     -- kein Textbaustein passte, kein Modell da
    --   werbung         -- als Werbung geschlossen
    --   modell_fehler   -- das Sprachmodell antwortete nicht brauchbar
    ADD COLUMN IF NOT EXISTS kein_entwurf_code text
        CHECK (kein_entwurf_code IN ('heikel','kein_schluessel',
                                     'keine_regel','werbung',
                                     'modell_fehler')),
    ADD COLUMN IF NOT EXISTS kein_entwurf_grund text,
    ADD COLUMN IF NOT EXISTS kein_entwurf_am timestamptz,

    -- ---------------------------------------------------------------
    -- "Hier nicht antworten"
    -- ---------------------------------------------------------------
    --
    -- Bisher gab es beantworten oder liegenlassen, und Liegenlassen sah
    -- aus wie Arbeit, die noch wartet: Die Kennzahl "Wartet auf Freigabe"
    -- zählte den Vorgang mit (lib/kennzahlen.ts, ladeFreigabestand).
    --
    -- Bewusst KEIN neuer Status. Der CHECK auf vorgang.status
    -- ('offen','wartet','erledigt') bleibt wie er ist, und der Vorgang
    -- wird auf 'erledigt' gesetzt -- damit fällt er ohne weiteres Zutun
    -- aus jeder Zählung, die auf status = 'offen' prüft. Ein vierter
    -- Status hätte jede dieser Abfragen zu einer offenen Frage gemacht,
    -- und eine davon wäre übersehen worden. Was den Fall von einem
    -- gewöhnlichen "erledigt" unterscheidet, ist allein der Grund hier.
    ADD COLUMN IF NOT EXISTS ohne_antwort_grund text,
    ADD COLUMN IF NOT EXISTS ohne_antwort_am timestamptz;

COMMENT ON COLUMN vorgang.einordnung_stichwort IS
    'Der tatsaechlich getroffene Text des Stichwortmusters, nicht das '
    'Muster selbst. Am 03.11.2026 war das "Geben Sie mir Bescheid" -- '
    'erst dieser Wert macht eine falsche Einordnung erklaerbar.';
COMMENT ON COLUMN vorgang.kein_entwurf_code IS
    'Warum zu diesem Vorgang kein Entwurf entstand. Ohne diesen Wert '
    'hoert die Automatik still auf zu arbeiten -- genau der Schaden vom '
    '03.11.2026.';
COMMENT ON COLUMN vorgang.ohne_antwort_grund IS
    'Gesetzt, wenn der Vorgang ausdruecklich ohne Antwort geschlossen '
    'wurde. Der Status ist dann erledigt; dieser Grund unterscheidet den '
    'Fall von einem beantworteten Vorgang.';

-- ---------------------------------------------------------------------------
-- 2. Herkunft des Entwurfs an der Nachricht
-- ---------------------------------------------------------------------------
--
-- AgentErgebnis.quelle ("regel" | "modell") wurde schon erhoben und dann
-- weggeworfen. Hier bleibt sie stehen.

ALTER TABLE nachricht
    ADD COLUMN IF NOT EXISTS entwurf_quelle text
        CHECK (entwurf_quelle IN ('regel','modell','mensch')),

    -- Welches Modell. Nicht "claude" -- die Vorgabe wechselt (AGENT_MODELL,
    -- Vorgabe claude-sonnet-4-6), und bei einem Text, der an Dritte geht,
    -- ist die Frage "womit ist das entstanden" eine nach der Fassung.
    ADD COLUMN IF NOT EXISTS entwurf_modell text,

    -- Welche Fassung aus entwurf_fassung derzeit in koerper_text steht.
    -- Redundant zur Historie und trotzdem richtig: Die Freigabeliste
    -- braucht die Zahl, ohne die Historie zu laden.
    ADD COLUMN IF NOT EXISTS entwurf_fassung_nr integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN nachricht.entwurf_quelle IS
    'Textbaustein (regel), Sprachmodell (modell) oder von Hand (mensch).';

-- ---------------------------------------------------------------------------
-- 3. Zusammengesetzte Schlüssel für die Mandantengrenze im Fremdschlüssel
-- ---------------------------------------------------------------------------
--
-- Dieselbe Begründung wie in db/029 und db/017: Fremdschlüsselprüfungen
-- laufen im System und unterliegen RLS nicht. Eine Policy prüft die
-- mandant_id der Zeile selbst, nicht die des Verweisziels. Ohne den
-- zusammengesetzten Schlüssel wäre ein Verweis auf einen fremden Kontakt
-- gültig und dessen Weisung unsichtbar -- eine Weisung, die niemand
-- findet und die trotzdem in jeden Prompt wandert.

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
      ('kontakt',  'kontakt_id_mandant_key',  'UNIQUE (id, mandant_id)'),
      ('nachricht','nachricht_id_mandant_key','UNIQUE (id, mandant_id)')
    ) AS v(tab, name, def) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.name) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',
                           r.tab, r.name, r.def);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Dauerweisungen
-- ---------------------------------------------------------------------------
--
-- Drei Ebenen, von allgemein nach eng:
--
--   allgemein  "schreib kurz, höchstens fünf Sätze"
--   kategorie  "bei Handwerkern immer nach einem Termin fragen"
--   kontakt    "der schreibt Englisch, antworte auf Englisch"
--
-- Alle drei wirken zusammen; bei Widerspruch gilt die engere. Die
-- Rangfolge und ihre Nachvollziehbarkeit stehen in app/lib/weisungen.ts
-- und sind dort ohne Datenbank geprüft -- hier liegt nur der Bestand.
--
-- Eine Weisung ist vom Nutzer geschriebener Text, der in einen Prompt
-- wandert. Dieses Schema gibt ihr deshalb bewusst KEINE Spalte, mit der
-- sie etwas auslösen könnte: kein "sendet_automatisch", kein
-- "freigabe_nicht_noetig", kein Empfänger. Sie trägt Text und sonst
-- nichts. Die belastbare Sicherung ist nicht eine Prüfung ihres Inhalts,
-- sondern dass im Code hinter dem Entwurf kein Versandweg liegt.

CREATE TABLE IF NOT EXISTS weisung (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id  uuid NOT NULL REFERENCES mandant(id) ON DELETE RESTRICT
                     DEFAULT aktueller_mandant(),

    ebene       text NOT NULL
                CHECK (ebene IN ('allgemein','kategorie','kontakt')),

    -- Nur bei ebene='kategorie'. Die Liste ist dieselbe wie bei
    -- vorgang.kategorie (db/001) und Kategorie in app/lib/typen.ts. Ein
    -- Freitext hier würde eine Weisung erlauben, die zu keiner Kategorie
    -- gehört und deshalb nie wirkt -- unsichtbar unwirksam ist schlimmer
    -- als abgelehnt.
    kategorie   text
                CHECK (kategorie IN ('mieter','handwerker','behoerde',
                                     'rechnung','interessent','mahnwesen',
                                     'werbung','sonstige')),

    -- Nur bei ebene='kontakt'. Zusammengesetzter Fremdschlüssel: siehe
    -- Abschnitt 3.
    kontakt_id  uuid,

    -- Der Wortlaut der Weisung. Die Spalte heisst nicht "text": Das ist
    -- in Postgres ein Typname, und in einem CHECK oder einer Funktion
    -- liest sich btrim(text) als Typangabe statt als Spalte.
    weisungstext text NOT NULL CHECK (btrim(weisungstext) <> ''),

    -- Abschalten statt löschen. Eine Weisung hat Entwürfe geprägt, die
    -- versendet wurden; wer später fragt, warum eine Mail so klang, soll
    -- die Weisung noch finden.
    aktiv       boolean NOT NULL DEFAULT true,

    -- Reihenfolge innerhalb einer Ebene. Gleiche Werte: dann entscheidet
    -- angelegt_am.
    rang        integer NOT NULL DEFAULT 0,

    angelegt_am  timestamptz NOT NULL DEFAULT now(),
    geaendert_am timestamptz NOT NULL DEFAULT now(),

    -- Die Ebene und ihr Bezug müssen zusammenpassen. Ohne diesen CHECK
    -- wäre eine Weisung mit ebene='kontakt' und kontakt_id IS NULL
    -- anlegbar: Sie stünde in der Liste, sähe richtig aus und würde nie
    -- wirken.
    CONSTRAINT weisung_ebene_bezug CHECK (
        (ebene = 'allgemein' AND kategorie IS NULL AND kontakt_id IS NULL)
     OR (ebene = 'kategorie' AND kategorie IS NOT NULL AND kontakt_id IS NULL)
     OR (ebene = 'kontakt'   AND kontakt_id IS NOT NULL AND kategorie IS NULL)
    ),

    -- mandant_id als ERSTE Spalte -- siehe Kopf dieser Datei und db/019.
    -- NULLS NOT DISTINCT, weil kategorie und kontakt_id je Ebene leer
    -- bleiben: Ohne das wären zwei wortgleiche allgemeine Weisungen
    -- (beide NULL, NULL) für Postgres verschieden, und der Bestand füllte
    -- sich mit Dubletten, die alle gemeinsam in jeden Prompt wandern.
    CONSTRAINT weisung_eindeutig
        UNIQUE NULLS NOT DISTINCT
            (mandant_id, ebene, kategorie, kontakt_id, weisungstext)
);

CREATE INDEX IF NOT EXISTS weisung_mandant_idx  ON weisung (mandant_id);
CREATE INDEX IF NOT EXISTS weisung_ebene_idx    ON weisung (mandant_id, ebene)
    WHERE aktiv;
CREATE INDEX IF NOT EXISTS weisung_kontakt_idx  ON weisung (kontakt_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'weisung_kontakt_fk') THEN
        ALTER TABLE weisung ADD CONSTRAINT weisung_kontakt_fk
            FOREIGN KEY (kontakt_id, mandant_id)
            REFERENCES kontakt (id, mandant_id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE weisung ENABLE ROW LEVEL SECURITY;
ALTER TABLE weisung FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weisung_mandant ON weisung;
CREATE POLICY weisung_mandant ON weisung
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

GRANT SELECT, INSERT, UPDATE, DELETE ON weisung TO stig_app;

COMMENT ON TABLE weisung IS
    'Dauerhafte Weisungen an den Entwurfsagenten: allgemein, je Kategorie, '
    'je Kontakt. Der Text wandert in den Prompt -- deshalb traegt die '
    'Tabelle mandant_id und FORCE ROW LEVEL SECURITY. Eine ueber die '
    'Mandantengrenze gelesene Weisung veraendert die Korrespondenz eines '
    'fremden Unternehmens.';
COMMENT ON COLUMN weisung.aktiv IS
    'Abschalten statt loeschen: Eine Weisung hat versendete Entwuerfe '
    'gepraegt und muss spaeter noch auffindbar sein.';

-- ---------------------------------------------------------------------------
-- 5. Entwurfshistorie
-- ---------------------------------------------------------------------------
--
-- Jede Fassung eines Entwurfs mit der Anweisung, die zu ihr geführt hat.
-- Es wird nur ANGEFÜGT, nie geändert und nie überschrieben: Auch ein
-- Zurückgehen auf eine frühere Fassung erzeugt eine neue Zeile mit dem
-- alten Text. Eine Historie, die beim Zurückgehen Zeilen verliert, ist
-- bei einer Mahnung genau dann wertlos, wenn sie gebraucht wird.

CREATE TABLE IF NOT EXISTS entwurf_fassung (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id   uuid NOT NULL REFERENCES mandant(id) ON DELETE RESTRICT
                      DEFAULT aktueller_mandant(),

    nachricht_id uuid NOT NULL,

    -- 1, 2, 3 ... je Nachricht. Menschenlesbar, weil in der Oberfläche
    -- "Fassung 3" steht und nicht eine UUID.
    fassung      integer NOT NULL CHECK (fassung >= 1),

    koerper_text text NOT NULL,

    -- Was der Mensch verlangt hat ("kürzer", "frag nach dem Zählerstand").
    -- NULL bei der ersten Fassung: Die ist von der Automatik entstanden,
    -- ohne dass jemand etwas verlangt hat.
    anweisung    text,

    quelle       text NOT NULL CHECK (quelle IN ('regel','modell','mensch')),
    modell       text,

    -- Welche Dauerweisungen bei DIESER Fassung gewirkt haben, als
    -- Momentaufnahme: [{ebene, text, kategorie, kontakt_id}].
    --
    -- Bewusst kopiert und nicht verwiesen. Eine Weisung lässt sich
    -- ändern; die Frage "warum klang diese Mail so" ist eine nach dem
    -- Stand von damals. Ein Verweis auf weisung.id würde später den
    -- heutigen Wortlaut zeigen und damit eine falsche Auskunft geben --
    -- und zwar eine, die niemand als falsch erkennt.
    weisungen    jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Wer die Fassung veranlasst hat. 'agent' bei der ersten.
    wer          text,

    angelegt_am  timestamptz NOT NULL DEFAULT now(),

    -- mandant_id als erste Spalte -- siehe Kopf dieser Datei.
    CONSTRAINT entwurf_fassung_eindeutig
        UNIQUE (mandant_id, nachricht_id, fassung)
);

CREATE INDEX IF NOT EXISTS entwurf_fassung_mandant_idx
    ON entwurf_fassung (mandant_id);
CREATE INDEX IF NOT EXISTS entwurf_fassung_nachricht_idx
    ON entwurf_fassung (nachricht_id, fassung);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'entwurf_fassung_nachricht_fk') THEN
        ALTER TABLE entwurf_fassung ADD CONSTRAINT entwurf_fassung_nachricht_fk
            FOREIGN KEY (nachricht_id, mandant_id)
            REFERENCES nachricht (id, mandant_id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE entwurf_fassung ENABLE ROW LEVEL SECURITY;
ALTER TABLE entwurf_fassung FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entwurf_fassung_mandant ON entwurf_fassung;
CREATE POLICY entwurf_fassung_mandant ON entwurf_fassung
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

GRANT SELECT, INSERT, UPDATE, DELETE ON entwurf_fassung TO stig_app;

COMMENT ON TABLE entwurf_fassung IS
    'Fassungen eines Entwurfs mit der Anweisung, die zu jeder gefuehrt '
    'hat. Nur anfuegen: Auch ein Zurueckgehen erzeugt eine neue Zeile.';
COMMENT ON COLUMN entwurf_fassung.weisungen IS
    'Momentaufnahme der wirksamen Dauerweisungen. Bewusst kopiert statt '
    'verwiesen -- ein Verweis zeigte spaeter den geaenderten Wortlaut und '
    'beantwortete die Frage "warum klang das so" falsch.';

COMMIT;
