import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Den Eigenbeleg.
 *
 * WOFÜR
 *
 * Nicht jede Ausgabe bringt eine Rechnung mit. Ein Kauf von einer
 * Privatperson über Kleinanzeigen stellt keine; eine Quittung geht
 * verloren; ein Parkautomat gibt nichts heraus, was ein Steuerberater
 * anfassen kann. Für diesen Fall schreibt man selbst auf, was man
 * bezahlt hat.
 *
 * WAS DRAUFSTEHEN MUSS
 *
 * Ein Eigenbeleg wird nur anerkannt, wenn er vollständig ist. Gefordert
 * sind: der Zahlungsempfänger, die Art der Aufwendung, das Datum der
 * Zahlung, der Betrag, und -- der Punkt, an dem die meisten scheitern --
 * der GRUND, warum kein Fremdbeleg vorliegt. Dazu, wer ihn geschrieben
 * hat und wann. Ohne den Grund ist es ein Zettel; mit ihm ist es ein
 * Beleg.
 *
 * Darum prüft `fehlendeAngaben` zuerst und das Blatt wird nur erzeugt,
 * wenn nichts fehlt. Ein halber Eigenbeleg ist schlimmer als keiner: Er
 * liegt in der Ablage, sieht nach Beleg aus und fällt erst in der
 * Prüfung auf, wenn es zu spät ist, ihn zu ergänzen.
 *
 * WARUM EINE UNTERSCHRIFTSZEILE
 *
 * Weil die Unterschrift des Erstellers zu den geforderten Angaben
 * gehört. In einem System mit Zugangskontrolle und Zeitstempel ist der
 * Eintrag "erstellt von X am Y" das, was an ihre Stelle tritt -- aber
 * ein Steuerberater, der das Blatt in der Hand hält, erwartet eine
 * Linie. Sie kostet nichts und erspart die Diskussion. Das Blatt nennt
 * beides und behauptet nicht, dass die eine die andere ersetzt.
 */

export interface Eigenbeleg {
  /** An wen das Geld ging. */
  empfaenger: string;
  /** Was gekauft wurde, in Worten. Nicht die Kostenart. */
  zweck: string;
  /** Tag der Zahlung, als 2026-03-17. */
  datum: string;
  /** Betrag in Euro, positiv. */
  betrag: number;
  /** Warum kein Fremdbeleg vorliegt. */
  grund: string;
  /** Wer das Blatt geschrieben hat. */
  erstellt_von: string;
  /** Tag der Erstellung, als 2026-11-06. */
  erstellt_am: string;
  /** Wie bezahlt wurde ("PayPal", "bar", "Überweisung"). Freiwillig. */
  gezahlt_mit?: string;
  /** Die Abbuchung, zu der er gehört -- wenn sie bekannt ist. */
  buchungstag?: string;
}

const FELDER: Array<{ schluessel: keyof Eigenbeleg; name: string }> = [
  { schluessel: "empfaenger", name: "Zahlungsempfänger" },
  { schluessel: "zweck", name: "Art der Aufwendung" },
  { schluessel: "datum", name: "Datum der Zahlung" },
  { schluessel: "betrag", name: "Betrag" },
  { schluessel: "grund", name: "Grund für das Fehlen eines Fremdbelegs" },
  { schluessel: "erstellt_von", name: "Ersteller" },
  { schluessel: "erstellt_am", name: "Datum der Erstellung" },
];

/**
 * Was dem Eigenbeleg noch fehlt, in Worten -- leer, wenn er vollständig
 * ist.
 */
export function fehlendeAngaben(e: Partial<Eigenbeleg>): string[] {
  const fehlt: string[] = [];
  for (const f of FELDER) {
    const wert = e[f.schluessel];
    if (f.schluessel === "betrag") {
      if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
        fehlt.push(f.name);
      }
      continue;
    }
    if (typeof wert !== "string" || wert.trim().length === 0) {
      fehlt.push(f.name);
      continue;
    }
    // Ein Grund wie "." oder "keiner" ist keiner. Drei Zeichen sind eine
    // niedrige Huerde, aber sie faengt den Haken, der nur weiterklicken
    // will.
    if (f.schluessel === "grund" && wert.trim().length < 3) fehlt.push(f.name);
  }
  if (e.datum && !/^\d{4}-\d{2}-\d{2}$/.test(e.datum)) {
    fehlt.push("Datum der Zahlung (als Jahr-Monat-Tag)");
  }
  return fehlt;
}

const tag = (iso: string) => {
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
};

const euro = (w: number) =>
  `${w.toFixed(2).replace(".", ",")} EUR`.replace(
    /\B(?=(\d{3})+(?!\d),)/g,
    ".",
  );

/**
 * Das Blatt. Wirft, wenn eine geforderte Angabe fehlt -- der Aufrufer
 * soll nachfragen, nicht ein Loch drucken.
 */
