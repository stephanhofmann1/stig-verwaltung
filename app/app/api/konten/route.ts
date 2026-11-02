import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, query } from "@/lib/db";
import { kurzeIban, pruefeArt, pruefeBezeichnung } from "@/lib/konten";

export const dynamic = "force-dynamic";

/**
 * Konten anlegen und wieder entfernen.
 *
 * Bis hierhin gab es keinen Weg, ein Konto anzulegen -- weder ueber die
 * Oberflaeche noch im Import. Damit war der ganze Zahlungsteil nicht
 * erreichbar: Der CSV-Import bricht mit "Konto ist nicht angelegt" ab, und
 * die FinTS-Einrichtung laesst nur unter einem bestehenden Konto anlegen.
 *
 * Nur fuer Verwalter.
 */

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const form = await req.formData();
  const feld = (n: string) => String(form.get(n) ?? "");

  const { wert: bezeichnung, fehler } = pruefeBezeichnung(feld("bezeichnung"));
  if (fehler) return NextResponse.json({ fehler }, { status: 400 });

  const art = pruefeArt(feld("art"));
  if (!art) {
    return NextResponse.json(
      { fehler: 'Art muss "bank" oder "barkasse" sein.' },
      { status: 400 },
    );
  }

  const ibanKurz = kurzeIban(feld("iban_kurz"));
  const objektId = feld("objekt_id").trim() || null;
  const notizen = feld("notizen").trim() || null;

  // Eindeutig ist (mandant_id, bezeichnung) -- siehe db/019. Den Konflikt
  // abfangen und erklaeren, statt einen Datenbankfehler durchzulassen.
  const schon = await one<{ id: string }>(
    `SELECT id FROM konto WHERE bezeichnung = $1`,
    [bezeichnung],
  );
  if (schon) {
    return NextResponse.json(
      { fehler: `Ein Konto "${bezeichnung}" gibt es schon.` },
      { status: 409 },
    );
  }

  const r = await one<{ id: string; bezeichnung: string; iban_kurz: string | null }>(
    `INSERT INTO konto (bezeichnung, objekt_id, art, iban_kurz, notizen)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, bezeichnung, iban_kurz`,
    [bezeichnung, objektId, art, ibanKurz, notizen],
  );

  return NextResponse.json({ ok: true, konto: r });
}

/**
 * Ein Konto entfernen -- aber nur, solange keine Buchung daranhaengt.
 *
 * Der Grund ist nicht Bequemlichkeit, sondern dass ein Tippfehler in der
 * Bezeichnung sonst dauerhaft in der Liste stehen bliebe. Sobald Buchungen
 * daranhaengen, ist das Konto Teil der Buchhaltung und wird nicht mehr
 * geloescht: Dann waere die Zuordnung von Zahlungen mit weg.
 */
export async function DELETE(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ fehler: "id fehlt" }, { status: 400 });
  }

  const anzahl = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM buchung WHERE konto_id = $1`,
    [id],
  );
  if (Number(anzahl?.n ?? 0) > 0) {
    return NextResponse.json(
      {
        fehler:
          `An diesem Konto hängen ${anzahl?.n} Buchungen. Es wird nicht ` +
          "gelöscht — damit die Zuordnung der Zahlungen erhalten bleibt.",
      },
      { status: 409 },
    );
  }

  const zugang = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM fints_zugang WHERE konto_id = $1`,
    [id],
  );
  if (Number(zugang?.n ?? 0) > 0) {
    return NextResponse.json(
      { fehler: "An diesem Konto hängt ein Bankzugang. Erst den entfernen." },
      { status: 409 },
    );
  }

  await query(`DELETE FROM konto WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
