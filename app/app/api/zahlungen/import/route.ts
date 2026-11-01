import { NextResponse } from "next/server";
import { leseCsv } from "@/lib/kontoimport";
import { liesKontoauszug, UnbekanntesFormat } from "@/lib/kontoformate";
import { tx, one } from "@/lib/db";
import { uebernehmeSichere } from "@/lib/zuordnung";

export const dynamic = "force-dynamic";

/**
 * Nimmt einen Kontoauszug entgegen und legt die Buchungen ab.
 * Doppelte Zeilen werden ueber den Fingerabdruck abgefangen, der Auszug
 * darf also gefahrlos mehrfach hochgeladen werden.
 *
 * Gelesen wird als **Bytes**, nicht als Text. Das ist kein Detail: Die
 * Sparkassen- und die ING-CSV sind cp1252. `File.text()` dekodiert immer
 * als UTF-8 und macht aus jedem Umlaut ein Ersatzzeichen -- der Name
 * passt dann zu keinem Mieter mehr, und die Zahlung bleibt liegen.
 *
 * Fuer die vier bekannten Formate gibt es den genauen Leser
 * (lib/kontoformate.ts). Nur wenn keines passt, uebernimmt der allgemeine
 * CSV-Leser, der die Spalten anhand ihrer Ueberschriften errät -- dann
 * aber mit ausdruecklichem Hinweis darauf in der Antwort.
 */
export async function POST(req: Request) {
  // Den Koerper darf man nur einmal lesen -- also vorher am Content-Type
  // entscheiden, statt formData() zu probieren und auf json() auszuweichen.
  const typ = req.headers.get("content-type") ?? "";
  let rohe: Buffer;
  let kontoBezeichnung: string;

  if (typ.includes("multipart/form-data") || typ.includes("form-urlencoded")) {
    const form = await req.formData();
    const datei = form.get("datei");
    if (datei instanceof File) {
      rohe = Buffer.from(await datei.arrayBuffer());
    } else if (typeof datei === "string") {
      rohe = Buffer.from(datei, "utf8");
    } else {
      return NextResponse.json({ fehler: "Keine Datei erhalten" }, { status: 400 });
    }
    kontoBezeichnung = String(form.get("konto") ?? "").trim();
  } else {
    const body = (await req.json().catch(() => null)) as
      | { csv?: string; konto?: string }
      | null;
    if (!body) {
      return NextResponse.json({ fehler: "Koerper nicht lesbar" }, { status: 400 });
    }
    rohe = Buffer.from(body.csv ?? "", "utf8");
    kontoBezeichnung = (body.konto ?? "").trim();
  }

  if (!kontoBezeichnung) {
    return NextResponse.json({ fehler: "Konto fehlt" }, { status: 400 });
  }

  const konto = await one<{ id: string }>(
    `SELECT id FROM konto WHERE bezeichnung = $1`,
    [kontoBezeichnung],
  );
  if (!konto) {
    return NextResponse.json(
      { fehler: `Konto "${kontoBezeichnung}" ist nicht angelegt` },
      { status: 404 },
    );
  }

  // Erst der genaue Leser, dann der allgemeine.
  let format = "unbekannt";
  let kodierung = "?";
  let zeitraum: { von: string; bis: string } | null = null;
  let buchungen;
  let uebersprungen: unknown;
  const warnungen: string[] = [];

  try {
    const l = liesKontoauszug(rohe);
    format = l.format;
    kodierung = l.kodierung;
    zeitraum = l.zeitraum;
    buchungen = l.buchungen;
    uebersprungen = l.uebersprungen;
    warnungen.push(...l.warnungen);
  } catch (e) {
    if (!(e instanceof UnbekanntesFormat)) throw e;
    // Rückfall: Spalten über die Überschriften erraten. Das kann stimmen,
    // muss aber nicht -- deshalb steht es in der Antwort.
    const g = leseCsv(rohe.toString("utf8"));
    buchungen = g.gelesen;
    uebersprungen = g.uebersprungen;
    warnungen.push(
      "Das Format dieser Datei ist keines der vier bekannten. Die Spalten " +
        "wurden anhand ihrer Überschriften erraten und die Datei als UTF-8 " +
        "gelesen. Beträge und Buchungstage bitte an ein paar Zeilen " +
        "nachsehen, bevor darauf gemahnt wird. Erkannt wurde: " +
        JSON.stringify(g.erkannteSpalten),
    );
  }

  let neu = 0;
  let bekannt = 0;

  await tx(async (c) => {
    for (const b of buchungen) {
      const r = await c.query(
        `INSERT INTO buchung (konto_id, buchungstag, valuta, betrag, waehrung,
                              absender, verwendungszweck, fingerabdruck)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (konto_id, fingerabdruck) DO NOTHING
         RETURNING id`,
        [konto.id, b.buchungstag, b.valuta, b.betrag, b.waehrung,
         b.absender, b.verwendungszweck, b.fingerabdruck],
      );
      if (r.rowCount && r.rowCount > 0) neu++; else bekannt++;
    }
  });

  const zuordnung = await uebernehmeSichere();

  return NextResponse.json({
    format,
    kodierung,
    zeitraum,
    gelesen: buchungen.length,
    neu,
    bereits_bekannt: bekannt,
    uebersprungen,
    // Geht in die Antwort und auf die Seite. Jede Warnung hier kann einen
    // puenktlichen Zahler zum Saeumigen machen -- sie darf nicht nur im
    // Log stehen.
    warnungen,
    zuordnung,
  });
}
