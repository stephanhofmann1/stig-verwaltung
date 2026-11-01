import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  schlageBelegeVor,
  uebernehmeSichereBelege,
  markiereOhneBelegpflicht,
} from "@/lib/belegabgleich";

export const dynamic = "force-dynamic";

/** Aktuelle Vorschlaege, ohne etwas festzuschreiben. */
export async function GET() {
  return NextResponse.json({ vorschlaege: await schlageBelegeVor() });
}

/**
 * Ohne Koerper: sichere Treffer uebernehmen und Mieteingaenge von der
 * Belegpflicht befreien.
 * Mit { buchung_id, beleg_id, betrag }: von Hand zuordnen.
 * Mit { buchung_id, kein_beleg_noetig, vermerk }: Bewegung als
 * belegfrei vermerken (Umbuchung, Privatentnahme).
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    buchung_id?: string;
    beleg_id?: string;
    betrag?: number;
    kein_beleg_noetig?: boolean;
    vermerk?: string;
  } | null;

  if (!b?.buchung_id) {
    const ohnePflicht = await markiereOhneBelegpflicht();
    const abgleich = await uebernehmeSichereBelege();
    return NextResponse.json({ ohne_belegpflicht: ohnePflicht, ...abgleich });
  }

  if (b.kein_beleg_noetig) {
    if (!b.vermerk?.trim()) {
      return NextResponse.json(
        { fehler: "Ein Vermerk ist nötig — sonst weiß später niemand warum." },
        { status: 400 },
      );
    }
    await query(
      `UPDATE buchung SET beleg_nicht_noetig = true, beleg_vermerk = $2
        WHERE id = $1`,
      [b.buchung_id, b.vermerk.trim()],
    );
    return NextResponse.json({ ok: true });
  }

  if (!b.beleg_id || typeof b.betrag !== "number") {
    return NextResponse.json({ fehler: "beleg_id oder betrag fehlt" }, { status: 400 });
  }

  await query(
    `INSERT INTO belegbuchung (buchung_id, beleg_id, betrag, sicherheit, begruendung)
     VALUES ($1,$2,$3,'bestaetigt','Von Hand zugeordnet.')
     ON CONFLICT (buchung_id, beleg_id)
     DO UPDATE SET betrag = EXCLUDED.betrag, sicherheit = 'bestaetigt'`,
    [b.buchung_id, b.beleg_id, b.betrag],
  );
  return NextResponse.json({ ok: true });
}
