import { laufAgent } from "@/lib/agent";
import { fuerAlleMandanten, pruefeSchluessel } from "@/lib/aufgabenlauf";

/**
 * Laesst den Agenten ueber alle offenen, unbeantworteten Vorgaenge laufen
 * und Entwuerfe anlegen. Versendet nichts.
 */
export async function POST(req: Request) {
  return pruefeSchluessel(req) ?? fuerAlleMandanten("agent", laufAgent);
}
