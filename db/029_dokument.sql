BEGIN;

-- Dokumente zu Objekt, Einheit und Mietverhältnis
--
-- Bisher kennt diese Datenbank zwei Ablagen, und keine von beiden passt:
--
--   anhang (db/001) hängt an einer NACHRICHT. Eine Datei ohne Mail kann
--           dort nicht liegen, und der Grundriss einer Wohnung ist keine
--           Mail.
--   beleg  (db/008) ist eine Rechnung. Die Spalten heißen belegnummer,
--           belegdatum, betrag_brutto -- ein Foto vom Bad hat davon nichts.
--
-- Die Folge war, dass es für Bilder und Grundrisse gar keinen Ort gab. Die
-- Grundrisse der Westanlage 9 liegen deshalb bis heute in einem Ordner auf
-- einem Rechner, und wer wissen will, wie Zimmer 1.4 geschnitten ist, fragt
-- nach. Genau das ist der Anlass dieser Tabelle.
--
-- Der Bezug ist bewusst dreifach und nicht einer:
--   objekt_id           Energieausweis, Lageplan, Hausordnung -- gilt fürs
--                       ganze Haus und soll nicht an 28 Einheiten hängen.
--   einheit_id          Grundriss und Fotos. Die bleiben über den
--                       Mieterwechsel hinweg richtig; am Mietverhältnis
--                       wären sie nach jedem Auszug verwaist.
--   mietverhaeltnis_id  Übergabeprotokoll, unterschriebener Vertrag,
--                       Zählerstände -- das gehört zu DIESEM Mieter und
--                       darf der Nachmieter nicht sehen.
--
-- Mindestens einer muss gesetzt sein (CHECK unten). Ein Dokument ohne
-- jeden Bezug wäre eine Datei, die niemand mehr findet.

