import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, query } from "@/lib/db";
import { lieseBeleg } from "@/lib/belegtext";
import {
  ergaenzeMitModell,
  findeKontobewegung,
  legeAb,
  leseZahl,
  werteBelegAus,
  ablagePfad,
  type BelegBefund,
} from "@/lib/belege";
import {
  offeneAusgaben,
  schlageBelegeVor,
  uebernehmeSichereBelege,
} from "@/lib/belegabgleich";

export const dynamic = "force-dynamic";

/**
 * Belege hochladen -- in zwei Schritten, wie der Kontoauszug.
 *
 * Erst lesen und zeigen, was erkannt wurde, dann übernehmen. Dazwischen
 * kann jedes Feld von Hand geändert werden. Der Grund ist derselbe wie
 * beim Auszug: Aus diesen Zahlen entsteht die Buchführung. Ein falsch
 * gelesener Betrag fällt später niemandem mehr auf, weil ihn niemand
 * nachrechnet -- er muss hier auffallen, vor dem Speichern.
 *
 * Stufe 1 ist das Regelwerk in lib/belege.ts und läuft immer. Stufe 2
 * (Sprachmodell) ergänzt nur, was Stufe 1 offen gelassen hat, bekommt nur
 * den extrahierten Text und nie die Datei, und ist ohne
 * ANTHROPIC_API_KEY einfach nicht da.
 *
 * Ein Foto einer Quittung hat keine Textebene. Es wird abgelegt und als
 * "nicht auslesbar" gekennzeichnet; die Felder trägt dann ein Mensch ein.
 * Zeichen zu erraten wäre hier der falsche Dienst.
 */

/** 25 MB je Datei. Darüber ist es kein Beleg, sondern ein Versehen. */
const GRENZE_BYTES = 25 * 1024 * 1024;
const MAX_DATEIEN = 20;

interface Felder {
  dateiname: string;
  aussteller?: string | null;
  belegnummer?: string | null;
  belegdatum?: string | null;
  betrag_brutto?: number | string | null;
}

function sauberName(n: string): string {
  const basis = n.split(/[\\/]/).pop() ?? "beleg";
  return basis.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "beleg";
}

function text(w: unknown, max: number): string | null {
  if (typeof w !== "string") return null;
  const s = w.trim();
  return s ? s.slice(0, max) : null;
}

/** Nur was geprüft ist, geht in die Spalte. Rest bleibt leer. */
function pruefeEingabe(f: Felder): {
  befund: Pick<BelegBefund, "aussteller" | "belegnummer" | "belegdatum" | "betrag_brutto">;
  fehler: string | null;
} {
  const datum = text(f.belegdatum, 10);
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return { befund: leer(), fehler: "Belegdatum bitte als JJJJ-MM-TT." };
  }
  let betrag: number | null = null;
  if (f.betrag_brutto !== null && f.betrag_brutto !== undefined && f.betrag_brutto !== "") {
    const z = zahlAusEingabe(f.betrag_brutto);
    if (z === null) {
      return {
        befund: leer(),
        fehler:
          "Betrag nicht eindeutig lesbar. Bitte als 1234,56 oder 1.234,56 " +
          "eintragen.",
      };
    }
    betrag = z;
  }
  return {
    befund: {
      aussteller: text(f.aussteller, 120),
      belegnummer: text(f.belegnummer, 60),
      belegdatum: datum,
      betrag_brutto: betrag,
    },
    fehler: null,
  };
}

/**
 * Betrag aus einem Eingabefeld.
 *
 * Erst der strenge Leser aus lib/belege.ts -- der lehnt alles ab, was
 * zweideutig ist. Nur die handgetippten Kurzformen ("126,5", "126.5")
 * kommen danach noch durch; sie sind eindeutig, weil nur ein Trennzeichen
 * mit höchstens zwei Stellen dahinter steht.
 */
