import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import manifest from "../app/manifest";

/**
 * Tests der Installation auf dem Telefon.
 *
 * Was hier geprueft wird, hat eine Eigenschaft gemeinsam: Es faellt auf
 * dem Schreibtisch nicht auf. Ein Manifest, das auf eine fehlende Datei
 * zeigt, eine Farbe, die von der CSS-Marke abgewichen ist, ein
 * apple-touch-icon, das es nicht gibt -- im Browser am Rechner sieht man
 * von alledem nichts. Man sieht es erst auf dem Geraet, und dort sieht
 * man nur das Ergebnis ("das Zeichen ist grau") und nicht die Ursache.
 */

const lies = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pfadVon = (p: string) => new URL(p, import.meta.url).pathname;

const globals = lies("../app/globals.css");
const layout = lies("../app/layout.tsx");
const naviBoden = lies("../components/NaviBoden.tsx");
const navi = lies("../components/Navi.tsx");
const dockerfile = lies("../Dockerfile");
const manifestQuelle = lies("../app/manifest.ts");

/**
 * Den Wert einer CSS-Marke aus globals.css holen.
 *
 * Gelesen und nicht abgeschrieben: Genau das Abschreiben ist der Fehler,
 * gegen den der halbe Block unten schuetzt.
 */
function marke(name: string): string {
  const treffer = globals.match(
    new RegExp(`^\\s*--${name}:\\s*(#[0-9A-Fa-f]{3,8})\\s*;`, "m"),
  );
  assert.ok(treffer, `--${name} steht nicht als Hexwert in globals.css`);
  return treffer![1].toUpperCase();
}

const GRUND = marke("grund");
const DK_GRUND = marke("dk-grund");

/**
 * Breite und Hoehe aus dem PNG-Kopf lesen.
 *
 * Der Kopf eines PNG ist festgelegt: acht Bytes Signatur, vier Bytes
 * Laenge, vier Bytes "IHDR", dann Breite und Hoehe als 32-Bit-Zahlen --
 * also Byte 16 bis 23 der Datei. Das steht hier ausgeschrieben, damit die
 * Pruefung keine Bibliothek braucht und damit sie wirklich die Datei
 * misst und nicht den Dateinamen glaubt.
 */
function pngMasse(datei: string): { breite: number; hoehe: number } {
  const b = readFileSync(datei);
  const signatur = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(
    b.subarray(0, 8).equals(signatur),
    `${datei} ist kein PNG -- die Signatur stimmt nicht`,
  );
  assert.equal(
    b.subarray(12, 16).toString("latin1"),
    "IHDR",
    `${datei}: der erste Abschnitt ist nicht der Kopf`,
  );
  return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) };
}

/* ===========================================================================
   Das Manifest verweist auf Dateien, die es gibt
   ---------------------------------------------------------------------------
   Verhindert wird: ein Manifest, das auf ein fehlendes oder falsch grosses
   Zeichen zeigt. Der Browser meldet das nicht. Er legt dann entweder gar
   kein Zeichen auf den Startbildschirm oder einen verkleinerten
   Bildschirmabzug der Seite -- die Installation ist still unbrauchbar, und
   gesucht wird anschliessend an der falschen Stelle, weil die Anwendung ja
   laeuft.
   =========================================================================== */
