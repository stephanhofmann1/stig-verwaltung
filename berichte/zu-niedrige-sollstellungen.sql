-- BERICHT, KEINE MIGRATION. Diese Datei aendert nichts.
--
--   cd /opt/stig
--   docker compose exec -T db psql -U stig -d stig -f /dev/stdin \
--     < berichte/zu-niedrige-sollstellungen.sql
--
-- (Oder den Inhalt in psql einfuegen. Die Datei liegt bewusst nicht in db/
--  -- dort wuerde sie der Migrationsrunner einspielen.)
--
-- ---------------------------------------------------------------------------
-- Wozu
-- ---------------------------------------------------------------------------
--
-- Bis zum 01.11.2026 rechnete die Sollstellung nur Kaltmiete + Nebenkosten.
-- Der Moeblierungszuschlag fehlte, weil der Lesezugriff auf die Spalte den
-- falschen Namen hatte -- ein Fehler, der nichts gemeldet hat, sondern still
-- NULL lieferte. Fast alle WG-Zimmer sind moebliert vermietet.
--
-- Die Erzeugung legt bestehende Sollstellungen nie neu an (ON CONFLICT DO
-- NOTHING, und das ist richtig: was gestellt und vielleicht bezahlt ist,
-- bleibt stehen). Die zu niedrigen Betraege von damals korrigieren sich also
-- nicht von selbst.
--
-- Dieser Bericht zeigt, welche das sind und um wie viel. Er entscheidet
-- nichts -- die Entscheidung ist kaufmaennisch und rechtlich, nicht
-- technisch:
--
--   a) Stehen lassen. Die Differenz ist ein Mietrueckstand, den der
--      Kontoabgleich als Ueberzahlung des Mieters ausweist. Das heisst: Wer
--      korrekt den vollen Betrag gezahlt hat, hat bei uns ein Guthaben
--      stehen. Fuer den Mieter folgenlos, fuer die Buchfuehrung falsch.
--   b) Nachstellen. Die fehlenden Betraege als eigene Sollstellungen
--      anlegen. Sauber in der Buchfuehrung -- aber wer tatsaechlich zu wenig
--      gezahlt hat, hat damit rueckwirkend einen Rueckstand, und das Mahnwesen
--      wuerde darauf anspringen. Vor einer solchen Nachforderung gehoert
--      geprueft, was tatsaechlich eingegangen ist.
--   c) Nur dort nachstellen, wo der Mieter ohnehin den vollen Betrag gezahlt
--      hat. Das ist in den meisten Faellen die richtige Antwort: Dort geht es
--      um die Zuordnung eines bereits erhaltenen Betrags, nicht um eine
--      Forderung an jemanden.
--
-- Ohne Zahlen ist das nicht zu entscheiden, und die liefert nur der Server.

\pset footer off

\echo ''
\echo '=== 1. Sollstellungen unter dem heute richtigen Betrag ==='
\echo ''

WITH richtig AS (
    SELECT mv.id,
           k.anzeigename,
           e.bezeichnung AS einheit,
           -- Dieselbe Regel wie lib/sollstellung.ts: die Vertragszusage
           -- schlaegt die Summe der Posten.
           COALESCE(
               NULLIF(mv.gesamtmiete, 0),
               COALESCE(mv.kaltmiete, 0)
                 + COALESCE(mv.nebenkosten, 0)
                 + COALESCE(mv.moeblierungszuschlag, 0)
           ) AS soll_monat
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
)
SELECT r.anzeigename,
       r.einheit,
       to_char(s.monat, 'MM/YYYY')        AS monat,
       s.betrag                           AS gestellt,
       r.soll_monat                       AS richtig,
       r.soll_monat - s.betrag            AS differenz,
       -- Ein anteiliger Monat ist kein Fehler: Ein- und Auszug werden
       -- taggenau gerechnet, der Betrag ist dann zu Recht niedriger.
       CASE WHEN s.notizen LIKE 'Anteilig:%' THEN 'anteilig - pruefen'
            ELSE 'voller Monat' END       AS art
  FROM sollstellung s
  JOIN richtig r ON r.id = s.mietverhaeltnis_id
 WHERE s.betrag < r.soll_monat
 ORDER BY r.anzeigename, s.monat;

