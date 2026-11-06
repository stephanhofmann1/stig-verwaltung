import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, query } from "@/lib/db";
import { lieseBeleg } from "@/lib/belegtext";
import { pruefeKostenart } from "@/lib/kostenarten";
import { ablageMarke, legeAb, werteBelegAus } from "@/lib/belege";
import { fuehreZusammen, werteDiktatAus } from "@/lib/diktat";
import { baueEigenbeleg, fehlendeAngaben } from "@/lib/eigenbeleg";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Die Ablage: Beleg hochladen, dazu sprechen, fertig.
 *
 * WOFÜR
 *
 * Für die private Steuerablage. Eine Quittung abfotografieren, einen
 * Satz dazu sagen -- "das war der Pizzaschneider für die Küche, bar
 * bezahlt" -- und der Beleg liegt eingeordnet in der Ablage, ohne ein
 * Formular. Und für den Fall, dass es gar keinen Beleg gibt: dann
 * entsteht aus dem Gesagten ein Eigenbeleg.
 *
 * ZWEI SCHRITTE, NICHT EINER
 *
 * Ein POST mit `uebernehmen=0` (die Vorgabe) liest, wertet aus und gibt
 * einen VORSCHLAG zurück, ohne etwas zu speichern. Erst ein POST mit
 * `uebernehmen=1` schreibt.
 *
 * Das ist nicht Umstand, sondern der Kern: Hier ist ein Sprachmodell im
 * Spiel, und ein Sprachmodell erfindet Zahlen, wenn es sie nicht
 * findet. Ein Beleg, der ohne Blick in die Bücher wandert, wäre genau
 * der Fall, den ich vermeiden will -- er sieht aus wie erledigte
 * Arbeit. Also: zeigen, dann fragen.
 *
 * DIE GEGENPROBE
 *
 * Das Regelwerk (lib/belege.ts) liest den Dokumenttext unabhängig, nur
 * nach Mustern. Bei Betrag und Datum hat es Vorrang, wo es gelesen hat.
 * Weicht die KI ab, wird das als `abweichung` in die Zeile geschrieben
 * -- dann lässt der selbsttätige Abgleich den Beleg liegen, und ein
 * Mensch sieht hin. Siehe lib/diktat.ts.
 */

const MAX_BYTES = 25 * 1024 * 1024;

function nurName(n: string): string {
  return (n.split(/[\\/]/).pop() ?? "beleg").slice(0, 200) || "beleg";
}

