import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import {
  ALLE,
  KEKS_ALTER,
  KEKS_OBJEKT,
  objekteDesMandanten,
} from "@/lib/objektsicht";

export const dynamic = "force-dynamic";

/**
 * Das betrachtete Objekt umstellen.
 *
 * Anders als beim Mandantenwechsel (app/api/mandant/wechseln) wird hier
 * keine Sitzung neu ausgestellt: Das Objekt ist eine Sicht, kein Recht --
 * die Begruendung steht in lib/objektsicht.ts.
 *
 * Geprueft wird trotzdem, dass die Kennung zu einem Objekt dieses
 * Mandanten gehoert. Nicht aus Sicherheit -- die Zeilensicherheit laesst
 * ohnehin nichts Fremdes durch --, sondern damit im Cookie nichts steht,
 * was spaeter stillschweigend auf die Gesamtschau zurueckfaellt. Ein
 * Umschalter, der etwas annimmt und dann etwas anderes zeigt, ist
 * schlimmer als einer, der ablehnt.
 */
export async function POST(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung) {
    return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
  }
  // Ein Mieterzugang sieht genau eine Wohnung. Es gibt nichts zu waehlen.
  if (sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  let ziel = "";
  try {
    const koerper = await anfrage.json();
    if (koerper && typeof koerper === "object" && typeof koerper.objekt === "string") {
      ziel = koerper.objekt;
    }
  } catch {
    /* unten als fehlender Wert behandelt */
  }
  if (!ziel) {
    return NextResponse.json({ fehler: "Kein Objekt angegeben." }, { status: 400 });
  }

  if (ziel !== ALLE) {
    const objekte = await objekteDesMandanten();
    if (!objekte.some((o) => o.id === ziel)) {
      return NextResponse.json(
        { fehler: "Dieses Objekt gibt es hier nicht." },
        { status: 404 },
      );
    }
  }

  const antwort = NextResponse.json({ ok: true, objekt: ziel });
  antwort.cookies.set(KEKS_OBJEKT, ziel, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: KEKS_ALTER,
  });
  return antwort;
}
