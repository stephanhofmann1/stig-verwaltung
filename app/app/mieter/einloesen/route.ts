import { NextResponse } from "next/server";
import { loeseZugangEin } from "@/lib/mieter";
import { baueSitzung, COOKIE_NAME } from "@/lib/sitzung";

export const dynamic = "force-dynamic";

/**
 * Loest den Anmeldelink ein und setzt die Sitzung.
 *
 * Danach eine Umleitung ohne Token in der Adresse: Sonst steht der Schluessel
 * im Verlauf des Browsers, in der Historie und in jedem Screenshot.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const basis = new URL(req.url).origin;

  const daten = await loeseZugangEin(token);
  if (!daten) {
    return NextResponse.redirect(`${basis}/mieter/anmelden?abgelaufen=1`);
  }

  const antwort = NextResponse.redirect(`${basis}/mieter`);
  antwort.cookies.set(
    COOKIE_NAME,
    baueSitzung({
      name: daten.anzeigename,
      mandant: daten.mandant_id,
      rolle: "mieter",
      mietverhaeltnis: daten.mietverhaeltnis_id,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 86_400,
    },
  );
  return antwort;
}
