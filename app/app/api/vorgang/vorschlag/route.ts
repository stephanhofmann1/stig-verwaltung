import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { schlageVor } from "@/lib/vorgangsvorschlag";

export const dynamic = "force-dynamic";

/**
 * Das Fenster "Neuer Vorgang": aus einer Beschreibung in eigenen Worten
 * wird ein ausgefuelltes Formular. Es wird nichts angelegt -- das tut
 * POST /api/vorgang, wenn Stephan auf "Vorgang anlegen" klickt.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ ok: false, fehler: "Nicht angemeldet." }, { status: 401 });
  }
  const roh = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const beschreibung = typeof roh?.text === "string" ? roh.text : "";
  return NextResponse.json(await schlageVor(beschreibung));
}
