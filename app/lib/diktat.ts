import { gewaehltesModell, type Holer } from "./agent";

/**
 * Aus einem Dokument und einem gesprochenen Satz einen Beleg machen.
 *
 * WOFÜR
 *
 * Für die private Steuerablage: Eine Quittung abfotografieren oder die
 * PDF-Rechnung hochladen, einen Satz dazu sagen -- "das war der
 * Pizzaschneider für die Küche in der Westanlage, bar bezahlt" -- und
 * der Beleg ist vollständig eingeordnet, ohne ein Formular auszufüllen.
 *
 * WARUM NICHT DIE KI ALLEIN
 *
 * Weil ein Sprachmodell Zahlen erfindet, wenn es sie nicht findet, und
 * es tut das in vollständigen Sätzen. Ein erfundener Betrag in den
 * Büchern ist schlimmer als ein fehlender: Der fehlende fällt auf.
 *
 * Darum liest das Regelwerk (lib/belege.ts) denselben Text ein zweites
 * Mal, unabhängig, nur nach Mustern. Stimmen beide bei Betrag und Datum
 * überein, hat der Beleg zwei Zeugen. Weichen sie ab, wird er angelegt
 * UND markiert, und der selbsttätige Abgleich lässt ihn liegen -- genau
 * wie bei der Einlieferung (api/belege/einlieferung). Das ist dieselbe
 * Gegenprobe, nur mit der KI an der Stelle, an der sonst eine
 * zugelieferte Datei steht.
 *
 * WAS DIE KI BEITRÄGT UND WAS NICHT
 *
 * Sie trägt bei, was nur in Worten steht: wofür die Ausgabe war, wer
 * der Empfänger ist, ob es überhaupt eine Rechnung ist oder ein
 * Eigenbeleg sein muss, welche Kostenart passt. Das kann kein Muster.
 *
 * Sie entscheidet NICHT über Betrag und Datum, wenn das Regelwerk sie
 * gelesen hat -- dort hat das Muster Vorrang, weil es nicht raten kann.
 * Nur wo das Regelwerk schweigt (ein Foto ohne Textebene, ein
 * handschriftlicher Zettel, gar kein Dokument), zählt ihre Angabe --
 * und dann steht in `quelle`, dass sie es war.
 */

export interface DiktatBefund {
  aussteller: string | null;
  /** Wofuer die Ausgabe war, in Worten. */
  zweck: string | null;
  belegdatum: string | null;
  betrag_brutto: number | null;
  /** 'rechnung' | 'quittung' | 'eigenbeleg' | 'gutschrift' | 'sonstige' */
  art: string | null;
  kostenart: string | null;
  /** Nur beim Eigenbeleg: warum kein Fremdbeleg vorliegt. */
  eigenbeleg_grund: string | null;
  gezahlt_mit: string | null;
  /** Was das Modell selbst nicht sicher wusste, in Worten. */
  unklar: string[];
}

export type DiktatErgebnis =
  | { ok: true; befund: DiktatBefund; modell: string }
  | { ok: false; code: "kein_schluessel" | "modell_fehler"; fehler: string };

const ERLAUBTE_ARTEN = [
  "rechnung",
  "gutschrift",
  "quittung",
  "eigenbeleg",
  "sonstige",
] as const;

export const SYSTEMPROMPT = [
  "Du ordnest Belege für eine private Steuerablage ein.",
  "",
  "Du bekommst zwei Dinge: den Text eines Dokuments (kann leer sein) und",
  "einen gesprochenen Satz der Person, die den Beleg ablegt.",
  "",
  "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Vorwort und ohne",
  "Codeblock, mit genau diesen Schlüsseln:",
  '  aussteller, zweck, belegdatum, betrag_brutto, art, kostenart,',
  "  eigenbeleg_grund, gezahlt_mit, unklar",
  "",
  "Regeln:",
  "- belegdatum als JJJJ-MM-TT oder null.",
  "- betrag_brutto als Zahl in Euro (Punkt als Dezimaltrennzeichen) oder null.",
  `- art ist einer von: ${ERLAUBTE_ARTEN.join(", ")}.`,
  "- art ist 'eigenbeleg' NUR, wenn kein Beleg eines Dritten vorliegt",
  "  (Kauf von einer Privatperson, Quittung verloren, Automat). Dann",
  "  gehört in eigenbeleg_grund, warum -- mit den Worten der Person,",
  "  nicht ausgedacht.",
  "- zweck ist, WAS gekauft wurde, in wenigen Worten. Nicht die Kostenart.",
  "- unklar ist eine Liste der Angaben, die du NICHT aus Dokument oder",
  "  Satz entnehmen konntest. Lass sie dann auf null und nenne sie hier.",
  "",
  "ERFINDE NICHTS. Steht ein Betrag oder Datum nicht im Dokument und sagt",
  "die Person es nicht, dann ist der Wert null und gehört in unklar. Ein",
  "geratener Betrag in einer Buchhaltung ist schlimmer als ein fehlender.",
].join("\n");

