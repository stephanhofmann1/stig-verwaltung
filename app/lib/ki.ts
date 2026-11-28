/**
 * Der gemeinsame Weg zum Sprachmodell fuer alles, was in der Oberflaeche
 * mit KI arbeitet: den Assistenten (lib/assistent.ts) und das Ausfuellen
 * eines neuen Vorgangs (lib/vorgangsvorschlag.ts).
 *
 * Die Antwortentwuerfe des Agenten haben ihren eigenen Aufruf in
 * lib/agent.ts und bleiben dabei -- dort haengen Fassungen, Herkunft und
 * Weisungen dran. Hier geht es um das, was beide neuen Funktionen
 * brauchen: eine Anfrage mit Werkzeugen, eine klare Antwort, und im
 * Fehlerfall ein Satz statt einer Ausnahme.
 *
 * Gleich wie in lib/agent.ts:
 *   - derselbe Schluessel (ANTHROPIC_API_KEY) und dasselbe Modell
 *     (AGENT_MODELL, sonst die Vorgabe dort) -- eine Stelle, an der man
 *     es umstellt
 *   - `holen` ist einspritzbar: Die Tests laufen gegen eine Attrappe, kein
 *     Test ruft die echte Schnittstelle
 */

import { gewaehltesModell } from "./agent";

export type Holer = (url: string, init: RequestInit) => Promise<Response>;

/** Ein Textbaustein oder ein Werkzeugaufruf, wie die Schnittstelle sie liefert. */
export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface ModellNachricht {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface Werkzeug {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type KiErgebnis =
  | { ok: true; inhalt: Block[]; stopp: string; modell: string }
  | { ok: false; code: "kein_schluessel" | "modell_fehler"; fehler: string };

/** Der Satz, wenn kein Schluessel hinterlegt ist -- er steht in der Oberflaeche. */
export const OHNE_SCHLUESSEL =
  "Für die KI ist auf dem Server kein Schlüssel hinterlegt " +
  "(ANTHROPIC_API_KEY). Ohne ihn lässt sich nichts fragen.";

/**
 * Eine Anfrage an das Sprachmodell.
 *
 * `werkzeugPflicht` zwingt das Modell, genau dieses Werkzeug zu benutzen --
 * so kommt beim Ausfuellen eines Vorgangs garantiert ein Datensatz zurueck
 * und kein Fliesstext.
 */
export async function frageModell(opts: {
  system: string;
  nachrichten: ModellNachricht[];
  werkzeuge?: Werkzeug[];
  werkzeugPflicht?: string;
  maxTokens?: number;
  schluessel?: string | null;
  modell?: string;
  holen?: Holer;
}): Promise<KiErgebnis> {
  const key = opts.schluessel ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, code: "kein_schluessel", fehler: OHNE_SCHLUESSEL };

  const modell = opts.modell ?? gewaehltesModell();
  const holen = (opts.holen ?? (fetch as unknown as Holer)) as Holer;

  const koerper: Record<string, unknown> = {
    model: modell,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: opts.nachrichten,
  };
  if (opts.werkzeuge && opts.werkzeuge.length > 0) {
    koerper.tools = opts.werkzeuge;
    if (opts.werkzeugPflicht) {
      koerper.tool_choice = { type: "tool", name: opts.werkzeugPflicht };
    }
  }

  try {
    const res = await holen("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(koerper),
    });
    if (!res.ok) {
      return {
        ok: false,
        code: "modell_fehler",
        fehler: `Das Sprachmodell antwortete mit Status ${res.status}.`,
      };
    }
    const d = (await res.json()) as { content?: Block[]; stop_reason?: string };
    return {
      ok: true,
      inhalt: Array.isArray(d.content) ? d.content : [],
      stopp: d.stop_reason ?? "end_turn",
      modell,
    };
  } catch (e) {
    return {
      ok: false,
      code: "modell_fehler",
      fehler: `Das Sprachmodell war nicht erreichbar: ${(e as Error).message}`,
    };
  }
}

/** Der Text einer Antwort, ohne Werkzeugaufrufe. */
export function textAus(inhalt: Block[]): string {
  return inhalt
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
