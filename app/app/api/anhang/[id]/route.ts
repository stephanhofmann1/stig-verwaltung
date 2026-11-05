import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one } from "@/lib/db";
import { anhangMitPfad, auslieferung, entferne, leseInhalt } from "@/lib/anhaenge";
import { darfSchreiben } from "@/lib/dokumente";

export const dynamic = "force-dynamic";

/**
 * Einen Anhang ausliefern oder entfernen.
 *
 * Warum eine eigene Route und nicht ein Link auf die Platte: Der Pfad
 * darf nirgends im HTML stehen. Stünde er dort, hinge der Schutz daran,
 * dass niemand die Adresse weitergibt. Hier hängt er an der Sitzung und
 * an RLS, und beides wird bei JEDEM Abruf geprüft -- auch beim zweiten,
 * auch aus einem gespeicherten Lesezeichen. Dieselbe Begründung wie bei
 * app/api/dokumente/[id].
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Die Kopfzeilen der Auslieferung.
 *
 * nosniff ist hier wichtiger als irgendwo sonst in dieser Anwendung:
 * Eingehende Anhänge kommen von Fremden und gehen grundsätzlich als
 * application/octet-stream hinaus (lib/anhaenge.ts: auslieferung). Ohne
 * nosniff dürfte der Browser in die Datei schauen, sich für HTML
 * entscheiden und sie im Ursprung dieser Anwendung ausführen -- genau
 * das, was die octet-stream-Regel verhindern soll.
 *
 * sandbox und default-src 'none' decken den zweiten Weg ab: Ein PDF darf
 * Javascript enthalten, und ein PDF liefern wir inline aus.
 */
function kopfzeilen(
  contentType: string,
  disposition: "inline" | "attachment",
  dateiname: string,
  laenge: number,
): Record<string, string> {
  const schlicht = dateiname
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "");
  return {
    "Content-Type": contentType,
    "Content-Length": String(laenge),
    "Content-Disposition":
      `${disposition}; filename="${schlicht}"; ` +
      `filename*=UTF-8''${encodeURIComponent(dateiname)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, private",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "keine Kennung" }, { status: 400 });
  }

  const a = await anhangMitPfad(id);
  if (!a) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }

  let inhalt: Buffer;
  try {
    inhalt = await leseInhalt(a.ablage_pfad);
  } catch {
    // Die Zeile steht, die Datei fehlt. Das ist ein Fehler im Bestand
    // und keine fehlende Berechtigung -- deshalb 410 und nicht 404: Es
    // gab sie, sie ist weg.
    return NextResponse.json(
      { fehler: "Die Datei liegt nicht mehr in der Ablage." },
      { status: 410 },
    );
  }

  const art = auslieferung({ richtung: a.richtung, mime_typ: a.mime_typ });
  return new NextResponse(new Uint8Array(inhalt), {
    headers: kopfzeilen(
      art.contentType,
      art.disposition,
      a.dateiname,
      inhalt.length,
    ),
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || !darfSchreiben(sitzung.rolle)) {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "keine Kennung" }, { status: 400 });
  }

  const a = await anhangMitPfad(id);
  if (!a) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }

  // Nur an einem Entwurf. Was gesendet wurde, bleibt in der Akte so
  // stehen, wie es hinausging -- auch die Anhänge. Und was hereinkam,
  // gehört dem Absender: Eingehende Post wird hier nicht beschnitten.
  const n = await one<{ status: string }>(
    `SELECT status FROM nachricht WHERE id = $1`,
    [a.nachricht_id],
  );
  if (!n || n.status !== "entwurf") {
    return NextResponse.json(
      {
        fehler:
          "Anhänge lassen sich nur an einem Entwurf entfernen. Was gesendet " +
          "oder empfangen wurde, bleibt in der Akte.",
      },
      { status: 409 },
    );
  }

  const weg = await entferne(id);
  return NextResponse.json({ ok: weg });
}
