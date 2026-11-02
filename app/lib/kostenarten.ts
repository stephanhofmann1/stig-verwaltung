/**
 * Kostenarten für Belege.
 *
 * Zwei Fragen hängen an jedem Ausgabenbeleg, und beide lassen sich später
 * nicht mehr zuverlässig nachholen:
 *
 *   1. Zu welchem Objekt gehört er? Gießen, Ludwigshafen und Mannheim
 *      werden getrennt abgerechnet.
 *   2. Darf er auf die Mieter umgelegt werden?
 *
 * Die zweite Frage ist eine Rechtsfrage, keine Geschmacksfrage. Der
 * Katalog der umlagefähigen Betriebskosten steht abschliessend in
 * § 2 BetrKV; § 1 Abs. 2 BetrKV nimmt Verwaltungskosten und
 * Instandhaltungs-/Instandsetzungskosten ausdrücklich AUS. Hinzu kommt:
 * Umgelegt werden darf nur, was der Mietvertrag auch vereinbart --
 * § 556 Abs. 1 BGB. Diese Liste bildet den gesetzlichen Rahmen ab, nicht
 * den einzelnen Vertrag.
 *
 * `umlagefaehig` ist deshalb ein VORSCHLAG, den die Oberfläche einträgt
 * und der Mensch ändern kann. `null` heisst: kommt auf den Fall an, hier
 * wird nichts vorgeschlagen.
 */

export interface Kostenart {
  schluessel: string;
  text: string;
  /** Vorschlag. true = regelmässig umlagefähig, false = nicht, null = kommt darauf an. */
  umlagefaehig: boolean | null;
  hinweis?: string;
}

export const KOSTENARTEN: Kostenart[] = [
  // --- Betriebskosten nach § 2 BetrKV ------------------------------------
  { schluessel: "grundsteuer", text: "Grundsteuer", umlagefaehig: true },
  { schluessel: "wasser", text: "Wasser und Abwasser", umlagefaehig: true },
  {
    schluessel: "heizung",
    text: "Heizung und Warmwasser",
    umlagefaehig: true,
    hinweis:
      "Wird nach der Heizkostenverordnung abgerechnet, überwiegend " +
      "verbrauchsabhängig — nicht nach dem allgemeinen Verteilerschlüssel.",
  },
  { schluessel: "muell", text: "Müllbeseitigung und Straßenreinigung", umlagefaehig: true },
  { schluessel: "gebaeudereinigung", text: "Gebäudereinigung und Ungezieferbekämpfung", umlagefaehig: true },
  { schluessel: "gartenpflege", text: "Gartenpflege", umlagefaehig: true },
  { schluessel: "beleuchtung", text: "Allgemeinstrom und Beleuchtung", umlagefaehig: true },
  { schluessel: "schornsteinfeger", text: "Schornsteinreinigung", umlagefaehig: true },
  {
    schluessel: "versicherung",
    text: "Sach- und Haftpflichtversicherung",
    umlagefaehig: true,
    hinweis: "Gebäude-, Haftpflicht-, Elementarschaden. Nicht: Rechtsschutz.",
  },
  { schluessel: "hauswart", text: "Hauswart", umlagefaehig: true,
    hinweis: "Nur der Betriebsanteil. Reparaturen durch den Hauswart sind Instandhaltung." },
  { schluessel: "aufzug", text: "Aufzug", umlagefaehig: true },
  { schluessel: "kabel", text: "Gemeinschaftsantenne, Kabel, Internet", umlagefaehig: true },
  { schluessel: "waschen", text: "Waschmaschine, Trockner", umlagefaehig: true },

  // --- Ausdrücklich NICHT umlagefähig, § 1 Abs. 2 BetrKV ------------------
  {
    schluessel: "instandhaltung",
    text: "Instandhaltung und Reparatur",
    umlagefaehig: false,
    hinweis:
      "§ 1 Abs. 2 Nr. 2 BetrKV nimmt Instandhaltung ausdrücklich aus. " +
      "Werbungskosten ja, Umlage nein. Hier landen die meisten " +
      "Baumarkt- und Handwerkerrechnungen.",
  },
  {
    schluessel: "modernisierung",
    text: "Modernisierung, Ausbau, Anschaffung",
    umlagefaehig: false,
    hinweis:
      "Nicht umlagefähig und oft nicht sofort absetzbar, sondern über die " +
      "Nutzungsdauer abzuschreiben. Die Abgrenzung zur Instandhaltung " +
      "entscheidet der Steuerberater.",
  },
  {
    schluessel: "verwaltung",
    text: "Verwaltungskosten",
    umlagefaehig: false,
    hinweis: "§ 1 Abs. 2 Nr. 1 BetrKV. Auch Kontoführung und Software.",
  },
  { schluessel: "finanzierung", text: "Zinsen und Finanzierung", umlagefaehig: false },
  { schluessel: "recht", text: "Rechtsberatung und Gericht", umlagefaehig: false },
  {
    schluessel: "leerstand",
    text: "Leerstandskosten",
    umlagefaehig: false,
    hinweis: "Kosten leerstehender Einheiten trägt der Vermieter.",
  },

  // --- Rest ---------------------------------------------------------------
  {
    schluessel: "sonstige",
    text: "Sonstiges",
    umlagefaehig: null,
    hinweis:
      "Sonstige Betriebskosten nach § 2 Nr. 17 BetrKV sind nur umlagefähig, " +
      "wenn sie im Mietvertrag einzeln benannt sind.",
  },
];

const NACH_SCHLUESSEL = new Map(KOSTENARTEN.map((k) => [k.schluessel, k]));

/** Gibt die Kostenart zurück oder null -- nie eine erfundene. */
export function pruefeKostenart(wert: unknown): Kostenart | null {
  if (typeof wert !== "string") return null;
  return NACH_SCHLUESSEL.get(wert.trim()) ?? null;
}

/**
 * Der Vorschlag für `umlagefaehig`, wenn der Mensch nichts gewählt hat.
 *
 * Gibt null zurück, wo das Gesetz keine pauschale Antwort gibt. Ein
 * Vorgabewert, der sich im Zweifel festlegt, wäre hier die schlechtere
 * Wahl: Eine zu Unrecht umgelegte Position fällt erst auf, wenn ein
 * Mieter die Abrechnung prüft.
 */
export function vorschlagUmlage(schluessel: unknown): boolean | null {
  return pruefeKostenart(schluessel)?.umlagefaehig ?? null;
}
