import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { query } from "@/lib/db";
import { lieseBeleg } from "@/lib/belegtext";
import { werteBelegAus } from "@/lib/belege";
import { liesWiderspruch, widerspruch } from "@/lib/gegenprobe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Abgelegte Belege mit den heutigen Regeln neu lesen.
 *
 * WOFÜR
 *
 * Das Regelwerk wird besser, und die abgelegten Belege werden es nicht
 * mit. Was beim Einliefern falsch gelesen wurde, bleibt falsch gelesen
 * -- die Datei liegt auf der Platte, die Regel ist repariert, und es
 * gab keinen Weg, die eine auf die andere anzuwenden.
 *
 * Am 07.11.2026 stand das in Zahlen da: 19 Belege trugen einen
 * Widerspruchsvermerk aus der Gegenprobe, und alle 19 waren nach den
 * heutigen Regeln widerspruchsfrei. Weil ein Beleg mit Vermerk vom
 * selbsttätigen Abgleich bewusst nicht angenommen wird, hingen daran
 * 43 offene Amazon-Zahlungen -- und zwar solche, die ihre Bestellnummer
 * im Verwendungszweck tragen, also den verlässlichsten Treffer, den
 * der Abgleich kennt.
 *
 * Das ist das dritte Mal, dass dasselbe fehlt: Eine verbesserte Regel
 * räumt nicht auf, was die alte angerichtet hat. Für eine ganze
 * Lieferung gibt es die Rücknahme, für den Bestand der Zuordnungen die
 * Prüfung -- und jetzt für den einzelnen Beleg das Nachlesen.
 *
 * WIE DER WIDERSPRUCH AUFGELÖST WIRD
 *
 * Nicht dadurch, dass der Vermerk verschwindet. Dafür braucht es den
 * zweiten Zeugen zurück: `liesWiderspruch` holt die zugelieferten Werte
 * aus dem gespeicherten Vermerk. Stimmt die neue Lesung mit ihnen
 * überein, hat der Beleg wieder zwei Zeugen -- die Zeile wird auf die
 * neuen Werte gesetzt und der Vermerk entfernt. Stimmen sie weiter
 * nicht, wird der Vermerk mit dem FRISCHEN Vergleich überschrieben und
 * bleibt stehen.
 *
 * Einen Vermerk ohne zweiten Zeugen löst diese Route NICHT auf. Ein
 * Vermerk, den niemand bestätigt, verschwindet sonst nur deshalb, weil
 * das Regelwerk heute etwas anderes sagt als vorgestern -- und das ist
 * kein Beweis, sondern eine zweite Meinung.
 *
 * ZWEI SCHRITTE
 *
 * Ohne `aendern=1` wird nur gelesen und berichtet. Diese Route hebt
 * Belege in den Zustand, aus dem der selbsttätige Abgleich wieder in
 * das Hauptbuch schreiben darf. Das soll man vorher sehen können.
 */

interface Zeile {
  id: string;
  dateiname: string | null;
  aussteller: string | null;
  ablage_pfad: string | null;
  belegdatum: string | null;
  betrag_brutto: string | null;
  abweichung: string | null;
}

