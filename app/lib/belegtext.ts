/**
 * Text aus einem hochgeladenen Beleg holen.
 *
 * Die Belegerkennung in lib/belege.ts liest bisher nur Dateiname, Betreff
 * und Mailtext. Für hochgeladene Rechnungen ist das zu wenig: Bei Amazon
 * steht die Bestellnummer im PDF, nicht im Dateinamen -- und genau diese
 * Nummer steht auch im Verwendungszweck der Abbuchung. Sie ist damit der
 * einzige eindeutige Schlüssel, den es zwischen Rechnung und Kontobewegung
 * gibt.
 *
 * Gelesen wird nur die Textebene. Ein Foto einer Baumarktquittung hat
 * keine, und Zeichen zu erraten ist hier gefährlich: Aus einer falsch
 * erkannten 8 wird ein falscher Betrag in der Buchhaltung. Solche Belege
 * werden deshalb abgelegt und ausdrücklich als "nicht auslesbar"
 * gekennzeichnet -- dann trägt ein Mensch die drei Felder ein, statt sich
 * auf eine Zahl zu verlassen, die niemand geprüft hat.
 */

export interface BelegText {
  text: string;
  seiten: number;
  /** Keine Textebene gefunden -- vermutlich ein Scan oder ein Foto. */
  ohne_textebene: boolean;
}

/** Nur Bytes anfassen, nie den Dateinamen: Endungen lügen. */
export function istPdf(bytes: Buffer): boolean {
  return bytes.length > 4 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

export function istBild(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  const a = bytes.subarray(0, 12);
  // PNG
  if (a[0] === 0x89 && a.subarray(1, 4).toString("latin1") === "PNG") return true;
  // JPEG
  if (a[0] === 0xff && a[1] === 0xd8 && a[2] === 0xff) return true;
  // HEIC/HEIF (iPhone-Fotos): ftyp-Box mit heic/heix/mif1
  if (a.subarray(4, 8).toString("latin1") === "ftyp") {
    const marke = a.subarray(8, 12).toString("latin1");
    return ["heic", "heix", "mif1", "msf1", "hevc"].includes(marke);
  }
  return false;
}

/**
 * Holt die Textebene aus einem PDF.
 *
 * Läuft ohne Worker: In einem Serverprozess gibt es keinen, und pdfjs
 * würde sonst versuchen, einen zu starten und daran scheitern.
 */
export async function pdfText(bytes: Buffer): Promise<BelegText> {
  // Der legacy-Build ist der für Node gedachte.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const dok = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // Schriften und Bilder interessieren nicht, nur Text.
    disableFontFace: true,
    // Ein Beleg, der eine Standardschrift braucht, soll nicht am Laden
    // einer Datei aus dem Netz scheitern -- das Netz ist hier dicht.
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const stuecke: string[] = [];
  for (let s = 1; s <= dok.numPages; s++) {
    const seite = await dok.getPage(s);
    const inhalt = await seite.getTextContent();
    const zeile = inhalt.items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ");
    stuecke.push(zeile);
  }
  await dok.destroy();

  const text = stuecke.join("\n").replace(/[ \t]+/g, " ").trim();
  return {
    text,
    seiten: dok.numPages,
    // Eine Handvoll Zeichen ist keine Textebene: Manche Scanner legen
    // eine leere Ebene mit Seitenzahlen an.
    ohne_textebene: text.replace(/\s/g, "").length < 40,
  };
}

/**
 * Text aus einem Beleg, soweit es geht.
 *
 * Wirft nicht: Ein Beleg, dessen Text sich nicht lesen lässt, soll
 * trotzdem abgelegt werden. Der Fehler wird gemeldet, nicht verschluckt --
 * aber er verhindert das Ablegen nicht.
 */
export async function lieseBeleg(bytes: Buffer): Promise<
  BelegText & { fehler: string | null; art: "pdf" | "bild" | "unbekannt" }
> {
  if (istPdf(bytes)) {
    try {
      return { ...(await pdfText(bytes)), fehler: null, art: "pdf" };
    } catch (e) {
      return {
        text: "", seiten: 0, ohne_textebene: true, art: "pdf",
        fehler: `PDF nicht lesbar: ${(e as Error).message}`,
      };
    }
  }
  if (istBild(bytes)) {
    return {
      text: "", seiten: 1, ohne_textebene: true, art: "bild",
      fehler: null,
    };
  }
  return {
    text: "", seiten: 0, ohne_textebene: true, art: "unbekannt",
    fehler: "Weder PDF noch Bild.",
  };
}
