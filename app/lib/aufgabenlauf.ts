import { NextResponse } from "next/server";
import { alleMandanten, mitMandant } from "./mandant";
import { query } from "./db";

/**
 * Gemeinsames Geruest fuer die zeitgesteuerten Laeufe.
 *
 * Die laufen ohne Anmeldung und damit ohne Mandanten im Kontext. Seit der
 * Mandantentrennung muessen sie deshalb ueber alle Mandanten gehen und
 * jeden einzeln setzen -- eine Abfrage ohne gesetzten Mandanten liefert
 * absichtlich nichts.
 *
 * Ein Fehler bei einem Mandanten bricht die anderen nicht ab. Sonst wuerde
 * ein kaputtes Postfach bei Kunde A dafuer sorgen, dass Kunde B seine
 * Entwuerfe nicht bekommt, ohne dass das irgendwo auffaellt.
 *
 * Jeder Lauf schreibt je Mandant eine Zeile in `lauf` (siehe db/020).
 * Vorher ging das Ergebnis nirgends hin: Der Zeitplaner wirft die Antwort
 * weg, Fehler landeten als console.error im Containerlog. Ein Lauf, der
 * seit Wochen scheitert, verhaelt sich dann genauso wie einer, der nichts
 * zu tun hatte -- beide schweigen.
 */
export async function fuerAlleMandanten<T>(
  name: string,
  arbeit: () => Promise<T>,
  /**
   * Leitet aus dem Ergebnis ab, was ein Mensch ansehen muss, obwohl der Lauf
   * geklappt hat. Bleibt hier draussen, weil jeder Lauf etwas anderes zaehlt
   * -- das Geruest soll nicht wissen muessen, was eine Mietabweichung ist.
   */
  hinweiseAus?: (wert: T) => string[],
): Promise<NextResponse> {
  const mandanten = await alleMandanten();
  const ergebnisse: Array<{
    mandant: string;
    ok: boolean;
    wert?: T;
    fehler?: string;
    hinweise?: string[];
  }> = [];

  for (const m of mandanten) {
    const start = Date.now();
    try {
      const wert = await mitMandant(m, arbeit);
      let hinweise: string[] = [];
      try {
        hinweise = hinweiseAus ? hinweiseAus(wert) : [];
      } catch (e) {
        // Ein Fehler beim Ableiten der Hinweise darf einen geglueckten Lauf
        // nicht zum Fehlschlag machen -- die Arbeit ist getan und in der
        // Datenbank.
        console.error(`[${name}] Hinweise fuer ${m}:`, e);
        hinweise = ["Hinweise konnten nicht ermittelt werden."];
      }
      ergebnisse.push({ mandant: m, ok: true, wert, hinweise });
      await vermerke(m, name, true, Date.now() - start, wert, null, hinweise);
    } catch (e) {
      console.error(`[${name}] Mandant ${m}:`, e);
      const meldung = (e as Error).message;
      ergebnisse.push({ mandant: m, ok: false, fehler: meldung });
      await vermerke(m, name, false, Date.now() - start, null, meldung, []);
    }
  }

  const gescheitert = ergebnisse.filter((e) => !e.ok).length;
  return NextResponse.json(
    { lauf: name, mandanten: ergebnisse.length, gescheitert, ergebnisse },
    // Teilerfolg ist kein Erfolg: Wer den Lauf ueberwacht, soll es am
    // Statuscode sehen und nicht erst im Rumpf suchen muessen.
    { status: gescheitert > 0 ? 207 : 200 },
  );
}

/**
 * Schreibt eine Protokollzeile. Scheitert das, wird es gemeldet, aber der
 * Lauf gilt weiter als erfolgreich: Das Protokoll ist die Beobachtung der
 * Arbeit, nicht die Arbeit. Ein voller Datenträger darf nicht dazu führen,
 * dass keine Mieten mehr gestellt werden.
 */
