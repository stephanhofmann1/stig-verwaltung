#!/usr/bin/env bash
# Spielt neue Datenbankschritte ein und richtet die Anwendungsrolle ein.
#
#   cd /opt/stig && ./migrieren.sh
#
# Merkt sich in schema_migration, was schon gelaufen ist, und ueberspringt
# es beim naechsten Mal. Laeuft als "stig" (Superuser) -- Migrationen muessen
# an der Mandantentrennung vorbei arbeiten koennen.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Keine .env vorhanden."; exit 1; }

# Welche Werte Compose braucht, steht in der compose.yaml -- also wird die
# Liste dort ausgelesen und nicht hier gepflegt.
#
# Vorher stand sie von Hand in diesem Skript, und am 01.11.2026 war sie
# vier Werte hinterher: LAGEBERICHT_AN und die drei FINTS_*. Die Folge war
# kein Fehler, sondern Schweigen -- der Lagebericht wurde gebaut, ins Log
# geschrieben und nie verschickt, weil im Container keine Empfaengeradresse
# ankam. Eine Liste, die man vergessen kann, gehoert nicht in ein Skript.
# Eine leere Datei, die Compose anstelle der .env zu sehen bekommt.
# Sie MUSS existieren, sonst scheitert jeder docker-compose-Aufruf hier mit
# "env file not found".
: > leer.env

WERTE=$(grep -oE '\$\{[A-Z_][A-Z0-9_]*' compose.yaml | sed 's/^\${//' | sort -u)

hole() { sed -n "s/^$1=//p" .env | head -n1; }

for V in $WERTE; do
  export "$V=$(hole "$V")"
done

# Beim ersten Lauf nach dem Umbau gibt es das Anwendungspasswort noch nicht.
if [ -z "$APP_DB_PASSWORT" ]; then
  APP_DB_PASSWORT="$(openssl rand -hex 24)"
  if grep -q '^APP_DB_PASSWORT=' .env; then
    sed -i "s|^APP_DB_PASSWORT=.*|APP_DB_PASSWORT=${APP_DB_PASSWORT}|" .env
  else
    printf '\n# Datenbankrolle der Anwendung (siehe db/011)\nAPP_DB_PASSWORT=%s\n' \
      "$APP_DB_PASSWORT" >> .env
  fi
  echo "APP_DB_PASSWORT erzeugt und in die .env geschrieben."
fi

# psql im laufenden Datenbankcontainer, als Superuser stig.
# Migrationen muessen an der Mandantentrennung vorbei arbeiten koennen --
# die Anwendungsrolle stig_app kann das ausdruecklich nicht.
psql_stig() {
  docker compose --env-file leer.env \
    exec -T -e PGPASSWORD="$DB_PASSWORT" db \
    psql -v ON_ERROR_STOP=1 -U stig -d stig "$@"
}

echo "Starte die Datenbank, falls sie steht ..."
docker compose --env-file leer.env up -d db

echo "Warte auf die Datenbank ..."
for _ in $(seq 1 30); do
  psql_stig -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 2
done

psql_stig -q -c "
  CREATE TABLE IF NOT EXISTS schema_migration (
      datei       text PRIMARY KEY,
      angewandt_am timestamptz NOT NULL DEFAULT now()
  );" >/dev/null

# Nachbuchung der Erstinstallation: liegt in db/nachbuchen.sh, damit sie
# ohne Docker und ohne Server testbar ist (app/tests/nachbuchen.test.sh).
# shellcheck source=db/nachbuchen.sh
. db/nachbuchen.sh
nachbuchen || exit 1

echo
echo "== Offene Schritte =="

