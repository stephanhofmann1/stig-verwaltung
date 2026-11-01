# Nachbuchung der Erstinstallation.
#
# Wird von migrieren.sh eingelesen, nicht selbst aufgerufen. Erwartet eine
# Funktion psql_stig, die SQL gegen die Datenbank ausfuehrt -- so laesst sich
# dieselbe Logik im Test gegen eine lokale Postgres-Instanz pruefen, ohne
# Docker und ohne Server. Vorher stand sie mitten in migrieren.sh und war
# damit nur auf dem Server und nur im Fehlerfall testbar; genau deshalb ist
# der Fehler vom 01.11.2026 nicht aufgefallen.
#
# Setzt NACHBUCHUNG_GRENZE auf die hoechste erkannte Nummer und gibt 1
# zurueck, wenn das Schema anders aussieht als erwartet.

# --- Nachbuchung der Erstinstallation ---------------------------------------
#
# Bestandsserver: Das Schema steht seit dem ersten Aufsetzen, nur die
# Buchfuehrung darueber fehlte. Ohne Nachbuchung versucht der erste Lauf
# "CREATE TABLE objekt" ein zweites Mal und bricht ab.
#
# Diese Pruefung hing frueher daran, ob schema_migration *fehlt*. Das war ein
# Fehler mit Folgen: Die Tabelle wird angelegt, BEVOR die Nachbuchung fertig
# ist. Brach ein Lauf dazwischen ab, blieb eine leere Tabelle zurueck -- und
# ab dann hielt der Runner jeden Schritt fuer offen, bei jedem Versuch, fuer
# immer. Genau das ist am 01.11.2026 passiert.
#
# Jetzt entscheidet der Zustand, nicht die Vorgeschichte: "Schema da, aber
# nichts vermerkt" heisst nachbuchen. Das heilt sich selbst und laesst sich
# beliebig oft wiederholen.
nachbuchen() {
  VERMERKT=$(psql_stig -tAc "SELECT count(*) FROM schema_migration")
  SCHEMA_DA=$(psql_stig -tAc "
    SELECT CASE WHEN to_regclass('public.objekt') IS NULL THEN 'nein' ELSE 'ja' END")

  # Woran man erkennt, dass ein Schritt durch ist. Jede Migration laeuft in
  # einer Transaktion (BEGIN/COMMIT), deshalb ist eine vorhandene Marke der
  # Beweis, dass der Schritt GANZ gelaufen ist -- nicht nur angefangen. Ohne
  # die Transaktionen waere diese Nachbuchung Raterei.
  #
  # Nicht jeder Schritt braucht eine Marke. Es genuegen Ankerpunkte: Die
  # Nachbuchung sucht den hoechsten erreichten Anker und vermerkt alles bis
  # dorthin. Die Schritte zwischen zwei Ankern sind genau die, die ohnehin
  # wiederholbar sind (CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS) --
  # laufen sie ein zweites Mal, schadet das nicht.
  marke() {
    case "$1" in
      001) echo "to_regclass('public.objekt')" ;;
      002) echo "(SELECT 1 FROM information_schema.columns
                  WHERE table_name='nachricht' AND column_name='kanal')" ;;
      007) echo "to_regclass('public.konto')" ;;
      008) echo "to_regclass('public.beleg')" ;;
      009) echo "to_regclass('public.postfach')" ;;
      010) echo "to_regclass('public.mandant')" ;;
      # Nicht nur "Rolle existiert": Rollen gelten clusterweit, die Marke
      # waere dann in JEDER Datenbank erfuellt, auch in einer leeren. Ein
      # Test hat das am 01.11.2026 aufgedeckt -- die Nachbuchung haette
      # Schritte bis 011 vermerkt, die nie gelaufen sind. Gefragt ist die
      # Wirkung von 011 in DIESER Datenbank: das Leserecht auf objekt.
      011) echo "(SELECT 1 FROM pg_roles WHERE rolname='stig_app'
                   AND has_table_privilege('stig_app','public.objekt','SELECT'))" ;;
      012) echo "to_regclass('public.mandant_adresse')" ;;
      015) echo "to_regclass('public.mieter_zugang')" ;;
      019) echo "(SELECT 1 FROM pg_proc WHERE proname='mieter_uebersicht')" ;;
      020) echo "to_regclass('public.lauf')" ;;
      021) echo "(SELECT 1 FROM information_schema.columns
                  WHERE table_name='mietverhaeltnis' AND column_name='abrechnung_ab')" ;;
      022) echo "to_regclass('public.mietanpassung')" ;;
      023) echo "(SELECT 1 FROM information_schema.columns
                  WHERE table_name='objekt' AND column_name='zahlungsdaten_ab')" ;;
      024) echo "to_regclass('public.mahnwesen_freigabe')" ;;
      025) echo "to_regclass('public.frist')" ;;
      027) echo "to_regclass('public.fints_zugang')" ;;
      026) echo "(SELECT 1 FROM information_schema.columns
                   WHERE table_name='mietverhaeltnis'
                     AND column_name='wgb_uebergeben_am')" ;;
      *)   echo "" ;;
    esac
  }

  if [ "$VERMERKT" = "0" ] && [ "$SCHEMA_DA" = "ja" ]; then
    echo "Bestehendes Schema gefunden, aber nichts vermerkt — Nachbuchung."

    # Hoechster erreichter Anker.
    GRENZE="000"
    for f in db/*.sql; do
      name="$(basename "$f")"
      nummer="${name%%_*}"
      ausdruck="$(marke "$nummer")"
      [ -n "$ausdruck" ] || continue
      da=$(psql_stig -tAc "SELECT 1 WHERE ($ausdruck) IS NOT NULL" 2>/dev/null || true)
      if [ "$da" = "1" ]; then
        GRENZE="$nummer"
        echo "  Marke gefunden:  $name"
      fi
    done

    if [ "$GRENZE" = "000" ]; then
      echo
      echo "FEHLER: Die Tabelle objekt existiert, aber keine einzige Marke"
      echo "passt dazu. Das Schema sieht anders aus als erwartet, und blind"
      echo "nachzubuchen wuerde echte Schritte ueberspringen."
      echo "Hier ist von Hand nachzusehen, nichts wurde geaendert."
      return 1
    fi

    # Stimmigkeit: Die Migrationen laufen in Reihenfolge, also muss jeder
    # Anker UNTERHALB der Grenze auch erfuellt sein. Fehlt einer, wurde
    # irgendwann von Hand eingegriffen oder etwas ausser der Reihe
    # eingespielt. Dann ist die Grenze keine Grenze, und nachbuchen wuerde
    # echte Schritte ueberspringen -- lieber abbrechen und nachsehen.
    LUECKEN=""
    for f in db/*.sql; do
      name="$(basename "$f")"
      nummer="${name%%_*}"
      [ "$nummer" \> "$GRENZE" ] && continue
      ausdruck="$(marke "$nummer")"
      [ -n "$ausdruck" ] || continue
      da=$(psql_stig -tAc "SELECT 1 WHERE ($ausdruck) IS NOT NULL" 2>/dev/null || true)
      [ "$da" = "1" ] || LUECKEN="$LUECKEN $name"
    done
    if [ -n "$LUECKEN" ]; then
      echo
      echo "FEHLER: Das Schema reicht bis $GRENZE, aber diese Schritte"
      echo "darunter fehlen trotzdem:$LUECKEN"
      echo "So kann das Schema nicht in Reihenfolge entstanden sein."
      echo "Hier ist von Hand nachzusehen, nichts wurde geaendert."
      return 1
    fi

    echo "  Erstinstallation reicht bis $GRENZE."
    for f in db/*.sql; do
      name="$(basename "$f")"
      nummer="${name%%_*}"
      [ "$nummer" \> "$GRENZE" ] && continue
      psql_stig -q -c "INSERT INTO schema_migration (datei) VALUES ('${name}')
                       ON CONFLICT DO NOTHING" >/dev/null
      echo "  vorgefunden:     $name"
    done
  fi
  return 0
}