function zahlAusEingabe(w: number | string): number | null {
  if (typeof w === "number") {
    return Number.isFinite(w) && w > 0 ? Math.round(w * 100) / 100 : null;
  }
  const s = w.trim().replace(/\s|€|EUR/gi, "");
  const streng = leseZahl(s);
  if (streng !== null) return streng;
  if (/^\d+[.,]\d{1,2}$/.test(s)) {
    const z = Number(s.replace(",", "."));
    return Number.isFinite(z) && z > 0 ? Math.round(z * 100) / 100 : null;
  }
  return null;
}

function leer() {
  return {
    aussteller: null,
    belegnummer: null,
    belegdatum: null,
    betrag_brutto: null,
  };
}

export async function POST(req: Request) {
  // Die Middleware (proxy.ts) deckt den Pfad ab. Hier wird trotzdem selbst
  // geprüft: Eine Route, die Dateien auf die Platte schreibt und Zeilen in
  // die Buchhaltung legt, soll nicht davon abhängen, dass eine andere
  // Datei richtig konfiguriert bleibt.
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const typ = req.headers.get("content-type") ?? "";
  if (!typ.includes("multipart/form-data")) {
    return NextResponse.json(
      { fehler: "Bitte als Formular mit Dateien senden." },
      { status: 415 },
    );
  }

  const form = await req.formData();
  const nurPruefen = String(form.get("pruefen") ?? "") === "1";

  if (!nurPruefen && sitzung.rolle === "lesen") {
    return NextResponse.json(
      { fehler: "Nur Leserecht — Belege übernehmen darf diese Rolle nicht." },
      { status: 403 },
    );
  }

  const rohe = [...form.getAll("dateien"), ...form.getAll("datei")].filter(
    (d): d is File => d instanceof File && d.size > 0,
  );
  if (rohe.length === 0) {
    return NextResponse.json({ fehler: "Keine Datei erhalten" }, { status: 400 });
  }
  if (rohe.length > MAX_DATEIEN) {
    return NextResponse.json(
      { fehler: `Höchstens ${MAX_DATEIEN} Dateien auf einmal.` },
      { status: 400 },
    );
  }

  let eingaben: Felder[] = [];
  if (!nurPruefen) {
    const roh = form.get("felder");
    try {
      eingaben = JSON.parse(String(roh ?? "[]")) as Felder[];
    } catch {
      return NextResponse.json({ fehler: "felder ist kein JSON" }, { status: 400 });
    }
    if (!Array.isArray(eingaben) || eingaben.length !== rohe.length) {
      return NextResponse.json(
        {
          fehler:
            "Zu den Dateien fehlen die geprüften Felder. Bitte erneut lesen " +
            "und dann übernehmen.",
        },
        { status: 400 },
      );
    }
  }

  // --- Vorschau: lesen, nichts schreiben ----------------------------------
  if (nurPruefen) {
    const ausgaben = await offeneAusgaben();
    const dateien = [];

    for (const d of rohe) {
      const name = sauberName(d.name);
      if (d.size > GRENZE_BYTES) {
        dateien.push({
          dateiname: name,
          groesse_bytes: d.size,
          abgelehnt: `Größer als 25 MB (${(d.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        continue;
      }
      const bytes = Buffer.from(await d.arrayBuffer());
      const gelesen = await lieseBeleg(bytes);

      // Der Dateityp wird am Inhalt entschieden, nicht an der Endung.
      if (gelesen.art === "unbekannt") {
        dateien.push({
          dateiname: name,
          groesse_bytes: bytes.length,
          abgelehnt:
            "Der Inhalt ist weder ein PDF noch ein Bild — unabhängig davon, " +
            "was die Dateiendung sagt.",
        });
        continue;
      }

      let befund = werteBelegAus(gelesen.text, name);
      if (!gelesen.ohne_textebene) befund = await ergaenzeMitModell(gelesen.text, befund);

      const pfad = ablagePfad(bytes, name);
      const schon = await one<{ id: string }>(
        `SELECT id FROM beleg WHERE ablage_pfad = $1`,
        [pfad],
      );

      dateien.push({
        dateiname: name,
        groesse_bytes: bytes.length,
        art: gelesen.art,
        seiten: gelesen.seiten,
        ohne_textebene: gelesen.ohne_textebene,
        lesefehler: gelesen.fehler,
        bereits_vorhanden: schon !== null,
        erkannt: befund,
        // Ein Stück des gelesenen Textes, damit nachvollziehbar ist, woraus
        // die Felder stammen.
        textprobe: gelesen.text.slice(0, 240),
        vorschlag: findeKontobewegung(befund, ausgaben),
        abgelehnt: null,
      });
    }

    return NextResponse.json({
      vorschau: true,
      modell_aktiv: Boolean(process.env.ANTHROPIC_API_KEY),
      dateien,
    });
  }

  // --- Übernehmen ---------------------------------------------------------
  const gespeichert: Array<{
    dateiname: string;
    beleg_id: string;
    aussteller: string | null;
    belegnummer: string | null;
    belegdatum: string | null;
    betrag_brutto: number | null;
  }> = [];
  const abgelehnt: Array<{ dateiname: string; grund: string }> = [];

  for (let i = 0; i < rohe.length; i++) {
    const d = rohe[i];
    const name = sauberName(d.name);
    const eingabe = eingaben[i];

    if (!eingabe || sauberName(eingabe.dateiname ?? "") !== name) {
      abgelehnt.push({
        dateiname: name,
        grund:
          "Die geprüften Felder gehören zu einer anderen Datei. Bitte erneut lesen.",
      });
      continue;
    }
    if (d.size > GRENZE_BYTES) {
      abgelehnt.push({ dateiname: name, grund: "Größer als 25 MB." });
      continue;
    }

    const bytes = Buffer.from(await d.arrayBuffer());
    const gelesen = await lieseBeleg(bytes);
    if (gelesen.art === "unbekannt") {
      abgelehnt.push({
        dateiname: name,
        grund: "Der Inhalt ist weder ein PDF noch ein Bild.",
      });
      continue;
    }

    const { befund, fehler } = pruefeEingabe(eingabe);
    if (fehler) {
      abgelehnt.push({ dateiname: name, grund: fehler });
      continue;
    }

    const pfad = ablagePfad(bytes, name);
    const schon = await one<{ id: string }>(
      `SELECT id FROM beleg WHERE ablage_pfad = $1`,
      [pfad],
    );
    if (schon) {
      abgelehnt.push({
        dateiname: name,
        grund: "Dieser Beleg liegt schon in der Ablage (gleicher Inhalt).",
      });
      continue;
    }

    try {
      await legeAb(bytes, name);
    } catch (e) {
      abgelehnt.push({
        dateiname: name,
        grund: `Ablage nicht beschreibbar: ${(e as Error).message}`,
      });
      continue;
    }

    // Ein Foto ohne Textebene ist eine Quittung, kein maschinenlesbarer
    // Rechnungsbeleg. Das steht so in der Zeile, damit später erkennbar
    // bleibt, woher die Felder kommen.
    const art = gelesen.ohne_textebene ? "quittung" : "rechnung";
    const notiz = gelesen.ohne_textebene
      ? "Hochgeladen. Keine Textebene — Felder von Hand eingetragen."
      : "Hochgeladen und aus der Textebene ausgelesen, vor dem Speichern geprüft.";

    const [b] = await query<{ id: string }>(
      `INSERT INTO beleg (art, richtung, aussteller, belegnummer, belegdatum,
                          betrag_brutto, dateiname, ablage_pfad, notizen)
       VALUES ($1,'eingang',$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        art,
        befund.aussteller,
        befund.belegnummer,
        befund.belegdatum,
        befund.betrag_brutto,
        name,
        pfad,
        notiz,
      ],
    );

    gespeichert.push({ dateiname: name, beleg_id: b.id, ...befund });
  }

  // Der vorhandene Abgleich entscheidet, nicht die Vorschau von oben.
  const abgleich = await uebernehmeSichereBelege();
  const neu = new Set(gespeichert.map((g) => g.beleg_id));
  const zuordnungen = (await schlageBelegeVor()).filter(
    (v) => v.beleg_id && neu.has(v.beleg_id),
  );

  return NextResponse.json({
    gespeichert,
    abgelehnt,
    abgleich,
    // Was nach dem Abgleich noch offen ist -- genau die Zeilen, die ein
    // Mensch noch anfassen muss.
    zuordnungen,
  });
}