# Nur nummerierte Dateien sind Migrationen. Alles andere in db/ wird
# ABGEWIESEN, nicht etwa uebersprungen.
#
# Anlass, 05.11.2026: In db/ lag eine Datei saat-gestaltung.sql --
# erfundene Mieter fuer die oertliche Gestaltungsarbeit, und sie begann
# mit DELETE FROM kontakt, mietverhaeltnis, vorgang, nachricht. Das
# Muster db/*.sql hat sie mitgenommen und auf dem SERVER ausgefuehrt.
#
# Gutgegangen ist das aus zwei Gruenden, die beide Zufall waren: Der
# Mandant der oertlichen Datenbank gibt es auf dem Server nicht, also
# scheiterte die Datei am Fremdschluessel und die Transaktion rollte
# zurueck -- und selbst ohne das haetten die DELETEs unter einem
# unbekannten Mandanten keine Zeile getroffen. Auf einen Zufall darf
# sich das nicht stuetzen.
#
# Zwei Aenderungen daraus:
#   1. Das Muster verlangt drei Ziffern und einen Unterstrich.
#   2. Eine nicht passende .sql-Datei bricht den Lauf ab. Stillschweigend
#      ueberspringen waere die gleiche Falle mit umgekehrtem Vorzeichen:
#      Eine echte Migration mit Tippfehler im Namen liefe nie, und
#      niemand erfuehre davon.
for f in db/*.sql; do
  name="$(basename "$f")"
  case "$name" in
    [0-9][0-9][0-9]_*.sql) : ;;
    *)
      echo "  ABBRUCH: $name ist keine Migration."
      echo "  In db/ gehoeren nur Dateien der Form 000_name.sql."
      echo "  Saatdaten und Hilfsskripte gehoeren nach entwicklung/."
      exit 1
      ;;
  esac

  schon=$(psql_stig -tAc "SELECT 1 FROM schema_migration WHERE datei = '${name}'")
  if [ "$schon" = "1" ]; then
    echo "  uebersprungen: $name"
    continue
  fi
  echo "  spiele ein:    $name"
  # ON_ERROR_STOP und die Pruefung des Rueckgabewerts: Vorher wurde die
  # Datei auch dann als eingespielt vermerkt, wenn sie gescheitert war.
  # Ein fehlgeschlagener Schritt, der als erledigt in schema_migration
  # steht, laeuft nie wieder -- und fehlt von da an stillschweigend.
  if ! psql_stig -q -v ON_ERROR_STOP=1 < "$f"; then
    echo "  FEHLGESCHLAGEN: $name -- nicht vermerkt, Lauf abgebrochen."
    exit 1
  fi
  psql_stig -q -c "INSERT INTO schema_migration (datei) VALUES ('${name}')" >/dev/null
done

echo
echo "== Anwendungsrolle =="
psql_stig -q -c "ALTER ROLE stig_app PASSWORD '${APP_DB_PASSWORT}';" >/dev/null
echo "  Passwort gesetzt."

# --- Bestehende Anmeldung in die Tabelle uebernehmen -------------------------
# Bis hierher stand sie als BENUTZER=name:scrypt$salz$hash in der .env.
# Ohne diesen Schritt koennte sich nach dem Umbau niemand mehr anmelden.
echo
echo "== Benutzer =="
MANDANT=$(psql_stig -tAc "SELECT id FROM mandant WHERE kuerzel = 'stig'")
if [ -z "$MANDANT" ]; then
  echo "  Kein Mandant 'stig' gefunden — uebersprungen."
else
  BENUTZER="$(hole BENUTZER)"
  IFS=',' read -r -a EINTRAEGE <<< "$BENUTZER"
  for e in "${EINTRAEGE[@]}"; do
    [ -n "$e" ] || continue
    name="${e%%:*}"
    hash="${e#*:}"
    [ -n "$name" ] && [ "$name" != "$hash" ] || continue
    psql_stig -q -c "
      INSERT INTO benutzer (mandant_id, name, passwort_hash, rolle)
      VALUES ('${MANDANT}', '${name}', \$\$${hash}\$\$, 'verwalter')
      ON CONFLICT (mandant_id, name) DO NOTHING;" >/dev/null
    echo "  uebernommen: $name"
  done
fi

echo
echo "== Fertig =="
echo "Jetzt neu starten:  ./start.sh up -d"
