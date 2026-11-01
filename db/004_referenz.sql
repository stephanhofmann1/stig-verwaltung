-- Kurzes Referenz-Kuerzel je Vorgang, das in wa.me-Links und Betreffzeilen
-- mitgegeben wird. Damit findet eine eingehende WhatsApp-Nachricht ihre Akte,
-- auch wenn die Telefonnummer noch unbekannt ist.

BEGIN;

ALTER TABLE vorgang
    ADD COLUMN referenz text UNIQUE;

-- Format: V-0042  (menschenlesbar, in Freitext wiederfindbar)
UPDATE vorgang SET referenz = 'V-' || lpad(nummer::text, 4, '0')
 WHERE referenz IS NULL;

CREATE OR REPLACE FUNCTION setze_referenz() RETURNS trigger AS $$
BEGIN
    IF NEW.referenz IS NULL THEN
        NEW.referenz := 'V-' || lpad(NEW.nummer::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vorgang_referenz
    BEFORE INSERT ON vorgang
    FOR EACH ROW EXECUTE FUNCTION setze_referenz();

COMMIT;
