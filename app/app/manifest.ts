import type { MetadataRoute } from "next";

/* ===========================================================================
   Webmanifest — was aus der Seite eine Anwendung auf dem Startbildschirm macht
   ---------------------------------------------------------------------------
   Next liefert diese Datei als /manifest.webmanifest aus und trägt den
   <link rel="manifest"> selbst in den Kopf ein. Von Hand ist in layout.tsx
   nur das nachzutragen, was Safari am Manifest vorbei liest — dort steht,
   was und warum.

   Was das Manifest bewirkt: Legt jemand die Seite auf den Startbildschirm,
   entscheidet display, ob sie mit Browserleiste oder im Vollbild startet,
   und icons entscheidet, welches Bild auf dem Startbildschirm liegt. Ohne
   Manifest ist beides dem Browser überlassen — in der Praxis heißt das:
   Adressleiste über jeder Seite und ein verkleinerter Bildschirmabzug als
   Zeichen.

   ---------------------------------------------------------------------------
   KEIN SERVICE WORKER. KEIN OFFLINEBETRIEB. KEIN ZWISCHENSPEICHER.
   ---------------------------------------------------------------------------
   Das ist eine Festlegung, keine Lücke. Wer hier später "Offline-Fähigkeit
   nachrüstet", muss erst diesen Absatz entkräften:

   Diese Anwendung zeigt Mietrückstände, Fristen und Zahlungsstände. Eine
   zwischengespeicherte Seite zeigt einen Rückstand von gestern und eine
   Frist, die inzwischen verstrichen ist — und sie zeigt es ohne jeden
   Hinweis darauf, dass die Zahl alt ist. Genau deshalb tragen alle Seiten
   `export const dynamic = "force-dynamic"` und next.config.ts
   `cacheComponents: false`: Die Zahlen sollen stimmen oder gar nicht da
   sein. Eine Seite, die nicht lädt, schickt niemanden zum Telefon, um eine
   Mahnung zu besprechen, die längst bezahlt ist.

   Auch keine Push-Benachrichtigungen und keine Berechtigungsabfragen: Ein
   Service Worker wäre deren Voraussetzung, und derselbe Einwand gilt.
   =========================================================================== */

/**
 * Titel und Beschreibung, wortgleich mit metadata.title/description in
 * app/layout.tsx.
 *
 * Doppelt geschrieben und nicht importiert: layout.tsx zieht React,
 * globals.css und die Anmeldung mit; diese Datei ist ein Route Handler und
 * soll davon nichts sehen. Den Gleichlauf hält tests/webapp.test.ts — es
 * liest beide Dateien und vergleicht die Zeichenketten.
 *
 * Warum hier kein Objekt steht: derselbe Grund wie im layout. Sobald ein
 * zweiter Vermieter die Anwendung benutzt, stünde auf seinem
 * Startbildschirm der Name einer fremden Immobilie. Der Startbildschirm
 * ist dabei der unangenehmste Ort dafür — er wird herumgezeigt.
 *
 * ANMERKUNG für den Eigentümer: Hier stehen zwei Namen nebeneinander. Der
 * Browsertab heißt "Hausverwaltung" (metadata.title), die Wortmarke in der
 * Kopfzeile "STIG Verwaltung". Das Manifest folgt dem Titel, weil der die
 * belastbarere Angabe ist — aber auf dem Startbildschirm fallen beide
 * Namen erstmals im selben Blick zusammen. Zu entscheiden ist das
 * woanders; hier wird es nur sichtbar.
 */
const NAME = "Hausverwaltung";
const BESCHREIBUNG = "Mieten, Zahlungen, Vorgänge und Freigaben an einer Stelle";

