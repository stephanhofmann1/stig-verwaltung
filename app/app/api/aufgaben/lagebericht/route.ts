import { baueLagebericht } from "@/lib/lagebericht";
import { sendeSystemmail } from "@/lib/versand";
import { fuerAlleMandanten, pruefeSchluessel } from "@/lib/aufgabenlauf";

/**
 * Täglicher Lagebericht per Mail.
 *
 * Läuft einmal am Tag, nicht zweimal: Ein Bericht, der zweimal täglich
 * kommt, wird nach einer Woche nicht mehr gelesen -- und dann ist er
 * nutzlos, gerade an dem Tag, an dem etwas drinsteht.
 *
 * Der Bericht ist die einzige Stelle, an der die Anwendung von selbst eine
 * Mail nach außen schickt. Das ist Absicht und mit Stephan so festgelegt:
 * Mieterpost geht nie ohne Freigabe raus, ein Bericht an ihn selbst schon.
 * Ohne diese Mail wüsste niemand, dass etwas liegen bleibt.
 *
 * Empfänger ist LAGEBERICHT_AN, sonst BERICHT_AN, sonst nichts -- dann wird
 * der Bericht nur gebaut und protokolliert. Ein fehlender Empfänger ist
 * kein Grund, den Lauf scheitern zu lassen; der Bericht steht dann auf der
 * Seite "Läufe" und geht nicht verloren.
 */
export async function POST(req: Request) {
  const fehler = pruefeSchluessel(req);
  if (fehler) return fehler;

  return fuerAlleMandanten(
    "lagebericht",
    async () => {
      const bericht = await baueLagebericht();
      const an =
        process.env.LAGEBERICHT_AN ?? process.env.BERICHT_AN ?? "";

      if (!an) {
        console.warn(
          "[lagebericht] Kein Empfänger (LAGEBERICHT_AN fehlt) — " +
            "Bericht nur protokolliert.",
        );
        return {
          dringend: bericht.dringend,
          versendet: false,
          grund: "kein Empfänger eingerichtet",
          betreff: bericht.betreff,
          text: bericht.text,
          lesefehler: bericht.fehler,
        };
      }

      const ergebnis = await sendeSystemmail({
        an,
        betreff: bericht.betreff,
        text: bericht.text,
      });

      return {
        dringend: bericht.dringend,
        versendet: ergebnis.ok,
        fehler: ergebnis.fehler ?? null,
        betreff: bericht.betreff,
        text: bericht.text,
        lesefehler: bericht.fehler,
      };
    },
    // Was ein Mensch ansehen muss, obwohl der Lauf geklappt hat.
    (wert) => {
      const hinweise: string[] = [];
      const w = wert as {
        versendet: boolean;
        fehler: string | null | undefined;
        grund?: string;
        lesefehler: string[];
      };
      if (!w.versendet)
        hinweise.push(
          `Lagebericht nicht versendet: ${w.fehler ?? w.grund ?? "unbekannt"}`,
        );
      for (const f of w.lesefehler)
        hinweise.push(`Abschnitt nicht lesbar — ${f}`);
      return hinweise;
    },
  );
}
