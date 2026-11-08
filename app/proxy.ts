import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pruefeSitzung, COOKIE_NAME, type Rolle } from "@/lib/sitzung";

/**
 * Nichts ist ohne Anmeldung erreichbar.
 *
 * Offen, jeweils mit eigenem Schutz:
 *   /willkommen          — das Schaufenster: die einzige Seite, die zeigt,
 *                          wie hier gearbeitet wird. Sie liest nichts aus
 *                          der Datenbank; was dort steht, steht fest im
 *                          Quelltext (siehe lib/schaufenster.ts).
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
  "/willkommen",
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

/**
 * Wege, die BEIDE Seiten brauchen.
 *
 * Der Verwalter legt Dokumente ab, der Mieter ruft die ab, die für ihn
 * freigegeben sind — über dieselbe Route. In FUER_MIETER aufgenommen
 * würde sie den Verwaltern verschlossen (siehe `if (fuerMieter) return
 * false` unten), deshalb eine eigene Liste.
 *
 * Für den Mieter gilt hier nur Lesen. Was er sehen darf, entscheidet die
 * Route selbst (darfSehen in lib/dokumente.ts): Sie verlangt den Haken
 * `mieter_sichtbar` und holt den Bezug seines Mietverhältnisses aus der
 * Datenbank — nie aus der Anfrage. Diese Liste öffnet also die Tür, nicht
 * die Akte.
 */
const AUCH_FUER_MIETER = ["/api/dokumente"];

/** Wer nur lesen darf, kommt an keine schreibende Schnittstelle. */
const SCHREIBEND = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function darf(pfad: string, rolle: Rolle, methode: string): boolean {
  const fuerMieter = FUER_MIETER.some(
    (p) => pfad === p || pfad.startsWith(p + "/"),
  );
  const auchMieter = AUCH_FUER_MIETER.some(
    (p) => pfad === p || pfad.startsWith(p + "/"),
  );

  if (rolle === "mieter") {
    // Lesen ja, schreiben nein: Hochladen und Löschen bleiben bei der
    // Verwaltung, auch wenn der Weg derselbe ist.
    if (auchMieter) return !SCHREIBEND.has(methode);
    return fuerMieter;
  }

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

  /*
    Die Wurzel gehört dem Schaufenster -- für jeden, auch für
    Angemeldete.

    Vorher war das nach Anmeldestatus geteilt: Fremde sahen das
    Schaufenster, wer angemeldet war, sprang direkt ins Cockpit. Das war
    für den täglichen Gebrauch bequem und hatte einen Haken, der erst in
    der Benutzung auffiel: Die beiden Menschen, die hier arbeiten,
    bekamen ihre eigene Außenseite nie zu Gesicht. Wer sie herzeigen
    wollte, musste sich abmelden oder die Adresse von Hand eintippen.

    Jetzt ist stig-immobilien.de für alle dasselbe, und das Cockpit hat
    mit /cockpit eine eigene Adresse. Der Weg hinein steht auf dem
    Schaufenster und ist einen Klick lang.
  */
  if (pfad === "/") {
    const ziel = req.nextUrl.clone();
    ziel.pathname = "/willkommen";
    ziel.search = "";
    return NextResponse.redirect(ziel);
  }

  if (OFFEN.some((p) => pfad === p || pfad.startsWith(p))) {
    /*
      Hier stand bis zum 08.11.2026 zusätzlich ein x-schaufenster, aus
      dem app/layout.tsx das Grundgerüst der Seite ableitete. Das ist
      entfallen: Ein Wurzel-Layout rendert nur beim Laden der Seite, das
      Merkmal blieb also beim Wechsel in die Verwaltung stehen.
      app/schaufenster.css erkennt die Schaufensterseite jetzt im Baum.

      x-angemeldet bleibt. Es entscheidet nur über eine Beschriftung auf
      genau dieser Seite und wird mit ihr zusammen gerendert -- es kann
      nicht veralten wie ein Merkmal am Grundgerüst.
    */
    if (pfad === "/willkommen") {
      const kopfzeilen = new Headers(req.headers);
      /*
        Ob jemand angemeldet ist, entscheidet nur über eine Beschriftung:
        "Zur Verwaltung" statt "Anmelden". Die Auskunft kommt von hier
        und nicht von der Seite selbst, weil die Seite keine Daten lesen
        soll -- so steht es auf ihr, und pruefeSitzung() prüft allein die
        Signatur des Kekses, ohne die Datenbank anzufassen.
      */
      if (pruefeSitzung(req.cookies.get(COOKIE_NAME)?.value)) {
        kopfzeilen.set("x-angemeldet", "ja");
      } else {
        kopfzeilen.delete("x-angemeldet");
      }
      return NextResponse.next({ request: { headers: kopfzeilen } });
    }
    const kopfzeilen = new Headers(req.headers);
    kopfzeilen.delete("x-angemeldet");
    return NextResponse.next({ request: { headers: kopfzeilen } });
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
    /*
      Jeder geschützte Pfad führt zur Anmeldung, und zwar mit dem Ziel im
      Gepäck -- nach dem Anmelden geht es dort weiter, wo man hinwollte.

      Einen Sonderfall für die Wurzel gibt es hier nicht mehr: Sie wird
      ganz oben abgefangen und zeigt für jeden das Schaufenster. Wer
      /cockpit aufruft und nicht angemeldet ist, will sich anmelden --
      ihn stattdessen auf die Außenseite zu schicken, wäre ein Umweg mit
      verlorener Absicht.
    */
    const ziel = req.nextUrl.clone();
    ziel.pathname = "/anmelden";
    ziel.search = `?weiter=${encodeURIComponent(pfad)}`;
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
    ziel.pathname = sitzung.rolle === "mieter" ? "/mieter" : "/cockpit";
    ziel.search = "";
    return NextResponse.redirect(ziel);
  }

  /*
    Auf dem geschützten Weg wird x-angemeldet entfernt. Sonst könnte es
    jemand von außen mitschicken; es entscheidet zwar nur über eine
    Beschriftung, aber ein Kopf, den der Browser setzen darf, ist keine
    Auskunft, auf die sich etwas stützen sollte.
  */
  const kopfzeilen = new Headers(req.headers);
  kopfzeilen.delete("x-angemeldet");
  return NextResponse.next({ request: { headers: kopfzeilen } });
}

