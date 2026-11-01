#!/usr/bin/env bash
# Startet den Stapel, ohne dass Docker Compose die .env selbst einliest.
#
#   ./start.sh up -d       starten
#   ./start.sh ps          Stand
#   ./start.sh logs -f app Log der Anwendung
#   ./start.sh restart     neu starten
#
# Warum der Umweg: Der Passwort-Hash hat die Form scrypt$salz$hash.
# Compose deutet in der .env jedes "$" als Variable und macht daraus
# leere Zeichenketten -- der Hash kaeme zerstueckelt im Container an.
# Hier werden die Werte zeichengetreu ausgelesen und als Umgebung
# uebergeben; Compose bekommt eine leere .env zu sehen.

set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Keine .env vorhanden. Erst einrichten.sh ausfuehren."; exit 1; }

: > leer.env

# Welche Werte Compose braucht, steht in der compose.yaml -- also wird die
# Liste dort ausgelesen und nicht hier gepflegt.
#
# Vorher stand sie von Hand in diesem Skript, und am 01.11.2026 war sie
# vier Werte hinterher: LAGEBERICHT_AN und die drei FINTS_*. Die Folge war
# kein Fehler, sondern Schweigen -- der Lagebericht wurde gebaut, ins Log
# geschrieben und nie verschickt, weil im Container keine Empfaengeradresse
# ankam. Eine Liste, die man vergessen kann, gehoert nicht in ein Skript.
WERTE=$(grep -oE '\$\{[A-Z_][A-Z0-9_]*' compose.yaml | sed 's/^\${//' | sort -u)

hole() { sed -n "s/^$1=//p" .env | head -n1; }

for V in $WERTE; do
  export "$V=$(hole "$V")"
done

if [ -z "${APP_DB_PASSWORT:-}" ]; then
  echo "APP_DB_PASSWORT fehlt in der .env."
  echo "Die Anwendung verbindet sich seit der Mandantentrennung als stig_app,"
  echo "nicht mehr als stig. Einmal ./migrieren.sh ausfuehren, das legt die"
  echo "Rolle an und schreibt das Passwort in die .env."
  exit 1
fi

exec docker compose --env-file leer.env "$@"
