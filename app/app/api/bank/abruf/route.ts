import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { starteAbruf } from "@/lib/fints/interaktiv";

export const dynamic = "force-dynamic";

/** Startet einen Abruf von Hand. Nur für Verwalter. */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const form = await req.formData();
  const id = String(form.get("zugang") ?? "");
  if (!id) return NextResponse.json({ fehler: "Zugang fehlt" }, { status: 400 });
  return NextResponse.json(await starteAbruf(id));
}
