-- Leads und Kanalwechsel.
--
-- Ein Interessent kommt ueber ein Portal (Kleinanzeigen, WG-Gesucht) oder per
-- Mail. Ziel ist, ihn nach WhatsApp zu holen, weil dort der Dialog schnell und
-- kostenfrei laeuft. Solange das nicht passiert ist, wird nachgefasst --
-- begrenzt und mit Abstand, damit es nicht laestig wird.

BEGIN;

ALTER TABLE vorgang
    -- Woher kam der Erstkontakt?
    ADD COLUMN herkunft text NOT NULL DEFAULT 'email'
        CHECK (herkunft IN ('email','kleinanzeigen','wg_gesucht','whatsapp','telefon','sonstige')),

    -- Hat der Interessent den Kanalwechsel vollzogen?
    ADD COLUMN kanalwechsel text NOT NULL DEFAULT 'nicht_noetig'
        CHECK (kanalwechsel IN ('nicht_noetig','offen','erfolgt','aufgegeben')),

    ADD COLUMN nachfass_anzahl   integer     NOT NULL DEFAULT 0,
    ADD COLUMN naechste_nachfassung timestamptz,
    ADD COLUMN letzter_kontakt_am   timestamptz;

CREATE INDEX vorgang_nachfass_idx
    ON vorgang (naechste_nachfassung)
 WHERE kanalwechsel = 'offen' AND status <> 'erledigt';

-- Portalvorgaenge koennen wir nicht selbst versenden: Kleinanzeigen und
-- WG-Gesucht haben keine Schnittstelle, und automatisierter Zugriff ist
-- dort untersagt. Der Entwurf wird darum zum Kopieren bereitgelegt.
ALTER TABLE nachricht
    ADD COLUMN versandweg text NOT NULL DEFAULT 'automatisch'
        CHECK (versandweg IN ('automatisch','zum_kopieren'));

-- letzter_kontakt_am aktuell halten
CREATE OR REPLACE FUNCTION touch_kontaktzeit() RETURNS trigger AS $$
BEGIN
    UPDATE vorgang
       SET letzter_kontakt_am = now()
     WHERE id = NEW.vorgang_id;

    -- Meldet sich der Interessent ueber WhatsApp, ist der Wechsel geschafft.
    IF NEW.kanal = 'whatsapp' AND NEW.richtung = 'ein' THEN
        UPDATE vorgang
           SET kanalwechsel = 'erfolgt',
               naechste_nachfassung = NULL
         WHERE id = NEW.vorgang_id
           AND kanalwechsel = 'offen';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nachricht_touch_kontaktzeit
    AFTER INSERT ON nachricht
    FOR EACH ROW EXECUTE FUNCTION touch_kontaktzeit();

COMMIT;
