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
  if (!token || !tan) {
    return NextResponse.json({ fehler: "Token oder TAN fehlt" }, { status: 400 });
  }
  return NextResponse.json(await loeseTanEin(token, tan));
}
