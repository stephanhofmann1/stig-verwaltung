-- Wirtschaftliche Stammdaten am Objekt: Kaufpreis, Ansätze, Finanzierung
--
-- Bisher weiß die Plattform alles über die Einnahmenseite und nichts über
-- das eingesetzte Geld. Sie kann sagen, dass im Oktober 4.312 Euro Soll
-- gestellt und 4.100 Euro gezahlt wurden -- aber nicht, ob das für dieses
-- Haus viel oder wenig ist. Jede Frage, die ein Eigentümer vor einem Kauf,
-- einer Sanierung oder einem Verkauf stellt ("rentiert sich das?"), endet
-- deshalb in einer Tabellenkalkulation neben der Anwendung. Und eine
-- Tabelle neben der Anwendung ist eine zweite Rechnung derselben Zahl --
-- genau das, was in lib/objekte.ts beim Wort "Leerstand" schon einmal
-- auseinandergelaufen ist.
--
-- Diese Migration legt nur die Eingangsgrößen an, die niemand ableiten
-- kann. Alles Gerechnete steht in app/lib/rendite.ts und wird nicht
-- gespeichert: Eine gespeicherte Rendite wäre ab dem nächsten
-- Mietverhältnis falsch, ohne dass es jemand merkt.
--
-- Warum jede einzelne Spalte:
--
--   kaufpreis / kaufnebenkosten
--     Getrennt, nicht als Summe. Die Nebenkosten (Grunderwerbsteuer,
--     Notar, Grundbuch, Makler) sind steuerlich anders zu behandeln als
--     der Kaufpreis und werden beim Verkauf anders betrachtet. Eine
--     addierte Spalte ließe sich nicht mehr auseinandernehmen.
--
--   kaufdatum
--     Ohne Datum lässt sich keine Aussage zeitlich einordnen -- und für
--     die Spekulationsfrist (§ 23 EStG, zehn Jahre) ist es der einzige
--     Anker, den die Datenbank hat.
--
--   verkehrswert
--     Optional und ausdrücklich nicht dasselbe wie der Kaufpreis. Nach
--     einer Sanierung ist die Rendite auf den Kaufpreis die Antwort auf
--     "war der Kauf gut?", die Rendite auf den heutigen Wert die Antwort
--     auf "ist das Kapital hier richtig eingesetzt?". Zwei Fragen, zwei
--     Bezugsgrößen.
--
--   bewirtschaftung_jahr
--     Der Notausgang. Die Belegerfassung ist für Gießen dicht, für
--     Mannheim läuft fast alles über die WEG-Hausgeldabrechnung und
--     taucht als ein Beleg im Jahr auf. Ohne einen manuellen
--     Jahresansatz müsste die Anwendung dort entweder schweigen oder
--     eine zu gute Rendite zeigen. Gesetzt schlägt dieser Wert die
--     Belegsumme -- siehe app/lib/rendite.ts.
--
--   instandhaltung_je_qm
--     Der kalkulatorische Ansatz (Peters'sche Formel, Verbände rechnen
--     mit 8 bis 15 €/m²/Jahr). Ein Jahr ohne Reparatur ist kein Jahr
--     ohne Instandhaltungsbedarf; wer nur die Belege rechnet, bekommt
--     in genau diesen Jahren eine Rendite, die er nicht halten kann.
--
--   mietausfallwagnis_satz
--     Prozent des Rohertrags, üblich 2 bis 4 %. In der
--     Wertermittlung (§ 32 ImmoWertV) ist das ein eigener Posten, kein
--     Schätzzuschlag. Steht hier als Satz und nicht als Betrag, damit er
--     bei steigender Miete mitwächst.
--
--   darlehen_restschuld / darlehen_zins_satz / darlehen_rate_monat
--     Drei Spalten, weil sie drei verschiedene Fragen beantworten: die
--     Restschuld das Eigenkapital, der Zinssatz die Zinsdeckung, die
--     Annuität den Cashflow. Aus der Annuität allein lässt sich der
--     Zinsanteil nicht herausrechnen, ohne den Tilgungsplan zu kennen.
--     0 ist ein gültiger Wert und heißt "schuldenfrei"; NULL heißt
--     "nicht erfasst", und darauf rechnet die Anwendung nichts.
--
-- Alle Spalten sind NULL-bar und ohne Vorgabewert. Das ist die Richtung
-- dieser Anwendung: Ein nicht gepflegter Wert führt zu einer Kennzahl, die
-- sagt "dafür fehlt mir X" -- nicht zu einer Null, die wie eine Aussage
-- aussieht. Es gibt deshalb hier auch keine UPDATE-Zeilen mit bekannten
-- Werten: Kaufpreise trägt der Eigentümer selbst ein, denn eine Zahl, die
-- eine Migration behauptet, prüft hinterher niemand nach.

