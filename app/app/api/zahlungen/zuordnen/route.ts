import { NextResponse } from "next/server";
import { schlageZuordnungenVor, uebernehmeSichere } from "@/lib/zuordnung";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liefert die aktuellen Vorschlaege, ohne etwas festzuschreiben. */
export async function GET() {
  return NextResponse.json({ vorschlaege: await schlageZuordnungenVor() });
}

/**
 * POST ohne Koerper: uebernimmt alle sicheren Vorschlaege.
 * POST mit { buchung_id, soll_id, betrag }: bestaetigt eine Zuordnung
 * von Hand -- das ist die Prueflisten-Aktion.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    | { buchung_id?: string; soll_id?: string; betrag?: number; verwerfen?: boolean }
    | null;

  if (!body?.buchung_id) {
    return NextResponse.json(await uebernehmeSichere());
  }

  if (body.verwerfen) {
    await query(`DELETE FROM zuordnung WHERE buchung_id = $1`, [body.buchung_id]);
    return NextResponse.json({ ok: true });
  }

  if (!body.soll_id || typeof body.betrag !== "number") {
    return NextResponse.json({ fehler: "soll_id oder betrag fehlt" }, { status: 400 });
  }

  await query(
    `INSERT INTO zuordnung (buchung_id, sollstellung_id, betrag, sicherheit,
                            begruendung, bestaetigt_am)
     VALUES ($1,$2,$3,'bestaetigt','Von Hand bestaetigt.', now())
     ON CONFLICT (buchung_id, sollstellung_id)
     DO UPDATE SET betrag = EXCLUDED.betrag,
                   sicherheit = 'bestaetigt',
                   bestaetigt_am = now()`,
    [body.buchung_id, body.soll_id, body.betrag],
  );
  return NextResponse.json({ ok: true });
}
