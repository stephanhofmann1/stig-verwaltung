-- Erfundene Mieter und Vorgänge für die Gestaltungsarbeit.
--
-- NICHT für den Server. Diese Datei füllt eine örtliche Wegwerfdatenbank,
-- damit die Oberfläche beim Entwerfen echte Zeilen zeigt statt leerer
-- Tabellen. Eine Gestaltung, die nur an leeren Listen geprüft wurde,
-- fällt beim ersten Kunden auseinander -- Umbrüche, lange Namen,
-- Zahlenbreiten sieht man erst an Inhalt.
--
-- Objekte und Einheiten kommen aus den Migrationen (echte Struktur, keine
-- Personen). Was hier dazukommt, sind Kontakte, Mietverhältnisse,
-- Sollstellungen und Vorgänge -- und die sind ALLE ERFUNDEN. Es stehen
-- bewusst keine echten Mieterdaten hier drin; die gehören nicht in eine
-- Datei, die im Git landet.
--
-- Absichtlich unbequeme Fälle, weil die Gestaltung genau daran scheitert:
--   ein sehr langer Name und ein sehr langer Betreff
--   ein fünfstelliger Betrag neben einem dreistelligen
--   Einheiten ohne Mietverhältnis (Leerstand darf nicht wie ein Fehler aussehen)
--   ein gesperrter Vorgang, ein wartender, ein erledigter
--
-- Aufruf:
--   psql -d stig_design -f db/saat-gestaltung.sql

BEGIN;

SET LOCAL app.mandant = '4bc754ad-0011-491f-841a-a516ef10446a';

DELETE FROM nachricht;
DELETE FROM vorgang;
DELETE FROM sollstellung;
DELETE FROM mietverhaeltnis;
DELETE FROM kontakt;

INSERT INTO kontakt (id, anzeigename, rolle, telefon) VALUES
 ('d0000000-0000-4000-8000-000000000001','Anna Beispiel','mieter','+4915112345001'),
 ('d0000000-0000-4000-8000-000000000002','Bernd Muster','mieter','+4915112345002'),
 -- Absichtlich lang: hier bricht eine Spalte, wenn sie zu eng ist.
 ('d0000000-0000-4000-8000-000000000003','Christina Schmidt-Oberländer','mieter','+4915112345003'),
 ('d0000000-0000-4000-8000-000000000004','Dilara Yildiz','mieter','+4915112345004'),
 ('d0000000-0000-4000-8000-000000000005','Boutique Beispiel GmbH','mieter','+4915112345005'),
 ('d0000000-0000-4000-8000-000000000006','Erik Nowak','mieter','+4915112345006'),
 ('d0000000-0000-4000-8000-000000000007','Farah Aziz','mieter','+4915112345007'),
 ('d0000000-0000-4000-8000-000000000008','Fensterbau Beispiel','handwerker','+4915112345008'),
 ('d0000000-0000-4000-8000-000000000009','Heizung Beispiel','handwerker','+4915112345009'),
 ('d0000000-0000-4000-8000-00000000000a','Stadt Beispiel, Amt für Wohnen','behoerde',NULL);

-- Mietverhältnisse auf die vorhandenen Einheiten, der Reihe nach.
-- Zwei Einheiten bleiben bewusst ohne.
WITH e AS (
  SELECT id, row_number() OVER (ORDER BY bezeichnung) AS n FROM einheit
), k AS (
  SELECT id, row_number() OVER (ORDER BY anzeigename) AS n
    FROM kontakt WHERE rolle = 'mieter'
)
INSERT INTO mietverhaeltnis (einheit_id, kontakt_id, beginn, kaltmiete, nebenkosten, kaution, status)
SELECT e.id, k.id,
       (date '2026-11-01' - ((k.n * 137) || ' days')::interval)::date,
       CASE k.n WHEN 5 THEN 2950 ELSE 440 + k.n * 55 END,
       CASE k.n WHEN 5 THEN  400 ELSE 110 + k.n * 10 END,
       CASE k.n WHEN 5 THEN 8850 ELSE (440 + k.n * 55) * 3 END,
       'aktiv'
  FROM k JOIN e ON e.n = k.n + 2;

INSERT INTO sollstellung (mietverhaeltnis_id, monat, betrag)
SELECT mv.id, m::date, COALESCE(mv.kaltmiete,0) + COALESCE(mv.nebenkosten,0)
  FROM mietverhaeltnis mv
 CROSS JOIN generate_series(date_trunc('month', now() - interval '3 months'),
                            date_trunc('month', now()), interval '1 month') AS m
 WHERE mv.beginn <= m;

