/**
 * Die zweite Meinung zu einem Beleg -- lesen, pruefen, vergleichen.
 *
 * WARUM DIESE DATEI EXISTIERT
 *
 * Am 05.11.2026 wurden 100 Amazon-Rechnungen eingeliefert, mit einer
 * Beifuegung, die je Beleg Betrag und Datum mitbrachte. Die Einlieferung
 * meldete "0 Auffaellige" -- und das klang wie Einigkeit. Es war
 * Schweigen: Die Beifuegung lag als {"belege": {...}} vor, das Portal
 * erwartete die Zuordnung auf oberster Ebene, und die Feldnamen hiessen
 * dort "betrag_brutto" statt "brutto". Kein einziger Beleg fand seine
 * zweite Meinung, und nichts sagte es.
 *
 * Daraus zwei Regeln, die hier zusammen stehen, damit sie nicht an zwei
 * Stellen auseinanderlaufen:
 *
 *   1. Beim Lesen grosszuegig sein. Der Umschlag "belege" und die
 *      naheliegenden Feldnamen werden mitgenommen.
 *   2. Beim Nichtstreffen laut sein. Eine Zulieferung, die keinen
 *      einzigen Beleg trifft, ist ein Fehler und keine Nachricht wert,
 *      die man ueberliest.
 */

export interface Zulieferung {
  aussteller?: unknown;
  belegnummer?: unknown;
  datum?: unknown;
  brutto?: unknown;
  objekt?: unknown;
  kostenart?: unknown;
  umlagefaehig?: unknown;
  anlagegut?: unknown;
  begruendung?: unknown;
}

/** Nur der Dateiname, ohne Pfad. */
export function nurName(n: string): string {
  return (n.split("/").pop() ?? "beleg").slice(0, 200) || "beleg";
}

export function text(w: unknown, max: number): string | null {
  if (typeof w !== "string") return null;
  const s = w.trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Ein Bruttobetrag. Null bleibt null, ein negativer Wert wird zum
 * Betrag: Die Richtung steht am Beleg, nicht im Vorzeichen -- eine
 * Gutschrift ueber 103,96 EUR ist ein Beleg ueber 103,96 EUR mit
 * Richtung "ausgang".
 */
export function zahl(w: unknown): number | null {
  if (typeof w === "number" && Number.isFinite(w) && w !== 0) {
    return Math.round(Math.abs(w) * 100) / 100;
  }
  return null;
}

export function datumFeld(w: unknown): string | null {
  const s = text(w, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function geld(n: number | null): string {
  return n === null ? "ohne" : n.toFixed(2).replace(".", ",");
}

export function gleichBetrag(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true; // nur eine Quelle: kein Widerspruch
  return Math.round(a * 100) === Math.round(b * 100);
}

export function gleichDatum(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * Der Widerspruchstext zweier Lesungen, oder null bei Einigkeit.
 *
 * "eigen" ist die Lesung des Portals, "fremd" die zugelieferte. Die
 * Namen stehen im Text, damit spaeter erkennbar ist, welche Zahl woher
 * kam -- ein Widerspruch ohne Herkunft ist nicht aufloesbar.
 */
export function widerspruch(
  eigen: { betrag: number | null; datum: string | null },
  fremd: { betrag: number | null; datum: string | null },
): string | null {
  const teile: string[] = [];
  if (!gleichBetrag(eigen.betrag, fremd.betrag)) {
    teile.push(`Betrag: Regelwerk ${geld(eigen.betrag)} / Beifügung ${geld(fremd.betrag)}`);
  }
  if (!gleichDatum(eigen.datum, fremd.datum)) {
    teile.push(`Datum: Regelwerk ${eigen.datum ?? "ohne"} / Beifügung ${fremd.datum ?? "ohne"}`);
  }
  return teile.length ? teile.join("; ") : null;
}

/** Die Feldnamen, die als dasselbe gelten. */
const GLEICHBEDEUTEND: Record<string, keyof Zulieferung> = {
  brutto: "brutto",
  betrag: "brutto",
  betrag_brutto: "brutto",
  bruttobetrag: "brutto",
  datum: "datum",
  belegdatum: "datum",
  rechnungsdatum: "datum",
  aussteller: "aussteller",
  belegnummer: "belegnummer",
  rechnungsnummer: "belegnummer",
  objekt: "objekt",
  kostenart: "kostenart",
  umlagefaehig: "umlagefaehig",
  umlagefähig: "umlagefaehig",
  anlagegut: "anlagegut",
  begruendung: "begruendung",
  begründung: "begruendung",
};

export interface Zulieferungen {
  /** Zuordnung Dateiname -> Felder, Schluessel ohne Pfad. */
  je: Record<string, Zulieferung>;
  /** Wie viele Eintraege gelesen wurden. */
  anzahl: number;
  /** Lag ein Umschlag "belege" darum? Nur fuer den Bericht. */
  umschlag: boolean;
}

/**
 * Eine Zulieferung lesen, in beiden Schreibweisen.
 *
 * Erlaubt ist die Zuordnung auf oberster Ebene und der Umschlag
 * {"belege": {...}}. Unbekannte Feldnamen werden NICHT uebernommen --
 * sie stillschweigend zu erraten waere genau der Fehler, den diese
 * Datei verhindern soll. Sie fallen im Bericht als unbekannte Felder
 * auf.
 */
export function liesZulieferungen(roh: unknown): Zulieferungen | { fehler: string } {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return { fehler: "Die Zulieferung ist kein Objekt." };
  }
  let quelle = roh as Record<string, unknown>;
  let umschlag = false;
  const innen = quelle["belege"];
  if (innen && typeof innen === "object" && !Array.isArray(innen)) {
    quelle = innen as Record<string, unknown>;
    umschlag = true;
  }
  const je: Record<string, Zulieferung> = {};
  for (const [name, wert] of Object.entries(quelle)) {
    if (!wert || typeof wert !== "object" || Array.isArray(wert)) continue;
    const felder: Zulieferung = {};
    for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
      const ziel = GLEICHBEDEUTEND[k.toLowerCase()];
      if (ziel) felder[ziel] = v;
    }
    je[nurName(name)] = felder;
  }
  return { je, anzahl: Object.keys(je).length, umschlag };
}
