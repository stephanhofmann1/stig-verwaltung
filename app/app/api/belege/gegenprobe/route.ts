import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";
import {
  datumFeld,
  liesZulieferungen,
  nurName,
  widerspruch,
  zahl,
} from "@/lib/gegenprobe";
import { uebernehmeSichereBelege } from "@/lib/belegabgleich";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Die Gegenprobe nachholen.
 *
 * WOFÜR
 *
 * Bei der Einlieferung bringt eine Beifügung je Beleg Betrag und Datum
 * mit. Stimmen sie mit dem überein, was das Portal selbst gelesen hat,
 * hat der Beleg zwei Zeugen. Fehlt die Beifügung oder passt sie nicht
 * zur erwarteten Form, steht der Beleg mit einer Lesung in den Büchern
 * -- und niemand merkt es.
 *
 * Genau das geschah am 05.11.2026: 100 Amazon-Rechnungen gingen mit
 * einer Beifügung ein, die das Portal nicht zuordnen konnte, und die
 * Meldung lautete "0 Auffällige". Diese Route holt die Gegenprobe
 * nachträglich nach, ohne dass ein Beleg erneut hochgeladen werden muss.
 *
 * SIE VERGLEICHT GEGEN DIE BÜCHER
 *
 * Verglichen wird die zugelieferte Lesung mit dem, was am Beleg steht --
 * nicht mit einer frischen Lesung der Datei. Denn in den Büchern steht
 * der gespeicherte Wert, und der muss stimmen. Ein Feld, das nur eine
 * Seite kennt, ist kein Widerspruch.
 *
 * SIE ÄNDERT NUR `abweichung`
 *
 * Kein Betrag, kein Datum, keine Kostenart wird überschrieben. Ein
 * Widerspruch wird vermerkt, damit der selbsttätige Abgleich den Beleg
 * liegen lässt (lib/belegabgleich.ts filtert auf `abweichung IS NULL`),
 * und ein Mensch entscheidet. Löst sich ein früher vermerkter
 * Widerspruch auf, wird der Vermerk entfernt -- aber nur ein Vermerk,
 * der aus einer Gegenprobe stammt; eine von Hand gesetzte Bemerkung
 * bleibt stehen.
 */
const AUS_GEGENPROBE = /^(Betrag|Datum):/;

export async function POST(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter" || sitzung.rolle === "lesen") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  let roh: unknown;
  try {
    roh = await anfrage.json();
  } catch {
    return NextResponse.json({ fehler: "Kein gültiges JSON." }, { status: 400 });
  }

  const gelesen = liesZulieferungen(roh);
  if ("fehler" in gelesen) {
    return NextResponse.json({ fehler: gelesen.fehler }, { status: 400 });
  }
  if (gelesen.anzahl === 0) {
    return NextResponse.json(
      {
        fehler:
          "Die Zulieferung enthält keinen Eintrag. Erwartet wird eine " +
          'Zuordnung Dateiname -> Felder, entweder direkt oder unter "belege".',
      },
      { status: 400 },
    );
  }

  const belege = await query<{
    id: string;
    dateiname: string | null;
    betrag_brutto: string | null;
    belegdatum: string | null;
    abweichung: string | null;
  }>(
    `SELECT id, dateiname, betrag_brutto::text, belegdatum::text, abweichung
       FROM beleg WHERE dateiname IS NOT NULL`,
  );

  // Zuordnung über den Dateinamen. Mehrere Belege mit demselben Namen
  // sind nicht eindeutig -- sie werden gemeldet, nicht geraten.
  const jeName = new Map<string, typeof belege>();
  for (const b of belege) {
    const n = nurName(b.dateiname!);
    jeName.set(n, [...(jeName.get(n) ?? []), b]);
  }

  const abweichungen: Array<{ datei: string; beleg_id: string; grund: string }> = [];
  const aufgeloest: string[] = [];
  const nichtGetroffen: string[] = [];
  const nichtEindeutig: string[] = [];
  let geprueft = 0;
  let einig = 0;

  for (const [name, felder] of Object.entries(gelesen.je)) {
    const treffer = jeName.get(name);
    if (!treffer || treffer.length === 0) {
      nichtGetroffen.push(name);
      continue;
    }
    if (treffer.length > 1) {
      nichtEindeutig.push(name);
      continue;
    }
    const b = treffer[0];
    geprueft += 1;
    const eigen = {
      betrag: b.betrag_brutto === null ? null : Number(b.betrag_brutto),
      datum: b.belegdatum,
    };
    const fremd = { betrag: zahl(felder.brutto), datum: datumFeld(felder.datum) };
    const grund = widerspruch(eigen, fremd);

    if (grund) {
      if (grund !== b.abweichung) {
        await query(`UPDATE beleg SET abweichung = $2 WHERE id = $1`, [b.id, grund]);
      }
      abweichungen.push({ datei: name, beleg_id: b.id, grund });
    } else {
      einig += 1;
      // Nur einen Vermerk aus einer Gegenprobe wieder entfernen.
      if (b.abweichung && AUS_GEGENPROBE.test(b.abweichung)) {
        await query(`UPDATE beleg SET abweichung = NULL WHERE id = $1`, [b.id]);
        aufgeloest.push(name);
      }
    }
  }

  // Trifft die Zulieferung nichts, ist etwas an ihrer Form falsch. Das
  // ist ein Fehler und keine Null in einem Bericht.
  if (geprueft === 0) {
    return NextResponse.json(
      {
        fehler:
          `Keiner der ${gelesen.anzahl} Einträge passt zu einem abgelegten Beleg. ` +
          "Die Schlüssel müssen die Dateinamen der Belege sein.",
        beispiele_zulieferung: Object.keys(gelesen.je).slice(0, 5),
        beispiele_ablage: [...jeName.keys()].slice(0, 5),
      },
      { status: 400 },
    );
  }

  const abgleich = await uebernehmeSichereBelege();

  return NextResponse.json({
    zugeliefert: gelesen.anzahl,
    umschlag: gelesen.umschlag,
    geprueft,
    einig,
    abweichend: abweichungen.length,
    aufgeloest: aufgeloest.length,
    nicht_getroffen: nichtGetroffen.length,
    nicht_eindeutig: nichtEindeutig.length,
    beispiele_nicht_getroffen: nichtGetroffen.slice(0, 10),
    beispiele_nicht_eindeutig: nichtEindeutig.slice(0, 10),
    abweichungen: abweichungen.slice(0, 100),
    abgleich,
    hinweis: `${einig} von ${geprueft} Belegen haben zwei übereinstimmende Lesungen.`,
  });
}
