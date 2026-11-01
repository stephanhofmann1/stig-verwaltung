#!/usr/bin/env bash
# Einrichtung auf dem Server. Einmal ausfuehren, danach laeuft alles.
#
#   cd /opt/stig && bash einrichten.sh
#
# Erzeugt die Zufallsgeheimnisse selbst, fragt nur nach den Passwoertern
# fuer die Anmeldung. Die Eingabe bleibt unsichtbar und landet nur in der
# .env auf diesem Server.

set -euo pipefail

cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "Es gibt bereits eine .env. Zum Neuanlegen erst umbenennen:"
  echo "   mv .env .env.alt"
  exit 1
fi

echo
echo "=== STIG Verwaltung einrichten ==="
echo

# --- Domain -----------------------------------------------------------------
read -r -p "Domain [stig-immobilien.de]: " DOMAIN
DOMAIN="${DOMAIN:-stig-immobilien.de}"

# --- Geheimnisse ------------------------------------------------------------
echo "Erzeuge Zufallsgeheimnisse ..."
DB_PASSWORT="$(openssl rand -hex 24)"
EINGANG_SCHLUESSEL="$(openssl rand -hex 32)"
AUFGABEN_SCHLUESSEL="$(openssl rand -hex 32)"
SITZUNG_GEHEIMNIS="$(openssl rand -hex 32)"

# --- Anmeldung --------------------------------------------------------------
# Der Hash wird im Container erzeugt, damit hier kein Klartext herumliegt.
echo
echo "Zugang zur Oberflaeche. Das Passwort wird nicht angezeigt."

# Alles Sichtbare geht hier bewusst nach stderr (>&2). Die Standardausgabe
# bleibt dem Hash vorbehalten -- sonst landen die Zeilenumbrueche der
# Passwortabfrage mit im Ergebnis und die .env bekommt ein leeres BENUTZER.
mache_benutzer() {
  local name="$1" pw pw2
  while :; do
    read -r -s -p "Passwort fuer ${name}: " pw; echo >&2
    read -r -s -p "Noch einmal:            " pw2; echo >&2
    [ "$pw" = "$pw2" ] && [ ${#pw} -ge 10 ] && break
    echo "   Stimmt nicht ueberein oder kuerzer als 10 Zeichen. Nochmal." >&2
  done
  # Bewusst "docker run" statt "docker compose run": compose braeuchte die
  # .env, die es an dieser Stelle noch nicht gibt.
  printf '%s' "$pw" \
    | docker run --rm -i stig-verwaltung-app \
        node hilfsmittel/passwort.mjs "$name" --stdin
}

echo "Baue das Abbild (dauert beim ersten Mal ein paar Minuten) ..."
docker build -t stig-verwaltung-app ./app

BENUTZER="$(mache_benutzer stephan)"
read -r -p "Zweiten Benutzer anlegen (igor)? [j/N]: " MEHR
if [ "${MEHR,,}" = "j" ]; then
  BENUTZER="${BENUTZER},$(mache_benutzer igor)"
fi

# --- .env schreiben ---------------------------------------------------------
# Docker Compose deutet in der .env jedes "$" als Variable. Der scrypt-Hash
# hat die Form scrypt$salz$hash -- ohne Verdopplung kaeme BENUTZER leer im
# Container an und der Start braeche mit "required variable BENUTZER is
# missing a value" ab.
BENUTZER_ENV="${BENUTZER//\$/\$\$}"

umask 077
cat > .env <<ENV
DOMAIN=${DOMAIN}
DB_PASSWORT=${DB_PASSWORT}
EINGANG_SCHLUESSEL=${EINGANG_SCHLUESSEL}
AUFGABEN_SCHLUESSEL=${AUFGABEN_SCHLUESSEL}
SITZUNG_GEHEIMNIS=${SITZUNG_GEHEIMNIS}
BENUTZER=${BENUTZER_ENV}

# --- Maileingang: GMX per IMAP (Start) -------------------------------------
# App-Passwort bei GMX anlegen, NICHT das Kontopasswort.
IMAP_HOST=imap.gmx.net
IMAP_PORT=993
IMAP_BENUTZER=STIGIMMO@gmx.de
IMAP_PASSWORT=

# --- Mailversand ------------------------------------------------------------
# Ohne Schluessel laeuft der Versand im Trockenmodus: Entwuerfe lassen sich
# freigeben, es verlaesst aber nichts das System.
RESEND_API_KEY=
ABSENDER_EMAIL=verwaltung@${DOMAIN}
ABSENDER_NAME=STIG Immobilien

SMTP_HOST=
SMTP_PORT=587
SMTP_BENUTZER=
SMTP_PASSWORT=

# --- Optional ---------------------------------------------------------------
ANTHROPIC_API_KEY=
WHATSAPP_NUMMER=
ENV

echo
echo "Starte ..."
./start.sh up -d

echo
echo "=== Fertig ==="
echo
echo "Oberflaeche:  https://${DOMAIN}"
echo "Logs:         ./start.sh logs -f app"
echo
echo "Noch offen, in .env nachtragen und './start.sh up -d' wiederholen:"
echo "  IMAP_PASSWORT    GMX-App-Passwort fuer den Maileingang"
echo "  RESEND_API_KEY   sonst bleibt der Versand im Trockenmodus"
echo
echo "Fuer den Cloudflare-Worker gebraucht (nicht weitergeben):"
echo "  EINGANG_SCHLUESSEL = ${EINGANG_SCHLUESSEL}"
echo
