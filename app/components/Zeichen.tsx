/**
 * Die Zeichen der Seitenleiste.
 *
 * Gezeichnet im Stil von SF Symbols -- runde Enden, eine Strichstaerke,
 * 24er-Raster --, damit die Navigation aussieht wie die Seitenleiste von
 * Mail oder Finder: links ein blaues Zeichen, daneben das Wort.
 *
 * Die Farbe kommt aus currentColor; welche das ist, entscheidet
 * globals.css (.navi-zeichen). Fuer die Vorlesesoftware sind die Zeichen
 * unsichtbar -- das Wort daneben sagt dasselbe.
 *
 * Fuenf davon stehen gleich noch einmal in NaviBoden.tsx, der Tableiste
 * auf dem Telefon. Bewusst doppelt: NaviBoden importiert aus Navi.tsx,
 * und Navi.tsx importiert von hier. Holte Navi die Zeichen aus NaviBoden,
 * waeren beide Dateien im Kreis voneinander abhaengig. Wer hier ein
 * Zeichen aendert, aendert es dort mit.
 */

const ZEICHEN = {
  className: "navi-zeichen",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

function Cockpit() {
  return (
    <svg {...ZEICHEN}>
      <path d="M3.5 10.25 12 3.5l8.5 6.75" />
      <path d="M5.5 9v10.75a.75.75 0 0 0 .75.75h11.5a.75.75 0 0 0 .75-.75V9" />
      <path d="M10 20.5v-5h4v5" />
    </svg>
  );
}

function Mietenbuch() {
  return (
    <svg {...ZEICHEN}>
      <rect x="3" y="4.25" width="18" height="15.5" rx="1.75" />
      <path d="M3 9.5h18" />
      <path d="M9.5 9.5v10.25" />
    </svg>
  );
}

function Objekte() {
  return (
    <svg {...ZEICHEN}>
      <path d="M4 20.5V5.75a1 1 0 0 1 1-1h7.25a1 1 0 0 1 1 1V20.5" />
      <path d="M13.25 10h5.75a1 1 0 0 1 1 1v9.5" />
      <path d="M2.75 20.5h18.5" />
      <path d="M7.25 8.5h3M7.25 12h3M7.25 15.5h3M16 13.75h1.25M16 17h1.25" />
    </svg>
  );
}

function Mieter() {
  return (
    <svg {...ZEICHEN}>
      <circle cx="9.25" cy="8" r="3.25" />
      <path d="M3.25 19.5c.55-3.05 2.9-5 6-5s5.45 1.95 6 5" />
      <path d="M15.5 4.85a3.25 3.25 0 0 1 0 6.3" />
      <path d="M17.5 14.85c1.75.65 2.9 2.2 3.25 4.65" />
    </svg>
  );
}

function Vorgaenge() {
  return (
    <svg {...ZEICHEN}>
      <path d="M3.5 13.25 5.7 5.3a1.5 1.5 0 0 1 1.45-1.05h9.7a1.5 1.5 0 0 1 1.45 1.05l2.2 7.95" />
      <path d="M3.5 13.25V18a1.75 1.75 0 0 0 1.75 1.75h13.5A1.75 1.75 0 0 0 20.5 18v-4.75h-5a3.5 3.5 0 0 1-7 0h-5Z" />
    </svg>
  );
}

function Kontoauszuege() {
  return (
    <svg {...ZEICHEN}>
      <path d="M14 3.25H6.75A1.75 1.75 0 0 0 5 5v14a1.75 1.75 0 0 0 1.75 1.75h10.5A1.75 1.75 0 0 0 19 19V8.25L14 3.25Z" />
      <path d="M14 3.25v5h5" />
      <path d="M8.5 12.5h7M8.5 16h5" />
    </svg>
  );
}

function Zahlungen() {
  return (
    <svg {...ZEICHEN}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M15.4 8.3a4.25 4.25 0 1 0 0 7.4" />
      <path d="M7.75 10.75h5.25M7.75 13.25h5.25" />
    </svg>
  );
}

function Belege() {
  return (
    <svg {...ZEICHEN}>
      <path d="M5.25 3.25h13.5v17.5l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5V3.25Z" />
      <path d="M8.75 8h6.5" />
      <path d="M8.75 11.75h6.5" />
    </svg>
  );
}

function Ablage() {
  return (
    <svg {...ZEICHEN}>
      <rect x="3.25" y="4" width="17.5" height="4.5" rx="1.25" />
      <path d="M4.75 8.5v10.25A1.25 1.25 0 0 0 6 20h12a1.25 1.25 0 0 0 1.25-1.25V8.5" />
      <path d="M10 12h4" />
    </svg>
  );
}

function Rueckstaende() {
  return (
    <svg {...ZEICHEN}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.5v5" />
      <path d="M12 16.25h.01" />
    </svg>
  );
}

function Bank() {
  return (
    <svg {...ZEICHEN}>
      <path d="M3.75 9 12 4.25 20.25 9H3.75Z" />
      <path d="M6.25 11.5v5.75M10.1 11.5v5.75M13.9 11.5v5.75M17.75 11.5v5.75" />
      <path d="M3.5 20h17" />
    </svg>
  );
}

function Automatik() {
  return (
    <svg {...ZEICHEN}>
      <path d="M19.5 9.5A7.75 7.75 0 0 0 5.2 7.6" />
      <path d="M5 3.75v4h4" />
      <path d="M4.5 14.5a7.75 7.75 0 0 0 14.3 1.9" />
      <path d="M19 20.25v-4h-4" />
    </svg>
  );
}

function Weisungen() {
  return (
    <svg {...ZEICHEN}>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="M9 4.5v-.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 .75.75v.75" />
      <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4.5" />
    </svg>
  );
}

/** Abmelden: ein Rahmen, aus dem ein Pfeil hinausfuehrt. */
export function ZeichenAbmelden() {
  return (
    <svg {...ZEICHEN}>
      <path d="M13.5 4.25H6.75A1.75 1.75 0 0 0 5 6v12a1.75 1.75 0 0 0 1.75 1.75h6.75" />
      <path d="M10.5 12h10" />
      <path d="M17.25 8.75 20.5 12l-3.25 3.25" />
    </svg>
  );
}

/** Das Menue der schmalen Breiten: drei Striche. */
export function ZeichenMenue() {
  return (
    <svg {...ZEICHEN}>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
    </svg>
  );
}

/** Der Assistent: zwei Funken, wie das Zeichen fuer KI auf Apple-Geraeten. */
export function ZeichenFunkeln() {
  return (
    <svg {...ZEICHEN}>
      <path d="M10 4.5Q11 11 17.5 12Q11 13 10 19.5Q9 13 2.5 12Q9 11 10 4.5Z" />
      <path d="M18.25 2.75Q18.6 5.15 21 5.5Q18.6 5.85 18.25 8.25Q17.9 5.85 15.5 5.5Q17.9 5.15 18.25 2.75Z" />
    </svg>
  );
}

/** Diktieren: ein Mikrofon. */
export function ZeichenMikro() {
  return (
    <svg {...ZEICHEN}>
      <rect x="9" y="3.25" width="6" height="11.5" rx="3" />
      <path d="M5.75 11.5a6.25 6.25 0 0 0 12.5 0" />
      <path d="M12 17.75v3" />
    </svg>
  );
}

/** Abschicken: ein Pfeil nach oben, wie in Nachrichten. */
export function ZeichenSenden() {
  return (
    <svg {...ZEICHEN} strokeWidth={2.25}>
      <path d="M12 18.5V6" />
      <path d="m6.75 11.25 5.25-5.25 5.25 5.25" />
    </svg>
  );
}

/** Neu verfassen: ein Blatt mit Stift, wie in Mail. */
export function ZeichenVerfassen() {
  return (
    <svg {...ZEICHEN}>
      <path d="M11.5 4.5H6.25A1.75 1.75 0 0 0 4.5 6.25v11.5c0 .97.78 1.75 1.75 1.75h11.5c.97 0 1.75-.78 1.75-1.75V12.5" />
      <path d="M17.6 3.9a1.6 1.6 0 0 1 2.3 2.3l-7.4 7.4-3.1.8.8-3.1 7.4-7.4Z" />
    </svg>
  );
}

/** Schliessen: ein Kreuz. */
export function ZeichenSchliessen() {
  return (
    <svg {...ZEICHEN}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

const ZU_WEG: Record<string, () => React.ReactElement> = {
  "/cockpit": Cockpit,
  "/mietenbuch": Mietenbuch,
  "/objekte": Objekte,
  "/stammdaten": Mieter,
  "/vorgaenge": Vorgaenge,
  "/konten": Kontoauszuege,
  "/zahlungen": Zahlungen,
  "/belege": Belege,
  "/ablage": Ablage,
  "/mahnwesen": Rueckstaende,
  "/bank": Bank,
  "/laeufe": Automatik,
  "/weisungen": Weisungen,
};

/** Das Zeichen zu einem Punkt der Navigation -- oder nichts. */
export function NaviZeichen({ weg }: { weg: string }) {
  const Z = ZU_WEG[weg];
  return Z ? <Z /> : null;
}