async function vermerke(
  mandant: string,
  name: string,
  ok: boolean,
  dauerMs: number,
  ergebnis: unknown,
  fehler: string | null,
  hinweise: string[],
): Promise<void> {
  try {
    await mitMandant(mandant, async () => {
      await query(
        `INSERT INTO lauf (name, dauer_ms, ok, ergebnis, fehler, hinweise)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          name,
          dauerMs,
          ok,
          verdichte(ergebnis),
          // Die Meldung, nicht der Stapel: Letzterer enthaelt Pfade und
          // mitunter Umgebungswerte und wird auf /laeufe angezeigt.
          fehler === null ? null : fehler.slice(0, 2000),
          hinweise.slice(0, 50).map((h) => h.slice(0, 500)),
        ],
      );
    });
  } catch (e) {
    console.error(`[${name}] Protokoll fuer ${mandant} nicht geschrieben:`, e);
  }
}

/** Obergrenze fuer das gespeicherte Ergebnis. */
const ERGEBNIS_MAX = 64 * 1024;

/**
 * Macht aus dem Ergebnis JSON, aber nicht beliebig viel davon.
 *
 * Die Laeufe geben unterschiedlich viel zurueck -- der Agentenlauf unter
 * Umstaenden jeden geschriebenen Entwurf im Volltext. Viermal taeglich, je
 * Mandant, auf Dauer: Das Protokoll waere dann groesser als die Daten, die
 * es beschreibt, und `lauf_aufraeumen` wuerde nur hinterherlaufen.
 *
 * Statt zu kuerzen und ungueltiges JSON zu erzeugen, wird in dem Fall ein
 * Vermerk gespeichert. Die Zeile bleibt damit vollstaendig -- Zeitpunkt,
 * Dauer, Erfolg, Hinweise -- nur die Einzelheiten fehlen, und die stehen
 * ohnehin in den Daten selbst.
 */
function verdichte(ergebnis: unknown): string | null {
  if (ergebnis === null || ergebnis === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(ergebnis);
  } catch {
    // Zirkulaere Verweise oder BigInt. Kein Grund, den Lauf zu verlieren.
    return JSON.stringify({ hinweis: "Ergebnis nicht als JSON darstellbar" });
  }
  if (text === undefined) return null;
  if (text.length <= ERGEBNIS_MAX) return text;
  return JSON.stringify({
    hinweis: "Ergebnis zu umfangreich und deshalb nicht gespeichert",
    zeichen: text.length,
  });
}

/**
 * Prueft den Aufgabenschluessel. Gibt null zurueck, wenn alles stimmt.
 *
 * Fehlt der Schluessel in der Umgebung, wird **abgewiesen** und nicht
 * durchgelassen. Vorher stand hier `if (erwartet && ...)` -- ohne gesetzten
 * Schluessel entfiel die Pruefung also ganz. Diese Pfade sind in proxy.ts
 * ausdruecklich von der Anmeldung ausgenommen (sie muessen es sein, der
 * Zeitplaner hat kein Sitzungscookie), und damit haette jeder im Internet
 * den Agenten anstossen, Entwuerfe erzeugen und Mails abrufen koennen.
 *
 * Eine fehlende Einstellung ist ein Einrichtungsfehler. Der gehoert
 * bemerkt, nicht stillschweigend in eine offene Tuer verwandelt. 503 statt
 * 401, damit im Log steht, was wirklich los ist.
 */
export function pruefeSchluessel(req: Request): NextResponse | null {
  const erwartet = process.env.AUFGABEN_SCHLUESSEL;
  if (!erwartet) {
    console.error(
      "[aufgaben] AUFGABEN_SCHLUESSEL ist nicht gesetzt — Lauf abgewiesen.",
    );
    return NextResponse.json(
      { fehler: "nicht eingerichtet" },
      { status: 503 },
    );
  }
  if (req.headers.get("x-aufgaben-schluessel") !== erwartet) {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 401 });
  }
  return null;
}
