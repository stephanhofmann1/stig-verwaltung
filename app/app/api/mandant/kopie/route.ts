import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Die stille Kopie dieses Mandanten setzen.
 *
 * WOFÜR
 *
 * db/037 legt mandant.versand_kopie an, und lib/versand.ts liest die
 * Spalte -- aber niemand konnte sie beschreiben. Eine Spalte ohne
 * Schreibweg ist halbe Arbeit: Die Adresse blieb NULL und damit bei der
 * Umgebung, also genau bei der installationsweiten Einstellung, von der
 * die Spalte wegführen sollte.
 *
 * WARUM EINE EIGENE ROUTE
 *
 * /api/mandant POST legt einen Mandanten an und wechselt hinein.
 * /api/mandant/kopie ändert eine Einstellung des Mandanten, in dem man
 * schon ist. Beides in einen Aufruf zu legen hieße, dass ein Tippfehler
 * im einen Feld den anderen Fall auslösen kann.
 *
 * WARUM NUR DIE VERWALTUNG
 *
 * Die Adresse bekommt eine verdeckte Kopie jeder ausgehenden Mail. Wer
 * sie setzen darf, darf mitlesen -- das ist keine Buchhaltungsaufgabe.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle !== "verwalter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const form = await req.formData();
  const roh = String(form.get("adresse") ?? "").trim();

  // Leer heisst "ausdruecklich keine Kopie" -- nicht "nicht
  // entschieden". Den Unterschied halten db/037 und waehleKopie().
  if (roh !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(roh)) {
    return NextResponse.json(
      {
        fehler:
          "Das ist keine E-Mail-Adresse. Eine Kopie an eine Adresse mit " +
          "Tippfehler kommt lautlos nirgends an — und genau darum geht " +
          "es hier nicht. Leer lassen schaltet die Kopie ab.",
      },
      { status: 400 },
    );
  }

  // Ohne WHERE: Die Policy aus db/010 gibt nur den eigenen Eintrag
  // heraus, also kann dieses UPDATE keinen fremden Mandanten treffen.
  const [geaendert] = await query<{ versand_kopie: string | null }>(
    `UPDATE mandant SET versand_kopie = $1 RETURNING versand_kopie`,
    [roh],
  );
  if (!geaendert) {
    return NextResponse.json(
      { fehler: "Kein Mandant in dieser Sitzung." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, adresse: geaendert.versand_kopie });
}

/** Was derzeit eingetragen ist -- NULL heißt "nicht entschieden". */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const m = await one<{ versand_kopie: string | null }>(
    `SELECT versand_kopie FROM mandant`,
  );
  return NextResponse.json({ adresse: m?.versand_kopie ?? null });
}
