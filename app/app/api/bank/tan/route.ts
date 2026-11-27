import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { loeseTanEin } from "@/lib/fints/interaktiv";

export const dynamic = "force-dynamic";

/**
 * Nimmt eine TAN entgegen und führt den Abruf zu Ende.
 *
 * Die TAN wird nirgends protokolliert und nicht gespeichert. Sie ist nur
 * Minuten gültig und gehört in keine Datenbank und in kein Log.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const tan = String(form.get("tan") ?? "").trim();
  if (!token) {
    return NextResponse.json({ fehler: "Token fehlt" }, { status: 400 });
  }
  /*
    Eine leere TAN ist erlaubt, denn bei Freigabeverfahren (pushTAN 2.0)
    gibt es keine. Ob sie gebraucht wird, entscheidet der offene Dialog
    und nicht dieser Endpunkt -- massgeblich ist, was die Bank erwartet,
    nicht was der Browser schickt.

    Vorher wurde eine leere TAN hier abgewiesen. Damit liess sich ein
    Freigabeverfahren gar nicht abschliessen: Die Oberflaeche verlangte
    eine Ziffer, und mit Ziffer lehnte die Bank die Nachricht ab.
  */
  return NextResponse.json(await loeseTanEin(token, tan || undefined));
}