\echo ''
\echo '=== 2. Summe je Mietverhaeltnis, nur volle Monate ==='
\echo ''
\echo '    Anteilige Monate sind ausgenommen: Dort ist ein kleinerer Betrag'
\echo '    richtig, und die Differenz waere nur Rauschen.'
\echo ''

WITH richtig AS (
    SELECT mv.id,
           k.anzeigename,
           e.bezeichnung AS einheit,
           COALESCE(
               NULLIF(mv.gesamtmiete, 0),
               COALESCE(mv.kaltmiete, 0)
                 + COALESCE(mv.nebenkosten, 0)
                 + COALESCE(mv.moeblierungszuschlag, 0)
           ) AS soll_monat
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
      JOIN einheit e ON e.id = mv.einheit_id
)
SELECT r.anzeigename,
       r.einheit,
       count(*)                            AS monate,
       min(to_char(s.monat,'MM/YYYY'))     AS ab,
       max(to_char(s.monat,'MM/YYYY'))     AS bis,
       sum(r.soll_monat - s.betrag)        AS summe_differenz
  FROM sollstellung s
  JOIN richtig r ON r.id = s.mietverhaeltnis_id
 WHERE s.betrag < r.soll_monat
   AND COALESCE(s.notizen,'') NOT LIKE 'Anteilig:%'
 GROUP BY r.anzeigename, r.einheit
 ORDER BY summe_differenz DESC;

\echo ''
\echo '=== 3. Hat der Mieter trotzdem den vollen Betrag gezahlt? ==='
\echo ''
\echo '    Entscheidend fuer die Wahl zwischen (b) und (c). Verglichen wird'
\echo '    das gestellte Soll gegen die zugeordneten Eingaenge je Monat.'
\echo '    "zuviel gezahlt" heisst hier: Der Mieter hat mehr ueberwiesen als'
\echo '    gestellt war -- also wahrscheinlich den richtigen Betrag.'
\echo ''

WITH richtig AS (
    SELECT mv.id,
           k.anzeigename,
           COALESCE(
               NULLIF(mv.gesamtmiete, 0),
               COALESCE(mv.kaltmiete, 0)
                 + COALESCE(mv.nebenkosten, 0)
                 + COALESCE(mv.moeblierungszuschlag, 0)
           ) AS soll_monat
      FROM mietverhaeltnis mv
      JOIN kontakt k ON k.id = mv.kontakt_id
), gezahlt AS (
    SELECT z.sollstellung_id, sum(z.betrag) AS eingang
      FROM zuordnung z
     GROUP BY z.sollstellung_id
)
SELECT r.anzeigename,
       to_char(s.monat,'MM/YYYY')              AS monat,
       s.betrag                                AS gestellt,
       r.soll_monat                            AS richtig,
       COALESCE(g.eingang, 0)                  AS zugeordnet,
       CASE
         WHEN COALESCE(g.eingang,0) >= r.soll_monat THEN 'voll gezahlt'
         WHEN COALESCE(g.eingang,0) >  s.betrag     THEN 'zuviel gezahlt'
         WHEN COALESCE(g.eingang,0) =  0            THEN 'kein Eingang zugeordnet'
         ELSE 'offen'
       END                                     AS lage
  FROM sollstellung s
  JOIN richtig r  ON r.id = s.mietverhaeltnis_id
  LEFT JOIN gezahlt g ON g.sollstellung_id = s.id
 WHERE s.betrag < r.soll_monat
   AND COALESCE(s.notizen,'') NOT LIKE 'Anteilig:%'
 ORDER BY r.anzeigename, s.monat;

\echo ''
\echo '=== Ende. Es wurde nichts geaendert. ==='
\echo ''
