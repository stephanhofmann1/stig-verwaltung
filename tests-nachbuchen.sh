#!/usr/bin/env bash
# Prueft die Nachbuchung gegen eine echte Postgres-Instanz, ohne Docker.
#
# Baut genau den Zustand nach, in dem Stephans Server am 01.11.2026 stand:
# Schema vollstaendig, schema_migration vorhanden, aber leer. Vorher lief der
# Runner in diesem Zustand bei jedem Versuch gegen "relation objekt already
# exists" -- fuer immer, weil die Nachbuchung nur griff, wenn die Tabelle
# ganz fehlte.
set -uo pipefail
cd "$(dirname "$0")"

DB=nachbuch_test
psql_stig() { sudo -u postgres psql -v ON_ERROR_STOP=1 -X -d "$DB" "$@"; }

fehler=0
pruefe() {
  if [ "$2" = "$3" ]; then echo "  ok      $1"
  else echo "  FEHLER  $1: erwartet '$3', war '$2'"; fehler=$((fehler+1)); fi
}

aufsetzen() {
  sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
  sudo -u postgres createdb "$DB" >/dev/null
  for f in db/0*.sql; do psql_stig -q -f "$f" >/dev/null 2>&1; done
}

. db/nachbuchen.sh

# Aus den Dateien abgeleitet, nicht fest verdrahtet: Sonst faellt dieser
# Test bei jeder neuen Migration, und zwar mit einer Meldung, die nach
# einem Fehler in der Nachbuchung aussieht statt nach einem im Test.
ANZAHL=$(ls db/0*.sql | wc -l | tr -d " ")
LETZTE=$(ls db/0*.sql | tail -1 | xargs basename)
HOECHSTE="${LETZTE%%_*}"
echo "Erwartet: $ANZAHL Migrationen, hoechste Nummer $HOECHSTE"
echo

echo "== Fall 1: Schema vollstaendig, schema_migration leer =="
echo "   (genau der Zustand, in dem der Server feststeckte)"
aufsetzen
psql_stig -q -c "CREATE TABLE IF NOT EXISTS schema_migration (
   datei text PRIMARY KEY, angewandt_am timestamptz NOT NULL DEFAULT now());" >/dev/null
ausgabe=$(nachbuchen 2>&1); rc=$?
pruefe "Nachbuchung laeuft durch" "$rc" "0"
pruefe "Grenze ist die hoechste Migration" \
  "$(echo "$ausgabe" | sed -n 's/.*reicht bis \([0-9]*\)\./\1/p')" "$HOECHSTE"
anzahl=$(psql_stig -tAc "SELECT count(*) FROM schema_migration")
pruefe "alle Schritte vermerkt" "$anzahl" "$ANZAHL"
pruefe "001 ist dabei" \
  "$(psql_stig -tAc "SELECT 1 FROM schema_migration WHERE datei='001_schema.sql'")" "1"

echo
echo "== Fall 2: dasselbe noch einmal (muss wiederholbar sein) =="
ausgabe2=$(nachbuchen 2>&1); rc2=$?
pruefe "zweiter Lauf stoert nicht" "$rc2" "0"
pruefe "nichts dazugekommen" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration")" "$ANZAHL"
pruefe "zweiter Lauf bucht nicht erneut nach" \
  "$(echo "$ausgabe2" | grep -c 'Nachbuchung')" "0"

echo
echo "== Fall 3: alte Installation, nur bis 012 =="
echo "   (Grenze muss 012 sein, 015 und hoeher muessen offen bleiben)"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
sudo -u postgres createdb "$DB" >/dev/null
for f in db/00*.sql db/010_*.sql db/011_*.sql db/012_*.sql; do
  psql_stig -q -f "$f" >/dev/null 2>&1
done
psql_stig -q -c "CREATE TABLE schema_migration (
   datei text PRIMARY KEY, angewandt_am timestamptz NOT NULL DEFAULT now());" >/dev/null
ausgabe3=$(nachbuchen 2>&1)
pruefe "Grenze ist 012" \
  "$(echo "$ausgabe3" | sed -n 's/.*reicht bis \([0-9]*\)\./\1/p')" "012"
pruefe "015 bleibt offen" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration WHERE datei='015_mieterzugang.sql'")" "0"
pruefe "024 bleibt offen" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration WHERE datei='024_mahnwesen_freigabe.sql'")" "0"

echo
echo "== Fall 4: leere Datenbank (Neuinstallation) =="
echo "   (es darf NICHTS nachgebucht werden, alles muss laufen)"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
sudo -u postgres createdb "$DB" >/dev/null
psql_stig -q -c "CREATE TABLE schema_migration (
   datei text PRIMARY KEY, angewandt_am timestamptz NOT NULL DEFAULT now());" >/dev/null
nachbuchen >/dev/null 2>&1; rc4=$?
pruefe "laeuft durch" "$rc4" "0"
pruefe "nichts vermerkt" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration")" "0"

echo
echo "== Fall 5: Loecher in der Reihenfolge (lauf da, mandant nicht) =="
echo "   (muss abbrechen statt eine Grenze zu erfinden)"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
sudo -u postgres createdb "$DB" >/dev/null
for f in db/00*.sql; do psql_stig -q -f "$f" >/dev/null 2>&1; done
# 010 ueberspringen, dafuer die Marke von 020 setzen -- so sieht es aus,
# als waere ausser der Reihe eingespielt worden.
psql_stig -q -c "CREATE TABLE lauf (id int);
   CREATE TABLE schema_migration (datei text PRIMARY KEY,
   angewandt_am timestamptz NOT NULL DEFAULT now());" >/dev/null
ausgabe5=$(nachbuchen 2>&1); rc5=$?
pruefe "bricht ab" "$rc5" "1"
pruefe "nennt den fehlenden Schritt" \
  "$(echo "$ausgabe5" | grep -c '010_mandant.sql')" "1"
pruefe "sagt, dass nichts geaendert wurde" \
  "$(echo "$ausgabe5" | grep -c 'nichts wurde geaendert')" "1"
pruefe "hat nichts vermerkt" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration")" "0"

echo
echo "== Fall 6: fremde Tabelle namens objekt =="
echo "   (Grenze 001, danach muss der echte Lauf laut scheitern)"
sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
sudo -u postgres createdb "$DB" >/dev/null
psql_stig -q -c "CREATE TABLE objekt (id int);
   CREATE TABLE schema_migration (datei text PRIMARY KEY,
   angewandt_am timestamptz NOT NULL DEFAULT now());" >/dev/null
nachbuchen >/dev/null 2>&1
pruefe "nur 001 vermerkt" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration")" "1"
pruefe "011 NICHT vermerkt (Rolle gilt clusterweit)" \
  "$(psql_stig -tAc "SELECT count(*) FROM schema_migration WHERE datei LIKE '011%'")" "0"

sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
echo
if [ "$fehler" = "0" ]; then echo "Alle Faelle in Ordnung."; else echo "$fehler Fehler."; exit 1; fi
