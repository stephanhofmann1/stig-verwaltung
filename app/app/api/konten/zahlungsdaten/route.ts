import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one } from "@/lib/db";
import { pruefeDatum } from "@/lib/konten";

export const dynamic = "force-dynamic";

/**
 * Setzt `objekt.zahlungsdaten_ab` -- den Beginn der Kontodaten je Objekt.
 *
 * Bis hierhin liess sich dieser Wert nur mit einem UPDATE von Hand
 * aendern. Er ist aber die Abdeckungsgrenze des Mahnwesens, und er wird
 * jedes Mal falsch, wenn Auszuege nachgeladen werden, die weiter
 * zurueckreichen. Ein Wert, der laufend stimmen muss, braucht eine
 * Oberflaeche.
 */
export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter" || sitzung.rolle === "lesen") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const form = await req.formData();
  const objektId = String(form.get("objekt_id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(objektId)) {
    return NextResponse.json({ fehler: "objekt_id fehlt" }, { status: 400 });
  }

  // "aus_buchungen": den ersten Buchungstag nehmen, der fuer dieses Objekt
  // wirklich in der Datenbank liegt. Das ist der Wert, der stimmt -- das
  // Eroeffnungsdatum des Kontos ist es gerade nicht.
  let datum: string | null;
  if (String(form.get("aus_buchungen") ?? "") === "1") {
    const r = await one<{ erste: string | null }>(
      `SELECT min(b.buchungstag)::text AS erste
         FROM buchung b
         JOIN konto k ON k.id = b.konto_id
        WHERE k.objekt_id = $1`,
      [objektId],
    );
    if (!r?.erste) {
      return NextResponse.json(
        {
          fehler:
            "Für dieses Objekt liegen keine Buchungen vor. Erst einen " +
            "Kontoauszug einlesen.",
        },
        { status: 409 },
      );
    }
    datum = r.erste;
  } else {
    const { wert, fehler } = pruefeDatum(String(form.get("datum") ?? ""));
    if (fehler) return NextResponse.json({ fehler }, { status: 400 });
    datum = wert;
  }

  const t = await one<{ name: string }>(
    `UPDATE objekt SET zahlungsdaten_ab = $1 WHERE id = $2 RETURNING name`,
    [datum, objektId],
  );
  if (!t) {
    return NextResponse.json({ fehler: "Objekt unbekannt" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, objekt: t.name, datum });
}
