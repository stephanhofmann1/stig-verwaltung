import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { emailZuMietverhaeltnis } from "@/lib/mieter";
import { mitMandant } from "@/lib/mandant";
import { verarbeiteEingang } from "@/lib/eingang";

export const dynamic = "force-dynamic";

/**
 * Eine Meldung aus dem Mieterbereich — Schaden, Frage, Hinweis.
 *
 * Geht denselben Weg wie eine eingehende Mail: Sie wird zu einem Vorgang,
 * wird eingeordnet, und der Agent schreibt eine Antwort vor. Das ist der
 * ganze Punkt des Umzugs in die Plattform — eine Reparaturmeldung landet
 * nicht in einem Postfach, sondern in der Akte.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle !== "mieter" || !sitzung.mietverhaeltnis) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    betreff?: string;
    text?: string;
  } | null;

  const betreff = (body?.betreff ?? "").trim().slice(0, 140);
  const text = (body?.text ?? "").trim().slice(0, 4000);

  if (text.length < 5) {
    return NextResponse.json(
      { fehler: "Bitte schreiben Sie kurz, worum es geht." },
      { status: 400 },
    );
  }

  // Absender ist der Mieter selbst — damit haengt der Vorgang am richtigen
  // Kontakt und eine Antwort geht an die richtige Adresse.
  const kontakt = await emailZuMietverhaeltnis(sitzung.mietverhaeltnis);
  if (!kontakt) {
    return NextResponse.json(
      { fehler: "Zu diesem Zugang ist keine Adresse hinterlegt." },
      { status: 409 },
    );
  }

  try {
    const ergebnis = await mitMandant(sitzung.mandant, () =>
      verarbeiteEingang({
        von_email: kontakt.email,
        von_name: kontakt.anzeigename,
        an_emails: [],
        betreff: betreff || "Meldung aus dem Mieterbereich",
        koerper_text: `${text}\n\n— über den Mieterbereich gemeldet —`,
        message_id: null,
        empfangen_am: new Date().toISOString(),
      }),
    );

    return NextResponse.json({ ok: true, referenz: ergebnis.vorgang_nummer });
  } catch (e) {
    console.error("[mieter/meldung]", e);
    return NextResponse.json(
      { fehler: "Die Meldung konnte nicht angenommen werden." },
      { status: 500 },
    );
  }
}
