#!/bin/sh
# Zeitplaner der Plattform.
#
# Laeuft als eigener Dienst (siehe compose.yaml) und stoesst die vier
# zeitgesteuerten Laeufe an. Wird nicht von Hand aufgerufen.
#
# Vorher stand das hier als einzeiliges sh -c in der compose.yaml, mit
# verdoppelten Dollarzeichen und jeder Antwort auf /dev/null. Zwei Gruende
# fuer eine eigene Datei:
#
#   - Die Ergebnisse gingen verloren. Ein Lauf, der seit Wochen an einem
#     abgelaufenen Zugang scheitert, sah von aussen aus wie einer, der
#     nichts zu tun hatte. Jetzt schreibt jeder Aufruf eine Zeile ins
#     Containerlog, und die Anwendung schreibt das Ergebnis zusaetzlich in
#     die Tabelle `lauf` (db/020) -- sichtbar unter /laeufe.
#   - In einer Zeile ohne Kommentare und mit $$ ueberall ist nicht zu
#     erkennen, was passiert.
set -u

: "${AUFGABEN_SCHLUESSEL:?AUFGABEN_SCHLUESSEL fehlt}"
BASIS="${APP_BASIS:-http://app:3000}"
# Zu welchen Stunden gelaufen wird. Zweimal taeglich reicht: Die Laeufe
# versenden nichts, sie legen Entwuerfe an.
STUNDEN="${AUFGABEN_STUNDEN:-07 18}"

protokoll() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*"
}

# Ein Lauf. Der Statuscode ist die Nachricht: 200 geglueckt, 207 bei einem
# Mandanten gescheitert (der Rest lief), 401/503 Einrichtungsfehler,
# 000 Anwendung nicht erreichbar.
anstossen() {
  name="$1"
  antwort=$(
    curl -sS -m 300 -o /tmp/antwort -w '%{http_code}' \
         -X POST "$BASIS/api/aufgaben/$name" \
         -H "x-aufgaben-schluessel: $AUFGABEN_SCHLUESSEL" 2>/tmp/fehler
  ) || antwort="000"

  case "$antwort" in
    200) protokoll "$name: ok" ;;
    207) protokoll "$name: TEILWEISE GESCHEITERT ($(head -c 400 /tmp/antwort))" ;;
    000) protokoll "$name: Anwendung nicht erreichbar ($(head -c 200 /tmp/fehler))" ;;
    *)   protokoll "$name: FEHLER HTTP $antwort ($(head -c 400 /tmp/antwort))" ;;
  esac
}

protokoll "Zeitplaner gestartet. Stunden: $STUNDEN. Ziel: $BASIS"

# Die Anwendung baut beim ersten Start mehrere Minuten. Ohne dieses Warten
# steht im Log als Erstes ein Fehlschlag, der keiner ist.
i=0
while [ "$i" -lt 60 ]; do
  curl -sS -m 5 -o /dev/null "$BASIS/api/oeffentlich/verfuegbarkeit" 2>/dev/null && break
  i=$((i + 1))
  sleep 10
done

letzter=""
while true; do
  stunde=$(date +%H)
  heute=$(date +%Y-%m-%d)

  for s in $STUNDEN; do
    if [ "$stunde" = "$s" ] && [ "$letzter" != "$heute-$s" ]; then
      protokoll "--- Lauf $heute $s Uhr ---"
      # Reihenfolge ist Absicht: erst Mails holen, dann der Agent darauf,
      # dann Nachfassen, zuletzt die Buchhaltung.
      # Der Bankabruf zuerst: Die Sollstellungen und das Mahnwesen
      # rechnen auf den Zahlungen, die er holt. Umgekehrt saehe eine
      # Zahlung von heute morgen aus wie ein Rueckstand.
      anstossen bankabruf
      anstossen mailabruf
      anstossen agent
      anstossen nachfassen
      anstossen sollstellungen
      # Der Lagebericht zuletzt und nur im ersten Lauf des Tages: Er
      # beschreibt, was die Laeufe davor gefunden haben, und zweimal
      # taeglich wuerde er nicht mehr gelesen.
      erste_stunde=$(echo "$STUNDEN" | cut -d" " -f1)
      [ "$s" = "$erste_stunde" ] && anstossen lagebericht
      # Merker statt sleep 3600: Ein Neustart des Containers innerhalb
      # derselben Stunde loeste den Lauf vorher ein zweites Mal aus.
      letzter="$heute-$s"
    fi
  done

  sleep 300
done
