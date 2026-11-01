import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { sendeEntwurf, verwirfEntwurf } from "@/lib/versand";


type Ctx = { params: Promise<{ id: string }> };

/** Entwurfstext ändern, bevor er freigegeben wird. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as { koerper?: string; betreff?: string };

  const felder: string[] = [];
  const werte: unknown[] = [id];
  if (typeof body.koerper === "string") {
    werte.push(body.koerper);
    felder.push(`koerper_text = $${werte.length}`);
  }
  if (typeof body.betreff === "string") {
    werte.push(body.betreff);
    felder.push(`betreff = $${werte.length}`);
  }
  if (felder.length === 0) {
    return NextResponse.json({ fehler: "nichts zu ändern" }, { status: 400 });
  }
  // Sobald ein Mensch den Text anfasst, gilt er als von ihm verfasst.
  felder.push(`verfasst_von = 'mensch'`);

  const rows = await query(
    `UPDATE nachricht SET ${felder.join(", ")}
      WHERE id = $1 AND status = 'entwurf'
      RETURNING id`,
    werte,
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { fehler: "Entwurf nicht gefunden oder schon versendet" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}

/** Freigeben und senden. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await sendeEntwurf(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

/** Verwerfen. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await verwirfEntwurf(id);
  return NextResponse.json({ ok: true });
}