export async function POST(req: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  const typ = req.headers.get("content-type") ?? "";
  if (!typ.includes("multipart/form-data")) {
    return NextResponse.json(
      { fehler: "Bitte als Formular senden." },
      { status: 415 },
    );
  }

  const form = await req.formData();
  const uebernehmen = String(form.get("uebernehmen") ?? "") === "1";
  const diktat = String(form.get("diktat") ?? "").slice(0, 4000);

  if (uebernehmen && sitzung.rolle === "lesen") {
    return NextResponse.json(
      { fehler: "Nur Leserecht — ablegen darf diese Rolle nicht." },
      { status: 403 },
    );
  }

  const datei = form.get("datei");
  const hatDatei = datei instanceof File && datei.size > 0;

  if (!hatDatei && diktat.trim().length === 0) {
    return NextResponse.json(
      {
        fehler:
          "Ohne Datei und ohne Angabe gibt es nichts abzulegen. Entweder " +
          "ein Dokument hochladen oder sagen, was bezahlt wurde.",
      },
      { status: 400 },
    );
  }

  let bytes: Buffer | null = null;
  let name = "";
  let dokumenttext = "";
  let ohneTextebene = false;

  if (hatDatei) {
    if (datei.size > MAX_BYTES) {
      return NextResponse.json(
        { fehler: `Die Datei ist größer als ${MAX_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }
    bytes = Buffer.from(await datei.arrayBuffer());
    name = nurName(datei.name);

    // Dieselbe Datei schon in der Ablage? Dann hier abbrechen, bevor
    // ein Sprachmodell gerufen und eine zweite Zeile angelegt wird.
    const dublette = await one<{ id: string; dateiname: string | null }>(
      `SELECT id, dateiname FROM beleg WHERE ablage_pfad LIKE $1`,
      [`%${ablageMarke(bytes)}%`],
    );
    if (dublette) {
      return NextResponse.json(
        {
          fehler:
            "Diese Datei liegt schon in der Ablage" +
            (dublette.dateiname ? ` (als „${dublette.dateiname}")` : "") +
            ".",
          beleg_id: dublette.id,
        },
        { status: 409 },
      );
    }

    const gelesen = await lieseBeleg(bytes);
    dokumenttext = gelesen.text ?? "";
    ohneTextebene = dokumenttext.trim().length < 40;
  }

  const regelwerk = hatDatei
    ? werteBelegAus(dokumenttext, name)
    : { belegdatum: null, betrag_brutto: null, aussteller: null, belegnummer: null };

  const ki = await werteDiktatAus(dokumenttext, diktat);
  if (!ki.ok && ki.code === "kein_schluessel") {
    return NextResponse.json({ fehler: ki.fehler }, { status: 503 });
  }

  const vorschlag = fuehreZusammen(
    { belegdatum: regelwerk.belegdatum, betrag_brutto: regelwerk.betrag_brutto },
    ki.ok ? ki.befund : null,
  );

  // Der Aussteller aus dem Dokument hat Vorrang vor dem aus dem
  // Gesagten -- aus demselben Grund wie bei Betrag und Datum.
  const aussteller = regelwerk.aussteller ?? vorschlag.aussteller;
  // pruefeKostenart gibt die bekannte Kostenart zurueck oder null. Eine
  // erfundene Kostenart der KI faellt damit weg, statt als Freitext in
  // die Spalte zu wandern: Die Abrechnung wertet darauf aus, und ein
  // Tippfehler nimmt die Position lautlos aus der Umlage.
  const kostenart = pruefeKostenart(vorschlag.kostenart)?.schluessel ?? null;

  const antwort = {
    vorschlag: {
      ...vorschlag,
      aussteller,
      kostenart,
      belegnummer: regelwerk.belegnummer ?? null,
      dateiname: hatDatei ? name : null,
      ohne_textebene: ohneTextebene,
    },
    auswertung: ki.ok
      ? { modell: ki.modell, unklar: ki.befund.unklar }
      : { fehler: ki.fehler },
    diktat,
  };

  if (!uebernehmen) return NextResponse.json({ gespeichert: false, ...antwort });

  // ---- ab hier wird geschrieben -------------------------------------

  // Ohne Dokument gibt es nur einen Weg: einen Eigenbeleg. Das ist
  // keine Wahl der Auswertung, sondern eine Tatsache.
  const art = !hatDatei
    ? "eigenbeleg"
    : vorschlag.art === "sonstige" && ohneTextebene
      ? "quittung"
      : vorschlag.art;

  // Ein Eigenbeleg wird nur angelegt, wenn er vollstaendig ist -- auch
  // dann, wenn ein Dokument dabei ist (ein Foto eines handschriftlichen
  // Zettels etwa). Die Datenbank fordert das ohnehin (db/036); ohne die
  // Pruefung hier waere die Antwort ein Serverfehler statt einer
  // Nachfrage. Und ein halber Eigenbeleg liegt in der Ablage, sieht nach
  // Beleg aus und faellt erst in der Pruefung auf.
  const eigen = {
    empfaenger: aussteller ?? "",
    zweck: vorschlag.zweck ?? "",
    datum: vorschlag.belegdatum ?? "",
    betrag: vorschlag.betrag_brutto ?? 0,
    grund: vorschlag.eigenbeleg_grund ?? "",
    erstellt_von: sitzung.name,
    erstellt_am: new Date().toISOString().slice(0, 10),
    ...(vorschlag.gezahlt_mit ? { gezahlt_mit: vorschlag.gezahlt_mit } : {}),
  };
  if (art === "eigenbeleg") {
    const fehlt = fehlendeAngaben(eigen);
    if (fehlt.length > 0) {
      return NextResponse.json(
        {
          fehler:
            (hatDatei
              ? "Das ist ein Eigenbeleg, und dem fehlen noch Angaben: "
              : "Ohne Dokument entsteht ein Eigenbeleg, und dem fehlen noch Angaben: ") +
            `${fehlt.join(", ")}. Bitte dazusagen.`,
          offen: fehlt,
          ...antwort,
        },
        { status: 422 },
      );
    }
  }

  let pfad: string;
  let dateiname: string;
  if (!hatDatei) {
    const pdf = await baueEigenbeleg(eigen);
    dateiname = `eigenbeleg_${eigen.datum}_${eigen.betrag.toFixed(2)}.pdf`;
    pfad = await legeAb(pdf, dateiname);
  } else {
    dateiname = name;
    pfad = await legeAb(bytes!, name);
  }

  const notiz = [
    `Über die Ablage eingetragen von ${sitzung.name}.`,
    diktat.trim() ? `Gesagt: „${diktat.trim()}"` : null,
    vorschlag.quelle.length > 0 ? vorschlag.quelle.join("; ") + "." : null,
    ki.ok ? `Ausgewertet mit ${ki.modell}.` : `Ohne Auswertung: ${ki.fehler}`,
    !hatDatei ? "Kein Fremdbeleg vorhanden; Eigenbeleg erzeugt." : null,
  ]
    .filter(Boolean)
    .join(" ");

  const [b] = await query<{ id: string }>(
    `INSERT INTO beleg (art, richtung, aussteller, belegnummer, belegdatum,
                        betrag_brutto, dateiname, ablage_pfad, notizen,
                        kostenart, zweck, eigenbeleg_grund, erstellt_von,
                        abweichung)
     VALUES ($1,'eingang',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      art,
      aussteller,
      regelwerk.belegnummer ?? null,
      vorschlag.belegdatum,
      vorschlag.betrag_brutto,
      dateiname,
      pfad,
      notiz,
      kostenart,
      vorschlag.zweck,
      art === "eigenbeleg" ? eigen.grund : null,
      sitzung.name,
      vorschlag.abweichung,
    ],
  );

  return NextResponse.json({ gespeichert: true, beleg_id: b.id, ...antwort });
}

/** Was in der Ablage liegt -- die letzten 60. */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const belege = await query(`
    SELECT id, art, aussteller, zweck, belegdatum::text, betrag_brutto::text,
           dateiname, kostenart, abweichung, erstellt_von,
           angelegt_am::text
      FROM beleg
     WHERE richtung = 'eingang'
     ORDER BY angelegt_am DESC
     LIMIT 60
  `);
  return NextResponse.json({ belege });
}
