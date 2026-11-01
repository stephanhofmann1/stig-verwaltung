import { laufNachfassen } from "@/lib/nachfassen";
import { fuerAlleMandanten, pruefeSchluessel } from "@/lib/aufgabenlauf";

/**
 * Taeglicher Lauf: legt Nachfass-Entwuerfe fuer Leads an, die noch nicht
 * auf WhatsApp gewechselt sind. Versendet nichts — alles geht in die Freigabe.
 */
export async function POST(req: Request) {
  return pruefeSchluessel(req) ?? fuerAlleMandanten("nachfassen", laufNachfassen);
}
