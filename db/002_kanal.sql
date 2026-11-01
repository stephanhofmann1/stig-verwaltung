-- Zweiter Kanal: WhatsApp. Die Vorgangsakte bleibt dieselbe,
-- nur die Nachricht weiss, worueber sie kam.

BEGIN;

ALTER TABLE nachricht
    ADD COLUMN kanal text NOT NULL DEFAULT 'email'
        CHECK (kanal IN ('email','whatsapp'));

-- Externe ID des Kanals (WhatsApp-Message-ID bzw. RFC-Message-ID).
-- Fuer E-Mail bleibt message_id massgeblich; fuer WhatsApp nutzen wir dies.
ALTER TABLE nachricht
    ADD COLUMN extern_id text;

CREATE UNIQUE INDEX nachricht_extern_id_idx
    ON nachricht (kanal, extern_id) WHERE extern_id IS NOT NULL;

-- Telefonnummer am Kontakt, damit eingehende WhatsApp-Nachrichten
-- demselben Menschen zugeordnet werden wie seine Mails.
CREATE TABLE kontakt_telefon (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kontakt_id  uuid NOT NULL REFERENCES kontakt(id) ON DELETE CASCADE,
    nummer_e164 text NOT NULL,          -- '+4915112345678'
    whatsapp_ok boolean NOT NULL DEFAULT false,   -- dokumentierte Einwilligung
    eingewilligt_am timestamptz,
    UNIQUE (nummer_e164)
);
CREATE INDEX kontakt_telefon_kontakt_idx ON kontakt_telefon (kontakt_id);

COMMIT;
