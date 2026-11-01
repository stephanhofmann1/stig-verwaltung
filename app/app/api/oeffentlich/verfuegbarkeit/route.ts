import { NextResponse } from "next/server";
import { verfuegbarkeit } from "@/lib/oeffentlich";
import { mitMandant, mandantFuerAdresse } from "@/lib/mandant";

export const dynamic = "force-dynamic";

/**
 * Freie und bald freie Einheiten — fuer die Objektwebsite und den
 * WG-Gesucht-Lauf.
 *
 * Ohne Anmeldung erreichbar, deshalb enthaelt die Antwort keinen einzigen
 * personenbezogenen Wert: keine Namen, keine Laufzeiten belegter Einheiten,
 * keine Mieten von belegten Zimmern.
 *
 * Welcher Mandant gemeint ist, sagt der Parameter ?host= — derselbe
 * Mechanismus wie beim Maileingang, nur ueber den Hostnamen der Website
 * statt ueber die Empfaengeradresse. Ohne Treffer: 404 statt einer leeren
 * Liste, sonst sieht ein Tippfehler aus wie "alles vermietet".
 */
export async function GET(req: Request) {
  const host = new URL(req.url).searchParams.get("host") ?? "";
  if (!host) {
    return NextResponse.json(
      { fehler: "Parameter host fehlt" },
      { status: 400 },
    );
  }

  const mandant = await mandantFuerAdresse(host);
  if (!mandant) {
    return NextResponse.json(
      { fehler: `Unbekannter Host: ${host}` },
      { status: 404 },
    );
  }

  const daten = await mitMandant(mandant, () => verfuegbarkeit());

  return NextResponse.json(daten, {
    headers: {
      // Die Website darf das von ueberall holen; es ist oeffentlich.
      "access-control-allow-origin": "*",
      // Eine Minute Puffer: haeufig genug, damit eine Kuendigung zeitnah
      // sichtbar wird, selten genug, dass ein Besucheransturm nicht
      // jedes Mal die Datenbank fragt.
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