export async function baueEigenbeleg(e: Eigenbeleg): Promise<Buffer> {
  const fehlt = fehlendeAngaben(e);
  if (fehlt.length > 0) {
    throw new Error(`Dem Eigenbeleg fehlen Angaben: ${fehlt.join(", ")}.`);
  }

  const dok = await PDFDocument.create();
  const seite = dok.addPage([595.28, 841.89]); // A4
  const normal = await dok.embedFont(StandardFonts.Helvetica);
  const fett = await dok.embedFont(StandardFonts.HelveticaBold);
  const breite = 595.28;
  const rand = 56;
  let y = 770;

  const schreibe = (
    text: string,
    x: number,
    groesse: number,
    schrift = normal,
    grau = 0,
  ) => {
    seite.drawText(text, {
      x,
      y,
      size: groesse,
      font: schrift,
      color: rgb(grau, grau, grau),
    });
  };

  schreibe("Eigenbeleg", rand, 20, fett);
  y -= 18;
  schreibe(
    "Eigenbeleg nach § 158 AO über eine Ausgabe ohne Fremdbeleg",
    rand,
    9.5,
    normal,
    0.4,
  );
  y -= 26;
  seite.drawLine({
    start: { x: rand, y },
    end: { x: breite - rand, y },
    thickness: 0.7,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 30;

  const zeile = (name: string, wert: string, hervor = false) => {
    schreibe(name, rand, 9.5, normal, 0.42);
    schreibe(wert, rand + 170, hervor ? 12 : 11, hervor ? fett : normal);
    y -= 24;
  };

  zeile("Zahlungsempfänger", e.empfaenger);
  zeile("Art der Aufwendung", e.zweck);
  zeile("Datum der Zahlung", tag(e.datum));
  // "Zahlbetrag", nicht "Betrag": Das Regelwerk des Portals
  // (lib/belege.ts, ETIKETTEN) erkennt "Betrag" nicht als Etikett --
  // es ist auf einer fremden Rechnung zu schwach, um den Endbetrag zu
  // bezeichnen. Ein Blatt mit der Aufschrift "Betrag" waere fuer die
  // eigene Auswertung ein Blatt ohne Betrag. Genau dieser Fehler ist
  // am 06.11.2026 bei 61 PayPal-Blaettern passiert.
  zeile("Zahlbetrag", euro(e.betrag), true);
  if (e.gezahlt_mit) zeile("Bezahlt mit", e.gezahlt_mit);
  if (e.buchungstag) zeile("Abbuchung auf dem Konto", tag(e.buchungstag));

  y -= 6;
  seite.drawLine({
    start: { x: rand, y },
    end: { x: breite - rand, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 26;

  schreibe("Warum kein Fremdbeleg vorliegt", rand, 10, fett);
  y -= 18;
  // Der Grund ist Freitext und kann lang sein; er wird umgebrochen.
  for (const z of umbrich(e.grund, normal, 10.5, breite - 2 * rand)) {
    schreibe(z, rand, 10.5);
    y -= 15;
  }

  y -= 34;
  schreibe("Erstellt von", rand, 9.5, normal, 0.42);
  schreibe(`${e.erstellt_von}, am ${tag(e.erstellt_am)}`, rand + 170, 11);
  y -= 46;

  seite.drawLine({
    start: { x: rand, y },
    end: { x: rand + 200, y },
    thickness: 0.5,
    color: rgb(0.45, 0.45, 0.45),
  });
  y -= 13;
  schreibe("Unterschrift des Erstellers", rand, 8.5, normal, 0.45);

  // Fuss: woher das Blatt kommt. Ein Beleg, der seine Herkunft
  // verschweigt, ist fuer einen Steuerberater wertlos.
  let yf = 92;
  for (const z of [
    "Dieses Blatt ist im Verwaltungsportal erzeugt worden und dort mit",
    `Ersteller und Zeitstempel verzeichnet (${e.erstellt_von}, ${tag(e.erstellt_am)}).`,
    "Der Eintrag dort tritt neben die Unterschrift, nicht an ihre Stelle.",
    "Es liegt kein Beleg eines Dritten vor; der Grund steht oben.",
  ]) {
    seite.drawText(z, {
      x: rand,
      y: yf,
      size: 8,
      font: normal,
      color: rgb(0.46, 0.46, 0.46),
    });
    yf -= 11;
  }

  return Buffer.from(await dok.save());
}

/** Text auf eine Breite umbrechen. */
export function umbrich(
  text: string,
  schrift: { widthOfTextAtSize(t: string, g: number): number },
  groesse: number,
  breite: number,
): string[] {
  const zeilen: string[] = [];
  let aktuell = "";
  for (const wort of text.split(/\s+/).filter(Boolean)) {
    const versuch = aktuell ? `${aktuell} ${wort}` : wort;
    if (schrift.widthOfTextAtSize(versuch, groesse) <= breite) {
      aktuell = versuch;
    } else {
      if (aktuell) zeilen.push(aktuell);
      aktuell = wort;
    }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen.length > 0 ? zeilen : [""];
}
