import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one } from "@/lib/db";
import { erkenneTyp } from "@/lib/dokumente";
import { kopfzeilen } from "@/lib/anhaenge";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Die Datei zu einem Beleg.
 *
 * WARUM DAS FEHLTE
 *
 * In app/belege/page.tsx stand ein Kommentar: "Kein Weg zur Datei: Ein
 * Beleg hat keine Zeile in `dokument`, und /api/dokumente/<id> liefert
 * nur die. Ein Link dorthin waere ein 404 -- schlimmer als keiner."
 *
 * Das war richtig beobachtet und die falsche Schlussfolgerung. Solange
 * niemand den Beleg öffnen kann, lässt sich eine Zuordnung nicht prüfen:
 * Die Zeile sagt "Amazon, 45,44 €", und ob das im Beleg wirklich so
 * steht, weiß man erst, wenn man ihn sieht. Bei 300 Belegen, die
 * maschinell eingeordnet wurden, ist das keine Bequemlichkeit, sondern
 * die Voraussetzung dafür, der Einordnung zu misstrauen.
 *
 * WARUM DER TYP AM INHALT BESTIMMT WIRD
 *
 * Nicht an der Endung und nicht an einer gespeicherten Angabe. Belege
 * kommen aus drei Richtungen herein -- hochgeladen, als Mailanhang, als
 * Sammel-Einlieferung -- und bei zwei davon stammt der Dateiname von
 * außen. erkenneTyp liest die ersten Bytes; was dabei nicht als PDF oder
 * Bild erkannt wird, geht als application/octet-stream zum Herunterladen
 * hinaus und nicht in den Ursprung dieser Anwendung.
 *
 * PDFs gehen inline hinaus, weil man sie ansehen soll. Dass das
 * ungefährlich ist, liegt nicht am Typ, sondern an den Kopfzeilen:
 * `default-src 'none'; sandbox` und nosniff (lib/anhaenge.ts:
 * kopfzeilen). Ein PDF darf Javascript enthalten; in der Sandbox läuft
 * es nicht.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    // Belege sind Buchhaltung. Ein Mieter hat hier nichts zu sehen --
    // auch nicht den Beleg zu seiner eigenen Wohnung, denn darauf stehen
    // Preise, die er nicht zu kennen braucht.
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "keine Kennung" }, { status: 400 });
  }

  const b = await one<{ ablage_pfad: string | null; dateiname: string | null }>(
    `SELECT ablage_pfad, dateiname FROM beleg WHERE id = $1`,
    [id],
  );
  if (!b) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }
  if (!b.ablage_pfad) {
    // Ein Beleg kann ohne Datei entstehen (von Hand angelegt). Das ist
    // kein Fehler, aber auch kein Download.
    return NextResponse.json(
      { fehler: "Zu diesem Beleg liegt keine Datei." },
      { status: 404 },
    );
  }

  let inhalt: Buffer;
  try {
    inhalt = await readFile(b.ablage_pfad);
  } catch {
    // Die Zeile steht, die Datei fehlt. Das ist ein Fehler im Bestand und
    // keine fehlende Berechtigung -- deshalb 410: Es gab sie, sie ist weg.
    return NextResponse.json(
      { fehler: "Die Datei liegt nicht mehr in der Ablage." },
      { status: 410 },
    );
  }

  const erkannt = erkenneTyp(inhalt);
  const anzeigbar =
    erkannt?.mime === "application/pdf" ||
    erkannt?.mime === "image/png" ||
    erkannt?.mime === "image/jpeg";

  return new NextResponse(new Uint8Array(inhalt), {
    headers: kopfzeilen(
      anzeigbar ? erkannt!.mime : "application/octet-stream",
      anzeigbar ? "inline" : "attachment",
      b.dateiname ?? `beleg${erkannt?.endung ?? ""}`,
      inhalt.length,
    ),
  });
}
