BEGIN;

-- Fristen, die Geld oder Rechte kosten, wenn sie verstreichen.
--
-- Der Anlass: Die Nebenkostenabrechnung 2025 für die Welserstraße muss den
-- Mietern bis zum **31.12.2026** zugehen (§ 556 Abs. 3 Satz 2 BGB). Danach
-- sind Nachforderungen ausgeschlossen -- 2.759,62 EUR wären verloren,
-- während die Guthaben von 1.280,02 EUR weiter auszuzahlen sind. Die Frist
-- stand bisher in einem Projektdokument. Ein Dokument warnt niemanden.
--
-- Deshalb sind Fristen hier Daten: Der tägliche Lagebericht liest sie und
-- meldet sie, je näher sie kommen, desto deutlicher.
--
-- Was hier NICHT hingehört: alles, was die Anwendung selbst ausrechnen kann.
-- Mietfälligkeit und Mahnstufen stehen in mahnstufen.ts und würden hier
-- doppelt gepflegt -- und zwei Quellen für dasselbe Datum heißt, dass eine
-- davon falsch ist.

CREATE TABLE IF NOT EXISTS frist (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mandant_id  uuid NOT NULL REFERENCES mandant(id) ON DELETE CASCADE
                     DEFAULT aktueller_mandant(),
    objekt_id   uuid REFERENCES objekt(id) ON DELETE CASCADE,
    bezeichnung text NOT NULL,
    faellig_am  date NOT NULL,
    -- Die Rechtsgrundlage oder der Vertrag. Gehört dazu: Wer eine Frist
    -- liest, muss nachsehen können, woher sie kommt, bevor er sie verschiebt.
    grundlage   text,
    -- Was auf dem Spiel steht. Nur zur Einordnung, keine Buchhaltung.
    betrag      numeric(12,2),
    -- Woran es noch hängt. Geht wörtlich in den Lagebericht.
    haengt_an   text,
    erledigt_am date,
    angelegt_am timestamptz NOT NULL DEFAULT now(),
    UNIQUE (mandant_id, bezeichnung, faellig_am)
);

CREATE INDEX IF NOT EXISTS frist_offen
    ON frist (faellig_am) WHERE erledigt_am IS NULL;

ALTER TABLE frist ENABLE ROW LEVEL SECURITY;
ALTER TABLE frist FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frist_mandant ON frist;
CREATE POLICY frist_mandant ON frist
    USING (mandant_id = aktueller_mandant())
    WITH CHECK (mandant_id = aktueller_mandant());

GRANT SELECT, INSERT, UPDATE, DELETE ON frist TO stig_app;

COMMIT;
