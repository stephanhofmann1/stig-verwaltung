-- Echte Objektstruktur.
--
-- Legt zuerst die beiden Objekte an. Testdaten liegen bewusst NICHT in
-- diesem Ordner, weil Postgres beim ersten Start alles hier ausfuehrt --
-- sonst staenden auf dem Server erfundene Mieter.
-- Quelle: oeffentliche Angaben auf westanlage9.vercel.app (Stand 31.10.2026).
-- Mieterdaten sind hier bewusst NICHT enthalten -- die traegt Stephan ein.

BEGIN;

INSERT INTO objekt (id, name, strasse, plz, ort) VALUES
 ('11111111-1111-1111-1111-111111111111','Westanlage 9','Westanlage 9','35390','Gießen'),
 ('22222222-2222-2222-2222-222222222222','Welserstraße 10','Welserstraße 10','67059','Ludwigshafen')
ON CONFLICT (id) DO NOTHING;

UPDATE objekt
   SET notizen = 'Baujahr 1957, Sanierung 2017. Vier Etagen plus DG, '
               || 'rund 920 m2 Grundflaeche. Gas-Zentralheizung. '
               || 'Neue Fenster und Haustuer umgesetzt, Waermepumpe und PV in Planung.'
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- --- Westanlage 9 -----------------------------------------------------------
-- Wohnungen als Gemeinschaftseinheit, Zimmer einzeln (einzeln vermietet).

INSERT INTO einheit (objekt_id, bezeichnung, etage, flaeche_qm, art, notizen) VALUES
 ('11111111-1111-1111-1111-111111111111','9er-WG','EG/UG', NULL,'gemeinschaft','Neun Einzelzimmer, Gemeinschaftskueche und -bad. Zimmergroessen 18-36 m2.'),
 ('11111111-1111-1111-1111-111111111111','5er-WG 1. OG','1. OG', NULL,'gemeinschaft','Fuenf Einzelzimmer, Wohn-/Essbereich, Kueche, Bad, WC. Zimmergroessen 13-27 m2.'),
 ('11111111-1111-1111-1111-111111111111','5er-WG 2. OG','2. OG', 148.0,'gemeinschaft','Gesamte zweite Etage, fuenf Einzelzimmer, eigene Kueche und Bad.'),
 ('11111111-1111-1111-1111-111111111111','4er-WG 3. OG','3. OG', NULL,'gemeinschaft','Vier Zimmer, gemeinsame Kueche und Bad. Zimmergroessen 12-16 m2.'),
 ('11111111-1111-1111-1111-111111111111','Single-Apartment 3. OG','3. OG', 39.0,'wohnen','Eigenstaendiges 1-Zimmer-Apartment mit Kueche und Bad.'),
 ('11111111-1111-1111-1111-111111111111','3-Zimmer-Wohnung DG','DG', 93.0,'wohnen','Voll moebliert. Angegeben ist die Grundflaeche; anrechenbare Wohnflaeche wegen Dachschraegen geringer.'),
 ('11111111-1111-1111-1111-111111111111','1-Zimmer-Apartment DG','DG', 39.0,'wohnen','Voll moebliert, eigene Kueche und Bad. Dachschraegen.'),
 ('11111111-1111-1111-1111-111111111111','Gewerbeflaeche EG','EG', 160.0,'gewerbe','Ladenflaeche mit Schaufenstern. Teilflaeche seit Herbst 2026 gesondert.');

-- Zimmer der WGs. Nummern und Preise, soweit oeffentlich bekannt;
-- der Rest wird beim Einpflegen der Mietverhaeltnisse ergaenzt.
INSERT INTO einheit (objekt_id, bezeichnung, etage, art, notizen)
SELECT '11111111-1111-1111-1111-111111111111',
       'Zimmer ' || g, 'EG/UG', 'wohnen', '9er-WG'
  FROM generate_series(1,9) g;

INSERT INTO einheit (objekt_id, bezeichnung, etage, art, notizen)
SELECT '11111111-1111-1111-1111-111111111111',
       'Zimmer 1.' || g, '1. OG', 'wohnen', '5er-WG 1. OG'
  FROM generate_series(1,5) g;

INSERT INTO einheit (objekt_id, bezeichnung, etage, art, notizen)
SELECT '11111111-1111-1111-1111-111111111111',
       'Zimmer 2.' || g, '2. OG', 'wohnen', '5er-WG 2. OG'
  FROM generate_series(1,5) g;

INSERT INTO einheit (objekt_id, bezeichnung, etage, art, notizen)
SELECT '11111111-1111-1111-1111-111111111111',
       'Zimmer 3.' || g, '3. OG', 'wohnen', '4er-WG 3. OG'
  FROM generate_series(1,4) g;

-- --- Welserstrasse 10, Ludwigshafen ----------------------------------------
-- Acht Mietparteien laut Zahlungsabgleich; Zuschnitt traegt Stephan nach.

INSERT INTO einheit (objekt_id, bezeichnung, etage, art, notizen)
SELECT '22222222-2222-2222-2222-222222222222',
       'Wohnung ' || g, NULL, 'wohnen', 'Zuschnitt noch einzutragen'
  FROM generate_series(1,8) g;

COMMIT;
