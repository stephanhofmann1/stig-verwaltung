import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import {
  ladeAuswahl,
  legeVorgangAn,
  normalisiere,
  KATEGORIEN,
} from "@/lib/vorgangsvorschlag";
import { KATEGORIE_LABEL } from "@/lib/typen";

export const dynamic = "force-dynamic";

/**
 * GET  -- was das Fenster "Neuer Vorgang" zur Auswahl braucht: Objekte,
 *         Einheiten, Kategorien.
 * POST -- legt den Vorgang an (lib/vorgangsvorschlag.ts, legeVorgangAn).
 *
 * Was hereinkommt, geht durch normalisiere() -- dieselbe Pruefung wie fuer
 * den Vorschlag der KI. Ein Formular aus dem Browser ist so vertrauenswuerdig
 * wie eine Antwort des Modells, also gar nicht.
 */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ ok: false, fehler: "Nicht angemeldet." }, { status: 401 });
  }
  const auswahl = await ladeAuswahl();
  return NextResponse.json({
    ok: true,
    ...auswahl,
    kategorien: KATEGORIEN.map((k) => ({ wert: k, name: KATEGORIE_LABEL[k] })),
    ki: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle !== "verwalter") {
    return NextResponse.json(
      { ok: false, fehler: "Nur die Verwaltung legt Vorgänge an." },
      { status: 403 },
    );
  }
  const roh = (await req.json().catch(() => null)) as {
    entwurf?: Record<string, unknown>;
    mitKi?: unknown;
    modell?: unknown;
  } | null;
  if (!roh?.entwurf || typeof roh.entwurf !== "object") {
    return NextResponse.json({ ok: false, fehler: "Kein Formular übergeben." }, { status: 400 });
  }
  const entwurf = normalisiere(roh.entwurf, await ladeAuswahl());
  // Die Kennung eines vorhandenen Kontakts uebernimmt normalisiere() als
  // Text; ob es ihn gibt, prueft legeVorgangAn() unter der Zeilensicherheit.
  try {
    const r = await legeVorgangAn(entwurf, {
      wer: sitzung.name,
      mitKi: roh.mitKi === true,
      modell: typeof roh.modell === "string" ? roh.modell : null,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, fehler: `Anlegen fehlgeschlagen: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
