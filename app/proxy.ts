import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pruefeSitzung, COOKIE_NAME, type Rolle } from "@/lib/sitzung";

/**
 * Nichts ist ohne Anmeldung erreichbar.
 *
 * Offen, jeweils mit eigenem Schutz:
 *   /anmelden            — die Anmeldeseite selbst
 *   /api/anmelden        — dito
 *   /api/mail/eingang    — Maileingang, abgesichert über EINGANG_SCHLUESSEL
 *   /api/aufgaben/*      — Zeitsteuerung, abgesichert über AUFGABEN_SCHLUESSEL
 *   /api/oeffentlich/*   — was die Objektwebsite abfragt und einliefert:
 *                          freie Einheiten raus, Anfragen rein. Enthält
 *                          bewusst keine personenbezogenen Daten.
 *
 * Seit es Mieterzugänge gibt, genügt "angemeldet" nicht mehr als Prüfung.
 * Ein Mieter ist angemeldet und hat in der Verwaltung trotzdem nichts zu
 * suchen. Deshalb entscheidet ab hier die Rolle, nicht die bloße Existenz
 * einer Sitzung.
 *
 * Der Proxy läuft auf dem Node-Laufzeitsystem, die Signatur des
 * Sitzungscookies wird also schon hier geprüft und nicht erst in der Seite.
 */

const OFFEN = [
  "/anmelden",
  "/api/anmelden",
  "/api/mail/eingang",
  "/api/aufgaben/",
  "/api/oeffentlich/",
  // Mieter haben noch keine Sitzung, wenn sie hier ankommen. Der Schutz
  // liegt im Einmallink selbst: Er wird an die im Mietvertrag hinterlegte
  // Adresse geschickt, gilt eine Stunde und laesst sich einmal einloesen.
  "/mieter/anmelden",
  "/mieter/einloesen",
  "/api/mieter/anmelden",
];

/** Was ein Mieter sehen darf — alles andere ist Verwaltung. */
const FUER_MIETER = ["/mieter"];

/** Wer nur lesen darf, kommt an keine schreibende Schnittstelle. */
const SCHREIBEND = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function darf(pfad: string, rolle: Rolle, methode: string): boolean {
  const fuerMieter = FUER_MIETER.some(
    (p) => pfad === p || pfad.startsWith(p + "/"),
  );

  if (rolle === "mieter") return fuerMieter;

  // Verwalter und Lesende haben im Mieterbereich nichts verloren — der zeigt
  // ohnehin nur die Sicht eines einzelnen Mietverhältnisses.
  if (fuerMieter) return false;

  if (rolle === "lesen") return !SCHREIBEND.has(methode);
  return true;
}

/** Zeichenweiser Vergleich ohne frühen Abbruch. */
function gleich(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return unterschied === 0;
}

export function proxy(req: NextRequest) {
  const pfad = req.nextUrl.pathname;

  if (OFFEN.some((p) => pfad === p || pfad.startsWith(p))) {
    return NextResponse.next();
  }

  // Der Aufgabenschlüssel öffnet zusätzlich die Entwurfs-Schnittstelle.
  // Darüber schreibt der Agent von außen Antworten vor — er hat keine
  // Sitzung und soll auch keine bekommen. Bewusst nur dieser eine Pfad:
  // Stammdaten und Zahlungen bleiben der Anmeldung vorbehalten.
  if (
    /^\/api\/vorgang\/[^/]+\/entwurf$/.test(pfad) &&
    gleich(req.headers.get("x-aufgaben-schluessel"), process.env.AUFGABEN_SCHLUESSEL)
  ) {
    return NextResponse.next();
  }

  const sitzung = pruefeSitzung(req.cookies.get(COOKIE_NAME)?.value);

  if (!sitzung) {
    // Schnittstellen bekommen einen Statuscode, keine Umleitung —
    // sonst liefert ein fehlgeschlagener Abruf stillschweigend HTML.
    if (pfad.startsWith("/api/")) {
      return NextResponse.json({ fehler: "nicht angemeldet" }, { status: 401 });
    }
    const ziel = req.nextUrl.clone();
    ziel.pathname = "/anmelden";
    ziel.search = pfad === "/" ? "" : `?weiter=${encodeURIComponent(pfad)}`;
    return NextResponse.redirect(ziel);
  }

  if (!darf(pfad, sitzung.rolle, req.method)) {
    if (pfad.startsWith("/api/")) {
      return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
    }
    // Angemeldet, aber am falschen Ort: dorthin schicken, wo die Rolle
    // hingehört, statt zurück auf die Anmeldung. Sonst sieht es für einen
    // Mieter wie ein kaputtes Login aus.
    const ziel = req.nextUrl.clone();
    ziel.pathname = sitzung.rolle === "mieter" ? "/mieter" : "/";
    ziel.search = "";
    return NextResponse.redirect(ziel);
  }

  return NextResponse.next();
}

export const config = {
  // Statische Dateien und Bilder bleiben außen vor, sonst blockiert der
  // Schutz das eigene Stylesheet.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