export function baueNutzertext(dokumenttext: string, diktat: string): string {
  const d = dokumenttext.trim();
  return [
    "## Text des Dokuments",
    d.length > 0 ? d.slice(0, 12_000) : "(kein Text -- Foto ohne Textebene oder kein Dokument)",
    "",
    "## Was die Person dazu gesagt hat",
    diktat.trim() || "(nichts gesagt)",
  ].join("\n");
}

/** Eine Zahl aus dem Modell, so streng wie möglich gelesen. */
function zahl(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v);
  if (typeof v === "string") {
    const t = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "");
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n) && n !== 0) return Math.abs(n);
  }
  return null;
}

function wort(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.toLowerCase() !== "null" ? t.slice(0, 400) : null;
}

/**
 * Die Antwort des Modells einlesen.
 *
 * Streng: Was nicht der verabredeten Form entspricht, wird zu null und
 * nicht gerettet. Ein Modell, das sich nicht an die Form haelt, hat
 * sich vielleicht auch am Inhalt vergriffen.
 */
export function liesAntwort(roh: string): DiktatBefund | null {
  const anfang = roh.indexOf("{");
  const ende = roh.lastIndexOf("}");
  if (anfang < 0 || ende <= anfang) return null;
  let o: Record<string, unknown>;
  try {
    const geparst: unknown = JSON.parse(roh.slice(anfang, ende + 1));
    if (!geparst || typeof geparst !== "object" || Array.isArray(geparst)) {
      return null;
    }
    o = geparst as Record<string, unknown>;
  } catch {
    return null;
  }

  const art = wort(o.art)?.toLowerCase() ?? null;
  const datum = wort(o.belegdatum);
  return {
    aussteller: wort(o.aussteller),
    zweck: wort(o.zweck),
    belegdatum: datum && /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : null,
    betrag_brutto: zahl(o.betrag_brutto),
    art: art && (ERLAUBTE_ARTEN as readonly string[]).includes(art) ? art : null,
    kostenart: wort(o.kostenart),
    eigenbeleg_grund: wort(o.eigenbeleg_grund),
    gezahlt_mit: wort(o.gezahlt_mit),
    unklar: Array.isArray(o.unklar)
      ? o.unklar.map((x) => wort(x)).filter((x): x is string => x !== null)
      : [],
  };
}

/**
 * Die KI fragen. `holen` ist einspritzbar; in den Tests läuft nie eine
 * echte Anfrage.
 */
export async function werteDiktatAus(
  dokumenttext: string,
  diktat: string,
  opts: { schluessel?: string | null; modell?: string; holen?: Holer } = {},
): Promise<DiktatErgebnis> {
  const key = opts.schluessel ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      code: "kein_schluessel",
      fehler:
        "Für die Auswertung ist kein Schlüssel hinterlegt (ANTHROPIC_API_KEY). " +
        "Der Beleg kann von Hand eingetragen werden.",
    };
  }
  const modell = opts.modell ?? gewaehltesModell();
  const holen = (opts.holen ?? (fetch as unknown as Holer)) as Holer;

  try {
    const res = await holen("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modell,
        max_tokens: 700,
        system: SYSTEMPROMPT,
        messages: [
          { role: "user", content: baueNutzertext(dokumenttext, diktat) },
        ],
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        code: "modell_fehler",
        fehler: `Die Auswertung antwortete mit Status ${res.status}.`,
      };
    }
    const d = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (d.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const befund = liesAntwort(text);
    if (!befund) {
      return {
        ok: false,
        code: "modell_fehler",
        fehler: "Die Antwort der Auswertung war nicht lesbar.",
      };
    }
    return { ok: true, befund, modell };
  } catch (e) {
    return {
      ok: false,
      code: "modell_fehler",
      fehler: `Die Auswertung war nicht erreichbar: ${(e as Error).message}`,
    };
  }
}

