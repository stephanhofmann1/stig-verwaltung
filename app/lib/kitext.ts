/**
 * Gliedert eine Antwort des Assistenten in Absaetze, Listen und
 * Zwischenzeilen -- ohne React, damit es sich pruefen laesst
 * (tests/ki.test.ts). Gezeichnet wird in components/Assistent.tsx (KiText).
 *
 * Warum es das gibt: Beim ersten echten Lauf am 28.11.2026 antwortete das
 * Modell mit Trennlinien ("---"), Ueberschriften und Listen direkt unter
 * einer Titelzeile. Die erste Fassung kannte nur Bloecke, die ganz aus
 * Listenzeilen bestanden; alles andere stand als Text mit Strichen davor da.
 *
 * Erkannt wird:
 *   - Leerzeile           neuer Block
 *   - "---", "***", "___" Trennlinie -- faellt weg, der Weissraum trennt
 *   - "# Titel" bis "###" Zwischenzeile (fett)
 *   - "- ", "* ", "• "    Listenpunkt
 *   - "1. ", "2. "        nummerierter Punkt
 *   - alles andere        Textzeile; aufeinanderfolgende bilden einen Absatz
 */

export type Teil =
  | { art: "absatz"; zeilen: string[] }
  | { art: "zwischen"; text: string }
  | { art: "liste"; punkte: string[] }
  | { art: "nummern"; punkte: string[] };

const TRENNER = /^\s*([-*_])\1{2,}\s*$/;
const KOPF = /^\s*#{1,6}\s+(.*)$/;
const PUNKT = /^\s*[-*•]\s+(.*)$/;
const NUMMER = /^\s*\d+[.)]\s+(.*)$/;

export function gliedere(text: string): Teil[] {
  const teile: Teil[] = [];
  const zeilen = text.replace(/\r/g, "").split("\n");

  for (const roh of zeilen) {
    const zeile = roh.trimEnd();
    const letzter = teile[teile.length - 1];

    if (zeile.trim() === "" || TRENNER.test(zeile)) {
      // Ein Blockende: Der naechste Text beginnt einen neuen Absatz.
      if (letzter && letzter.art === "absatz") teile.push({ art: "absatz", zeilen: [] });
      continue;
    }

    const kopf = KOPF.exec(zeile);
    if (kopf) {
      teile.push({ art: "zwischen", text: kopf[1].replace(/\*\*/g, "").trim() });
      continue;
    }

    const punkt = PUNKT.exec(zeile);
    if (punkt) {
      if (letzter && letzter.art === "liste") letzter.punkte.push(punkt[1]);
      else teile.push({ art: "liste", punkte: [punkt[1]] });
      continue;
    }

    const nummer = NUMMER.exec(zeile);
    if (nummer) {
      if (letzter && letzter.art === "nummern") letzter.punkte.push(nummer[1]);
      else teile.push({ art: "nummern", punkte: [nummer[1]] });
      continue;
    }

    if (letzter && letzter.art === "absatz") letzter.zeilen.push(zeile.trim());
    else teile.push({ art: "absatz", zeilen: [zeile.trim()] });
  }

  return teile.filter((t) => t.art !== "absatz" || t.zeilen.length > 0);
}
