import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { beantworte, type Gespraechsschritt } from "@/lib/assistent";
import { objektSicht } from "@/lib/objektsicht";
import { zugaengeFuer } from "@/lib/zugang";

export const dynamic = "force-dynamic";

/**
 * Der Assistent (lib/assistent.ts) -- eine Frage, eine Antwort.
 *
 * Geschuetzt wie jede Schnittstelle durch proxy.ts; Mieter kommen hier gar
 * nicht erst an (darf() laesst sie nur in den Mieterbereich). Die Pruefung
 * unten ist die zweite Tuer, falls sich daran etwas aendert.
 *
 * Der Verlauf kommt vom Browser und wird hier nur als Text genommen: Wer
 * was gefragt hat, entscheidet nichts -- jedes Werkzeug liest unter der
 * Zeilensicherheit der Sitzung, nicht unter dem, was im Verlauf steht.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ ok: false, fehler: "Nicht angemeldet." }, { status: 401 });
  }

  const roh = (await req.json().catch(() => null)) as { verlauf?: unknown } | null;
  const verlauf: Gespraechsschritt[] = Array.isArray(roh?.verlauf)
    ? (roh!.verlauf as unknown[])
        .filter(
          (s): s is Gespraechsschritt =>
            typeof s === "object" &&
            s !== null &&
            ((s as Gespraechsschritt).rolle === "nutzer" ||
              (s as Gespraechsschritt).rolle === "assistent") &&
            typeof (s as Gespraechsschritt).text === "string",
        )
        .map((s) => ({ rolle: s.rolle, text: s.text }))
    : [];
  if (verlauf.length === 0) {
    return NextResponse.json({ ok: false, fehler: "Keine Frage gestellt." }, { status: 400 });
  }

  const [zugaenge, sicht] = await Promise.all([
    zugaengeFuer(sitzung).catch(() => []),
    objektSicht().catch(() => ({ objekte: [], gewaehlt: null })),
  ]);
  const mandant = zugaenge.find((z) => z.mandant === sitzung.mandant)?.name ?? "der Verwaltung";

  const ergebnis = await beantworte(verlauf, {
    mandant,
    objekt: sicht.gewaehlt ? { id: sicht.gewaehlt.id, name: sicht.gewaehlt.name } : null,
  });
  return NextResponse.json(ergebnis);
}