describe("Manifest: die Zeichen liegen da, wo das Manifest sie nennt", () => {
  const zeichen = manifest().icons ?? [];

  test("das Manifest nennt ueberhaupt Zeichen", () => {
    // Waere die Liste leer, wuerden die Pruefungen darunter nichts
    // beweisen -- sie laufen dann null Mal.
    assert.ok(zeichen.length >= 3, `nur ${zeichen.length} genannt`);
  });

  for (const z of zeichen) {
    test(`${z.src} existiert und misst ${z.sizes}`, () => {
      assert.ok(
        z.src.startsWith("/"),
        `${z.src} muss ein absoluter Weg sein, sonst haengt er an der Seite, ` +
          `von der aus installiert wurde`,
      );
      const datei = pfadVon("../public" + z.src);
      assert.ok(
        existsSync(datei),
        `Das Manifest nennt ${z.src}, aber app/public${z.src} gibt es nicht.`,
      );

      const [b, h] = (z.sizes ?? "").split("x").map(Number);
      assert.ok(b > 0 && h > 0, `sizes "${z.sizes}" ist keine Groessenangabe`);

      const ist = pngMasse(datei);
      assert.deepEqual(
        ist,
        { breite: b, hoehe: h },
        `${z.src} ist ${ist.breite}x${ist.hoehe}, das Manifest sagt ${z.sizes}`,
      );
    });
  }

  test("die drei verlangten Groessen sind dabei", () => {
    // 180 fuer Safari, 192 und 512 fuer Android bzw. das Manifest selbst.
    const groessen = new Set(zeichen.map((z) => z.sizes));
    for (const g of ["180x180", "192x192", "512x512"])
      assert.ok(groessen.has(g), `${g} fehlt`);
  });

  test("es gibt ein maskable-Zeichen mit Sicherheitsrand", () => {
    // Android schneidet Zeichen frei, oft auf einen Kreis. Ohne ein
    // eigenes maskable-Zeichen wird dafuer das normale genommen und die
    // Ecken der beiden Bloecke werden abgeschnitten.
    const m = zeichen.filter((z) => z.purpose === "maskable");
    assert.equal(m.length, 1, "genau eines, nicht keines und nicht zwei");

    // Und es muss ein anderes Bild sein als das ungeschnittene: Derselbe
    // Weg fuer beide hiesse, dass der Sicherheitsrand fehlt.
    const any = zeichen.filter((z) => z.purpose === "any").map((z) => z.src);
    assert.ok(
      !any.includes(m[0].src),
      `${m[0].src} steht zugleich als "any" -- dann ist es nicht eingerueckt`,
    );
  });
});

/* ===========================================================================
   Die Farben an den drei Stellen sind eine Farbe
   ---------------------------------------------------------------------------
   Verhindert wird: dass die Flaechenfarbe in globals.css, im Manifest und
   im viewport-Export des layouts auseinanderlaufen. Weder Manifest noch
   Metadaten loesen CSS-Marken auf, der Wert steht also dreimal als Hex da.
   Genau das ist am 03.11.2026 passiert -- im layout standen #F6F7F9 und
   #0E1116, waehrend globals.css #EEF1F5 und #0F1318 fuehrte. Sichtbar ist
   so ein Auseinanderlaufen nur auf dem Geraet, als Farbkante zwischen
   Systemleiste und Seite.
   =========================================================================== */
