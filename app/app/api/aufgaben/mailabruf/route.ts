import { ruefeAb } from "@/lib/imap";
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
    fuerAlleMandanten("mailabruf", async () => {
      const abruf = await ruefeAb();
      const agent = abruf.verarbeitet > 0 ? await laufAgent() : null;
      return { abruf, agent };
    })
  );
}
