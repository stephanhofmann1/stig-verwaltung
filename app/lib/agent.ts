import { one, query, tx } from "./db";
import { erstelleEntwurf } from "./versand";
import { istPortal, waLink } from "./nachfassen";
import { findeStichwort } from "./einordnung";
import {
  baueWeisungsblock,
  ladeWeisungslage,
  setzeWeisungenZusammen,
  type WirksameWeisung,
  type Weisungslage,
} from "./weisungen";
import type { Kategorie } from "./typen";

/**
 * Der Agent schreibt Antworten vor. Er versendet nie.
 *
 * Zwei Stufen:
 *   1. Regelwerk — deckt die wiederkehrenden Fälle sicher ab und kommt
 *      ohne Sprachmodell aus. Läuft auch, wenn die API nicht erreichbar ist.
 *   2. Sprachmodell — übernimmt, sobald ein Schlüssel hinterlegt ist, und
 *      formuliert freier. Die Leitplanken darunter bleiben dieselben.
 *
 * Leitplanken, die in beiden Stufen gelten:
 *   - Heikle Vorgänge (Mahnwesen, Behörde) bekommen nie einen Entwurf.
 *   - Keine Zusagen zu Preis, Termin oder Verfügbarkeit ohne Deckung.
 *   - Bei Unsicherheit lieber nichts schreiben als etwas Falsches.
 *
 * ---------------------------------------------------------------------
 * WAS SICH AM 03.11.2026 GEÄNDERT HAT
 *
 * Der Eigentümer will sein Postfach durch diese Plattform ersetzen und
 * hat drei Dinge benannt, die das verhinderten. Alle drei stehen jetzt
 * hier:
 *
 *   1. HERKUNFT. Woher ein Entwurf kommt, wurde erhoben
 *      (AgentErgebnis.quelle) und dann weggeworfen. Jetzt landet es am
 *      Vorgang und an der Nachricht (db/031) und steht auf der
 *      Oberfläche, wo der Entwurf steht. Und vor allem: Entstand KEIN
 *      Entwurf, steht ab jetzt dort, warum nicht. Dieses Schweigen war
 *      der eigentliche Schaden vom 03.11. — eine Mail des
 *      Messdienstleisters lag als Behördenpost in der Akte, war dadurch
 *      heikel, der Agent hielt an, und niemand erfuhr davon.
 *
 *   2. ANWEISEN UND NEU ERZEUGEN. Der Mensch sagt in eigenen Worten, was
 *      anders werden soll, und lässt neu erzeugen. Die alte Fassung
 *      bleibt (entwurf_fassung). Siehe erzeugeNeuMitAnweisung().
 *
 *   3. DAUERWEISUNGEN. lib/weisungen.ts. Sie gehen in JEDEN Entwurf —
 *      auch in einen, den ein Textbaustein liefern würde. Deshalb greift
 *      Stufe 2 jetzt auch dann, wenn Stufe 1 etwas gefunden hat, sofern
 *      Weisungen wirksam sind: Ein Textbaustein kann "antworte auf
 *      Englisch" nicht befolgen, und eine Weisung, die sichtbar
 *      eingetragen ist und nichts tut, ist derselbe stille Fehler in der
 *      anderen Richtung. Fällt das Modell aus, bleibt der Textbaustein
 *      stehen und die Herkunft sagt, dass die Weisungen nicht angewandt
 *      wurden.
 *
 * DIE GRENZE, DIE HIER NICHT ANGEFASST WIRD
 *
 * Diese Datei erzeugt ausschließlich Nachrichten mit status='entwurf'.
 * Sie ruft sendeEntwurf() nicht auf, kennt keine Resend- und keine
 * SMTP-Adresse und hat keinen Pfad, auf dem ein Text ohne ausdrückliche
 * Freigabe eines Menschen das Haus verlässt. Das ist die einzige
 * belastbare Sicherung dagegen, dass eine vom Nutzer geschriebene
 * Weisung oder Anweisung mehr auslöst als eine Umformulierung — eine
 * Inhaltsprüfung ließe sich umschreiben, eine fehlende Funktion nicht.
 * app/tests/weisungen.test.ts und app/tests/agent.test.ts halten das fest.
 */

/**
 * HINWEIS für die Mandantenfähigkeit (offene Produktentscheidung, hier
 * absichtlich nicht geändert):
 *
 * Diese Unterschrift steht fest im Code, und lib/versand.ts nimmt die
 * Absenderadresse aus ABSENDER_EMAIL / ABSENDER_NAME der Umgebung.
 * Beides gilt damit für die ganze Installation. Sobald ein zweiter
 * Mandant Entwürfe erzeugt, trägt jede seiner Mails die Unterschrift des
 * ersten. db/010 hat die richtigen Spalten bereits:
 * mandant.absender_email und mandant.absender_name.
 */
const UNTERSCHRIFT = `Beste Grüße
Stephan Hofmann
STIG Immobilien eGbR`;

/** Das Modell, solange AGENT_MODELL nichts anderes sagt. */
export const VORGABE_MODELL = "claude-sonnet-4-6";

/**
 * Welches Modell gefragt wird.
 *
 * Als eigene Funktion mit übergebener Umgebung, damit der Test sie ohne
 * process.env prüfen kann — und damit der Name im Ergebnis steht und
 * nicht nur in der Konfiguration. Bei einem Text, der an Dritte geht,
 * ist "womit ist das entstanden" eine Frage nach der Fassung.
 */
export function gewaehltesModell(
  umgebung: Record<string, string | undefined> = process.env,
): string {
  const gesetzt = (umgebung.AGENT_MODELL ?? "").trim();
  return gesetzt || VORGABE_MODELL;
}

/** Warum zu einem Vorgang kein Entwurf entstand (db/031). */
export type KeinEntwurfCode =
  | "heikel"
  | "kein_schluessel"
  | "keine_regel"
  | "werbung"
  | "modell_fehler";

