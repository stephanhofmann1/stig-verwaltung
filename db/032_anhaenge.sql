BEGIN;

-- Anhänge an Nachrichten -- in beide Richtungen
--
-- ANLASS
--
-- Am 05.11.2026 sollte eine Mail an den Fensterbauer raus: Schaden im
-- Treppenaufgang, sieben Fotos, Bitte um Kostenvoranschlag. Der Entwurf
-- stand im Portal, der Text war richtig, und die Fotos konnten nicht
-- mit. lib/versand.ts kennt keine Anhänge -- weder über Resend noch über
-- SMTP. Eine Schadensmeldung ohne Bilder ist keine Schadensmeldung.
--
-- Die Gegenrichtung war halb da: app/api/mail/eingang nimmt Anhänge an
-- und reicht sie an sichereAnhang() weiter (lib/belege.ts). Dort kommt
-- aber nur durch, was istBelegKandidat() für eine Rechnung hält -- PDF,
-- Bild, Office-Datei mit passender Endung. Alles andere fällt weg, und
-- zwar lautlos: kein Eintrag, kein Hinweis in der Akte. Wer später in
-- den Vorgang sieht, erfährt nicht, dass es den Anhang je gab.
--
-- Beides hat dieselbe Ursache: Anhänge hingen am Beleg, nicht an der
-- Nachricht. Ein Beleg ist eine Buchhaltungssache. Ein Anhang ist Teil
-- der Korrespondenz, auch wenn er nie eine Rechnung wird -- ein Foto,
-- ein Grundriss, eine Unterschrift. Deshalb diese Tabelle: Sie hängt am
-- nachricht-Datensatz und sagt nichts darüber aus, ob der Inhalt
-- buchhalterisch interessant ist. Der Belegweg bleibt daneben bestehen
-- und bekommt künftig seine Kandidaten aus derselben Quelle.
--
-- WARUM NICHT dokument MITBENUTZEN
--
-- dokument (db/029) hängt an Objekt, Einheit oder Mietverhältnis und hat
-- eine Sichtbarkeitsregel für Mieter (darfSehen). Ein Mailanhang hat
-- keinen dieser Bezüge -- er hängt an einer Nachricht, und wer die
-- Nachricht sehen darf, darf den Anhang sehen. Die drei Fremdschlüssel
-- von dokument wären hier alle NULL, und die Mietersichtbarkeit wäre
-- eine Frage, die sich nicht stellt. Eine Tabelle, deren halbe Spalten
-- für den neuen Fall bedeutungslos sind, lädt zu falschen Abfragen ein.
--
-- Was geteilt wird, ist die Mechanik: dieselbe Ablage (Inhaltshash als
-- Dateiname, Monatsordner), dieselbe Typprüfung am Inhalt
-- (erkenneTyp/pruefeDatei in lib/dokumente.ts), derselbe sichere
-- Dateiname. Geteilt wird der Code, nicht die Tabelle.
--
-- MANDANTENFÄHIGKEIT
--
-- Muster aus db/010, db/027, db/029 und db/031: mandant_id mit DEFAULT
-- aktueller_mandant(), Policy mit USING und WITH CHECK, ENABLE *und*
-- FORCE ROW LEVEL SECURITY. Ohne FORCE ist die Übung wirkungslos, weil
-- die Anwendung sich als Eigentümer der Tabellen verbindet und der RLS
-- standardmäßig umgeht.
--
-- Hier wiegt die Grenze besonders schwer, und zwar aus einem Grund, den
-- die anderen Tabellen nicht haben: Diese Zeilen werden nicht nur
-- gelesen, sie werden VERSENDET. Ein Leseleck über die Mandantengrenze
-- zeigt fremde Daten auf einem Bildschirm. Ein Anhang, der über die
-- Grenze an einen Entwurf gerät, verlässt das Haus -- an einen
-- Empfänger, der ihn nie zurückgibt. Das ist nicht reparabel.
--
-- Deshalb der zusammengesetzte Fremdschlüssel auf
-- nachricht (id, mandant_id) statt auf nachricht (id) allein: Er prüft
-- die mandant_id der Zeile selbst gegen die des Verweisziels. Eine
-- fremde Nachricht lässt sich damit nicht als Träger missbrauchen, auch
-- wenn jemand ihre Kennung kennt. Die Zielspalte gibt es seit db/031
-- (nachricht_id_mandant_key).