interface Befund {
  beleg_id: string;
  dateiname: string | null;
  aussteller: string | null;
  alt: { betrag: number | null; datum: string | null };
  neu: { betrag: number | null; datum: string | null };
  beifuegung: { betrag: number | null; datum: string | null } | null;
  /** 'aufgeloest' | 'bleibt' | 'ohne_zweiten_zeugen' | 'unlesbar' | 'gleich' */
  ergebnis: string;
  hinweis?: string;
}

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const aendern = String(form?.get("aendern") ?? "") === "1";
  const nurEiner = String(form?.get("beleg_id") ?? "").trim();

  if (aendern && sitzung.rolle === "lesen") {
    return NextResponse.json(
      { fehler: "Nur Leserecht — ändern darf diese Rolle nicht." },
      { status: 403 },
    );
  }

  const zeilen = nurEiner
    ? await query<Zeile>(
        `SELECT id, dateiname, aussteller, ablage_pfad, belegdatum::text,
                betrag_brutto::text, abweichung
           FROM beleg WHERE id = $1`,
        [nurEiner],
      )
    : await query<Zeile>(
        `SELECT id, dateiname, aussteller, ablage_pfad, belegdatum::text,
                betrag_brutto::text, abweichung
           FROM beleg
          WHERE abweichung IS NOT NULL
            AND ablage_pfad IS NOT NULL
          ORDER BY belegdatum DESC NULLS LAST`,
      );

  const befunde: Befund[] = [];
  let aufgeloest = 0;

  for (const z of zeilen) {
    const alt = {
      betrag: z.betrag_brutto === null ? null : Number(z.betrag_brutto),
      datum: z.belegdatum,
    };
    const beifuegung = liesWiderspruch(z.abweichung);

    let text: string;
    try {
      const d = await lieseBeleg(await readFile(z.ablage_pfad!));
      text = d.text ?? "";
    } catch (e) {
      befunde.push({
        beleg_id: z.id,
        dateiname: z.dateiname,
        aussteller: z.aussteller,
        alt,
        neu: { betrag: null, datum: null },
        beifuegung,
        ergebnis: "unlesbar",
        hinweis: `Die abgelegte Datei ist nicht lesbar: ${(e as Error).message}`,
      });
      continue;
    }

    const f = werteBelegAus(text, z.dateiname ?? "");
    const neu = { betrag: f.betrag_brutto, datum: f.belegdatum };

    if (!beifuegung) {
      befunde.push({
        beleg_id: z.id,
        dateiname: z.dateiname,
        aussteller: z.aussteller,
        alt,
        neu,
        beifuegung: null,
        ergebnis: "ohne_zweiten_zeugen",
        hinweis:
          "Aus dem Vermerk lassen sich keine zugelieferten Werte " +
          "zurücklesen. Ohne zweiten Zeugen bleibt der Vermerk stehen.",
      });
      continue;
    }

    const frisch = widerspruch(neu, beifuegung);

    if (frisch === null) {
      befunde.push({
        beleg_id: z.id,
        dateiname: z.dateiname,
        aussteller: z.aussteller,
        alt,
        neu,
        beifuegung,
        ergebnis: "aufgeloest",
      });
      aufgeloest += 1;
      if (aendern) {
        // Die Zeile bekommt die neuen Werte: Beim Einliefern wurde die
        // Lesung des Regelwerks gespeichert, und das war die falsche.
        await query(
          `UPDATE beleg
              SET belegdatum = COALESCE($2::date, belegdatum),
                  betrag_brutto = COALESCE($3::numeric, betrag_brutto),
                  abweichung = NULL,
                  notizen = concat_ws(' ', notizen,
                    $4::text)
            WHERE id = $1`,
          [
            z.id,
            neu.datum,
            neu.betrag,
            `Am ${new Date().toISOString().slice(0, 10)} von ${sitzung.name} ` +
              `mit den heutigen Regeln neu gelesen; der Widerspruch ` +
              `(${z.abweichung}) ist damit aufgelöst.`,
          ],
        );
      }
      continue;
    }

    befunde.push({
      beleg_id: z.id,
      dateiname: z.dateiname,
      aussteller: z.aussteller,
      alt,
      neu,
      beifuegung,
      ergebnis: "bleibt",
      hinweis: frisch,
    });
    if (aendern && frisch !== z.abweichung) {
      // Der Vermerk wird frisch geschrieben: Er soll den heutigen
      // Vergleich nennen, nicht den von vorgestern.
      await query(`UPDATE beleg SET abweichung = $2 WHERE id = $1`, [
        z.id,
        frisch,
      ]);
    }
  }

  return NextResponse.json({
    geaendert: aendern,
    geprueft: befunde.length,
    aufgeloest,
    bleibt: befunde.filter((b) => b.ergebnis === "bleibt").length,
    ohne_zweiten_zeugen: befunde.filter(
      (b) => b.ergebnis === "ohne_zweiten_zeugen",
    ).length,
    unlesbar: befunde.filter((b) => b.ergebnis === "unlesbar").length,
    befunde,
  });
}
