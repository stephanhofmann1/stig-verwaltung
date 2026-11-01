import { fuerAlleMandanten, pruefeSchluessel } from "@/lib/aufgabenlauf";
import { zugaenge, hole, vermerke } from "@/lib/fints/holen";
import { one } from "@/lib/db";
import { uebernehmeSichere } from "@/lib/zuordnung";

/**
 * Nächtlicher Umsatzabruf über FinTS.
 *
 * Läuft über alle Zugänge, die aktiv sind und keine offene
 * TAN-Anforderung haben. Ein Zugang, der scheitert, hält die anderen
 * nicht auf -- sonst würde ein abgelaufenes Passwort bei der Sparkasse
 * dafür sorgen, dass auch die Volksbank nicht mehr abgeglichen wird.
 *
 * Nach dem Abruf wird zugeordnet. Das ist die Reihenfolge, auf die es
 * ankommt: Eine geholte, aber nicht zugeordnete Zahlung sieht im
 * Mahnwesen genauso aus wie keine Zahlung.
 */
export async function POST(req: Request) {
  const fehler = pruefeSchluessel(req);
  if (fehler) return fehler;

  return fuerAlleMandanten(
    "bankabruf",
    async () => {
      const liste = await zugaenge();
      const ergebnisse: Array<{
        zugang: string;
        art: string;
        neu?: number;
        bekannt?: number;
        gekuerzt?: boolean;
        meldung?: string;
      }> = [];

      for (const z of liste) {
        const k = await one<{ konto_id: string }>(
          `SELECT konto_id FROM fints_zugang WHERE id = $1`,
          [z.id],
        );
        const e = await hole(z);
        const { neu, bekannt } = await vermerke(z, k!.konto_id, e);
        ergebnisse.push({
          zugang: z.bezeichnung,
          art: e.art,
          ...(e.art === "ok"
            ? { neu, bekannt, gekuerzt: e.gekuerzt }
            : e.art === "tan_faellig"
              ? { meldung: e.hinweis }
              : { meldung: e.meldung }),
        });
      }

      // Nur zuordnen, wenn wirklich etwas Neues da ist -- ein Lauf ohne
      // neue Buchungen muss die Zuordnung nicht erneut durchrechnen.
      const etwasNeu = ergebnisse.some((e) => (e.neu ?? 0) > 0);
      const zuordnung = etwasNeu ? await uebernehmeSichere() : null;

      return { zugaenge: liste.length, ergebnisse, zuordnung };
    },
    (wert) => {
      const w = wert as {
        zugaenge: number;
        ergebnisse: Array<{
          zugang: string; art: string; gekuerzt?: boolean; meldung?: string;
        }>;
      };
      const hinweise: string[] = [];
      if (w.zugaenge === 0)
        hinweise.push(
          "Kein FinTS-Zugang eingerichtet — es wird nichts abgerufen.",
        );
      for (const e of w.ergebnisse) {
        if (e.art === "tan_faellig")
          hinweise.push(`${e.zugang}: TAN nötig — ${e.meldung}`);
        if (e.art === "fehler")
          hinweise.push(`${e.zugang}: ${e.meldung}`);
        if (e.gekuerzt)
          hinweise.push(
            `${e.zugang}: Der Zeitraum war länger als ohne TAN möglich und ` +
              "wurde gekürzt. Es fehlt Historie — über einen Dateiexport " +
              "nachholen.",
          );
      }
      return hinweise;
    },
  );
}
