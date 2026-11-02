import { NextResponse } from "next/server";
import { leseCsv } from "@/lib/kontoimport";
import { liesKontoauszug, UnbekanntesFormat } from "@/lib/kontoformate";
import { tx, one, query } from "@/lib/db";
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
  // Vorschau statt Schreiben. Standard ist schreiben -- wer das Flag nicht
  // kennt, bekommt das alte Verhalten.
  let nurPruefen = false;
  let dateiname: string | null = null;

  if (typ.includes("multipart/form-data") || typ.includes("form-urlencoded")) {
    const form = await req.formData();
    const datei = form.get("datei");
    if (datei instanceof File) {
      rohe = Buffer.from(await datei.arrayBuffer());
      dateiname = datei.name || null;
    } else if (typeof datei === "string") {
      rohe = Buffer.from(datei, "utf8");
    } else {
      return NextResponse.json({ fehler: "Keine Datei erhalten" }, { status: 400 });
    }
    kontoBezeichnung = String(form.get("konto") ?? "").trim();
    nurPruefen = String(form.get("pruefen") ?? "") === "1";
  } else {
    const body = (await req.json().catch(() => null)) as
      | { csv?: string; konto?: string; pruefen?: boolean }
      | null;
    if (!body) {
      return NextResponse.json({ fehler: "Koerper nicht lesbar" }, { status: 400 });
    }
    rohe = Buffer.from(body.csv ?? "", "utf8");
    kontoBezeichnung = (body.konto ?? "").trim();
    nurPruefen = body.pruefen === true;
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
  let abgeschnitten = false;
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
    abgeschnitten = l.abgeschnitten;
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

  // --- Vorschau ------------------------------------------------------------
  //
  // Ein Kontoauszug entscheidet spaeter darueber, wer eine Mahnung bekommt.
  // Deshalb gibt es den Weg, ihn zu lesen, ohne ihn zu schreiben: erst
  // ansehen, was erkannt wurde, dann uebernehmen. Hier wird nichts
  // veraendert -- kein INSERT, keine Zuordnung.
  if (nurPruefen) {
    return NextResponse.json({
      vorschau: true,
      format,
      kodierung,
      zeitraum,
      gelesen: buchungen.length,
      uebersprungen,
      warnungen,
      // Ein paar echte Zeilen zum Nachsehen. Die Warnung im Rueckfall-Fall
      // sagt "Betraege und Buchungstage bitte an ein paar Zeilen
      // nachsehen" -- dann muessen die Zeilen auch sichtbar sein.
      proben: buchungen.slice(0, 8).map((b) => ({
        buchungstag: b.buchungstag,
        betrag: b.betrag,
        absender: b.absender,
        verwendungszweck: (b.verwendungszweck ?? "").slice(0, 80),
      })),
      summe: buchungen
        .reduce((s, b) => s + Number(b.betrag), 0)
        .toFixed(2),
    });
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

  // --- Importprotokoll ----------------------------------------------------
  //
  // Die Warnungen gab es bisher nur einmal, in der Antwort auf diesen
  // Aufruf. Wer sie wegklickt, konnte sie nicht wiederfinden -- und bei
  // einem abgeschnittenen Volksbank-Export entscheidet genau diese
  // Warnung darüber, ob die Buchhaltung vollständig ist. Sie gehört
  // deshalb in die Datenbank, im Wortlaut.
  //
  // Der Eintrag darf den Import nicht scheitern lassen: Die Buchungen
  // sind an dieser Stelle schon geschrieben, und ein fehlendes Protokoll
  // ist das kleinere Übel als ein Fehler, der wie ein fehlgeschlagener
  // Import aussieht.
  await query(
    `INSERT INTO auszug_import
       (konto_id, dateiname, format, kodierung, zeitraum_von, zeitraum_bis,
        gelesen, neu, bereits_bekannt, warnungen, abgeschnitten, geraten)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [konto.id, dateiname, format, kodierung,
     zeitraum?.von ?? null, zeitraum?.bis ?? null,
     buchungen.length, neu, bekannt, warnungen,
     abgeschnitten, format === "unbekannt"],
  ).catch((e) => {
    console.error("[import] Protokolleintrag fehlgeschlagen:", (e as Error).message);
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
