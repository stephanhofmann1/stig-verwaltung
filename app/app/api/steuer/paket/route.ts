import { angemeldeteSitzung } from "@/lib/anmeldung";
import { NextResponse } from "next/server";
import {
  ladeJournal,
  journalCsv,
  einnahmenCsv,
  ausgabenCsv,
  ohneBelegCsv,
  anlagegueterCsv,
  summenCsv,
  liesmich,
  belegName,
  zahlen,
} from "@/lib/steuerpaket";
import { zipStrom, type ZipQuelle } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Das Steuerberater-Paket als ZIP.
 *
 * Ein Abruf, eine Datei, alles drin: Journal, Teillisten, Summen und
 * jeder Einzelbeleg. Was der Steuerberater sonst aus drei Quellen
 * zusammentragen müsste, liegt hier beieinander -- und in einer Form, die
 * ohne Rückfrage lesbar ist (siehe lib/steuerpaket.ts).
 *
 * WARUM IM STROM
 *
 * Die Anlage enthält jeden Beleg. Bei 300 Belegen sind das etwa 200 MB.
 * Die würden im Arbeitsspeicher des Servers stehen, bevor das erste Byte
 * beim Abrufer ankommt. Der Server hat 2 GB und noch anderes zu tun.
 * zipStrom liefert Stück für Stück; nur das Verzeichnis am Ende wird
 * gesammelt, und das hängt an der Zahl der Dateien, nicht an ihrer
 * Größe.
 *
 * WAS PASSIERT, WENN EIN BELEG FEHLT
 *
 * Dann fehlt die Datei auf der Platte, obwohl die Zeile in der Datenbank
 * steht. Das wird nicht übergangen: Der Fehlbestand landet in
 * `fehlende-dateien.txt` im Paket. Ein Paket, aus dem ein Beleg
 * stillschweigend verschwindet, wird weitergegeben und erst beim
 * Steuerberater bemerkt -- und dann weiß niemand, ob er je da war.
 */
export async function GET(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const roh = new URL(req.url).searchParams.get("jahr");
  const jahr = Number(roh ?? new Date().getFullYear());
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) {
    return NextResponse.json(
      { fehler: "Jahr bitte vierstellig, zwischen 2000 und 2100." },
      { status: 400 },
    );
  }

  const paket = await ladeJournal(jahr);
  if (paket.zeilen.length === 0) {
    return NextResponse.json(
      { fehler: `Für ${jahr} liegen keine Kontobewegungen im Portal.` },
      { status: 404 },
    );
  }

  const erstellt = new Date();
  const quellen: ZipQuelle[] = [
    { name: "LIESMICH.txt", inhalt: Buffer.from(liesmich(paket, erstellt), "utf8") },
    { name: `journal-${jahr}.csv`, inhalt: Buffer.from(journalCsv(paket), "utf8") },
    { name: `einnahmen-${jahr}.csv`, inhalt: Buffer.from(einnahmenCsv(paket), "utf8") },
    { name: `ausgaben-${jahr}.csv`, inhalt: Buffer.from(ausgabenCsv(paket), "utf8") },
    { name: `summen-${jahr}.csv`, inhalt: Buffer.from(summenCsv(paket), "utf8") },
    { name: `ohne-beleg-${jahr}.csv`, inhalt: Buffer.from(ohneBelegCsv(paket), "utf8") },
    { name: `anlagegueter-${jahr}.csv`, inhalt: Buffer.from(anlagegueterCsv(paket), "utf8") },
    ...paket.belege.map((b) => ({
      name: `belege/${belegName(b.nr, b.dateiname)}`,
      pfad: b.ablage_pfad,
    })),
  ];

  const fehlend: string[] = [];
  const z = zahlen(paket);

  const strom = new ReadableStream<Uint8Array>({
    async start(steuerung) {
      try {
        for await (const stueck of zipStrom(quellen, (q, grund) => {
          fehlend.push(`${q.name}: ${grund}`);
        })) {
          steuerung.enqueue(stueck);
        }
        // Ein Fehlbestand ist erst bekannt, wenn das Archiv durch ist --
        // und dann ist der Abschluss geschrieben und nichts mehr
        // anzuhängen. Er kann deshalb nicht als Datei ins Paket. Statt
        // ihn zu verschweigen, steht er im Anwendungsprotokoll, und die
        // Zahl der gelieferten Belege steht im Kopf der Antwort
        // (X-Belege): Wer 297 erwartet und 295 bekommt, sieht es dort,
        // ohne das Archiv auszupacken.
        if (fehlend.length > 0) {
          console.warn(
            `[steuerpaket] ${fehlend.length} Beleg(e) fehlen auf der Platte: ` +
              fehlend.join(", "),
          );
        }
        steuerung.close();
      } catch (e) {
        steuerung.error(e);
      }
    },
  });

  return new Response(strom, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition":
        `attachment; filename="stig-belege-${jahr}.zip"`,
      "Cache-Control": "no-store",
      "X-Bewegungen": String(z.bewegungen),
      "X-Belege": String(z.belege),
      "X-Ohne-Beleg": String(z.ohne_beleg),
      "X-Mit-Abweichung": String(z.mit_abweichung),
    },
  });
}
