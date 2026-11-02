import { ruefeAb, imapEingerichtet } from "@/lib/imap";
import { laufAgent } from "@/lib/agent";
import { fuerAlleMandanten, pruefeSchluessel } from "@/lib/aufgabenlauf";

/**
 * Holt neue Mails und laesst danach den Agenten Entwuerfe schreiben.
 * Versendet nichts.
 *
 * Nur noch Rueckfallebene: Der Regelweg ist der Cloudflare-Worker, der
 * eingehende Mails direkt an /api/mail/eingang reicht. Ohne IMAP-Zugangsdaten
 * tut dieser Lauf nichts.
 */
export async function POST(req: Request) {
  return (
    pruefeSchluessel(req) ??
    fuerAlleMandanten(
      "mailabruf",
      async () => {
        // Nicht eingerichtet ist kein Fehlschlag. Vorher scheiterte dieser
        // Lauf zweimal täglich an einer fehlenden Einstellung und stand im
        // Lagebericht als "gescheitert" -- ein Bericht, der jeden Tag
        // denselben roten Punkt zeigt, bringt einem bei, ihn zu überlesen.
        // Genau so macht es der Bankabruf schon: kein Zugang eingerichtet
        // heisst Hinweis, nicht Fehler.
        if (!imapEingerichtet()) {
          return { eingerichtet: false, abruf: null, agent: null };
        }
        const abruf = await ruefeAb();
        const agent = abruf.verarbeitet > 0 ? await laufAgent() : null;
        return { eingerichtet: true, abruf, agent };
      },
      (wert) => {
        const w = wert as { eingerichtet: boolean };
        return w.eingerichtet
          ? []
          : [
              "Kein IMAP-Zugang hinterlegt — die Rückfallebene ist nicht " +
                "eingerichtet. Der Regelweg ist der Cloudflare-Worker, der " +
                "eingehende Mails direkt einliefert. Fällt der still aus, " +
                "merkt es ohne diese zweite Leitung niemand.",
            ];
      },
    )
  );
}