/**
 * Flächenfarbe. Muss zu --grund in app/globals.css passen (#F4F2EE).
 *
 * Als Hex und nicht als var(--grund), weil das Manifest eine JSON-Datei
 * ist und keine CSS-Marken auflöst — dieselbe Lage wie beim themeColor im
 * viewport-Export des layouts. Zwei Stellen, ein Wert: tests/webapp.test.ts
 * liest globals.css und vergleicht, sonst läuft das auseinander, ohne dass
 * es jemand sieht (auf dem Schreibtisch sieht man es gar nicht, auf dem
 * Telefon als Farbkante über der Seite).
 *
 * Nur der helle Wert: Das Manifest kennt kein prefers-color-scheme, es
 * trägt genau ein theme_color. Den Dunkelmodus bedient der viewport-Export
 * in layout.tsx, der beide Fälle führt (--grund / --dk-grund).
 *
 * theme_color und background_color sind derselbe Wert mit zwei Aufgaben:
 * theme_color färbt die Systemleiste, background_color die Fläche, die
 * beim Start steht, bevor die erste Seite da ist. Gleich gewählt, damit
 * der Start nicht blinkt.
 */
const GRUND = "#F4F2EE";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // id trennt die Kennung der Anwendung von der Startadresse. Ohne id
    // leitet der Browser sie aus start_url ab — wer start_url später
    // ändert, hat dann eine zweite Anwendung statt einer geänderten, und
    // auf dem Startbildschirm liegen zwei Zeichen nebeneinander.
    id: "/",
    name: NAME,
    // short_name steht unter dem Zeichen auf dem Startbildschirm. iOS
    // kürzt dort nach etwa zwölf Zeichen mit "…" ab; "Hausverwaltung"
    // erscheint also verkürzt. Ein kürzerer Name wäre eine Namensfrage
    // und keine technische — siehe die Anmerkung oben.
    short_name: NAME,
    description: BESCHREIBUNG,
    lang: "de",
    dir: "ltr",

    // Wohin der Start führt: das Cockpit. Es beantwortet die Frage, mit
    // der die Anwendung aufgerufen wird ("bleibt heute etwas liegen?").
    start_url: "/",
    // scope hält die Navigation im Fenster der Anwendung. Ohne scope
    // kann ein Weg, der aus der Wurzel herausführt, die Anwendung
    // verlassen und in den Browser zurückfallen — mitten im Vorgang.
    scope: "/",

    // Der eigentliche Punkt der Übung: ohne Browserleiste starten.
    // Safari ab iOS 15.4 wertet das aus; ältere Fassungen brauchen
    // zusätzlich das apple-mobile-web-app-capable aus layout.tsx.
    display: "standalone",

    background_color: GRUND,
    theme_color: GRUND,

    // Keine orientation: Das Mietenbuch ist die breiteste Tabelle der
    // Anwendung und quer besser zu lesen. Eine festgenagelte Hochkantlage
    // würde genau die Seite unbrauchbar machen, für die man das Telefon
    // dreht.

    /*
      Die Zeichen stammen alle aus app/icon.svg — dieselben zwei Blöcke,
      nur mit Fläche darunter: Der Startbildschirm kennt keine
      Durchsichtigkeit, iOS legt sonst Schwarz hinter das Zeichen. Darum
      die Umkehrung — helles Zeichen (--grund) auf Akzentfläche
      (--akzent) statt Akzentzeichen auf Nichts. Beide Werte stehen so in
      globals.css; erfunden ist keiner. Auf hellem wie dunklem
      Hintergrundbild hat das Zeichen damit eine eigene Kante.

      purpose "any"      — das Zeichen, wie es ist.
      purpose "maskable" — Android schneidet frei, oft auf einen Kreis.
                           Sicher ist nur die mittlere Kreisfläche mit
                           80 % Durchmesser; das größte Quadrat darin hat
                           0,8/√2 ≈ 56,6 % Kantenlänge. Die Blöcke sitzen
                           deshalb auf 288 von 512 px (56,25 %) und
                           können auch bei rundem Schnitt nicht
                           angeschnitten werden.

      Die 180×180 ist die Größe, die Safari als apple-touch-icon
      verlangt; sie steht hier mit, damit tests/webapp.test.ts auch sie
      auf Maße prüft. Verwiesen wird darauf zusätzlich als <link> in
      layout.tsx — Safari liest das Manifest für diesen Zweck nicht.
    */
    icons: [
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