describe("Flaechenfarben: globals.css, Manifest, layout", () => {
  const m = manifest();

  test("das Manifest traegt --grund als theme_color und background_color", () => {
    assert.equal(m.theme_color?.toUpperCase(), GRUND);
    assert.equal(m.background_color?.toUpperCase(), GRUND);
  });

  test("beide Manifestfarben sind derselbe Wert", () => {
    // Sonst blinkt der Start: erst die Startflaeche, dann die Seite.
    assert.equal(m.background_color, m.theme_color);
  });

  test("das layout traegt --grund und --dk-grund als themeColor", () => {
    // Aus der Quelle gelesen: layout.tsx laesst sich hier nicht laden,
    // es zieht globals.css und die Anmeldung mit.
    const hell = layout.match(
      /prefers-color-scheme:\s*light\)",\s*color:\s*"(#[0-9A-Fa-f]{6})"/,
    );
    const dunkel = layout.match(
      /prefers-color-scheme:\s*dark\)",\s*color:\s*"(#[0-9A-Fa-f]{6})"/,
    );
    assert.ok(hell && dunkel, "themeColor fuehrt nicht mehr beide Faelle");
    assert.equal(hell![1].toUpperCase(), GRUND, "heller Wert weicht von --grund ab");
    assert.equal(
      dunkel![1].toUpperCase(),
      DK_GRUND,
      "dunkler Wert weicht von --dk-grund ab",
    );
  });

  test("im Manifest steht keine Farbe, die es in globals.css nicht gibt", () => {
    // Gegenprobe ueber die ganze Datei: Jeder Hexwert in app/manifest.ts
    // muss eine Marke aus globals.css sein. Faengt auch Farben, die
    // jemand spaeter fuer screenshots oder shortcuts dazuschreibt.
    const erlaubt = new Set(
      [...globals.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((t) =>
        t[0].toUpperCase(),
      ),
    );
    for (const t of manifestQuelle.matchAll(/#[0-9A-Fa-f]{6}\b/g))
      assert.ok(
        erlaubt.has(t[0].toUpperCase()),
        `${t[0]} steht in app/manifest.ts, aber in keiner Marke in globals.css`,
      );
  });
});

/* ===========================================================================
   Was die Installation ausmacht
   ---------------------------------------------------------------------------
   Verhindert wird: dass jemand display, start_url oder scope aendert und
   damit die Anwendung wieder im Browserfenster startet -- der ganze Zweck
   dieser Dateien. "standalone" ist die einzige Angabe, die unter dem
   Zeichen auf dem Startbildschirm eine Anwendung und keine Verknuepfung
   erzeugt.
   =========================================================================== */
describe("Manifest: Start und Darstellung", () => {
  const m = manifest();

  test('display ist "standalone"', () => {
    assert.equal(m.display, "standalone");
  });

  test("start_url und scope zeigen auf die Wurzel", () => {
    assert.equal(m.start_url, "/");
    // Ohne scope kann ein Weg aus der Wurzel heraus die Anwendung
    // verlassen und in den Browser zurueckfallen -- mitten im Vorgang.
    assert.equal(m.scope, "/");
  });

  test("lang ist de", () => {
    assert.equal(m.lang, "de");
  });

  test("es gibt eine id", () => {
    // Ohne id leitet der Browser die Kennung aus start_url ab. Wer
    // start_url spaeter aendert, hat dann zwei Anwendungen auf dem
    // Startbildschirm statt einer geaenderten.
    assert.equal(m.id, "/");
  });
});

/* ===========================================================================
   Das Manifest nennt kein Objekt und keine Anschrift
   ---------------------------------------------------------------------------
   Verhindert wird: dass auf dem Startbildschirm eines zweiten Vermieters
   die Immobilie eines Fremden steht. Der Startbildschirm ist dafuer der
   unangenehmste Ort -- er wird herumgezeigt. Dieselbe Begruendung steht
   im Kommentarkopf von app/layout.tsx; hier wird sie durchgesetzt.
   =========================================================================== */
describe("Manifest: keine Objektnamen, keine Anschriften", () => {
  const m = manifest();
  const text = [m.name, m.short_name, m.description, m.id, m.start_url]
    .filter(Boolean)
    .join(" | ");

  const OBJEKTE = [
    "Westanlage",
    "Gießen",
    "Giessen",
    "Ludwigshafen",
    "Welser",
    "Mannheim",
    "Augarten",
    "Henninger",
  ];

  for (const wort of OBJEKTE)
    test(`"${wort}" steht nicht im Manifest`, () => {
      assert.ok(
        !text.toLowerCase().includes(wort.toLowerCase()),
        `"${wort}" steht im Manifest: ${text}`,
      );
    });

  test("keine Postleitzahl und keine Hausnummer", () => {
    assert.doesNotMatch(text, /\b\d{5}\b/, "sieht nach einer Postleitzahl aus");
    assert.doesNotMatch(
      text,
      /(stra(ß|ss)e|str\.|weg|platz|allee|anlage)\s*\d/i,
      "sieht nach einer Anschrift aus",
    );
  });

  test("Name und Beschreibung stimmen mit dem layout ueberein", () => {
    // Die Zeichenketten stehen zweimal da (siehe die Begruendung in
    // app/manifest.ts). Dass sie gleich bleiben, haelt nur diese Pruefung.
    assert.ok(
      layout.includes(`title: "${m.name}"`),
      `metadata.title im layout ist nicht "${m.name}"`,
    );
    assert.ok(
      layout.includes(`description: "${m.description}"`),
      "metadata.description im layout weicht vom Manifest ab",
    );
  });
});

/* ===========================================================================
   Die neuen Dateien liegen dort, wo der Container sie findet
   ---------------------------------------------------------------------------
   Verhindert wird die Wiederholung des Abbruchs vom 03.11.2026: Das
   Dockerfile kopiert /app/public in das Laufzeitabbild. Liegt ein Zeichen
   woanders, ist es im Container nicht da -- das Manifest zeigt dann im
   Betrieb ins Leere, obwohl beim Entwickeln alles stimmte.
   tests/umgebung.test.ts prueft die andere Haelfte: dass public ueberhaupt
   im Paket liegt (git verfolgt keine leeren Verzeichnisse).
   =========================================================================== */
describe("Dockerfile nimmt die Zeichen mit", () => {
  /** Pfade, die aus der Build-Stufe uebernommen werden. */
  const kopiert = [
    ...dockerfile.matchAll(/^COPY --from=build(?:\s+--\S+)*\s+\/app\/(\S+)/gm),
  ].map((t) => t[1]);

  test("public steht in der Kopierliste des Dockerfiles", () => {
    assert.ok(
      kopiert.includes("public"),
      `public wird nicht kopiert; kopiert wird: ${kopiert.join(", ")}`,
    );
  });

  for (const z of manifest().icons ?? [])
    test(`${z.src} liegt unter public/`, () => {
      // Der Weg im Manifest ist der Weg im Netz. Ausgeliefert wird er
      // aus public/ -- nur daraus, und genau dieses Verzeichnis nimmt
      // das Dockerfile mit.
      assert.ok(
        existsSync(pfadVon("../public" + z.src)),
        `${z.src} liegt nicht in app/public/`,
      );
      assert.doesNotMatch(
        z.src,
        /\.\./,
        "ein Weg mit .. verlaesst public und wird nicht ausgeliefert",
      );
    });

  test("das apple-touch-icon aus dem layout liegt ebenfalls unter public/", () => {
    // Es haengt nicht am Manifest -- Safari liest es als <link>. Eine
    // eigene Pruefung, weil es sonst durch jedes Raster faellt.
    const t = layout.match(/url:\s*"(\/[^"]*apple-touch-icon[^"]*\.png)"/);
    assert.ok(t, "das layout nennt kein apple-touch-icon");
    assert.ok(
      existsSync(pfadVon("../public" + t![1])),
      `${t![1]} steht im layout, liegt aber nicht in app/public/`,
    );
  });
});

/* ===========================================================================
   Was Safari ausser dem Manifest braucht
   ---------------------------------------------------------------------------
   Verhindert wird: dass jemand die drei Eintraege fuer unnoetige Dopplung
   haelt und aufraeumt. Safari liest das Manifest fuer das Zeichen auf dem
   Startbildschirm nicht, und env(safe-area-inset-bottom) ist ohne
   viewport-fit=cover durchgehend 0 -- die Fusszeile laege dann auf dem
   Streifen, in dem die Geste zum Schliessen wohnt.
   =========================================================================== */
describe("iOS: die Eintraege im layout", () => {
  test("es gibt einen apple-touch-icon-Verweis mit 180x180", () => {
    assert.match(layout, /apple:\s*\[/, "icons.apple fehlt");
    assert.match(layout, /sizes:\s*"180x180"/);
  });

  test("appleWebApp ist capable", () => {
    // Setzt in dieser Next-Fassung <meta name="mobile-web-app-capable">.
    assert.match(layout, /appleWebApp:\s*\{[\s\S]*?capable:\s*true/);
  });

  test("die alte apple-mobile-web-app-capable steht auch da", () => {
    // Next hat dafuer kein Feld; Safari vor iOS 15.4 kennt nur diese.
    assert.match(layout, /"apple-mobile-web-app-capable":\s*"yes"/);
  });

  test('viewportFit ist "cover"', () => {
    assert.match(layout, /viewportFit:\s*"cover"/);
  });

  test("width=device-width steht weiterhin im viewport", () => {
    // Ohne das rechnet das Telefon in 980 px und keine der schmalen
    // Regeln aus globals.css greift -- dann hilft auch die Fussleiste
    // nichts, weil sie winzig waere.
    assert.match(layout, /width:\s*"device-width"/);
  });
});

/* ===========================================================================
   Die Fussnavigation
   ---------------------------------------------------------------------------
   Verhindert wird zweierlei. Erstens ein toter Weg: Die Leiste ist auf
   breiten Geraeten unsichtbar, ein Tippfehler im Pfad faellt beim
   Entwickeln am Rechner also nie auf. Zweitens eine Leiste aus blossen
   Symbolen -- ein Ausrufezeichen im Kreis heisst "Rueckstaende",
   "Fehler" oder "Hinweis", je nachdem, wer hinsieht.
   =========================================================================== */
describe("Fussnavigation: Ziele und Beschriftung", () => {
  const ziele = [...naviBoden.matchAll(/\{\s*href:\s*"([^"]+)"/g)].map(
    (t) => t[1],
  );

  test("die Leiste hat vier bis fuenf Ziele", () => {
    // Weniger ist keine Navigation, mehr passt auf 390 px nicht mehr
    // mit 44 px Zielflaeche nebeneinander.
    assert.ok(
      ziele.length >= 4 && ziele.length <= 5,
      `${ziele.length} Ziele: ${ziele.join(", ")}`,
    );
  });

  for (const weg of ziele)
    test(`${weg} ist ein Weg, den es in der Hauptnavigation gibt`, () => {
      assert.ok(
        navi.includes(`href: "${weg}"`),
        `${weg} steht nur in der Fussleiste -- entweder ein Tippfehler oder ` +
          `ein Ort, den es in der Hauptnavigation nicht gibt`,
      );
    });

  test("jedes Ziel hat ein Zeichen", () => {
    const mitZeichen = [
      ...naviBoden.matchAll(/^\s*"([^"]+)":\s*Zeichen\w+,/gm),
    ].map((t) => t[1]);
    assert.deepEqual(
      [...ziele].sort(),
      [...mitZeichen].sort(),
      "Ziele und Zeichen decken sich nicht",
    );
  });

  test("jedes Ziel hat ein Wort", () => {
    for (const weg of ziele) {
      const zeile = naviBoden.match(
        new RegExp(`href:\\s*"${weg.replace("/", "\\/")}",\\s*text:\\s*"([^"]+)"`),
      );
      assert.ok(zeile && zeile[1].length > 0, `${weg} hat keine Beschriftung`);
    }
    assert.match(
      naviBoden,
      /className="navi-boden-wort"/,
      "die Beschriftung wird nicht ausgegeben",
    );
  });

  test("die vereinbarten Klassennamen werden benutzt", () => {
    // Die Regeln dazu stehen in globals.css und werden dort gepflegt.
    // Ein umbenannter Klassenname hier laesst die Leiste ungestaltet
    // stehen -- sichtbar nur auf dem Telefon.
    for (const k of [
      "navi-boden",
      "navi-boden-punkt",
      "navi-boden-zeichen",
      "navi-boden-wort",
    ])
      assert.ok(
        naviBoden.includes(`"${k}"`),
        `die Klasse ${k} kommt in NaviBoden.tsx nicht vor`,
      );
  });

  test("der aktive Punkt traegt aria-current", () => {
    assert.match(naviBoden, /aria-current=\{aktiv \? "page" : undefined\}/);
  });

  test("die Zeichen sind fuer die Vorlesesoftware unsichtbar", () => {
    // Das Wort daneben sagt dasselbe; zweimal vorgelesen waere es doppelt.
    assert.match(naviBoden, /"aria-hidden":\s*true/);
  });

  test("keine Farbe und kein Stil im Markup der Zeichen", () => {
    // currentColor statt eines Wertes -- sonst muessten heller und
    // dunkler Modus hier ein zweites Mal gepflegt werden.
    assert.ok(naviBoden.includes("currentColor"));
    assert.doesNotMatch(
      naviBoden,
      /#[0-9A-Fa-f]{3,8}\b/,
      "ein fester Farbwert steht im Markup",
    );
    assert.doesNotMatch(
      naviBoden,
      /\bstyle=\{\{/,
      "ein Inline-Stil steht im Markup",
    );
  });

  test("die Leiste benutzt dieselbe Aktiv-Erkennung wie die Kopfzeile", () => {
    // Eine nachgebaute zweite Fassung laeuft auseinander, und zwar
    // unbemerkt: Beide Navigationen sind nie gleichzeitig sichtbar.
    assert.match(naviBoden, /import \{ istAktiv.*\} from "\.\/Navi"/);
    assert.match(navi, /^export function istAktiv\(/m);
  });

  test("im Mieterbereich und auf der Anmeldeseite steht keine Leiste", () => {
    // Gesperrt sind die Seiten in proxy.ts; eine Leiste, die vier
    // verbotene Wege anbietet, ist trotzdem falsch -- und am unteren
    // Rand waere sie der am leichtesten zu treffende Fehler.
    assert.match(naviBoden, /pfad === "\/anmelden"\) return null/);
    assert.match(naviBoden, /pfad\.startsWith\("\/mieter\/"\)\) return null/);
    assert.match(naviBoden, /if \(!benutzer\) return null/);
  });

  test("das layout haengt die Leiste ein", () => {
    assert.match(layout, /<NaviBoden benutzer=\{benutzer\} \/>/);
  });
});

/* ===========================================================================
   Kein Service Worker
   ---------------------------------------------------------------------------
   Verhindert wird eine Nachruestung ohne Entscheidung. Die Begruendung
   steht ausfuehrlich im Kopf von app/manifest.ts: Diese Anwendung zeigt
   Mietrueckstaende und Fristen. Eine zwischengespeicherte Seite zeigt
   einen Rueckstand von gestern -- ohne Hinweis darauf, dass die Zahl alt
   ist. Eine Seite, die nicht laedt, ist das kleinere Uebel. Wer das
   aendern will, aendert zuerst diesen Test und begruendet es dort.
   =========================================================================== */
describe("kein Service Worker, kein Offlinebetrieb", () => {
  test("niemand meldet einen Service Worker an", () => {
    for (const d of ["../app/layout.tsx", "../components/NaviBoden.tsx", "../components/Navi.tsx"])
      assert.doesNotMatch(lies(d), /serviceWorker/i, `${d} meldet einen an`);
  });

  test("es liegt keine Service-Worker-Datei in public/", () => {
    for (const n of ["sw.js", "service-worker.js", "workbox-sw.js"])
      assert.ok(
        !existsSync(pfadVon("../public/" + n)),
        `app/public/${n} ist da -- siehe den Kopf von app/manifest.ts`,
      );
  });

  test("das Manifest begruendet die Festlegung", () => {
    // Nicht am Wortlaut haengen: geprueft wird, dass der Absatz da ist.
    assert.ok(
      manifestQuelle.includes("KEIN SERVICE WORKER"),
      "der Absatz, der die Festlegung traegt, fehlt",
    );
  });

  test("das Manifest fordert keine Berechtigungen an", () => {
    const m = manifest();
    assert.equal(
      (m as Record<string, unknown>).gcm_sender_id,
      undefined,
      "gcm_sender_id richtet Push ein",
    );
  });
});

/**
 * Die oeffentlichen Dateien muessen ohne Anmeldung erreichbar sein.
 *
 * Das ist keine Formsache, sondern die Voraussetzung dafuer, dass die
 * Arbeit an der Webapp ueberhaupt wirkt.
 *
 * Ein Browser laedt manifest.webmanifest standardmaessig OHNE
 * Anmeldedaten. Lag das Manifest hinter dem Zugriffsschutz, bekam er
 * eine Weiterleitung auf die Anmeldeseite statt des Manifests -- und die
 * Folge war still und vollstaendig: Die Anwendung liess sich ablegen,
 * startete aber nie im Vollbild, trug nicht ihren Namen und nicht ihr
 * Zeichen. Nichts davon meldet einen Fehler; es sieht aus wie ein
 * Lesezeichen. Gemessen am 03.11.2026 auf dem laufenden Server:
 * /icon.svg antwortete einer nicht angemeldeten Anfrage mit 307.
 *
 * Geprueft wird gegen den Ausdruck im matcher, weil der zur Bauzeit
 * gelesen wird und kein Test ihn zur Laufzeit befragen kann.
 */
describe("oeffentliche Dateien bleiben ohne Anmeldung erreichbar", () => {
  const proxy = lies("../proxy.ts");
  const matcher =
    proxy.match(/matcher:\s*\[\s*"([^"]+)"/)?.[1] ??
    (() => {
      throw new Error("matcher in proxy.ts nicht gefunden");
    })();

  // Jede Datei, die im Paket oeffentlich ausgeliefert wird, plus die
  // Pfade, die Next aus der Dateikonvention erzeugt.
  const oeffentlich = [
    ...readdirSync(fileURLToPath(new URL("../public", import.meta.url))),
    "icon.svg",
    "manifest.webmanifest",
    "favicon.ico",
  ];

  for (const datei of oeffentlich) {
    test(`/${datei} ist vom Zugriffsschutz ausgenommen`, () => {
      // Der matcher ist ein negativer Vorgriff: Was darin steht, wird
      // NICHT abgefangen. Also muss der Dateiname dort vorkommen.
      //
      // Verglichen wird ohne Maskierungen. Der matcher steht als
      // Zeichenkette im Quelltext, der Punkt ist dort doppelt maskiert
      // ("favicon\\.ico"), und wer das nachbaut, prueft am Ende die
      // Maskierung statt des Dateinamens. Die Maskierung selbst ist
      // nicht das, was hier schieflaufen kann -- der vergessene
      // Eintrag ist es.
      const ohneMaskierung = matcher.replace(/\\/g, "");
      assert.ok(
        ohneMaskierung.includes(datei),
        `"${datei}" fehlt im matcher von proxy.ts. Eine nicht ` +
          `angemeldete Anfrage auf /${datei} bekaeme eine Weiterleitung ` +
          `auf die Anmeldeseite -- und niemand erfuehre es.`,
      );
    });
  }

  /**
   * Die Liste neben dem Ausdruck und der Ausdruck selbst muessen
   * dasselbe sagen. Der Ausdruck muss ein Literal bleiben, damit Next
   * ihn beim Bauen lesen kann; damit gibt es zwei Stellen, und zwei
   * Stellen laufen auseinander.
   */
  test("die Liste in proxy.ts deckt sich mit dem Ausdruck", () => {
    const liste = proxy
      .match(/const OEFFENTLICHE_DATEIEN = \[([\s\S]*?)\]/)?.[1]
      ?.match(/"([^"]+)"/g)
      ?.map((s) => s.replace(/"/g, ""));
    assert.ok(liste && liste.length > 0, "OEFFENTLICHE_DATEIEN nicht gefunden");
    for (const d of liste!) {
      assert.ok(
        matcher.replace(/\\/g, "").includes(d),
        `"${d}" steht in der Liste, aber nicht im matcher`,
      );
    }
  });
});