INSERT INTO vorgang (id, betreff, kategorie, status, heikel, kontakt_id) VALUES
 ('f0000000-0000-4000-8000-000000000001','Heizung im Bad bleibt kalt','mieter','offen',false,
  'd0000000-0000-4000-8000-000000000001'),
 -- Absichtlich sehr lang: prüft Umbruch in Liste und Überschrift.
 ('f0000000-0000-4000-8000-000000000002','Angebot Fensteraustausch inklusive Demontage, Entsorgung der Altfenster und Glattstrich der Laibungen','handwerker','offen',false,
  'd0000000-0000-4000-8000-000000000008'),
 ('f0000000-0000-4000-8000-000000000003','Anfrage Wohnung im 2. OG, Einzug zum Quartalsbeginn','interessent','offen',false,NULL),
 ('f0000000-0000-4000-8000-000000000004','Mietrückstand, zweite Mahnstufe','mahnwesen','wartet',true,
  'd0000000-0000-4000-8000-000000000004'),
 ('f0000000-0000-4000-8000-000000000005','Termin Heizungswartung 12.11.','handwerker','erledigt',false,
  'd0000000-0000-4000-8000-000000000009'),
 ('f0000000-0000-4000-8000-000000000006','Rückfrage zur Abrechnung 2025','behoerde','offen',true,
  'd0000000-0000-4000-8000-00000000000a');

INSERT INTO nachricht (vorgang_id, richtung, status, von_email, von_name, an_emails,
                       betreff, koerper_text, empfangen_am) VALUES
 ('f0000000-0000-4000-8000-000000000001','ein','empfangen','a.beispiel@example.org','Anna Beispiel',
  ARRAY['verwaltung@example.org'],'Heizung im Bad bleibt kalt',
  'Guten Abend, die Heizung im Bad wird seit gestern nicht mehr warm. Die anderen Räume sind in Ordnung. Können Sie da jemanden schicken?',
  now() - interval '3 hours'),
 ('f0000000-0000-4000-8000-000000000002','ein','empfangen','angebot@example.net','Fensterbau Beispiel',
  ARRAY['verwaltung@example.org'],'Angebot',
  'Guten Tag, anbei unser Angebot über den Austausch von dreizehn Fenstern. Netto 12.793,54 EUR, brutto 15.224,31 EUR.',
  now() - interval '2 days'),
 ('f0000000-0000-4000-8000-000000000003','ein','empfangen','interesse@example.org','Interessentin',
  ARRAY['verwaltung@example.org'],'Anfrage Wohnung 2. OG',
  'Hallo, ist die Wohnung im zweiten Obergeschoss noch frei? Ich würde gern zum Quartalsbeginn einziehen.',
  now() - interval '1 day'),
 ('f0000000-0000-4000-8000-000000000006','ein','empfangen','amt@example.org','Stadt Beispiel',
  ARRAY['verwaltung@example.org'],'Rückfrage zur Abrechnung 2025',
  'Sehr geehrte Damen und Herren, zu der eingereichten Abrechnung haben wir eine Rückfrage.',
  now() - interval '5 days');

-- Ein Entwurf, der auf Freigabe wartet -- der häufigste Zustand im Postfach.
INSERT INTO nachricht (vorgang_id, richtung, status, von_email, an_emails,
                       betreff, koerper_text, verfasst_von) VALUES
 ('f0000000-0000-4000-8000-000000000001','aus','entwurf','verwaltung@example.org',
  ARRAY['a.beispiel@example.org'],'AW: Heizung im Bad bleibt kalt',
  E'Guten Abend,\n\ndanke für die Meldung. Ich habe den Heizungsbetrieb informiert und melde mich, sobald ein Termin steht. Falls es im Bad bis dahin zu kalt wird, sagen Sie mir bitte kurz Bescheid.\n\nBeste Grüße',
  'agent'),
 ('f0000000-0000-4000-8000-000000000003','aus','entwurf','verwaltung@example.org',
  ARRAY['interesse@example.org'],'AW: Anfrage Wohnung 2. OG',
  E'Guten Tag,\n\nvielen Dank für Ihr Interesse. Die Wohnung ist zum 01.01. frei. Gern vereinbaren wir einen Besichtigungstermin.\n\nBeste Grüße',
  'agent');

COMMIT;
