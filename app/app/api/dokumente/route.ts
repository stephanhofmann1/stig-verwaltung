import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one } from "@/lib/db";
import {
  dokumenteFuer,
  darfSchreiben,
  istArt,
  pruefeDatei,
  sichererDateiname,
  speichere,
  GRENZE_BYTES,
  type Bezug,
} from "@/lib/dokumente";

export const dynamic = "force-dynamic";

/**
 * Dokumente hochladen und auflisten.
 *
 * Was hier hereinkommt, wird am Inhalt geprüft und nicht am Namen (siehe
 * lib/dokumente.ts). Der Dateiname des Hochladenden wird nur angezeigt; der
 * Name auf der Platte ist der Hash des Inhalts.
 *
 * Nur für die Verwaltung. Ein Mieterzugang hat hier nichts zu suchen -- und
 * wer nur lesen darf, lädt nichts hoch.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Genau ein Bezug, und der muss es wirklich geben.
 *
 * Die Prüfung auf Vorhandensein ist nicht Höflichkeit: Ohne sie legt ein
 * vertippter Schlüssel ein Dokument an, das an nichts hängt und auf keiner
 * Seite mehr auftaucht. Und sie läuft über query() -- damit sieht sie nur
 * Zeilen des eigenen Mandanten, eine fremde Einheit ist nicht vorhanden.
 */
async function bezugPruefen(
  form: FormData,
): Promise<{ bezug: Bezug } | { fehler: string; status: number }> {
  const felder: [keyof Bezug, string][] = [
    ["objekt_id", "objekt"],
    ["einheit_id", "einheit"],
    ["mietverhaeltnis_id", "mietverhaeltnis"],
  ];

  const gesetzt = felder
    .map(([feld, tabelle]) => ({
      feld,
      tabelle,
      wert: String(form.get(feld) ?? "").trim(),
    }))
    .filter((f) => f.wert !== "");

  if (gesetzt.length === 0) {
    return {
      fehler:
        "Es fehlt der Bezug: objekt_id, einheit_id oder mietverhaeltnis_id.",
      status: 400,
    };
  }
  if (gesetzt.length > 1) {
    return {
      fehler:
        "Ein Dokument hängt an genau einer Stelle. Mehrere Bezüge zugleich " +
        "nimmt diese Schnittstelle nicht an.",
      status: 400,
    };
  }

  const { feld, tabelle, wert } = gesetzt[0];
  if (!UUID.test(wert)) {
    return { fehler: `${feld} ist keine Kennung.`, status: 400 };
  }

  // Tabellenname aus der festen Liste oben, nie aus der Anfrage.
  const da = await one<{ id: string }>(
    `SELECT id FROM ${tabelle} WHERE id = $1`,
    [wert],
  );
  if (!da) {
    return { fehler: `${tabelle}: nicht gefunden.`, status: 404 };
  }

  return { bezug: { [feld]: wert } as Bezug };
}

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || !darfSchreiben(sitzung.rolle)) {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const typ = req.headers.get("content-type") ?? "";
  if (!typ.includes("multipart/form-data")) {
    return NextResponse.json(
      { fehler: "Erwartet wird ein Formular mit Datei (multipart/form-data)." },
      { status: 415 },
    );
  }

  const form = await req.formData();
  const datei = form.get("datei");
  if (!(datei instanceof File) || datei.size === 0) {
    return NextResponse.json({ fehler: "Keine Datei erhalten." }, { status: 400 });
  }

  // Vor dem Lesen: Eine 300-MB-Datei soll nicht erst im Speicher landen.
  if (datei.size > GRENZE_BYTES) {
    return NextResponse.json(
      {
        fehler:
          `Die Datei ist ${(datei.size / 1024 / 1024).toFixed(1)} MB groß. ` +
          `Mehr als ${GRENZE_BYTES / 1024 / 1024} MB werden nicht angenommen.`,
      },
      { status: 413 },
    );
  }

  const bezug = await bezugPruefen(form);
  if ("fehler" in bezug) {
    return NextResponse.json({ fehler: bezug.fehler }, { status: bezug.status });
  }

  const artRoh = String(form.get("art") ?? "sonstige").trim();
  if (!istArt(artRoh)) {
    return NextResponse.json(
      { fehler: `Unbekannte Art: ${artRoh}` },
      { status: 400 },
    );
  }

  const inhalt = new Uint8Array(await datei.arrayBuffer());
  const geprueft = pruefeDatei(inhalt, datei.name ?? "");
  if (!geprueft.ok) {
    return NextResponse.json({ fehler: geprueft.fehler }, { status: 415 });
  }

  const bezeichnung =
    String(form.get("bezeichnung") ?? "").trim().slice(0, 200) || null;
  const sichtbar = ["1", "on", "true", "ja"].includes(
    String(form.get("mieter_sichtbar") ?? "").toLowerCase(),
  );

  const neu = await speichere({
    bezug: bezug.bezug,
    art: artRoh,
    bezeichnung,
    mieterSichtbar: sichtbar,
    dateiname: sichererDateiname(datei.name ?? ""),
    inhalt,
    mime: geprueft.mime,
    endung: geprueft.endung,
  });

  return NextResponse.json({
    ok: true,
    id: neu.id,
    mime_typ: geprueft.mime,
    // Der Hochladende soll erfahren, wenn die Endung nicht zum Inhalt
    // passte -- meist ist dann die falsche Datei ausgewählt.
    hinweis: geprueft.endungPasstNicht
      ? `Die Datei heißt "${datei.name}", ist aber nach ihrem Inhalt ` +
        `${geprueft.mime}. Geführt wird sie nach dem Inhalt.`
      : undefined,
  });
}

/** Die Dokumente zu einem Bezug. Ohne Pfade -- die bleiben im Server. */
export async function GET(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const bezug: Bezug = {
    objekt_id: p.get("objekt_id"),
    einheit_id: p.get("einheit_id"),
    mietverhaeltnis_id: p.get("mietverhaeltnis_id"),
  };
  for (const wert of Object.values(bezug)) {
    if (wert && !UUID.test(wert)) {
      return NextResponse.json({ fehler: "keine Kennung" }, { status: 400 });
    }
  }
  if (!bezug.objekt_id && !bezug.einheit_id && !bezug.mietverhaeltnis_id) {
    return NextResponse.json({ fehler: "Bezug fehlt" }, { status: 400 });
  }

  return NextResponse.json({ dokumente: await dokumenteFuer(bezug) });
}
