#!/usr/bin/env bash
#
# Die Bankanbindung scharf schalten.
#
#   bash fints-einrichten.sh
#
# Setzt die beiden Werte, ohne die /bank "Noch nicht einsatzbereit"
# meldet:
#
#   FINTS_SCHLUESSEL   verschluesselt die Bank-PIN in der Datenbank.
#                      Wird AUF DEM SERVER erzeugt und nie angezeigt --
#                      er muss durch niemandes Haende gehen. Ist schon
#                      einer da, bleibt er unangetastet: Ein neuer
#                      Schluessel macht eine bereits hinterlegte PIN
#                      unlesbar.
#   FINTS_PRODUKT_ID   die Registrierungsnummer der Deutschen
#                      Kreditwirtschaft. Wird abgefragt, erscheint
#                      nicht auf dem Bildschirm.
#
# Danach startet die Anwendung neu, sonst liest sie den alten Stand.
#
# Warum ZWEI SSH-Verbindungen: Das ferne Skript als Heredoc hinter dem
# ssh-Aufruf und der Wert durch eine Pipe davor wollen beide dieselbe
# Standardeingabe, und das Heredoc gewinnt -- der Wert kaeme nie an, und
# das Skript meldete trotzdem Erfolg. Dieselbe Falle steht schon in der
# Betriebsdoku. Deshalb: erst das Skript ablegen, dann den Wert
# hineingeben.

set -euo pipefail

SERVER="${SERVER:-root@78.47.196.190}"
PFAD="${PFAD:-/opt/stig}"

# --- Schritt 1: das ferne Skript ablegen ------------------------------------
# Hier fliesst nur Skripttext, kein Geheimnis.

ssh "$SERVER" "cat > /tmp/stig-fints.sh && chmod 700 /tmp/stig-fints.sh" <<'FERN'
set -euo pipefail

DATEI="$PFAD/.env"
[ -f "$DATEI" ] || { echo "$DATEI gibt es nicht." >&2; exit 1; }

# Der Wert kommt ueber die Standardeingabe, nicht als Argument:
# Argumente stehen in der Prozessliste, die Standardeingabe nicht.
PRODUKT_ID=$(cat)
[ -n "$PRODUKT_ID" ] || { echo "Keine Produkt-ID angekommen." >&2; exit 1; }

# Genau 25 Zeichen -- die DK schreibt das ausdruecklich vor und weist
# laengere Werte ab. Lieber hier scheitern als spaeter an der Bank.
if [ "${#PRODUKT_ID}" -ne 25 ]; then
  echo "Die Produkt-ID hat ${#PRODUKT_ID} Zeichen, gefordert sind genau 25." >&2
  echo "Nichts geaendert." >&2
  exit 1
fi

SICHERUNG="$DATEI.$(date +%Y%m%d-%H%M%S).bak"
cp -p "$DATEI" "$SICHERUNG"
chmod 600 "$SICHERUNG"

setze() {
  # Ersetzen statt anhaengen, falls die Zeile schon existiert: In dieser
  # .env gewinnt die erste Zeile (hole() nimmt head -n1), ein zweiter
  # Eintrag waere also wirkungslos und irrefuehrend.
  awk -v n="$1" -v w="$2" '
    $0 ~ "^" n "=" { print n "=" w; getan=1; next }
    { print }
    END { if (!getan) print n "=" w }
  ' "$DATEI" > "$DATEI.neu"
  chmod 600 "$DATEI.neu"
  mv "$DATEI.neu" "$DATEI"
}

# --- Schluessel: nur erzeugen, wenn noch keiner da ist ---
ALT=$(sed -n 's/^FINTS_SCHLUESSEL=//p' "$DATEI" | head -n1)
if printf '%s' "$ALT" | grep -qE '^[0-9a-fA-F]{64}$'; then
  echo "FINTS_SCHLUESSEL: war schon gesetzt, bleibt unveraendert."
