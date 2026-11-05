#!/usr/bin/env bash
# Was auf dem SERVER passiert, wenn ein neues Paket angekommen ist.
#
# Aufruf: Die Werkbank legt diese Datei nach /tmp und ruft sie dort auf
# (.github/workflows/einspielen.yml). Von Hand geht es genauso:
#
#     cd /opt/stig && bash einspielen-fern.sh
#
# WARUM EINE DATEI UND KEIN HIER-DOKUMENT
#
# Bis zum 05.11.2026 wurde dieses Stueck ueber `ssh host 'bash -s'` in die
# Standardeingabe der fernen Shell geschrieben. Das sieht sauber aus und
# ist eine Falle: `bash -s` liest das Skript Stueck fuer Stueck aus der
# Standardeingabe -- und `docker compose exec -T` in migrieren.sh liest
# aus derselben Quelle. Es hat den Rest des Skripts verschluckt.
#
# Die Folge war kein Fehler, sondern Schweigen: Migrationen liefen, die
# Anwendung wurde nie neu gebaut, der Gesundheitstest fragte die alte
# Fassung und meldete Erfolg. Drei Einspielvorgaenge hintereinander
# sahen gruen aus und haben nichts ausgeliefert.
#
# Eine Datei kann nicht verschluckt werden. Zusaetzlich bekommt jeder
# Aufruf, der sich an der Standardeingabe bedienen koennte, sie
# ausdruecklich leer (< /dev/null) -- und am Ende steht eine Marke, die
# die Werkbank prueft. Ein abgeschnittenes Skript faellt damit auf.

set -euo pipefail
cd /opt/stig

echo "== Auspacken =="
# Welche .sql-Dateien das Paket mitbringt -- abgelesen, BEVOR ausgepackt
# wird.
tar tzf neu.tgz \
  | sed -n 's|^\(\./\)\?db/\([^/]*\.sql\)$|\2|p' \
  | sort > /tmp/soll.txt
tar xzf neu.tgz && rm -f neu.tgz
chmod +x start.sh migrieren.sh einrichten.sh einspielen-fern.sh db/nachbuchen.sh 2>/dev/null || true

# Tar legt Dateien dazu, nimmt aber keine weg. Eine .sql, die das Paket
# nicht mehr enthaelt, bleibt also in db/ liegen -- und migrieren.sh
# bricht bei jeder Fremddatei dort ab, zu Recht. Am 05.11.2026 war genau
# das der Fall: Die Saatdatei mit den DELETEs lag auf dem Server,
# nachdem sie aus dem Paket entfernt worden war.
#
# Beiseitegelegt, nicht geloescht. Beiseite genuegt, um den Lauf
# freizumachen, und was geloescht ist, kann niemand mehr nachsehen.
ls db/*.sql 2>/dev/null | sed 's|^db/||' | sort > /tmp/ist.txt
UEBRIG=$(comm -13 /tmp/soll.txt /tmp/ist.txt)
if [ -n "$UEBRIG" ]; then
  mkdir -p abgelegt
  for n in $UEBRIG; do
    echo "  nicht mehr im Paket, beiseitegelegt: db/$n"
    mv "db/$n" "abgelegt/$n"
  done
fi

echo
echo "== Datenbank migrieren =="
./migrieren.sh < /dev/null

echo
echo "== Anwendung neu bauen und starten =="
./start.sh up -d --build < /dev/null

echo
echo "== Stand =="
./start.sh ps < /dev/null

# Die Marke. Die Werkbank prueft, dass sie in der Ausgabe steht; fehlt
# sie, ist das Skript unterwegs abgebrochen oder verschluckt worden --
# und dann ist nichts eingespielt, auch wenn jeder einzelne Schritt
# vorher gut aussah.
echo
echo "EINSPIELEN-VOLLSTAENDIG"