/**
 * Der Satz, der dem Menschen angezeigt wird.
 *
 * Nicht "null" und nicht ein leeres Feld: Genau das war der Schaden vom
 * 03.11.2026. Die Automatik hörte auf zu arbeiten, und auf der
 * Oberfläche stand nichts — weder ein Fehler noch ein Grund.
 */
export const KEIN_ENTWURF_GRUND: Record<KeinEntwurfCode, string> = {
  heikel:
    "Heikler Vorgang — hier schreibt der Agent grundsätzlich nichts vor. " +
    "Die Sperre lässt sich in der Akte mit Begründung aufheben.",
  kein_schluessel:
    "Kein Textbaustein passte, und für das Sprachmodell ist kein " +
    "Schlüssel hinterlegt (ANTHROPIC_API_KEY). Es wurde nichts versucht.",
  keine_regel:
    "Kein sicheres Muster erkannt — bitte selbst beantworten.",
  werbung: "Als Werbung eingeordnet und geschlossen.",
  modell_fehler:
    "Das Sprachmodell hat nicht brauchbar geantwortet. Es wurde kein " +
    "Entwurf angelegt; ein vorhandener bleibt unverändert stehen.",
};

export interface AgentErgebnis {
  vorgang_id: string;
  referenz: string;
  entwurf: boolean;
  nachricht_id?: string;
  grund?: string;
  /** Maschinenlesbar zum Mitschreiben an den Vorgang. */
  kein_entwurf_code?: KeinEntwurfCode;
  quelle?: "regel" | "modell";
  /** Bei quelle='modell': welches Modell. */
  modell?: string;
  /** Welche Dauerweisungen gewirkt haben. */
  weisungen?: WirksameWeisung[];
  /**
   * Gesetzt, wenn Weisungen wirksam waren, das Modell aber ausfiel und
   * der Textbaustein stehen blieb. Eine Weisung, die stillschweigend
   * nicht angewandt wird, ist schlimmer als keine.
   */
  weisungen_nicht_angewandt?: string;
}

interface Fall {
  vorgang_id: string;
  referenz: string;
  kategorie: Kategorie;
  heikel: boolean;
  herkunft: string;
  betreff: string;
  nachricht_id: string;
  von_name: string | null;
  von_email: string;
  koerper_text: string;
  kontakt_id: string | null;
}

/** Die Spalten, die offeneFaelle() und bearbeiteVorgang() gleich brauchen. */
const FALL_SPALTEN = `v.id AS vorgang_id, v.referenz, v.kategorie, v.heikel,
       v.herkunft, v.betreff, v.kontakt_id,
       n.id AS nachricht_id, n.von_name, n.von_email, n.koerper_text`;

/** Vorgänge mit eingegangener, aber noch unbeantworteter Nachricht. */
export async function offeneFaelle(): Promise<Fall[]> {
  return query<Fall>(`
    SELECT ${FALL_SPALTEN}
      FROM vorgang v
      JOIN LATERAL (
            SELECT id, von_name, von_email, koerper_text
              FROM nachricht
             WHERE vorgang_id = v.id AND richtung = 'ein'
             ORDER BY angelegt_am DESC LIMIT 1) n ON true
     WHERE v.status = 'offen'
       AND NOT EXISTS (
             SELECT 1 FROM nachricht a
              WHERE a.vorgang_id = v.id
                AND a.richtung = 'aus'
                AND a.status IN ('entwurf','gesendet'))
     ORDER BY v.geaendert_am ASC
     LIMIT 50
  `);
}

function vorname(name: string | null, email: string): string {
  const n = (name ?? "").trim();
  if (n && !n.includes("@")) return n.split(/\s+/)[0];
  return email.split("@")[0];
}

