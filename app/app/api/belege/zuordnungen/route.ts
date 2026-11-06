import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Was hat die Maschine zugeordnet -- und wie macht man es rückgängig?
 *
 * WARUM DAS FEHLTE
 *
 * Der Abgleich schreibt sichere Treffer selbsttätig in die Bücher. Die
 * Begründung dafür stand in belegbuchung.begruendung -- und wurde
 * nirgends angezeigt. Am 06.11.2026 ordnete eine neue Regel 28
 * Bewegungen auf einen Schlag zu; nachprüfen konnte man das nur in der
 * Datenbank, und zurücknehmen gar nicht.
 *
 * Ein Automat, der ins Hauptbuch schreibt, braucht beides: eine Spur,
 * die ein Mensch lesen kann, und einen Weg zurück. Ohne das Zweite ist
 * jede Regelverbesserung ein Risiko, das man nicht eingehen will --
 * und genau dann baut man sie nicht ein.
 */
export async function GET(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const url = new URL(anfrage.url);
  const roh = Number(url.searchParams.get("grenze") ?? "60");
  const grenze = Number.isFinite(roh) ? Math.min(Math.max(roh, 1), 300) : 60;

  const zeilen = await query<{
    id: string;
    betrag: string;
    sicherheit: string;
    begruendung: string | null;
    angelegt_am: string;
    buchungstag: string;
    buchung_betrag: string;
    absender: string | null;
    verwendungszweck: string | null;
    beleg_id: string;
    dateiname: string | null;
    aussteller: string | null;
    belegnummer: string | null;
    belegdatum: string | null;
  }>(
    `SELECT bb.id, bb.betrag::text, bb.sicherheit, bb.begruendung,
            bb.angelegt_am::text,
            bu.buchungstag::text, bu.betrag::text AS buchung_betrag,
            bu.absender, bu.verwendungszweck,
            bg.id AS beleg_id, bg.dateiname, bg.aussteller, bg.belegnummer,
            bg.belegdatum::text
       FROM belegbuchung bb
       JOIN buchung bu ON bu.id = bb.buchung_id
       JOIN beleg   bg ON bg.id = bb.beleg_id
      ORDER BY bb.angelegt_am DESC
      LIMIT $1`,
    [grenze],
  );
  return NextResponse.json({ zuordnungen: zeilen });
}

/**
 * Eine Zuordnung lösen.
 *
 * Die Zuordnung verschwindet, Bewegung und Beleg stehen danach wieder
 * als offen da. Der Beleg selbst wird nicht angefasst -- gelöst wird
 * die Verbindung, nicht der Beleg.
 *
 * Damit der Abgleich sie nicht beim nächsten Lauf gleich wieder
 * herstellt, bekommt der Beleg einen Vermerk in `abweichung`: Der
 * selbsttätige Abgleich lässt Belege mit Abweichung liegen. Wer von
 * Hand löst, hat einen Grund, und die Maschine soll ihn nicht
 * überstimmen.
 */
export async function DELETE(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter" || sitzung.rolle === "lesen") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  let id = "";
  try {
    const b = await anfrage.json();
    if (b && typeof b === "object" && typeof b.id === "string") id = b.id;
  } catch {
    /* unten als fehlender Wert behandelt */
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ fehler: "Keine gültige Kennung." }, { status: 400 });
  }

  const [weg] = await query<{ beleg_id: string }>(
    `DELETE FROM belegbuchung WHERE id = $1 RETURNING beleg_id`,
    [id],
  );
  if (!weg) {
    return NextResponse.json({ fehler: "Diese Zuordnung gibt es nicht." }, { status: 404 });
  }

  const vermerk =
    `Zuordnung am ${new Date().toISOString().slice(0, 10)} von Hand gelöst ` +
    `(${sitzung.name}). Der selbsttätige Abgleich lässt diesen Beleg deshalb liegen.`;
  await query(
    `UPDATE beleg SET abweichung = COALESCE(abweichung || ' ', '') || $2
      WHERE id = $1`,
    [weg.beleg_id, vermerk],
  );

  return NextResponse.json({ ok: true, beleg_id: weg.beleg_id });
}
