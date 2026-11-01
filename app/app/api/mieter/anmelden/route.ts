import { NextResponse } from "next/server";
import { fordereZugangAn } from "@/lib/mieter";
import { mitMandant } from "@/lib/mandant";
import { sendeSystemmail } from "@/lib/versand";

export const dynamic = "force-dynamic";

/**
 * Fordert einen Anmeldelink an.
 *
 * Antwortet immer gleich — egal, ob die Adresse hinterlegt ist oder nicht.
 * Sonst liesse sich ueber dieses Formular herausfinden, wer wo wohnt, und
 * das Formular ist ohne Anmeldung erreichbar.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = (body?.email ?? "").trim().slice(0, 160);

  const immerGleich = NextResponse.json({
    ok: true,
    hinweis:
      "Wenn diese Adresse bei uns hinterlegt ist, ist der Link unterwegs. " +
      "Er gilt eine Stunde.",
  });

  if (!email.includes("@")) return immerGleich;

  try {
    const zugang = await fordereZugangAn(email);
    if (!zugang) return immerGleich;

    const basis = `https://${process.env.DOMAIN ?? "stig-immobilien.de"}`;
    const link = `${basis}/mieter/einloesen?token=${encodeURIComponent(zugang.token)}`;

    // Der Versand laeuft unter dem Mandanten, damit die Absenderadresse
    // die des jeweiligen Vermieters ist und nicht unsere.
    await mitMandant(zugang.daten.mandant_id, async () => {
      const r = await sendeSystemmail({
        an: email,
        betreff: "Ihr Zugang zum Mieterbereich",
        text: [
          `Hallo ${zugang.daten.anzeigename},`,
          "",
          "hier ist Ihr Zugang zum Mieterbereich:",
          "",
          link,
          "",
          "Der Link gilt eine Stunde und lässt sich einmal verwenden.",
          "Fordern Sie einfach einen neuen an, wenn er abgelaufen ist.",
          "",
          "Haben Sie den Link nicht angefordert, können Sie diese Mail",
          "ignorieren — ohne Klick passiert nichts.",
        ].join("\n"),
      });
      if (!r.ok) console.error("[mieter/anmelden] Versand:", r.fehler);
    });
  } catch (e) {
    // Auch ein Fehler darf nach aussen nichts verraten.
    console.error("[mieter/anmelden]", e);
  }

  return immerGleich;
}