else
  if [ -n "$ALT" ]; then
    echo "FINTS_SCHLUESSEL: vorhandener Wert ist unbrauchbar (${#ALT} Zeichen"
    echo "  statt 64 Hexzeichen) -- wird ersetzt."
  fi
  NEU=$(openssl rand -hex 32)
  setze FINTS_SCHLUESSEL "$NEU"
  unset NEU
  echo "FINTS_SCHLUESSEL: neu erzeugt (64 Hexzeichen, nicht angezeigt)."
fi

# --- Produkt-ID ---
setze FINTS_PRODUKT_ID "$PRODUKT_ID"
echo "FINTS_PRODUKT_ID: gesetzt, 25 Zeichen, endet auf …${PRODUKT_ID: -4}"
echo "Sicherung der alten Datei: $SICHERUNG"

# --- Gegenprobe auf der Datei ---
for N in FINTS_SCHLUESSEL FINTS_PRODUKT_ID; do
  ANZ=$(grep -c "^$N=" "$DATEI" || true)
  [ "$ANZ" -eq 1 ] || { echo "WARNUNG: $N steht ${ANZ}x in der .env." >&2; }
done
FERN

# --- Schritt 2: die Produkt-ID abfragen und hineingeben ---------------------

echo >&2
echo "Die 25-stellige Registrierungsnummer steht in der Mail vom 04.11.2026" >&2
echo "von registrierung@hbci-zka.de (Betreff: AW: Produktregistrierung FinTS)." >&2
echo >&2
printf 'FINTS_PRODUKT_ID (Eingabe bleibt unsichtbar): ' >&2
read -r -s WERT
printf '\n' >&2

if [ -z "$WERT" ]; then
  echo "Nichts eingegeben, nichts geaendert." >&2
  ssh "$SERVER" "rm -f /tmp/stig-fints.sh" || true
  exit 1
fi

# Der Rueckgabewert des fernen Skripts muss durchgereicht werden. Stuende
# hier nur "bash skript.sh; rm -f skript.sh", waere der Status der von rm
# -- also fast immer 0. Das Skript meldete dann Erfolg, obwohl die ferne
# Pruefung abgebrochen hat, und startete anschliessend sinnlos neu. Im
# Trockenlauf am 06.11.2026 genau so aufgetreten.
printf '%s' "$WERT" |
  ssh "$SERVER" "PFAD='$PFAD' bash /tmp/stig-fints.sh; E=\$?; rm -f /tmp/stig-fints.sh; exit \$E"

# --- Schritt 3: neu starten und nachsehen, ob es angekommen ist -------------

echo >&2
echo "Starte neu …" >&2
ssh "$SERVER" "$PFAD/start.sh restart" >/dev/null 2>&1 || {
  echo "Der Neustart hat nicht geklappt. Von Hand:" >&2
  echo "  ssh $SERVER '$PFAD/start.sh restart'" >&2
  exit 1
}

echo >&2
echo "Gegenprobe im laufenden Programm:" >&2
ssh "$SERVER" '
  for i in $(seq 1 20); do
    docker compose -f '"$PFAD"'/docker-compose.yml ps --status running 2>/dev/null \
      | grep -q app && break
    sleep 2
  done
  CID=$(docker compose -f '"$PFAD"'/docker-compose.yml ps -q app 2>/dev/null | head -n1)
  if [ -z "$CID" ]; then echo "  Anwendung laeuft noch nicht -- gleich /bank im Browser pruefen."; exit 0; fi
  for N in FINTS_SCHLUESSEL FINTS_PRODUKT_ID; do
    L=$(docker exec "$CID" sh -c "printenv $N 2>/dev/null | wc -c" 2>/dev/null || echo 0)
    L=$((L > 0 ? L - 1 : 0))
    if [ "$L" -gt 0 ]; then echo "  $N: angekommen ($L Zeichen)"; else echo "  $N: FEHLT noch"; fi
  done
' 2>&1 | tail -5

echo >&2
echo "Fertig. Jetzt https://stig-immobilien.de/bank aufrufen --" >&2
echo "der Kasten 'Noch nicht einsatzbereit' sollte weg sein." >&2
