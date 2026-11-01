import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { vertragFuer, wgbFuer } from "@/lib/vertragsdaten";

export const dynamic = "force-dynamic";

/**
 * Mietvertrag und Wohnungsgeberbestätigung für den angemeldeten Mieter.
 *
 * Das Mietverhältnis kommt **ausschließlich aus der Sitzung**, niemals aus
 * der Adresse. Das ist der ganze Sinn dieser Datei: Stünde die Kennung im
 * Pfad, könnte jeder angemeldete Mieter sie austauschen und den Vertrag
 * eines anderen herunterladen -- mit Geburtsdatum, Geburtsort, Voranschrift
 * und Kaution darin. Der Pfadparameter sagt nur, WELCHES der beiden
 * Dokumente gemeint ist.
 *
 * Erzeugt wird bei jedem Abruf neu, nichts wird abgelegt. Eine Datei auf
 * der Platte müsste man gegen fremden Zugriff schützen; ein Dokument, das
 * nur für die Dauer der Antwort existiert, nicht.
 */

const ARTEN = {
  mietvertrag: vertragFuer,
  wohnungsgeberbestaetigung: wgbFuer,
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ art: string }> },
) {
  const sitzung = await angemeldeteSitzung();
  // Beides prüfen: Die Rolle allein genügt nicht, und ein Mieterzugang
  // ohne Mietverhältnis wäre ein Fehler, nicht eine leere Antwort.
  if (!sitzung || sitzung.rolle !== "mieter" || !sitzung.mietverhaeltnis) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }

  const { art } = await params;
  const bauen = ARTEN[art as keyof typeof ARTEN];
  if (!bauen) {
    return NextResponse.json({ fehler: "unbekanntes Dokument" }, { status: 404 });
  }

  try {
    const dok = await bauen(sitzung.mietverhaeltnis);
    return new NextResponse(new Uint8Array(dok.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dok.dateiname}"`,
        // Kein Zwischenspeicher: Das PDF enthält persönliche Daten und
        // hinter einem geteilten Netz (Büro, WLAN) würde ein Proxy es
        // sonst für den nächsten Abruf aufbewahren.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    // Fehlende Angaben sind der Normalfall bei übernommenen Altmietern --
    // die haben oft keinen Vertrag auf STIG-Briefpapier. Dem Mieter wird
    // deshalb nicht die Feldliste gezeigt, sondern ein Satz, mit dem er
    // etwas anfangen kann. Die Einzelheiten stehen im Log.
    console.warn(
      `[mieterdokument] ${art} für ${sitzung.mietverhaeltnis}: ` +
        (e as Error).message,
    );
    return NextResponse.json(
      {
        fehler:
          "Dieses Dokument lässt sich für Ihr Mietverhältnis noch nicht " +
          "erzeugen. Bitte melden Sie sich bei der Verwaltung.",
      },
      { status: 409 },
    );
  }
}
