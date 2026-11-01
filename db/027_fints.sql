BEGIN;

-- Direkte Bankanbindung über FinTS (HBCI mit PIN/TAN).
--
-- Entschieden am 01.11.2026 nach einem Vergleich: finAPI kostet 200 EUR im
-- Monat, der kostenlose Zugang von Enable Banking gilt nach deren eigener
-- Dokumentation nur für "individual non-commercial use" und deckt eine
-- gewerbliche Vermietung damit nicht. FinTS kostet nichts, verlangt aber
-- eine (derzeit kostenfreie) Produktregistrierung bei der Deutschen
-- Kreditwirtschaft -- seit 01.08.2019 lassen die Banken nur registrierte
-- Produkte zu.
--
-- WAS DIE VERSCHLÜSSELUNG HIER LEISTET UND WAS NICHT
--
-- Die PIN liegt mit AES-256-GCM verschlüsselt in `pin_verschluesselt`, der
-- Schlüssel kommt aus der Umgebungsvariablen FINTS_SCHLUESSEL. Das schützt
-- gegen das, was realistisch passiert: ein Datenbank-Abzug, ein Backup auf
-- einem fremden Datenträger, ein versehentlich geteilter Dump. In allen
-- diesen Fällen ist die PIN nicht lesbar.
--
-- Es schützt NICHT gegen jemanden mit Root-Rechten auf dem Server. Der
-- liest die Umgebungsvariable und entschlüsselt. Das ist keine
-- Nachlässigkeit, sondern eine Eigenschaft der Aufgabe: Ein nächtlicher
-- Lauf, der sich ohne Menschen bei der Bank anmeldet, muss die PIN auf
-- dieser Maschine wiederherstellen können. Wer etwas anderes verspricht,
-- hat entweder den Schlüssel doch dort liegen oder der Lauf ist nicht
-- unbeaufsichtigt.
--
-- Daraus folgt eine harte Voraussetzung, die nicht in diesem Schema steht:
-- Auf dem Server muss die Passwort-Anmeldung abgeschaltet und das
-- Root-Passwort zurückgesetzt sein, BEVOR hier eine PIN hinterlegt wird.

CREATE TABLE IF NOT EXISTS fints_zugang (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id     uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                        DEFAULT aktueller_mandant(),
    -- Auf welches Konto die geholten Umsätze gebucht werden.
    konto_id       uuid NOT NULL REFERENCES konto(id) ON DELETE CASCADE,

    bezeichnung    text NOT NULL,
    bank_id        text NOT NULL,            -- BLZ
    url            text NOT NULL,            -- FinTS-Endpunkt der Bank
    benutzer       text NOT NULL,            -- Anmeldename im Onlinebanking
    kunden_id      text,                     -- falls abweichend
    -- Die Kontonummer/IBAN, die bei der Bank geführt wird. Ein Zugang kann
    -- mehrere Konten sehen; geholt wird nur dieses.
    konto_iban     text,

    -- AES-256-GCM: 12 Byte Nonce ++ Geheimtext ++ 16 Byte Prüfsumme.
    pin_verschluesselt bytea,

    tan_verfahren  int,
    tan_medium     text,

    -- Das Ergebnis von synchronize(): BPD und UPD der Bank.
    --
    -- Wird gespeichert, weil eine vollständige Synchronisation selbst eine
    -- TAN verlangen kann. Mit gespeicherter Information meldet sich der
    -- Lauf direkt an und holt nur die Umsätze.
    bank_information jsonb,

    -- Ab wann beim nächsten Mal geholt wird.
    --
    -- Das ist der wichtigste Wert der Tabelle. Fragt man "alles
    -- verfügbare" ab oder einen Zeitraum von mehr als 90 Tagen, verlangt
    -- JEDE Bank eine TAN -- bei jedem Lauf. Nur wer sich den letzten Abruf
    -- merkt und ab dort weiterfragt, kommt ohne aus.
    letzter_abruf  date,
    letzter_erfolg timestamptz,

    -- Die Bank hat beim letzten Lauf eine TAN verlangt. Dann ruht der
    -- Zugang, bis ein Mensch sie eingibt -- ein Lauf, der es alle vier
    -- Stunden erneut versucht, lässt den Zugang sperren.
    tan_faellig    boolean NOT NULL DEFAULT false,
    tan_hinweis    text,
    letzter_fehler text,

    aktiv          boolean NOT NULL DEFAULT true,
    angelegt_am    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (mandant_id, bezeichnung)
);

ALTER TABLE fints_zugang ENABLE ROW LEVEL SECURITY;
ALTER TABLE fints_zugang FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fints_zugang_mandant ON fints_zugang;
CREATE POLICY fints_zugang_mandant ON fints_zugang
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

GRANT SELECT, INSERT, UPDATE, DELETE ON fints_zugang TO stig_app;

COMMENT ON COLUMN fints_zugang.letzter_abruf IS
    'Ab diesem Tag wird beim naechsten Lauf geholt. Ohne diesen Wert '
    'verlangt die Bank bei jedem Abruf eine TAN.';
COMMENT ON COLUMN fints_zugang.pin_verschluesselt IS
    'AES-256-GCM, Schluessel aus FINTS_SCHLUESSEL. Schuetzt Datenbank-'
    'Abzuege und Backups, nicht gegen Root auf dem Server.';

COMMIT;