export interface Zusammenfuehrung {
  aussteller: string | null;
  zweck: string | null;
  belegdatum: string | null;
  betrag_brutto: number | null;
  art: string;
  kostenart: string | null;
  eigenbeleg_grund: string | null;
  gezahlt_mit: string | null;
  /** Was woher kommt -- wandert in beleg.notizen. */
  quelle: string[];
  /** Gefüllt, wenn Regelwerk und KI sich widersprechen. */
  abweichung: string | null;
  /** Was noch fehlt, damit ein Mensch nachfragen kann. */
  offen: string[];
}

const geld = (w: number | null) =>
  w === null ? "ohne" : `${w.toFixed(2).replace(".", ",")} EUR`;

/**
 * Regelwerk und KI zusammenführen.
 *
 * Bei Betrag und Datum hat das Regelwerk Vorrang, wo es gelesen hat --
 * ein Muster kann nicht raten. Weicht die KI ab, wird das als
 * `abweichung` festgehalten, nicht stillschweigend verworfen: Wenn zwei
 * Lesungen auseinandergehen, kann auch das Muster falsch liegen, und
 * dann soll ein Mensch hinsehen.
 */
export function fuehreZusammen(
  regelwerk: { belegdatum: string | null; betrag_brutto: number | null },
  ki: DiktatBefund | null,
): Zusammenfuehrung {
  const quelle: string[] = [];
  const offen: string[] = [];

  let betrag = regelwerk.betrag_brutto;
  let datum = regelwerk.belegdatum;

  if (betrag !== null) {
    quelle.push("Betrag aus dem Dokument gelesen");
  } else if (ki?.betrag_brutto != null) {
    betrag = ki.betrag_brutto;
    quelle.push("Betrag aus dem Gesagten übernommen");
  } else {
    offen.push("Betrag");
  }

  if (datum !== null) {
    quelle.push("Datum aus dem Dokument gelesen");
  } else if (ki?.belegdatum) {
    datum = ki.belegdatum;
    quelle.push("Datum aus dem Gesagten übernommen");
  } else {
    offen.push("Belegdatum");
  }

  const teile: string[] = [];
  if (
    regelwerk.betrag_brutto !== null &&
    ki?.betrag_brutto != null &&
    Math.abs(regelwerk.betrag_brutto - ki.betrag_brutto) >= 0.005
  ) {
    teile.push(
      `Betrag: Regelwerk ${geld(regelwerk.betrag_brutto)} / Auswertung ${geld(ki.betrag_brutto)}`,
    );
  }
  if (
    regelwerk.belegdatum !== null &&
    ki?.belegdatum &&
    regelwerk.belegdatum !== ki.belegdatum
  ) {
    teile.push(
      `Datum: Regelwerk ${regelwerk.belegdatum} / Auswertung ${ki.belegdatum}`,
    );
  }

  const art = ki?.art ?? "sonstige";
  if (art === "eigenbeleg" && !ki?.eigenbeleg_grund) {
    offen.push("Grund für das Fehlen eines Fremdbelegs");
  }
  if (!ki?.zweck) offen.push("Art der Aufwendung");
  if (!ki?.aussteller) offen.push("Zahlungsempfänger");

  return {
    aussteller: ki?.aussteller ?? null,
    zweck: ki?.zweck ?? null,
    belegdatum: datum,
    betrag_brutto: betrag,
    art,
    kostenart: ki?.kostenart ?? null,
    eigenbeleg_grund: ki?.eigenbeleg_grund ?? null,
    gezahlt_mit: ki?.gezahlt_mit ?? null,
    quelle,
    abweichung: teile.length > 0 ? teile.join("; ") : null,
    offen,
  };
}
