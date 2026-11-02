import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import {
  darfSehen,
  darfSchreiben,
  downloadName,
  dokumentMitPfad,
  leseInhalt,
  loesche,
  mieterBezug,
  ERLAUBTE_TYPEN,
  type Zugang,
} from "@/lib/dokumente";
import { vertragFuer, wgbFuer, type Dokument } from "@/lib/vertragsdaten";

export const dynamic = "force-dynamic";

/**
 * Eine Datei ausliefern -- und zwar nur dem, der sie sehen darf.
 *
 * Warum überhaupt eine Route: Der Pfad auf der Platte darf nirgends im HTML
 * stehen. Stünde er dort, hinge der Schutz der Datei daran, dass niemand
 * die Adresse errät oder weitergibt. Hier hängt er an der Sitzung, und die
 * Prüfung läuft bei JEDEM Abruf -- auch beim zweiten, auch beim Abruf aus
 * einem gespeicherten Lesezeichen.
 *
 * Zwei Arten von Kennungen:
 *   <uuid>            ein abgelegtes Dokument aus der Tabelle dokument
 *   vertrag-<uuid>    der Mietvertrag zu einem Mietverhältnis
 *   wgb-<uuid>        die Wohnungsgeberbestätigung (§ 19 BMG)
 *
 * Die beiden letzten liegen nirgends. Sie werden bei jedem Abruf neu
 * erzeugt (lib/vertragsdaten.ts) -- eine Datei auf der Platte müsste man
 * gegen fremden Zugriff schützen, ein Dokument, das nur für die Dauer der
 * Antwort existiert, nicht. Dieselbe Begründung wie in
 * app/mieter/dokument/[art]/route.ts, wo der Mieter seine eigenen holt.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERLAUBTE_MIMES: Set<string> = new Set(ERLAUBTE_TYPEN.map((t) => t.mime));

/**
 * Die Kopfzeilen der Auslieferung.
 *
 * nosniff, weil der Content-Type aus den Magic Bytes stammt und der Browser
 * ihn nicht überstimmen soll. no-store, weil die Dateien persönliche Daten
 * enthalten können und hinter einem geteilten Netz sonst ein Proxy sie für
 * den nächsten Abruf aufbewahrt. Content-Security-Policy, weil ein PDF im
 * selben Ursprung ausgeliefert wird und ein PDF Javascript enthalten kann.
 */
function kopfzeilen(
  mime: string,
  dateiname: string,
  laenge: number,
  anhang: boolean,
): Record<string, string> {
  // Für den Header-Wert zwei Schreibweisen: eine ohne Sonderzeichen für
  // alte Browser, eine nach RFC 5987 mit Umlauten.
  const schlicht = dateiname.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return {
    "Content-Type": ERLAUBTE_MIMES.has(mime) ? mime : "application/octet-stream",
    "Content-Length": String(laenge),
    "Content-Disposition":
      `${anhang ? "attachment" : "inline"}; filename="${schlicht}"; ` +
      `filename*=UTF-8''${encodeURIComponent(dateiname)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, private",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}

/** Mietvertrag und Wohnungsgeberbestätigung -- erzeugt, nicht gelesen. */
async function erzeugtes(
  id: string,
): Promise<{ bauen: (mv: string) => Promise<Dokument>; mv: string } | null> {
  for (const [vorsatz, bauen] of [
    ["vertrag-", vertragFuer],
    ["wgb-", wgbFuer],
  ] as const) {
    if (id.startsWith(vorsatz)) {
      const mv = id.slice(vorsatz.length);
      return UUID.test(mv) ? { bauen, mv } : null;
    }
  }
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }

  const { id } = await params;
  const anhang = new URL(req.url).searchParams.get("download") === "1";

  // --- Erzeugte Dokumente ---------------------------------------------
  const erzeugt = await erzeugtes(id);
  if (erzeugt) {
    // Der Mieter holt seine beiden Dokumente unter /mieter/dokument/<art>,
    // und dort kommt das Mietverhältnis aus der Sitzung statt aus dem
    // Pfad. Hier steht es im Pfad -- also darf hier kein Mieter herein.
    if (sitzung.rolle === "mieter") {
      return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
    }
    try {
      const dok = await erzeugt.bauen(erzeugt.mv);
      return new NextResponse(new Uint8Array(dok.pdf), {
        headers: kopfzeilen(
          "application/pdf",
          dok.dateiname,
          dok.pdf.length,
          anhang,
        ),
      });
    } catch (e) {
      // Fehlende Angaben sind der Normalfall bei übernommenen
      // Altmietverhältnissen. Die Meldung nennt alle fehlenden Felder auf
      // einmal und ist damit die Arbeitsliste -- sie geht hier an die
      // Verwaltung und nicht an den Mieter, darf also deutlich sein.
      return NextResponse.json(
        { fehler: (e as Error).message },
        { status: 409 },
      );
    }
  }

  // --- Abgelegte Dokumente --------------------------------------------
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }

  // Sieht nur Zeilen des eigenen Mandanten -- das ist die erste Grenze und
  // Postgres zieht sie (RLS, db/029).
  const dok = await dokumentMitPfad(id);
  if (!dok) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }

  // Die zweite Grenze: Innerhalb eines Mandanten trennt RLS die Mieter
  // nicht voneinander. Welche Wohnung zu diesem Mieter gehört, kommt aus
  // der Datenbank und nicht aus der Anfrage.
  let zugang: Zugang = { rolle: sitzung.rolle };
  if (sitzung.rolle === "mieter") {
    const eigen =
      sitzung.mietverhaeltnis && (await mieterBezug(sitzung.mietverhaeltnis));
    if (!eigen) {
      return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
    }
    zugang = eigen;
  }

  if (!darfSehen(zugang, dok)) {
    // Bewusst 404 und nicht 403 für Mieter: Ein 403 bestätigt, dass es ein
    // Dokument mit dieser Kennung gibt. Für die Verwaltung ist das
    // gleichgültig, für einen Mieter nicht.
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }

  let inhalt: Buffer;
  try {
    inhalt = await leseInhalt(dok.ablage_pfad);
  } catch (e) {
    // Zeile da, Datei weg. Das kann nach einem Umzug der Ablage passieren
    // oder wenn jemand im Dateisystem aufgeräumt hat. Der Grund gehört ins
    // Log, nicht in die Antwort -- dort steht sonst ein Pfad.
    console.warn(
      `[dokument] ${id}: Datei nicht lesbar — ${(e as Error).message}`,
    );
    return NextResponse.json(
      {
        fehler:
          "Die Datei liegt nicht mehr in der Ablage. Der Eintrag ist noch " +
          "da; bitte neu hochladen.",
      },
      { status: 410 },
    );
  }

  return new NextResponse(new Uint8Array(inhalt), {
    headers: kopfzeilen(
      dok.mime_typ ?? "",
      downloadName(dok),
      inhalt.length,
      anhang,
    ),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || !darfSchreiben(sitzung.rolle)) {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }

  const weg = await loesche(id);
  if (!weg) {
    return NextResponse.json({ fehler: "nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