CREATE TABLE IF NOT EXISTS dokument (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id      uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                         DEFAULT aktueller_mandant(),

    -- Die drei Fremdschlüssel stehen nicht hier, sondern weiter unten als
    -- zusammengesetzte Schlüssel über (id, mandant_id). Dieselbe Bauweise
    -- wie kuendigung in db/017, Begründung dort und unten.
    objekt_id          uuid,
    einheit_id         uuid,
    mietverhaeltnis_id uuid,

    -- Die Art entscheidet über die Darstellung: 'grundriss' wird groß
    -- gezeigt, 'foto' kommt in die Galerie, alles andere in die Liste.
    -- Deshalb ein CHECK und kein Freitext -- ein Tippfehler würde das
    -- Dokument lautlos aus der Galerie nehmen.
    art             text NOT NULL DEFAULT 'sonstige'
                    CHECK (art IN ('grundriss','foto','mietvertrag',
                                   'uebergabeprotokoll','energieausweis',
                                   'sonstige')),

    -- Was darüber steht ("Grundriss 1. OG", "Bad nach Sanierung").
    -- Nullbar: Ohne Bezeichnung zeigt die Seite den Dateinamen.
    bezeichnung     text,

    -- Der Name, unter dem die Datei hochgeladen wurde. Wird angezeigt und
    -- beim Herunterladen vorgeschlagen, ist aber NICHT der Name auf der
    -- Platte: der steht in ablage_pfad und trägt den Inhaltshash.
    dateiname       text NOT NULL,

    -- Aus dem INHALT bestimmt (Magic Bytes), nicht aus der Endung. Siehe
    -- lib/dokumente.ts: eine Datei namens grundriss.pdf mit PNG-Inhalt
    -- wird als image/png geführt, weil die Ausliefer-Route genau diesen
    -- Wert als Content-Type setzt.
    mime_typ        text,
    groesse_bytes   bigint,

    -- Pfad auf der Platte, unterhalb von BELEG_ABLAGE/dokumente.
    -- Mehrere Zeilen dürfen auf dieselbe Datei zeigen: der Dateiname ist
    -- der Hash des Inhalts, derselbe Grundriss für zwei gleiche Zimmer
    -- liegt also nur einmal. Beim Löschen wird die Datei deshalb erst
    -- entfernt, wenn keine Zeile mehr auf sie zeigt.
    ablage_pfad     text NOT NULL,

    -- Reihenfolge in der Galerie. Gleiche Werte: dann entscheidet
    -- angelegt_am.
    sortierung      integer NOT NULL DEFAULT 0,

    -- Darf der Mieter dieses Dokument in seinem Bereich sehen?
    --
    -- Der Vorgabewert ist false, und das ist die wichtigste Zeile dieser
    -- Datei. An einem Mietverhältnis hängen Übergabeprotokolle mit
    -- Mängeln, Schriftverkehr und Zählerstände; an einer Einheit können
    -- Fotos aus der Zeit des Vormieters liegen. Was davon der Mieter zu
    -- sehen bekommt, ist eine Entscheidung, die jemand getroffen haben
    -- muss -- nicht der Umstand, dass eine Datei hochgeladen wurde.
    --
    -- Der Haken allein genügt dafür nicht: Row Level Security trennt
    -- Vermieter voneinander, nicht Mieter untereinander (siehe db/015).
    -- Die zweite Grenze zieht darfSehen() in lib/dokumente.ts, und zwar
    -- bei jedem Abruf: mieter_sichtbar UND derselbe Bezug.
    mieter_sichtbar boolean NOT NULL DEFAULT false,

    angelegt_am     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dokument_braucht_bezug
        CHECK (objekt_id IS NOT NULL
            OR einheit_id IS NOT NULL
            OR mietverhaeltnis_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS dokument_einheit_idx ON dokument (einheit_id);
CREATE INDEX IF NOT EXISTS dokument_objekt_idx  ON dokument (objekt_id);
CREATE INDEX IF NOT EXISTS dokument_mv_idx      ON dokument (mietverhaeltnis_id);

-- ---------------------------------------------------------------------------
-- Mandantengrenze auch im Fremdschlüssel
-- ---------------------------------------------------------------------------
--
-- Dieselbe Begründung wie bei kuendigung in db/017: Fremdschlüsselprüfungen
-- laufen im System und unterliegen RLS nicht. Eine Policy prüft die
-- mandant_id der Zeile selbst, nicht die des Verweisziels -- eine fremde
-- Einheit wäre unsichtbar und der Verweis trotzdem gültig. Dann läge ein
-- Grundriss an der Wohnung eines anderen Vermieters, und niemand sähe ihn
-- dort je wieder.
--
-- mietverhaeltnis hat die Zielspalte schon (db/017: UNIQUE (id,
-- mandant_id)); objekt und einheit bekommen sie hier. Bei einheit ist die
-- bestehende UNIQUE (id, objekt_id, mandant_id) als Ziel nicht verwendbar,
-- weil dokument keine objekt_id tragen muss.

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES

      ('objekt','objekt_id_mandant_key',  'UNIQUE (id, mandant_id)'),
      ('einheit','einheit_id_mandant_key','UNIQUE (id, mandant_id)'),

      ('dokument','dokument_objekt_fk',
       'FOREIGN KEY (objekt_id, mandant_id)
        REFERENCES objekt (id, mandant_id) ON DELETE CASCADE'),
      ('dokument','dokument_einheit_fk',
       'FOREIGN KEY (einheit_id, mandant_id)
        REFERENCES einheit (id, mandant_id) ON DELETE CASCADE'),
      ('dokument','dokument_mv_fk',
       'FOREIGN KEY (mietverhaeltnis_id, mandant_id)
        REFERENCES mietverhaeltnis (id, mandant_id) ON DELETE CASCADE')

    ) AS v(tab, name, def) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.name) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',
                           r.tab, r.name, r.def);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Mandantentrennung (Muster aus db/027)
-- ---------------------------------------------------------------------------

ALTER TABLE dokument ENABLE ROW LEVEL SECURITY;
ALTER TABLE dokument FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dokument_mandant ON dokument;
CREATE POLICY dokument_mandant ON dokument
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

GRANT SELECT, INSERT, UPDATE, DELETE ON dokument TO stig_app;

COMMENT ON COLUMN dokument.mieter_sichtbar IS
    'Darf der Mieter dieses Dokument in seinem Bereich sehen? Vorgabe '
    'false. Reicht allein nicht: zusaetzlich prueft darfSehen() in '
    'lib/dokumente.ts, dass der Bezug derselbe ist -- RLS trennt '
    'Vermieter, nicht Mieter untereinander.';
COMMENT ON COLUMN dokument.ablage_pfad IS
    'Pfad unterhalb BELEG_ABLAGE/dokumente. Dateiname ist der Hash des '
    'Inhalts, mehrere Zeilen koennen auf dieselbe Datei zeigen.';
COMMENT ON COLUMN dokument.mime_typ IS
    'Aus den Magic Bytes des Inhalts bestimmt, nicht aus der Endung.';

COMMIT;
