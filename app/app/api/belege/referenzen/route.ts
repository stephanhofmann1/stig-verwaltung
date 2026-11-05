import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";
import { lieseBeleg } from "@/lib/belegtext";
import { findeReferenzen } from "@/lib/referenzen";
import { uebernehmeSichereBelege } from "@/lib/belegabgleich";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Referenznummern aus den abgelegten Belegen neu ermitteln.
 *
 * WOFÜR
 *
 * Belege, die vor dieser Funktion eingeliefert wurden, haben keine
 * Referenzen — am 05.11.2026 waren das 229 Stück. Sie liegen aber alle
 * noch in der Ablage, mit Textebene. Die Nummern lassen sich also
 * nachträglich lesen, ohne dass jemand etwas hochladen muss.
 *
 * Der Aufruf ist auch danach noch nützlich und bleibt deshalb: Wenn die
 * Muster in lib/referenzen.ts besser werden — ein Versorger, dessen
 * Kundennummer bisher durchrutschte —, holt dieser Lauf die neuen
 * Nummern für den ganzen Bestand nach. Er ist wiederholbar: Was schon
 * steht, wird nicht doppelt angelegt.
 *
 * WAS ER NICHT TUT
 *
 * Er ändert keinen Beleg. Weder Betrag noch Datum noch Kostenart werden
 * angefasst — nur Referenzen kommen dazu. Und er löscht keine: Eine
 * Referenz, die ein Mensch von Hand eingetragen hat, soll ein
 * maschineller Lauf nicht wegräumen, bloß weil das Muster sie nicht
 * findet.
 */
export async function POST() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  if (sitzung.rolle === "lesen") {
    return NextResponse.json(
      { fehler: "Nur Leserecht." },
      { status: 403 },
    );
  }

  const belege = await query<{ id: string; ablage_pfad: string | null }>(
    `SELECT id, ablage_pfad FROM beleg
      WHERE ablage_pfad IS NOT NULL
      ORDER BY angelegt_am`,
  );

  let gelesen = 0;
  let ohneDatei = 0;
  let ohneText = 0;
  let neu = 0;
  const nachArt: Record<string, number> = {};

  for (const b of belege) {
    let inhalt: Buffer;
    try {
      inhalt = await readFile(b.ablage_pfad!);
    } catch {
      ohneDatei += 1;
      continue;
    }
    const d = await lieseBeleg(inhalt);
    gelesen += 1;
    if (!d.text || d.text.trim().length < 40) {
      ohneText += 1;
      continue;
    }
    for (const r of findeReferenzen(d.text)) {
      const eingefuegt = await query<{ id: string }>(
        `INSERT INTO beleg_referenz (beleg_id, art, wert, normiert)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (mandant_id, beleg_id, art, normiert) DO NOTHING
         RETURNING id`,
        [b.id, r.art, r.wert, r.normiert],
      );
      if (eingefuegt.length > 0) {
        neu += 1;
        nachArt[r.art] = (nachArt[r.art] ?? 0) + 1;
      }
    }
  }

  // Mit den neuen Referenzen lohnt der Abgleich sofort.
  const abgleich = neu > 0 ? await uebernehmeSichereBelege() : { uebernommen: 0, offen: 0 };

  return NextResponse.json({
    belege: belege.length,
    gelesen,
    ohne_datei: ohneDatei,
    ohne_textebene: ohneText,
    neue_referenzen: neu,
    nach_art: nachArt,
    abgleich,
  });
}

/** Wie viele Referenzen stehen schon da? */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const [z] = await query<{ gesamt: string; belege: string }>(
    `SELECT count(*)::text AS gesamt,
            count(DISTINCT beleg_id)::text AS belege
       FROM beleg_referenz`,
  );
  const nachArt = await query<{ art: string; n: string }>(
    `SELECT art, count(*)::text AS n FROM beleg_referenz GROUP BY art ORDER BY art`,
  );
  return NextResponse.json({ ...z, nach_art: nachArt });
}