CREATE TABLE IF NOT EXISTS nachricht_anhang (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id      uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                         DEFAULT aktueller_mandant(),

    -- Der Fremdschlüssel steht unten als zusammengesetzter Schlüssel über
    -- (nachricht_id, mandant_id). Begründung im Kopf.
    nachricht_id    uuid NOT NULL,

    -- Der Name, wie ihn der Absender geschickt oder der Hochladende
    -- vergeben hat. Wird angezeigt und beim Herunterladen vorgeschlagen.
    -- NICHT der Name auf der Platte: der steht in ablage_pfad und trägt
    -- den Inhaltshash.
    dateiname       text NOT NULL,

    -- Bei ausgehenden Anhängen am INHALT bestimmt (erkenneTyp), bei
    -- eingehenden das, was der Absender behauptet hat.
    --
    -- Der Unterschied ist wichtig und wird beim Ausliefern wieder
    -- aufgegriffen: Was von außen kam, wird NIE mit dem behaupteten Typ
    -- ausgeliefert, sondern als application/octet-stream zum
    -- Herunterladen. Sonst entscheidet ein Fremder, was der Browser mit
    -- seiner Datei tut.
    mime_typ        text,

    -- Herkunft, und damit die Antwort auf "darf das in den Browser".
    --   'eingehend' -- kam per Mail herein, Inhalt ungeprüft
    --   'ausgehend' -- hier hochgeladen, Typ am Inhalt geprüft
    richtung        text NOT NULL
                    CHECK (richtung IN ('eingehend','ausgehend')),

    groesse_bytes   bigint NOT NULL CHECK (groesse_bytes >= 0),

    -- Pfad auf der Platte. Entsteht aus Hash und Endung, nie aus einer
    -- Eingabe (lib/dokumente.ts: ablagePfad).
    ablage_pfad     text NOT NULL,

    -- Wenn aus dem Anhang zusätzlich ein Beleg geworden ist, steht er
    -- hier. Kein Fremdschlüssel mit CASCADE: Wer einen Beleg aus der
    -- Buchhaltung entfernt, soll damit nicht den Anhang aus der
    -- Korrespondenz löschen. Die beiden Dinge haben verschiedene
    -- Lebensdauern.
    beleg_id        uuid,

    angelegt_am     timestamptz NOT NULL DEFAULT now(),

    -- Dieselbe Datei zweimal am selben Entwurf ist immer ein Versehen --
    -- ein doppelter Klick auf "Hochladen", eine doppelt zugestellte
    -- Webhook-Nachricht. Weil der Dateiname auf der Platte der
    -- Inhaltshash ist, erkennt diese Bedingung die Dublette am INHALT und
    -- nicht am Namen: zwei Bilder "IMG_0001.jpg" mit verschiedenem Inhalt
    -- gehen durch, dasselbe Bild unter zwei Namen nicht.
    --
    -- mandant_id führt, wie jede UNIQUE in diesem Schema. db/019 ist ein
    -- ganzer Nachtrag, weil db/010 vier davon übersehen hat.
    UNIQUE (mandant_id, nachricht_id, ablage_pfad)
);

CREATE INDEX IF NOT EXISTS nachricht_anhang_nachricht_idx
    ON nachricht_anhang (nachricht_id);

-- Der zusammengesetzte Fremdschlüssel. Wie in db/029 und db/031 in einem
-- DO-Block, damit die Migration auch auf einer Datenbank läuft, auf der
-- sie schon einmal lief.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'nachricht_anhang_nachricht_fk'
  ) THEN
    ALTER TABLE nachricht_anhang
      ADD CONSTRAINT nachricht_anhang_nachricht_fk
      FOREIGN KEY (nachricht_id, mandant_id)
      REFERENCES nachricht (id, mandant_id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE nachricht_anhang ENABLE ROW LEVEL SECURITY;
ALTER TABLE nachricht_anhang FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nachricht_anhang_mandant ON nachricht_anhang;
CREATE POLICY nachricht_anhang_mandant ON nachricht_anhang
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

COMMIT;