/**
 * Die Pfade, die ohne Anmeldung erreichbar bleiben müssen.
 *
 * Sie tragen keine Daten -- es sind das Zeichen der Anwendung, die
 * Grafiken für den Startbildschirm und das Manifest. Was darin steht,
 * ist bewusst objektfrei (siehe app/manifest.ts): ein Name, zwei Farben,
 * vier Bildverweise.
 *
 * Warum das zählt, und zwar genau beim Manifest:
 *
 * Ein Browser lädt `manifest.webmanifest` standardmäßig OHNE
 * Anmeldedaten -- das ist so vorgesehen und ändert sich nur dort, wo
 * man `crossorigin="use-credentials"` ausdrücklich setzt. Lag das
 * Manifest hinter dem Schutz, bekam der Browser eine Weiterleitung auf
 * die Anmeldeseite statt des Manifests. Die Folge ist still und
 * vollständig: Die Anwendung lässt sich zwar ablegen, startet aber nie
 * im Vollbild, trägt nicht ihren Namen und nicht ihr Zeichen. Nichts
 * davon meldet einen Fehler -- es sieht einfach aus wie ein Lesezeichen.
 *
 * Dasselbe gilt für apple-touch-icon.png: Safari holt es für den
 * Startbildschirm, und kommt dort eine Weiterleitung, legt iOS einen
 * verkleinerten Bildschirmabzug der Anmeldeseite ab.
 *
 * robots.txt steht aus demselben Grund hier: Eine Weiterleitung statt
 * der Datei ist für eine Suchmaschine keine Antwort.
 *
 * Gemessen am 03.11.2026 auf dem laufenden Server: /icon.svg antwortete
 * einer nicht angemeldeten Anfrage mit 307.
 */
const OEFFENTLICHE_DATEIEN = [
  "favicon.ico",
  "icon.svg",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "manifest.webmanifest",
  "robots.txt",
];

export const config = {
  // Statische Dateien und Bilder bleiben außen vor, sonst blockiert der
  // Schutz das eigene Stylesheet.
  //
  // Der Ausdruck muss ein Literal bleiben, damit Next ihn beim Bauen
  // lesen kann -- eine zur Laufzeit zusammengesetzte Zeichenkette wertet
  // er nicht aus. Die Liste oben steht deshalb daneben, und
  // tests/webapp.test.ts hält beide gegeneinander; laufen sie
  // auseinander, fällt es dort auf und nicht erst auf dem Telefon.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon-maskable-512\\.png|manifest\\.webmanifest|robots\\.txt).*)",
  ],
};

export { OEFFENTLICHE_DATEIEN };
