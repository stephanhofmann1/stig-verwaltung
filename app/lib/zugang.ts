import { pool } from "./db";
import type { Rolle, Sitzung } from "./sitzung";

/**
 * Welche Mandanten stehen diesem Konto offen -- und der Wechsel dazwischen.
 *
 * WARUM DIESE DATEI EXISTIERT
 *
 * Stephan verwaltet die eGbR mit Igor und will daneben eine private
 * Steuerablage. Beides in einem Mandanten hiesse: Igor kommt an die
 * privaten Belege. Zwei Zugaenge hiessen: zum Wechseln ab- und wieder
 * anmelden. Also bleiben es zwei Mandanten mit RLS dazwischen, und nur
 * der Weg hinein wird bequemer.
 *
 * DIE EINE REGEL, AUF DIE ES ANKOMMT
 *
 * Der Zielmandant kommt vom Browser. Geprueft wird er in der Datenbank,
 * und die Rolle fuer den Zielmandanten kommt ebenfalls von dort -- nie
 * aus der Anfrage. Wer eine fremde Kennung schickt, bekommt kein neues
 * Cookie und keine Fehlermeldung, aus der sich ableiten laesst, ob es
 * diesen Mandanten gibt.
 *
 * WARUM DIE ABFRAGE AM POOL HAENGT UND NICHT AN query()
 *
 * query() setzt app.mandant auf den aktiven Mandanten, und die Policy auf
 * benutzer_zugang gibt es nicht -- die Tabelle ist fuer die
 * Anwendungsrolle ganz zu (db/035). Der einzige Weg hinein ist
 * zugaenge_fuer(), eine SECURITY-DEFINER-Funktion. Dieselbe Bauweise wie
 * die Anmeldung in lib/anmeldung.ts, und aus demselben Grund: Hier wird
 * der Mandant bestimmt, nicht benutzt.
 */

export interface Zugang {
  mandant: string;
  name: string;
  kuerzel: string;
  rolle: Rolle;
  /** Der Mandant, in dem die Benutzerzeile steht. */
  heimat: boolean;
}

interface Zeile {
  mandant_id: string;
  name: string;
  kuerzel: string;
  rolle: string;
  heimat: boolean;
}

/**
 * Die offenen Mandanten, Heimat zuerst.
 *
 * Ein Mieterzugang bekommt eine leere Liste. Nicht weil es nichts gaebe,
 * sondern damit der Umschalter dort nie erscheint -- ein Mieterzugang
 * haengt an einem Mietverhaeltnis und hat in einem zweiten Mandanten
 * nichts zu suchen.
 */
export async function zugaengeFuer(sitzung: Sitzung): Promise<Zugang[]> {
  if (sitzung.rolle === "mieter") return [];
  const heimat = sitzung.heimat ?? sitzung.mandant;
  const r = await pool.query<Zeile>(`SELECT * FROM zugaenge_fuer($1, $2)`, [
    sitzung.name,
    heimat,
  ]);
  return r.rows
    .filter((z) => z.rolle === "verwalter" || z.rolle === "lesen")
    .map((z) => ({
      mandant: z.mandant_id,
      name: z.name,
      kuerzel: z.kuerzel,
      rolle: z.rolle as Rolle,
      heimat: z.heimat,
    }));
}

/**
 * Die Sitzung für den Zielmandanten -- oder null.
 *
 * Null heisst in jedem Fall dasselbe: kein Wechsel. Ob der Mandant nicht
 * existiert, nicht freigegeben oder abgeschaltet ist, steht nicht in der
 * Antwort. Aus einer Unterscheidung liesse sich ablesen, welche
 * Mandanten es gibt.
 *
 * Die Rolle der neuen Sitzung kommt aus der Datenbank. Sie darf sich beim
 * Wechsel aendern: wer das eigene Haus verwaltet, liest im fremden
 * vielleicht nur mit.
 *
 * Der Heimatmandant bleibt, was er war. Sonst waere nach dem ersten
 * Wechsel der Rückweg verloren -- und schlimmer: der Browser haette
 * bestimmt, von wo aus die naechste Pruefung rechnet.
 */
export async function sitzungFuerMandant(
  sitzung: Sitzung,
  ziel: string,
): Promise<Sitzung | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ziel)) {
    return null;
  }
  const offen = await zugaengeFuer(sitzung);
  const treffer = offen.find((z) => z.mandant === ziel);
  if (!treffer) return null;
  return {
    name: sitzung.name,
    mandant: treffer.mandant,
    rolle: treffer.rolle,
    heimat: sitzung.heimat ?? sitzung.mandant,
  };
}
