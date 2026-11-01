-- Testdaten: genug, um den Durchlauf zu pruefen. Keine echten Mieterdaten.

BEGIN;

INSERT INTO objekt (id, name, strasse, plz, ort) VALUES
 ('11111111-1111-1111-1111-111111111111','Westanlage 9','Westanlage 9','35390','Gießen'),
 ('22222222-2222-2222-2222-222222222222','Welserstraße 10','Welserstraße 10','67059','Ludwigshafen');

INSERT INTO einheit (objekt_id, bezeichnung, etage, flaeche_qm, art) VALUES
 ('11111111-1111-1111-1111-111111111111','Zimmer 7','2. OG', 12.0,'wohnen'),
 ('11111111-1111-1111-1111-111111111111','Gewerbe EG','EG', 85.0,'gewerbe'),
 ('22222222-2222-2222-2222-222222222222','Wohnung links','1. OG', 64.0,'wohnen');

INSERT INTO kontakt (id, anzeigename, rolle, firma) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Dennis Harsch','handwerker','ML-Hauselemente'),
 ('aaaaaaaa-0000-0000-0000-000000000002','Testmieter Zimmer 7','mieter',NULL),
 ('aaaaaaaa-0000-0000-0000-000000000003','Stadtwerke (Test)','versorger','Stadtwerke');

INSERT INTO kontakt_email (kontakt_id, email, ist_primaer) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','d.harsch@beispiel.invalid',true),
 ('aaaaaaaa-0000-0000-0000-000000000002','mieter7@beispiel.invalid',true),
 ('aaaaaaaa-0000-0000-0000-000000000003','abrechnung@beispiel.invalid',true);

COMMIT;
