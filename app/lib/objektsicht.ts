import { cookies } from "next/headers";
import { query } from "@/lib/db";
import {
  KEKS_OBJEKT,
  waehleObjekt,
  type ObjektAngabe,
} from "@/lib/objektwahl";

// Weitergereicht, damit Serverstellen eine Anlaufstelle haben: Wer
// objektSicht() benutzt, braucht meist auch ALLE und die Form.
export { ALLE, KEKS_ALTER, KEKS_OBJEKT, waehleObjekt } from "@/lib/objektwahl";
export type { ObjektAngabe } from "@/lib/objektwahl";

/**
 * Welches Objekt gerade betrachtet wird.
 *
 * WARUM DAS NICHT IN DIE SITZUNG GEHOERT
 *
 * Der Mandant steckt im unterschriebenen Sitzungscookie (lib/sitzung.ts),
 * und das muss so bleiben: Er ist eine Rechtegrenze. Wer ihn faelschen
 * koennte, saehe fremde Daten; darum kommt er nie aus der Anfrage,
 * sondern aus einer Unterschrift, und der Wechsel stellt das Cookie neu
 * aus.
 *
 * Das Objekt ist keine Rechtegrenze. Alle Objekte eines Mandanten darf
 * derselbe Benutzer ohnehin sehen -- die Zeilensicherheit der Datenbank
 * hat das schon entschieden, bevor diese Datei gefragt wird. Hier geht
 * es nur darum, welchen Ausschnitt jemand sehen *will*.
 *
 * Daraus folgt beides: Es braucht keine Unterschrift (es gibt nichts zu
 * faelschen -- wer die Kennung eines fremden Objekts einsetzt, bekommt
 * durch die Zeilensicherheit nichts), und es darf keine geben (eine
 * Sicht in die Sitzung zu schreiben hiesse, eine Vorliebe wie ein Recht
 * zu behandeln; spaetestens beim naechsten Mandantenwechsel waere
 * unklar, was eigentlich gilt).
 *
 * Deshalb: ein gewoehnliches Cookie, und jede Lesung prueft gegen die
 * Objekte, die der Mandant wirklich hat.
 */

/**
 * Die Objekte des Mandanten, nach Namen.
 *
 * Ohne WHERE: Die Zeilensicherheit begrenzt auf den Mandanten der
 * Sitzung. Ein zusaetzliches mandant_id = ... waere eine zweite,
 * schwaechere Zusage neben der, die wirklich traegt.
 */
export async function objekteDesMandanten(): Promise<ObjektAngabe[]> {
  return query<ObjektAngabe>(`
    SELECT id, name
      FROM objekt
     ORDER BY name
  `);
}

/**
 * Die Sicht fuer diese Anfrage: alle Objekte und das gewaehlte.
 *
 * Eine Funktion und nicht zwei, weil die Pruefung in waehleObjekt() die
 * Liste ohnehin braucht -- und weil jede Seite beides anzeigen will: die
 * Wahl im Kopf und den Ausschnitt im Inhalt.
 */
export async function objektSicht(): Promise<{
  objekte: ObjektAngabe[];
  gewaehlt: ObjektAngabe | null;
}> {
  const objekte = await objekteDesMandanten();
  const keks = (await cookies()).get(KEKS_OBJEKT)?.value ?? null;
  return { objekte, gewaehlt: waehleObjekt(keks, objekte) };
}

/**
 * Nur die Kennung -- fuer die Abfragen.
 *
 * null heisst Gesamtschau, und genau so steht es in den Abfragen:
 * `($1::uuid IS NULL OR o.id = $1)`. Ein Platzhalter, der null sein darf,
 * statt zwei Fassungen derselben Abfrage.
 */
export async function gewaehltesObjekt(): Promise<string | null> {
  return (await objektSicht()).gewaehlt?.id ?? null;
}