BEGIN;

ALTER TABLE objekt
    ADD COLUMN IF NOT EXISTS kaufpreis              numeric(12,2),
    ADD COLUMN IF NOT EXISTS kaufnebenkosten        numeric(12,2),
    ADD COLUMN IF NOT EXISTS kaufdatum              date,
    ADD COLUMN IF NOT EXISTS verkehrswert           numeric(12,2),
    ADD COLUMN IF NOT EXISTS bewirtschaftung_jahr   numeric(10,2),
    ADD COLUMN IF NOT EXISTS instandhaltung_je_qm   numeric(6,2),
    ADD COLUMN IF NOT EXISTS mietausfallwagnis_satz numeric(5,2),
    ADD COLUMN IF NOT EXISTS darlehen_restschuld    numeric(12,2),
    ADD COLUMN IF NOT EXISTS darlehen_zins_satz     numeric(5,3),
    ADD COLUMN IF NOT EXISTS darlehen_rate_monat    numeric(10,2);

COMMENT ON COLUMN objekt.kaufpreis IS
    'Kaufpreis ohne Nebenkosten, in Euro. NULL = nicht erfasst; dann gibt '
    'es keine Rendite, sondern den Hinweis, dass der Kaufpreis fehlt.';

COMMENT ON COLUMN objekt.kaufnebenkosten IS
    'Grunderwerbsteuer, Notar, Grundbuch, Makler -- in Euro, getrennt vom '
    'Kaufpreis, weil steuerlich anders zu behandeln. Zusammen bilden beide '
    'den Gesamtinvest, auf den die Rendite gerechnet wird.';

COMMENT ON COLUMN objekt.kaufdatum IS
    'Tag des Eigentumsübergangs. Anker für jede zeitliche Einordnung und '
    'für die Spekulationsfrist nach § 23 EStG.';

COMMENT ON COLUMN objekt.verkehrswert IS
    'Heutiger Wert in Euro, optional. Bezugsgröße für die Rendite auf den '
    'aktuellen Wert -- nach einer Sanierung eine andere Frage als die '
    'Rendite auf den Kaufpreis.';

COMMENT ON COLUMN objekt.bewirtschaftung_jahr IS
    'Manueller Jahresansatz der Bewirtschaftungskosten in Euro. Gesetzt '
    'ersetzt er die Belegsumme (nicht die Ansätze für Mietausfallwagnis '
    'und Instandhaltung). Für Objekte gedacht, deren Kosten über eine '
    'WEG-Hausgeldabrechnung laufen und in den Belegen nicht vollständig '
    'stehen.';

COMMENT ON COLUMN objekt.instandhaltung_je_qm IS
    'Kalkulatorischer Instandhaltungsansatz in Euro je m² und Jahr. Ein '
    'Jahr ohne Reparaturbeleg ist kein Jahr ohne Instandhaltungsbedarf.';

COMMENT ON COLUMN objekt.mietausfallwagnis_satz IS
    'Mietausfallwagnis in Prozent des Rohertrags (üblich 2 bis 4). Als '
    'Satz und nicht als Betrag, damit er mit der Miete mitwächst.';

COMMENT ON COLUMN objekt.darlehen_restschuld IS
    'Restschuld aller Objektdarlehen in Euro. 0 = schuldenfrei, '
    'NULL = nicht erfasst. Nur mit diesem Wert gibt es ein Eigenkapital.';

COMMENT ON COLUMN objekt.darlehen_zins_satz IS
    'Nominalzins in Prozent pro Jahr. Grundlage der Zinsdeckung; aus der '
    'Annuität allein wäre der Zinsanteil nicht herauszurechnen.';

COMMENT ON COLUMN objekt.darlehen_rate_monat IS
    'Monatliche Annuität in Euro, also Zins plus Tilgung -- der Betrag, '
    'der das Konto verlässt. Grundlage des Cashflows. 0 = schuldenfrei, '
    'NULL = nicht erfasst.';

COMMIT;
