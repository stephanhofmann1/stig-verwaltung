#!/usr/bin/env bash
#
# Einen Wert in der .env auf dem Server setzen -- ohne ihn vorher
# irgendwo hinzuschreiben.
#
#   bash schluessel-setzen.sh ANTHROPIC_API_KEY
#
# Der Wert wird abgefragt, ohne auf dem Bildschirm zu erscheinen, und
# geht per SSH direkt in die Datei. Er steht danach nicht in der
# Shell-Historie, nicht in der Prozessliste und nicht im Terminalfenster.
#
# Warum ueberhaupt ein Skript: Der naheliegende Weg --
#   ssh server "echo KEY=... >> /opt/stig/.env"
# -- legt den Schluessel gleich dreifach ab: in der Historie des Macs,
# in der Prozessliste des Servers (wo ihn jeder andere Zugang sieht,
# solange der Befehl laeuft) und, wenn der Eintrag schon existiert, ein
# zweites Mal in der Datei. Das Skript vermeidet alle drei.
#
# Warum ZWEI Verbindungen: Beim ersten Versuch stand das ferne Skript
# als Heredoc hinter dem ssh-Aufruf und der Wert kam durch eine Pipe
# davor. Beide wollen dieselbe Standardeingabe, und das Heredoc gewinnt
# -- der Wert kam nie an, und das Skript meldete trotzdem Erfolg.
# Dieselbe Falle steht schon einmal in der Betriebsdoku, bei `read` in
# einem per Heredoc geschobenen Skript. Jetzt wird erst das Skript
# abgelegt, dann der Wert hineingegeben.
#
# Nach dem Setzen startet die Anwendung neu, sonst liest sie den alten
# Stand weiter.

set -euo pipefail

SERVER="${SERVER:-root@78.47.196.190}"
PFAD="${PFAD:-/opt/stig}"

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "Aufruf: bash schluessel-setzen.sh NAME_DER_VARIABLE" >&2
  echo "Beispiel: bash schluessel-setzen.sh ANTHROPIC_API_KEY" >&2
  exit 1
fi

# Nur Grossbuchstaben, Ziffern, Unterstrich -- sonst liesse sich ueber
# den Namen etwas in die Datei schmuggeln.
if ! printf '%s' "$NAME" | grep -qE '^[A-Z][A-Z0-9_]*$'; then
  echo "Der Name darf nur A-Z, 0-9 und _ enthalten." >&2
  exit 1
fi

# --- Schritt 1: das ferne Skript ablegen ------------------------------------
# Es liest den Wert spaeter von seiner Standardeingabe. Hier fliesst nur
# der Skripttext, kein Geheimnis.

ssh "$SERVER" "cat > /tmp/stig-wert-setzen.sh && chmod 700 /tmp/stig-wert-setzen.sh" <<'FERN'
set -euo pipefail

DATEI="$PFAD/.env"
# Der Wert kommt ueber die Standardeingabe, nicht als Argument:
# Argumente stehen in der Prozessliste, die Standardeingabe nicht.
WERT=$(cat)

[ -f "$DATEI" ] || { echo "$DATEI gibt es nicht." >&2; exit 1; }
[ -n "$WERT" ] || { echo "Kein Wert angekommen -- nichts geaendert." >&2; exit 1; }

# Sicherung mit Zeitstempel, nur fuer root lesbar.
SICHERUNG="$DATEI.$(date +%Y%m%d-%H%M%S).bak"
cp -p "$DATEI" "$SICHERUNG"
chmod 600 "$SICHERUNG"

# Vorhandene Zeile ersetzen, sonst anhaengen. Beides mit awk statt sed:
# Der Wert kann Schraegstriche und kaufmaennische Und enthalten, und
# beides deutet sed um. awk bekommt ihn als Variable und fasst ihn
# nicht an.
awk -v n="$NAME" -v w="$WERT" '
  $0 ~ "^" n "=" { print n "=" w; getan=1; next }
  { print }
  END { if (!getan) print n "=" w }
' "$DATEI" > "$DATEI.neu"

chmod 600 "$DATEI.neu"
mv "$DATEI.neu" "$DATEI"

# Zur Kontrolle nur die Laenge und die letzten vier Zeichen -- genug,
# um einen Tippfehler zu erkennen, zu wenig, um etwas damit anzufangen.
echo "$NAME gesetzt: ${#WERT} Zeichen, endet auf …${WERT: -4}"
echo "Sicherung: $SICHERUNG"
FERN

# --- Schritt 2: den Wert abfragen und hineingeben ---------------------------

printf 'Wert für %s (Eingabe bleibt unsichtbar): ' "$NAME" >&2
read -r -s WERT
printf '\n' >&2

if [ -z "$WERT" ]; then
  echo "Nichts eingegeben, nichts geändert." >&2
  ssh "$SERVER" "rm -f /tmp/stig-wert-setzen.sh" || true
  exit 1
fi

printf '%s' "$WERT" |
  ssh "$SERVER" "NAME='$NAME' PFAD='$PFAD' bash /tmp/stig-wert-setzen.sh; rm -f /tmp/stig-wert-setzen.sh"

echo >&2
echo "Jetzt neu starten, damit die Anwendung den Wert liest:" >&2
echo "  ssh $SERVER '$PFAD/start.sh restart'" >&2
