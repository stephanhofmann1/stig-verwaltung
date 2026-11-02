import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { importiere, pruefeAltdaten } from "@/lib/altdaten";

export const dynamic = "force-dynamic";

/**
 * Altdaten übernehmen -- Objekte, Einheiten, Mietverhältnisse, Mieter,
 * Mietanpassungen, Kündigungen und Fristen.
 *
 * Bis hierhin lief das nur als Skript auf dem Server. Die Auslieferung
 * spielt es nicht mit ein, und die Datei gehört nicht ins Repository: Sie
 * enthält Namen, Geburtsdaten, Geburtsorte und Voranschriften echter
 * Mieter. Über diese Route geht sie vom Browser direkt an den eigenen
 * Server -- kein Terminal, kein Dritter dazwischen.
 *
 * Standard ist der Probelauf. Geschrieben wird erst mit echt=1, und das
 * schickt die Oberfläche nur nach einem zweiten, ausdrücklichen Klick.
 *
 * Nur für Verwalter. Ein Mieterzugang hat hier nichts zu suchen -- und die
 * Daten anderer Mieter schon gar nicht.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  // Die Rolle "lesen" darf sehen, nicht schreiben. Der Probelauf schreibt
  // nichts, ist also erlaubt; die Übernahme nicht.
  const form = await req.formData();
  const echt = String(form.get("echt") ?? "") === "1";
  if (echt && sitzung.rolle === "lesen") {
    return NextResponse.json(
      { fehler: "Dieser Zugang darf nur lesen." },
      { status: 403 },
    );
  }

  const datei = form.get("datei");
  if (!(datei instanceof File)) {
    return NextResponse.json({ fehler: "Keine Datei erhalten" }, { status: 400 });
  }

  // Als UTF-8 lesen ist hier richtig: altdaten.json wird von einem
  // Programm geschrieben, nicht von einer Bank exportiert.
  const text = Buffer.from(await datei.arrayBuffer()).toString("utf8");

  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch (e) {
    return NextResponse.json(
      { fehler: `Die Datei ist kein gültiges JSON: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  // Prüfen, dass es wirklich die Altdaten sind -- nicht irgendeine andere
  // JSON-Datei, die beim Auswählen danebengegriffen wurde.
  const { bloecke: vorhanden, fehler: formFehler } = pruefeAltdaten(daten);
  if (formFehler) {
    return NextResponse.json({ fehler: formFehler }, { status: 400 });
  }

  try {
    const bericht = await importiere(daten, echt);
    return NextResponse.json({
      ok: true,
      echt,
      bloecke: vorhanden,
      bericht,
    });
  } catch (e) {
    // Die Meldung geht an die Oberfläche, weil sie dort gebraucht wird:
    // Ein Import, der an einer Einheit scheitert, muss sagen, an welcher.
    return NextResponse.json(
      { fehler: (e as Error).message },
      { status: 500 },
    );
  }
}
