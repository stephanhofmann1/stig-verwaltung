#!/usr/bin/env bash
# Legt einen neuen Mandanten an — einen weiteren Vermieter auf derselben
# Plattform.
#
#   cd /opt/stig && ./mandant-anlegen.sh
#
# Laeuft als "stig" (Superuser), weil ein neuer Mandant per Definition
# ausserhalb jeder bestehenden Mandantengrenze entsteht. Die Anwendung
# kann und soll das nicht.
#
# Angelegt werden: der Mandant, seine Eingangsadresse, ein Verwalterzugang.
# Nicht angelegt werden Objekte und Einheiten — die traegt der Kunde selbst
# ein oder bekommt sie importiert.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Keine .env vorhanden."; exit 1; }
hole() { sed -n "s/^$1=//p" .env | head -n1; }
: > leer.env
for V in DOMAIN DB_PASSWORT APP_DB_PASSWORT EINGANG_SCHLUESSEL \
         AUFGABEN_SCHLUESSEL SITZUNG_GEHEIMNIS BENUTZER; do
  export "$V=$(hole "$V")"
done

psql_stig() {
  docker compose --env-file leer.env \
    exec -T -e PGPASSWORD="$DB_PASSWORT" db \
    psql -v ON_ERROR_STOP=1 -U stig -d stig "$@"
}

# Einfache Anfuehrungszeichen verdoppeln, damit ein Name wie O'Brien
# die Abfrage nicht zerlegt.
sicher() { printf '%s' "$1" | sed "s/'/''/g"; }

echo
echo "=== Neuen Mandanten anlegen ==="
echo

read -r -p "Name des Vermieters (z. B. Muster Verwaltung GmbH): " NAME
[ -n "$NAME" ] || { echo "Ohne Namen geht es nicht."; exit 1; }

read -r -p "Kuerzel, klein, ohne Leerzeichen (z. B. muster):     " KUERZEL
if ! printf '%s' "$KUERZEL" | grep -Eq '^[a-z0-9-]{2,20}$'; then
  echo "Kuerzel: 2-20 Zeichen, nur Kleinbuchstaben, Ziffern, Bindestrich."
  exit 1
fi

VORGABE="${KUERZEL}@${DOMAIN:-stig-immobilien.de}"
read -r -p "Eingangsadresse [${VORGABE}]: " EINGANG
EINGANG="$(printf '%s' "${EINGANG:-$VORGABE}" | tr 'A-Z' 'a-z')"

read -r -p "Absenderadresse fuer ausgehende Mails [${EINGANG}]: " ABSENDER
ABSENDER="${ABSENDER:-$EINGANG}"

read -r -p "Benutzername des Verwalters (z. B. mueller):         " BENUTZERNAME
if ! printf '%s' "$BENUTZERNAME" | grep -Eq '^[a-zA-Z0-9._-]{2,40}$'; then
  echo "Benutzername: 2-40 Zeichen, keine Leerzeichen."
  exit 1
fi

# Das Passwort wird hier eingegeben und sofort im Container gehasht.
# Es taucht weder in der Prozessliste noch in der .env noch im Verlauf auf.
while :; do
  read -r -s -p "Passwort (mind. 10 Zeichen):                        " PW; echo
  read -r -s -p "Noch einmal:                                        " PW2; echo
  [ "$PW" = "$PW2" ] && [ ${#PW} -ge 10 ] && break
  echo "   Stimmt nicht ueberein oder zu kurz. Nochmal."
done

HASH=$(printf '%s' "$PW" | docker run --rm -i stig-verwaltung-app \
         node hilfsmittel/passwort.mjs "$BENUTZERNAME" --stdin)
# Das Hilfsskript gibt "name:scrypt$..." aus; hier wird nur der Hash gebraucht.
HASH="${HASH#*:}"
unset PW PW2

echo
echo "Lege an ..."

psql_stig -q <<SQL
BEGIN;

INSERT INTO mandant (name, kuerzel, absender_email, absender_name)
VALUES ('$(sicher "$NAME")', '$(sicher "$KUERZEL")',
        '$(sicher "$ABSENDER")', '$(sicher "$NAME")');

INSERT INTO mandant_adresse (adresse, mandant_id, art)
SELECT '$(sicher "$EINGANG")', id, 'eingang'
  FROM mandant WHERE kuerzel = '$(sicher "$KUERZEL")';

INSERT INTO benutzer (mandant_id, name, passwort_hash, rolle)
SELECT id, '$(sicher "$BENUTZERNAME")', \$\$${HASH}\$\$, 'verwalter'
  FROM mandant WHERE kuerzel = '$(sicher "$KUERZEL")';

COMMIT;
SQL

echo
echo "=== Angelegt ==="
psql_stig -tAc "
  SELECT 'Mandant:   ' || m.name || ' (' || m.kuerzel || ')' || chr(10) ||
         'Eingang:   ' || a.adresse || chr(10) ||
         'Absender:  ' || coalesce(m.absender_email,'—') || chr(10) ||
         'Benutzer:  ' || b.name || ' (' || b.rolle || ')'
    FROM mandant m
    JOIN mandant_adresse a ON a.mandant_id = m.id AND a.art = 'eingang'
    JOIN benutzer b        ON b.mandant_id = m.id
   WHERE m.kuerzel = '$(sicher "$KUERZEL")'"

cat <<HINWEIS

Noch zu tun, ausserhalb der Datenbank:

  1. Cloudflare Email Routing: ${EINGANG} auf den Worker
     "stig-maileingang" leiten. Ohne das kommt keine Mail an.

  2. Resend: Will der Kunde unter eigener Domain senden, muss er sie dort
     verifizieren. Sonst Absender auf eine Adresse unserer Domain setzen —
     fremde Domains ohne Verifizierung landen im Spam.

  3. Objekte und Einheiten anlegen. Erst danach hat der Zugang Inhalt.

  4. AV-Vertrag nach Art. 28 DSGVO. Ohne den darf der Vermieter die
     Mieterdaten gar nicht erst uebergeben.

HINWEIS