/** Stufe 1: Regelwerk. Gibt null zurück, wenn kein Muster sicher passt. */
export function regelEntwurf(f: Fall): { text: string; notiz: string } | null {
  const anrede = vorname(f.von_name, f.von_email);

  switch (f.kategorie) {
    case "interessent": {
      const link = waLink(f.referenz);
      return {
        text: `Hallo ${anrede},

vielen Dank für Ihre Anfrage zur Westanlage 9.

Welches Zimmer aktuell frei ist und ab wann, sehen Sie jederzeit auf westanlage9.de. Gern schicke ich Ihnen Fotos und den Grundriss zur passenden Einheit.

Am schnellsten geht es per WhatsApp — dort kann ich Ihnen Unterlagen direkt senden und offene Fragen sofort klären:
${link}

Schreiben Sie mir kurz, ab wann Sie einziehen möchten und ob Sie möbliert oder unmöbliert suchen.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Standardantwort auf Interessentenanfrage. Bewusst ohne Zusage zu Zimmer, Preis oder Termin — das steht auf der Website und ändert sich laufend.",
      };
    }

    case "handwerker":
      return {
        text: `Guten Tag ${anrede},

vielen Dank für Ihre Nachricht.

Ich schaue mir das an und melde mich mit einer Rückmeldung bei Ihnen.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Nur Eingangsbestätigung. Zu Angebot, Preis und Terminen äußert sich der Agent nicht — bitte selbst ergänzen.",
      };

    case "mieter":
      return {
        text: `Hallo ${anrede},

danke für deine Nachricht — ist angekommen.

Ich kümmere mich darum und melde mich, sobald ich mehr sagen kann.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Eingangsbestätigung an Mieter. Kein Lösungsversprechen und keine Frist zugesagt.",
      };

    case "rechnung":
      return {
        text: `Guten Tag ${anrede},

vielen Dank, die Rechnung ist bei uns eingegangen und wird geprüft.

${UNTERSCHRIFT}

Vorgang ${f.referenz}`,
        notiz:
          "Eingangsbestätigung. Keine Zahlungszusage und kein Zahlungsziel genannt.",
      };

    // werbung, sonstige, mahnwesen, behoerde: bewusst kein Entwurf
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Stufe 2: Sprachmodell
// ---------------------------------------------------------------------------

/** Was in den Prompt geht. Rein, damit es ohne Netz prüfbar ist. */
export interface PromptLage {
  kategorie: Kategorie;
  referenz: string;
  betreff: string;
  absender: string;
  eingang: string;
  /** Der Entwurf, der heute steht — bei einer Nacherzeugung. */
  bisher?: string | null;
  /** Was der Mensch in eigenen Worten verlangt hat. */
  anweisung?: string | null;
  /** Die dauerhaften Weisungen, bereits zusammengesetzt. */
  weisungsblock?: string;
}

/**
 * Der Systemteil des Prompts.
 *
 * Reine Funktion und eigener Export, weil hier zwei Dinge
 * zusammenkommen, die sich widersprechen können: die festen Leitplanken
 * (keine Zusagen, keine Fristen) und frei geschriebener Text von Nutzern
 * — Dauerweisungen und die Anweisung am Entwurf. Die Reihenfolge ist
 * deshalb nicht beliebig: Die Leitplanken stehen zuerst und werden
 * ausdrücklich als unverhandelbar bezeichnet, die Weisungen danach und
 * ausdrücklich als auf Ton und Inhalt beschränkt.
 *
 * Das ist Prompt-Hygiene und keine Sicherheitsgrenze. Die Grenze ist,
 * dass hinter dieser Datei kein Versandweg liegt (siehe Kopf).
 */
export function baueSystemprompt(lage: PromptLage): string {
  const teile = [
    `Du schreibst eine Antwortmail für die Hausverwaltung STIG Immobilien eGbR (Westanlage 9 in Gießen, Welserstraße 10 in Ludwigshafen).

Regeln, die du nie brichst — sie gelten vor allem, was weiter unten steht:
- Keine Zusagen zu Preisen, Terminen, Verfügbarkeiten oder Zahlungen.
- Keine rechtlichen Erklärungen, keine Fristen, keine Mahnungen.
- Wenn du etwas nicht sicher weißt, schreibst du es nicht.
- Höflich und knapp. Mieter werden geduzt, Geschäftspartner gesiezt.
- Schließe mit:
${UNTERSCHRIFT}

Vorgang ${lage.referenz}`,
  ];

  if (lage.weisungsblock) teile.push(lage.weisungsblock);

  teile.push(
    "Antworte ausschließlich mit dem Mailtext, ohne Betreff und ohne Erklärungen.",
  );

  return teile.join("\n\n");
}

/** Der Nutzerteil: die eingegangene Mail, der bisherige Entwurf, die Anweisung. */
export function baueNutzertext(lage: PromptLage): string {
  const teile = [
    `Kategorie: ${lage.kategorie}\nBetreff: ${lage.betreff}\nAbsender: ${lage.absender}`,
    `Nachricht:\n${lage.eingang.slice(0, 4000)}`,
  ];

  if (lage.bisher?.trim()) {
    teile.push(
      "Das ist der Entwurf, der heute steht:\n" + lage.bisher.slice(0, 4000),
    );
  }
  if (lage.anweisung?.trim()) {
    // Zuletzt und ausdrücklich benannt: Das ist der Grund, warum dieser
    // Aufruf überhaupt stattfindet.
    teile.push(
      "Die Verwaltung verlangt für diese Fassung ausdrücklich:\n" +
        lage.anweisung.trim().slice(0, 2000) +
        "\n\nSchreibe den Entwurf daraufhin neu. Alles, was die Anweisung " +
        "nicht betrifft, bleibt inhaltlich wie es war.",
    );
  }

  return teile.join("\n\n");
}

export type ModellErgebnis =
  | { ok: true; text: string; modell: string }
  | {
      ok: false;
      fehler: string;
      code: Extract<KeinEntwurfCode, "kein_schluessel" | "modell_fehler">;
    };

/** Wie das Sprachmodell erreicht wird — einspritzbar, damit Tests ohne Netz laufen. */
export type Holer = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Die Kürze, unter der ein Modelltext als unbrauchbar gilt. */
export const MINDESTLAENGE_MODELLTEXT = 40;

/**
 * Fragt das Sprachmodell. Wirft nie.
 *
 * Jeder Fehlerweg endet in { ok: false } mit Grund und Code. Das ist der
 * Unterschied zur alten Fassung: Die gab bei jedem Fehler schlicht null
 * zurück — kein Schlüssel, Zeitüberschreitung, HTTP 500 und eine zu
 * kurze Antwort waren dasselbe Ergebnis, und am Vorgang stand hinterher
 * nichts. Der Aufrufer konnte nicht einmal unterscheiden, ob überhaupt
 * etwas versucht wurde.
 *
 * `holen` ist einspritzbar: Die Tests laufen gegen eine Attrappe, es wird
 * in keinem Test eine echte API gerufen.
 */
export async function erzeugeModellText(
  lage: PromptLage,
  opts: {
    schluessel?: string | null;
    modell?: string;
    holen?: Holer;
  } = {},
): Promise<ModellErgebnis> {
  const key = opts.schluessel ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      code: "kein_schluessel",
      fehler: KEIN_ENTWURF_GRUND.kein_schluessel,
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
        max_tokens: 900,
        system: baueSystemprompt(lage),
        messages: [{ role: "user", content: baueNutzertext(lage) }],
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        code: "modell_fehler",
        fehler: `Das Sprachmodell antwortete mit Status ${res.status}.`,
      };
    }
    const d = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (d.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (text.length < MINDESTLAENGE_MODELLTEXT) {
      return {
        ok: false,
        code: "modell_fehler",
        fehler:
          `Die Antwort war ${text.length} Zeichen lang und damit kürzer als ` +
          `${MINDESTLAENGE_MODELLTEXT} — das ist keine Mail.`,
      };
    }
    return { ok: true, text, modell };
  } catch (e) {
    return {
      ok: false,
      code: "modell_fehler",
      fehler: `Das Sprachmodell war nicht erreichbar: ${(e as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Entwurfshistorie
// ---------------------------------------------------------------------------

/**
 * Eine Fassung eines Entwurfs (db/031: entwurf_fassung).
 *
 * Die Historie wird nur ANGEFÜGT. Auch ein Zurückgehen auf eine frühere
 * Fassung erzeugt eine neue Zeile mit dem alten Text, statt die
 * dazwischenliegenden zu löschen. Bei einer Mahnung ist die Frage
 * "welcher Wortlaut stand wann" genau dann zu beantworten, wenn es
 * unangenehm wird — eine Historie, die beim Zurückgehen Zeilen verliert,
 * ist dann wertlos.
 */
export interface Fassung {
  fassung: number;
  koerper_text: string;
  /** Was verlangt wurde. null bei der ersten, die von der Automatik kam. */
  anweisung: string | null;
  quelle: "regel" | "modell" | "mensch";
  modell: string | null;
  /** Welche Dauerweisungen bei DIESER Fassung gewirkt haben. */
  weisungen: WirksameWeisung[];
  wer: string | null;
}

/** Die nächste freie Nummer. Nie die Länge der Liste — Lücken sind möglich. */
export function naechsteFassungsnummer(bisher: Fassung[]): number {
  return bisher.reduce((max, f) => Math.max(max, f.fassung), 0) + 1;
}

/**
 * Fügt eine Fassung an. Ändert die bestehenden nicht.
 *
 * Die ganze Entwurfshistorie hängt an dieser einen Zeile. Deshalb eine
 * eigene Funktion statt eines push() an der Aufrufstelle: So gibt es
 * genau einen Ort, an dem sich „anfügen“ in „ersetzen“ verwandeln
 * könnte, und genau einen Test, der das merkt.
 */
export function ergaenzeFassung(
  bisher: Fassung[],
  neu: Omit<Fassung, "fassung">,
): Fassung[] {
  return [...bisher, { ...neu, fassung: naechsteFassungsnummer(bisher) }];
}

/** Der Text, der derzeit gilt: die höchste Fassung. */
export function geltendeFassung(fassungen: Fassung[]): Fassung | null {
  if (fassungen.length === 0) return null;
  return fassungen.reduce((a, b) => (b.fassung > a.fassung ? b : a));
}

/**
 * Das Ergebnis einer Nacherzeugung.
 *
 * `ergebnis` ist fest "entwurf" und kein offener String. Der Typ sagt
 * damit, was der Code kann: Hier entsteht ein Entwurf, nie ein Versand.
 * Egal was in einer Anweisung oder einer Dauerweisung steht — es gibt in
 * dieser Datei keine Funktion, die etwas anderes erzeugen könnte.
 */
export interface Nacherzeugung {
  ergebnis: "entwurf";
  ok: boolean;
  /** Der Text, der nach dieser Handlung gilt. */
  koerper_text: string;
  /** Die vollständige Historie nach dieser Handlung. */
  fassungen: Fassung[];
  /** Die neu entstandene Fassung, oder null, wenn nichts entstand. */
  neu: Fassung | null;
  fehler?: string;
}

/**
 * Wendet ein Modellergebnis auf die Historie an.
 *
 * Reine Funktion, und das ist der Kern dieser Aufgabe: Was bei einem
 * Fehlschlag passiert, muss ohne Netz und ohne Datenbank prüfbar sein.
 *
 * Fällt die API aus, bleibt der bisherige Entwurf stehen und der Fehler
 * ist am Ergebnis ablesbar. Ein leeres Feld nach einem Fehlschlag wäre
 * der schlimmere Ausgang: Der Mensch hätte auf "neu erzeugen" geklickt,
 * seinen Text verloren und nicht erfahren, warum.
 */
export function wendeAn(
  bisher: Fassung[],
  modell: ModellErgebnis,
  opts: { anweisung: string; weisungen: WirksameWeisung[]; wer: string },
): Nacherzeugung {
  const steht = geltendeFassung(bisher);

  if (!modell.ok) {
    return {
      ergebnis: "entwurf",
      ok: false,
      // Unverändert: dieselben Fassungen, derselbe Text.
      fassungen: bisher,
      koerper_text: steht?.koerper_text ?? "",
      neu: null,
      fehler: modell.fehler,
    };
  }

  const fassungen = ergaenzeFassung(bisher, {
    koerper_text: modell.text,
    anweisung: opts.anweisung.trim() || null,
    quelle: "modell",
    modell: modell.modell,
    weisungen: opts.weisungen,
    wer: opts.wer,
  });

  return {
    ergebnis: "entwurf",
    ok: true,
    fassungen,
    koerper_text: modell.text,
    neu: fassungen[fassungen.length - 1],
  };
}

/**
 * Geht auf eine frühere Fassung zurück — durch Anfügen, nicht durch Löschen.
 *
 * Der Text der Zielfassung wird als NEUE Fassung angefügt. Die Historie
 * wächst dadurch, und das ist richtig: Dass jemand zurückgegangen ist,
 * gehört zur Geschichte dieses Textes.
 */
export function fassungZurueck(
  bisher: Fassung[],
  ziel: number,
  wer: string,
): Nacherzeugung {
  const z = bisher.find((f) => f.fassung === ziel);
  if (!z) {
    return {
      ergebnis: "entwurf",
      ok: false,
      fassungen: bisher,
      koerper_text: geltendeFassung(bisher)?.koerper_text ?? "",
      neu: null,
      fehler: `Fassung ${ziel} gibt es zu diesem Entwurf nicht.`,
    };
  }
  const fassungen = ergaenzeFassung(bisher, {
    koerper_text: z.koerper_text,
    anweisung: `Zurück auf Fassung ${ziel}.`,
    quelle: "mensch",
    modell: null,
    weisungen: z.weisungen,
    wer,
  });
  return {
    ergebnis: "entwurf",
    ok: true,
    fassungen,
    koerper_text: z.koerper_text,
    neu: fassungen[fassungen.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Herkunft mitschreiben
// ---------------------------------------------------------------------------

/**
 * Traegt die Herkunft der Einordnung nach, wo sie fehlt.
 *
 * NOTBEHELF, und als solcher gekennzeichnet. Richtig gehoert das in
 * lib/eingang.ts: Dort entsteht der Vorgang, dort liegt das Ergebnis von
 * ordneEin() samt quelle, stichwort und fundstelle vor, und dort muesste
 * es in das INSERT. Diese Datei darf lib/eingang.ts nicht anfassen --
 * ohne diesen Notbehelf blieben die Spalten aus db/031 fuer jede neu
 * eingehende Mail leer, und die Oberflaeche zeigte dauerhaft "keine
 * Herkunft festgehalten".
 *
 * Es wird bewusst nur das Unzweifelhafte nachgetragen: Nur wenn das
 * heute treffende Stichwortmuster GENAU die Kategorie liefert, die am
 * Vorgang steht, gilt die Einordnung als von diesem Stichwort
 * entschieden. Stimmt sie nicht ueberein, war es der bekannte Kontakt,
 * eine Berichtigung von Hand oder ein inzwischen geaendertes Muster --
 * dann bleibt die Spalte leer. Eine erfundene Begruendung waere
 * schlimmer als eine fehlende: Man glaubt ihr.
 */
async function traegeEinordnungNach(f: Fall) {
  const t = findeStichwort(`${f.betreff}\n${f.koerper_text}`);
  if (!t || t.kategorie !== f.kategorie) return;
  await query(
    `UPDATE vorgang
        SET einordnung_quelle = 'regel',
            einordnung_stichwort = $2,
            einordnung_fundstelle = $3,
            einordnung_am = now()
      WHERE id = $1 AND einordnung_quelle IS NULL`,
    [f.vorgang_id, t.stichwort, t.fundstelle],
  );
}

/** Vermerkt am Vorgang, dass und warum kein Entwurf entstand. */
async function vermerkeKeinEntwurf(vorgangId: string, code: KeinEntwurfCode) {
  await query(
    `UPDATE vorgang
        SET kein_entwurf_code = $2,
            kein_entwurf_grund = $3,
            kein_entwurf_am = now()
      WHERE id = $1`,
    [vorgangId, code, KEIN_ENTWURF_GRUND[code]],
  );
}

/** Löscht den Vermerk, sobald doch ein Entwurf steht. */
async function loescheKeinEntwurf(vorgangId: string) {
  await query(
    `UPDATE vorgang
        SET kein_entwurf_code = NULL,
            kein_entwurf_grund = NULL,
            kein_entwurf_am = NULL
      WHERE id = $1 AND kein_entwurf_code IS NOT NULL`,
    [vorgangId],
  );
}

/** Schreibt Herkunft und erste Fassung zu einem neuen Entwurf. */
async function vermerkeEntwurf(opts: {
  vorgangId: string;
  nachrichtId: string;
  text: string;
  quelle: "regel" | "modell";
  modell: string | null;
  weisungen: WirksameWeisung[];
}) {
  await tx(async (c) => {
    await c.query(
      `UPDATE nachricht
          SET entwurf_quelle = $2, entwurf_modell = $3, entwurf_fassung_nr = 1
        WHERE id = $1`,
      [opts.nachrichtId, opts.quelle, opts.modell],
    );
    await c.query(
      `INSERT INTO entwurf_fassung
         (nachricht_id, fassung, koerper_text, anweisung, quelle, modell,
          weisungen, wer)
       VALUES ($1, 1, $2, NULL, $3, $4, $5::jsonb, 'agent')
       ON CONFLICT (mandant_id, nachricht_id, fassung) DO NOTHING`,
      [
        opts.nachrichtId,
        opts.text,
        opts.quelle,
        opts.modell,
        JSON.stringify(opts.weisungen),
      ],
    );
  });
}

export async function bearbeite(f: Fall): Promise<AgentErgebnis> {
  // Zuerst und in jedem Fall: Die Herkunft der Einordnung nachtragen.
  // Auch (und besonders) bei einem heiklen Vorgang -- dort ist die Frage
  // "welches Stichwort hat das heikel gemacht" die einzige, die weiter
  // hilft. Genau sie war am 03.11.2026 nicht zu beantworten.
  await traegeEinordnungNach(f);

  if (f.heikel) {
    await vermerkeKeinEntwurf(f.vorgang_id, "heikel");
    return {
      vorgang_id: f.vorgang_id,
      referenz: f.referenz,
      entwurf: false,
      kein_entwurf_code: "heikel",
      grund: KEIN_ENTWURF_GRUND.heikel,
    };
  }
  if (f.kategorie === "werbung") {
    await query(`UPDATE vorgang SET status = 'erledigt' WHERE id = $1`, [
      f.vorgang_id,
    ]);
    await vermerkeKeinEntwurf(f.vorgang_id, "werbung");
    return {
      vorgang_id: f.vorgang_id,
      referenz: f.referenz,
      entwurf: false,
      kein_entwurf_code: "werbung",
      grund: KEIN_ENTWURF_GRUND.werbung,
    };
  }

  // Die Dauerweisungen stehen VOR der Wahl der Stufe: Sie entscheiden
  // mit, ob ein Textbaustein überhaupt genügt.
  const lage: Weisungslage = await ladeWeisungslage({
    kategorie: f.kategorie,
    kontaktId: f.kontakt_id,
  });
  const weisungsblock = baueWeisungsblock(lage);

  const regel = regelEntwurf(f);

  // Stufe 2 greift, wenn Stufe 1 nichts hat ODER wenn Weisungen wirksam
  // sind, die ein Textbaustein nicht befolgen kann ("antworte auf
  // Englisch"). Sonst stünde eine sichtbar eingetragene Weisung da und
  // täte nichts — derselbe stille Fehler wie das Schweigen vom 03.11.,
  // nur in der anderen Richtung.
  const modellGefragt = !regel || lage.wirksam.length > 0;

  const modell = modellGefragt
    ? await erzeugeModellText({
        kategorie: f.kategorie,
        referenz: f.referenz,
        betreff: f.betreff,
        absender: f.von_name ?? f.von_email,
        eingang: f.koerper_text,
        bisher: regel?.text ?? null,
        weisungsblock,
      })
    : null;

  let text: string;
  let notiz: string;
  let quelle: "regel" | "modell";
  let modellName: string | null = null;
  let nichtAngewandt: string | undefined;

  if (modell?.ok) {
    text = modell.text;
    modellName = modell.modell;
    quelle = "modell";
    notiz =
      `Vom Sprachmodell formuliert (${modell.modell}). Bitte vor dem ` +
      "Senden gegenlesen." +
      (lage.wirksam.length
        ? ` ${lage.wirksam.length} dauerhafte Weisung(en) angewandt.`
        : "");
  } else if (regel) {
    text = regel.text;
    quelle = "regel";
    notiz = regel.notiz;
    if (lage.wirksam.length > 0 && modell && !modell.ok) {
      // Ausdrücklich sichtbar machen: Der Textbaustein steht, die
      // Weisungen sind NICHT drin.
      nichtAngewandt =
        `${lage.wirksam.length} dauerhafte Weisung(en) konnten nicht ` +
        `angewandt werden — ${modell.fehler} Es steht der Textbaustein.`;
      notiz = `${regel.notiz} ${nichtAngewandt}`;
    }
  } else {
    const code: KeinEntwurfCode =
      modell && !modell.ok && modell.code === "kein_schluessel"
        ? "kein_schluessel"
        : modell && !modell.ok
          ? "modell_fehler"
          : "keine_regel";
    await vermerkeKeinEntwurf(f.vorgang_id, code);
    return {
      vorgang_id: f.vorgang_id,
      referenz: f.referenz,
      entwurf: false,
      kein_entwurf_code: code,
      grund:
        modell && !modell.ok
          ? `${KEIN_ENTWURF_GRUND[code]} (${modell.fehler})`
          : KEIN_ENTWURF_GRUND[code],
      weisungen: lage.wirksam,
    };
  }

  const { nachricht_id } = await erstelleEntwurf({
    vorgangId: f.vorgang_id,
    antwortAufNachrichtId: f.nachricht_id,
    koerper: text,
    verfasstVon: "agent",
    agentNotiz: notiz,
  });

  await vermerkeEntwurf({
    vorgangId: f.vorgang_id,
    nachrichtId: nachricht_id,
    text,
    quelle,
    modell: modellName,
    weisungen: quelle === "modell" ? lage.wirksam : [],
  });
  await loescheKeinEntwurf(f.vorgang_id);

  // Portalvorgänge kann die Plattform nicht selbst versenden.
  if (istPortal(f.herkunft)) {
    await query(
      `UPDATE nachricht SET versandweg = 'zum_kopieren' WHERE id = $1`,
      [nachricht_id],
    );
  }

  // Interessenten bekommen den Kanalwechsel samt Nachfassen.
  if (f.kategorie === "interessent") {
    await query(
      `UPDATE vorgang
          SET kanalwechsel = CASE WHEN kanalwechsel = 'nicht_noetig'
                                  THEN 'offen' ELSE kanalwechsel END,
              naechste_nachfassung = COALESCE(naechste_nachfassung,
                                              now() + interval '3 days')
        WHERE id = $1`,
      [f.vorgang_id],
    );
  }

  return {
    vorgang_id: f.vorgang_id,
    referenz: f.referenz,
    entwurf: true,
    nachricht_id,
    quelle,
    ...(modellName ? { modell: modellName } : {}),
    weisungen: quelle === "modell" ? lage.wirksam : [],
    ...(nichtAngewandt ? { weisungen_nicht_angewandt: nichtAngewandt } : {}),
  };
}

export async function laufAgent() {
  const faelle = await offeneFaelle();
  const ergebnisse: AgentErgebnis[] = [];
  for (const f of faelle) ergebnisse.push(await bearbeite(f));
  return {
    geprueft: faelle.length,
    entwuerfe: ergebnisse.filter((e) => e.entwurf).length,
    ergebnisse,
  };
}

/** Einzelnen Vorgang erneut durch den Agenten schicken. */
export async function bearbeiteVorgang(
  vorgangId: string,
): Promise<AgentErgebnis | null> {
  const f = await one<Fall>(
    `SELECT ${FALL_SPALTEN}
       FROM vorgang v
       JOIN LATERAL (
             SELECT id, von_name, von_email, koerper_text
               FROM nachricht
              WHERE vorgang_id = v.id AND richtung = 'ein'
              ORDER BY angelegt_am DESC LIMIT 1) n ON true
      WHERE v.id = $1`,
    [vorgangId],
  );
  if (!f) return null;
  return bearbeite(f);
}

// ---------------------------------------------------------------------------
// Neu erzeugen mit Anweisung — das Kernstück
// ---------------------------------------------------------------------------

interface EntwurfStand {
  nachricht_id: string;
  vorgang_id: string;
  referenz: string;
  kategorie: Kategorie;
  heikel: boolean;
  betreff: string;
  kontakt_id: string | null;
  koerper_text: string;
  status: string;
  eingang_text: string | null;
  eingang_von: string | null;
}

/** Lädt alles, was für eine Nacherzeugung gebraucht wird. */
async function ladeEntwurfStand(
  nachrichtId: string,
): Promise<{ stand: EntwurfStand; fassungen: Fassung[] } | null> {
  const stand = await one<EntwurfStand>(
    `SELECT n.id AS nachricht_id, n.vorgang_id, n.betreff, n.koerper_text,
            n.status,
            v.referenz, v.kategorie, v.heikel, v.kontakt_id,
            e.koerper_text AS eingang_text,
            COALESCE(e.von_name, e.von_email) AS eingang_von
       FROM nachricht n
       JOIN vorgang v ON v.id = n.vorgang_id
       LEFT JOIN LATERAL (
             SELECT koerper_text, von_name, von_email
               FROM nachricht i
              WHERE i.vorgang_id = n.vorgang_id AND i.richtung = 'ein'
              ORDER BY i.angelegt_am DESC LIMIT 1) e ON true
      WHERE n.id = $1 AND n.richtung = 'aus'`,
    [nachrichtId],
  );
  if (!stand) return null;

  const zeilen = await query<{
    fassung: number;
    koerper_text: string;
    anweisung: string | null;
    quelle: "regel" | "modell" | "mensch";
    modell: string | null;
    weisungen: WirksameWeisung[] | null;
    wer: string | null;
  }>(
    `SELECT fassung, koerper_text, anweisung, quelle, modell, weisungen, wer
       FROM entwurf_fassung
      WHERE nachricht_id = $1
      ORDER BY fassung ASC`,
    [nachrichtId],
  );

  let fassungen: Fassung[] = zeilen.map((z) => ({
    fassung: z.fassung,
    koerper_text: z.koerper_text,
    anweisung: z.anweisung,
    quelle: z.quelle,
    modell: z.modell,
    weisungen: z.weisungen ?? [],
    wer: z.wer,
  }));

  // Entwürfe aus der Zeit vor db/031 haben keine Historie. Dann gilt der
  // Text in der Nachricht als Fassung 1 -- sonst würde die erste
  // Nacherzeugung einen Text verlieren, der nie irgendwo abgelegt war.
  if (fassungen.length === 0) {
    fassungen = [
      {
        fassung: 1,
        koerper_text: stand.koerper_text,
        anweisung: null,
        quelle: "regel",
        modell: null,
        weisungen: [],
        wer: null,
      },
    ];
  }

  return { stand, fassungen };
}

export interface NeuErzeugenErgebnis extends Nacherzeugung {
  nachricht_id: string;
  vorgang_id: string;
  /** Welche Dauerweisungen bei diesem Lauf gewirkt haben. */
  weisungen: WirksameWeisung[];
}

/**
 * Erzeugt den Entwurf mit einer Anweisung neu.
 *
 * Drei Zusagen, die diese Funktion einhält:
 *
 *   1. Es entsteht ein ENTWURF und nichts anderes. Es gibt hier keinen
 *      Aufruf von sendeEntwurf() und keinen Zugriff auf einen
 *      Versandweg. Was in der Anweisung steht, kann daran nichts ändern.
 *   2. Der alte Entwurf geht nicht verloren. Geschrieben wird per INSERT
 *      in entwurf_fassung; kein UPDATE auf eine bestehende Fassung.
 *   3. Fällt das Modell aus, bleibt der bisherige Entwurf stehen und der
 *      Fehler ist am Ergebnis ablesbar.
 *
 * Bei einem heiklen Vorgang schreibt der Agent nichts — das ist dieselbe
 * Sperre wie in api/vorgang/[id]/entwurf. Ein Mensch, der den Text
 * selbst tippt, darf; ein Modell, das ihn für ihn formuliert, nicht.
 */
export async function erzeugeNeuMitAnweisung(opts: {
  nachrichtId: string;
  anweisung: string;
  wer: string;
  holen?: Holer;
}): Promise<NeuErzeugenErgebnis | null> {
  const geladen = await ladeEntwurfStand(opts.nachrichtId);
  if (!geladen) return null;
  const { stand, fassungen } = geladen;

  const leer = (fehler: string): NeuErzeugenErgebnis => ({
    ergebnis: "entwurf",
    ok: false,
    fassungen,
    koerper_text: geltendeFassung(fassungen)?.koerper_text ?? "",
    neu: null,
    fehler,
    nachricht_id: stand.nachricht_id,
    vorgang_id: stand.vorgang_id,
    weisungen: [],
  });

  if (stand.status !== "entwurf") {
    return leer(
      `Die Nachricht steht auf „${stand.status}“ und ist kein Entwurf mehr. ` +
        "Was gesendet wurde, wird nicht nachträglich umgeschrieben.",
    );
  }
  if (stand.heikel) {
    return leer(KEIN_ENTWURF_GRUND.heikel);
  }

  const lage = await ladeWeisungslage({
    kategorie: stand.kategorie,
    kontaktId: stand.kontakt_id,
  });

  const modell = await erzeugeModellText(
    {
      kategorie: stand.kategorie,
      referenz: stand.referenz,
      betreff: stand.betreff,
      absender: stand.eingang_von ?? "unbekannt",
      eingang: stand.eingang_text ?? "",
      bisher: geltendeFassung(fassungen)?.koerper_text ?? stand.koerper_text,
      anweisung: opts.anweisung,
      weisungsblock: baueWeisungsblock(lage),
    },
    { holen: opts.holen },
  );

  const ergebnis = wendeAn(fassungen, modell, {
    anweisung: opts.anweisung,
    weisungen: lage.wirksam,
    wer: opts.wer,
  });

  if (ergebnis.ok && ergebnis.neu) {
    await speichereFassung(stand, ergebnis.neu);
  }

  return {
    ...ergebnis,
    nachricht_id: stand.nachricht_id,
    vorgang_id: stand.vorgang_id,
    weisungen: lage.wirksam,
  };
}

/** Geht auf eine frühere Fassung zurück. */
export async function stelleFassungWiederHer(opts: {
  nachrichtId: string;
  ziel: number;
  wer: string;
}): Promise<NeuErzeugenErgebnis | null> {
  const geladen = await ladeEntwurfStand(opts.nachrichtId);
  if (!geladen) return null;
  const { stand, fassungen } = geladen;

  if (stand.status !== "entwurf") {
    return {
      ergebnis: "entwurf",
      ok: false,
      fassungen,
      koerper_text: geltendeFassung(fassungen)?.koerper_text ?? "",
      neu: null,
      fehler: `Die Nachricht steht auf „${stand.status}“ und ist kein Entwurf mehr.`,
      nachricht_id: stand.nachricht_id,
      vorgang_id: stand.vorgang_id,
      weisungen: [],
    };
  }

  const ergebnis = fassungZurueck(fassungen, opts.ziel, opts.wer);
  if (ergebnis.ok && ergebnis.neu) {
    await speichereFassung(stand, ergebnis.neu);
  }
  return {
    ...ergebnis,
    nachricht_id: stand.nachricht_id,
    vorgang_id: stand.vorgang_id,
    weisungen: ergebnis.neu?.weisungen ?? [],
  };
}

/**
 * Legt eine neue Fassung ab und setzt sie als geltenden Text.
 *
 * INSERT, nie UPDATE auf eine bestehende Fassung — das ist die Stelle,
 * an der „der alte Entwurf geht nicht verloren“ tatsächlich eingehalten
 * wird. Die UNIQUE-Bedingung (mandant_id, nachricht_id, fassung) aus
 * db/031 ist die zweite Sicherung: Zwei gleichzeitige Nacherzeugungen
 * können nicht dieselbe Nummer belegen, eine davon scheitert sichtbar,
 * statt die andere zu überschreiben.
 *
 * Alles in einer Transaktion: Eine Fassung in der Historie, die nicht im
 * Entwurfstext steht (oder umgekehrt), wäre schlimmer als ein Fehler.
 */
async function speichereFassung(stand: EntwurfStand, neu: Fassung) {
  await tx(async (c) => {
    await c.query(
      `INSERT INTO entwurf_fassung
         (nachricht_id, fassung, koerper_text, anweisung, quelle, modell,
          weisungen, wer)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        stand.nachricht_id,
        neu.fassung,
        neu.koerper_text,
        neu.anweisung,
        neu.quelle,
        neu.modell,
        JSON.stringify(neu.weisungen),
        neu.wer,
      ],
    );
    // Der Entwurf bleibt ein Entwurf: status wird hier nicht angefasst.
    await c.query(
      `UPDATE nachricht
          SET koerper_text = $2,
              entwurf_quelle = $3,
              entwurf_modell = $4,
              entwurf_fassung_nr = $5
        WHERE id = $1 AND status = 'entwurf'`,
      [
        stand.nachricht_id,
        neu.koerper_text,
        neu.quelle,
        neu.modell,
        neu.fassung,
      ],
    );
    await c.query(
      `INSERT INTO protokoll (vorgang_id, nachricht_id, ereignis, details)
       VALUES ($1,$2,'entwurf_neu_erzeugt',$3::jsonb)`,
      [
        stand.vorgang_id,
        stand.nachricht_id,
        JSON.stringify({
          fassung: neu.fassung,
          anweisung: neu.anweisung,
          quelle: neu.quelle,
          modell: neu.modell,
          wer: neu.wer,
          weisungen: neu.weisungen.map((w) => ({
            ebene: w.ebene,
            weisungstext: w.weisungstext,
          })),
        }),
      ],
    );
  });
}

/**
 * Trägt eine von Hand geschriebene Fassung in die Historie ein.
 *
 * Wird von PATCH /api/entwurf/[id] gerufen. Auch die Handarbeit gehört
 * in die Historie: Sonst zeigt sie bei einer Mahnung drei Fassungen vom
 * Modell und nicht den Text, der wirklich hinausging.
 */
export async function vermerkeHandfassung(opts: {
  nachrichtId: string;
  koerper: string;
  wer: string;
}): Promise<Fassung | null> {
  const geladen = await ladeEntwurfStand(opts.nachrichtId);
  if (!geladen) return null;
  const { stand, fassungen } = geladen;
  if (stand.status !== "entwurf") return null;

  const steht = geltendeFassung(fassungen);
  // Unveränderter Text erzeugt keine Fassung. Die Oberfläche schickt den
  // Inhalt des Textfelds auch dann mit, wenn niemand etwas getippt hat.
  if (steht && steht.koerper_text === opts.koerper) return null;

  const neu = ergaenzeFassung(fassungen, {
    koerper_text: opts.koerper,
    anweisung: null,
    quelle: "mensch",
    modell: null,
    weisungen: [],
    wer: opts.wer,
  });
  const letzte = neu[neu.length - 1];
  await speichereFassung(stand, letzte);
  return letzte;
}

/**
 * Die Herkunft eines Entwurfs, fertig für die Oberfläche.
 *
 * Eine Abfrage, ein Ergebnis — die Frage "auf welcher Basis ist das
 * entstanden" soll nicht drei Abrufe kosten, sonst steht sie am Ende
 * doch nicht auf der Seite.
 */
export interface Herkunft {
  kategorie: Kategorie;
  heikel: boolean;
  einordnung_quelle: string | null;
  einordnung_stichwort: string | null;
  einordnung_fundstelle: string | null;
  kein_entwurf_code: KeinEntwurfCode | null;
  kein_entwurf_grund: string | null;
  entwurf_quelle: "regel" | "modell" | "mensch" | null;
  entwurf_modell: string | null;
  entwurf_fassung_nr: number | null;
  ohne_antwort_grund: string | null;
}

export async function ladeHerkunft(
  nachrichtId: string,
): Promise<{ herkunft: Herkunft; fassungen: Fassung[]; lage: Weisungslage } | null> {
  const geladen = await ladeEntwurfStand(nachrichtId);
  if (!geladen) return null;

  const h = await one<Herkunft>(
    `SELECT v.kategorie, v.heikel,
            v.einordnung_quelle, v.einordnung_stichwort,
            v.einordnung_fundstelle,
            v.kein_entwurf_code, v.kein_entwurf_grund, v.ohne_antwort_grund,
            n.entwurf_quelle, n.entwurf_modell, n.entwurf_fassung_nr
       FROM nachricht n
       JOIN vorgang v ON v.id = n.vorgang_id
      WHERE n.id = $1`,
    [nachrichtId],
  );
  if (!h) return null;

  const lage = await ladeWeisungslage({
    kategorie: geladen.stand.kategorie,
    kontaktId: geladen.stand.kontakt_id,
  });

  return { herkunft: h, fassungen: geladen.fassungen, lage };
}

// Damit die Weisungs-Zusammensetzung auch ohne Datenbank aus dieser Datei
// erreichbar ist (Tests, Vorschau).
export { setzeWeisungenZusammen, baueWeisungsblock };
