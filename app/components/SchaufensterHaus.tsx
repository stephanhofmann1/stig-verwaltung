"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Das Gebäude als Oberfläche — der Bestand, räumlich.
 *
 * Warum ein Modell und keine weiteren Bildschirmfotos: Die Oberfläche
 * weiter oben zeigt, wie ein Vorgang abläuft. Hier geht es um etwas
 * anderes, nämlich dass die Verwaltung dem Haus folgt und nicht einer
 * Tabelle. Dafür ist ein Grundriss die ehrlichere Darstellung — und ein
 * Modell zeigt obendrein gar keine Daten, weder echte noch erfundene.
 *
 * Maße nach den Grundrissen des Hauses: Vorderhaus 16,85 × 11,38 m,
 * fünf Ebenen über Grund, dazu ein schräg abgewinkelter Flügel, der nur
 * Erd- und erstes Obergeschoss hat. Diese eine Eigenart trägt das ganze
 * Modell; ohne sie wäre es ein beliebiger Riegel.
 *
 * Three.js wird erst geladen, wenn der Abschnitt in Sichtweite kommt.
 * Die Bibliothek wiegt mehr als die ganze übrige Seite, und wer nie bis
 * hierher scrollt, soll sie nicht bezahlen.
 */

interface Teil {
  augbraue: string;
  titel: string;
  lage: string;
  werte: [string, string, boolean?][];
}

const TEILE: Record<string, Teil> = {
  keller: {
    augbraue: "Untergeschoss · 122 m²",
    titel: "Wo die Haustechnik wohnt.",
    lage: "Gas-Zentralheizung von 1993, dazu Wohnraum. Der Heizkreis verliert laufend Wasser; das wasserführende Netz soll deshalb ganz aufgegeben werden. Ein Vorgang, der an diesem Bauteil hängt und nicht in einem Ordner.",
    werte: [
      ["Fläche", "122 m²"],
      ["Wärmeerzeuger", "Gaskessel, Bj. 1993"],
      ["Zustand Heizkreis", "undicht", true],
      ["Vorhaben", "Luft/Luft-Wärmepumpe"],
    ],
  },
  laden: {
    augbraue: "Erdgeschoss · Gewerbe",
    titel: "Laden und Büro.",
    lage: "127 m² Gewerbe im Vorderhaus, getrennt vom Wohnteil. Hier gilt Gewerbemietrecht und nicht Wohnraummietrecht — die Plattform unterscheidet das bei Fristen und Kündigungen.",
    werte: [
      ["Ladenfläche", "114,70 m²"],
      ["Büro", "12,28 m²"],
      ["Rechtsrahmen", "Gewerbemietrecht"],
    ],
  },
  fluegelEg: {
    augbraue: "Erdgeschoss · Flügel",
    titel: "Vier Zimmer am Flur.",
    lage: "Zimmer der großen WG im hinteren Flügel, aufgereiht an einem Flur. Jedes ist ein eigenes Mietverhältnis mit eigener Laufzeit.",
    werte: [
      ["Zimmer", "4"],
      ["Größen", "17,6 bis 35,9 m²"],
      ["Erschließung", "Flur, 37 m²"],
    ],
  },
  fluegelOg: {
    augbraue: "1. Obergeschoss · Flügel",
    titel: "Dieselbe Reihung, ein Geschoss höher.",
    lage: "Über dem ersten Obergeschoss endet der Flügel. Deshalb ist diese Ebene mit 272 m² die größte des Hauses — und deshalb sieht man beim Auseinanderziehen zwei Ebenen hier und fünf im Vorderhaus.",
    werte: [
      ["Zimmer", "4"],
      ["Größtes Zimmer", "35,89 m²"],
      ["Geschossfläche gesamt", "272 m²"],
      ["Darüber", "nicht bebaut"],
    ],
  },
  wg5: {
    augbraue: "1. Obergeschoss · Vorderhaus",
    titel: "Fünf Zimmer, fünf Verträge.",
    lage: "Eine Wohnung, aber fünf Mietverhältnisse mit eigenen Laufzeiten. Was frei ist, rechnet die Plattform aus den laufenden Verträgen aus — eine gepflegte Liste gibt es nicht, und damit auch keine, die jemand vergessen könnte.",
    werte: [
      ["Zimmer", "5"],
      ["Wohnen und Küche", "41,87 m²"],
      ["Größtes Zimmer", "27,16 m²"],
    ],
  },
  ober: {
    augbraue: "2. und 3. Obergeschoss",
    titel: "Zwei gleiche Ebenen.",
    lage: "148 und 146 m². Oberhalb des Flügels nur noch das Vorderhaus, vier Fensterachsen zur Straße — das Raster stammt aus dem Bauplan von 1957.",
    werte: [
      ["2. Obergeschoss", "148 m²"],
      ["3. Obergeschoss", "146 m²"],
      ["Fensterachsen", "4"],
    ],
  },
  dach: {
    augbraue: "Dachgeschoss · 126 m²",
    titel: "Unter der Schräge.",
    lage: "148 m² Grundfläche, davon 126 m² anrechenbar — den Unterschied machen die Dachschrägen, und er entscheidet über die Miete. Die Gauben sitzen dort, wo sie auch am Haus sitzen.",
    werte: [
      ["Grundfläche", "148 m²"],
      ["Anrechenbar", "126 m²"],
      ["Abzug", "Dachschrägen"],
    ],
  },
  treppe: {
    augbraue: "Treppenhaus und Aufzug",
    titel: "Das Gelenk des Hauses.",
    lage: "Beide Gebäudeteile hängen an diesem Punkt. Was hier anfällt — Reinigung, Beleuchtung, Prüfungen — ist umlagefähig und landet in der Nebenkostenabrechnung.",
    werte: [
      ["Aufzug", "2,77 m²"],
      ["Treppenhaus", "3,65 m²"],
      ["Kosten", "umlagefähig"],
    ],
  },
};

const START = "wg5";

export function SchaufensterHaus() {
  const halter = useRef<HTMLDivElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const [gewaehlt, setGewaehlt] = useState<string>(START);
  const [offen, setOffen] = useState(false);
  const [bereit, setBereit] = useState(false);
  const steuerung = useRef<{ oeffne: (a: boolean) => void; zurueck: () => void } | null>(null);

  useEffect(() => {
    const el = halter.current;
    if (!el) return;

    let abgebrochen = false;
    let aufraeumen: (() => void) | undefined;

    /*
      Erst laden, wenn der Abschnitt nah ist. Ohne das zahlt jeder
      Besucher der Startseite für eine 3D-Bibliothek, die er vielleicht
      nie zu Gesicht bekommt.
    */
    const beobachter = new IntersectionObserver(
      (eintraege) => {
        if (!eintraege.some((e) => e.isIntersecting)) return;
        beobachter.disconnect();
        void baue();
      },
      { rootMargin: "300px" },
    );
    beobachter.observe(el);

    async function baue() {
      const THREE = await import("three");
      if (abgebrochen || !leinwand.current) return;

      const FARBE = { papier: 0xf4f2ee, stein: 0xfbfaf8, kante: 0xd8d4cc, bronze: 0x8e6b3c, dunkel: 0x2a2724 };
      const szene = new THREE.Scene();
      szene.background = new THREE.Color(FARBE.papier);

      const kamera = new THREE.PerspectiveCamera(34, 1, 0.5, 400);
      const zeichner = new THREE.WebGLRenderer({ canvas: leinwand.current, antialias: true });
      zeichner.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      zeichner.shadowMap.enabled = true;
      zeichner.shadowMap.type = THREE.PCFSoftShadowMap;

      szene.add(new THREE.HemisphereLight(0xffffff, 0xdad6ce, 1.15));
      const sonne = new THREE.DirectionalLight(0xffffff, 1.5);
      sonne.position.set(20, 30, 16);
      sonne.castShadow = true;
      sonne.shadow.mapSize.set(2048, 2048);
      const d = 26;
      Object.assign(sonne.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 90 });
      sonne.shadow.bias = -0.0012;
      szene.add(sonne);

      const boden = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.15 }));
      boden.rotation.x = -Math.PI / 2;
      boden.receiveShadow = true;
      szene.add(boden);

      const haus = new THREE.Group();
      szene.add(haus);
      const stein = () => new THREE.MeshLambertMaterial({ color: FARBE.stein });

      type Teilmesh = THREE.Mesh & { userData: { teil?: string; kanten?: THREE.LineSegments } };

      function koerper(b: number, h: number, t: number, x: number, y: number, z: number, schluessel: string) {
        const g = new THREE.BoxGeometry(b, h, t);
        const m = new THREE.Mesh(g, stein()) as Teilmesh;
        m.position.set(x, y + h / 2, z);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.teil = schluessel;
        const kanten = new THREE.LineSegments(
          new THREE.EdgesGeometry(g),
          new THREE.LineBasicMaterial({ color: FARBE.kante }),
        );
        m.add(kanten);
        m.userData.kanten = kanten;
        return m;
      }

      const geschosse: THREE.Group[] = [];
      function geschoss(hub: number, teile: THREE.Object3D[]) {
        const g = new THREE.Group();
        g.userData.hub = hub;
        teile.forEach((t) => g.add(t));
        haus.add(g);
        geschosse.push(g);
        return g;
      }

      const VB = 16.85, VT = 11.38, FL = 19.5, FB = 7.0, GH = 2.8;
      const WINKEL = THREE.MathUtils.degToRad(36);
      const fx = -2.6 - Math.sin(WINKEL) * FL / 2;
      const fz = -VT / 2 - Math.cos(WINKEL) * FL / 2 + 1.2;

      function fluegelTeil(hoehe: number, unten: number, schluessel: string) {
        const m = koerper(FB, hoehe, FL, fx, unten, fz, schluessel);
        m.rotation.y = -WINKEL;
        return m;
      }

      geschoss(0, [koerper(VB, 2.4, VT, 0, -1.5, 0, "keller")]);
      geschoss(1.6, [koerper(VB, GH, VT, 0, 0.9, 0, "laden"), fluegelTeil(GH, 0.9, "fluegelEg")]);
      geschoss(3.2, [koerper(VB, GH, VT, 0, 0.9 + GH, 0, "wg5"), fluegelTeil(GH, 0.9 + GH, "fluegelOg")]);
      geschoss(4.8, [koerper(VB, GH, VT, 0, 0.9 + GH * 2, 0, "ober")]);
      geschoss(6.4, [koerper(VB, GH, VT, 0, 0.9 + GH * 3, 0, "ober")]);

      /* Satteldach als extrudierte Dreiecksform. Ein gedrehter Dreikant-
         Zylinder täte es auch, aber zwei verkettete Drehungen drehen je
         um die schon gedrehte Achse — das Dach stand dann quer. */
      const first = new THREE.Shape();
      first.moveTo(-VT / 2, 0);
      first.lineTo(VT / 2, 0);
      first.lineTo(0, 3.2);
      first.closePath();
      const dachG = new THREE.ExtrudeGeometry(first, { depth: VB, bevelEnabled: false });
      dachG.translate(0, 0, -VB / 2);
      const dach = new THREE.Mesh(dachG, stein()) as Teilmesh;
      dach.rotation.y = Math.PI / 2;
      dach.position.set(0, 0.9 + GH * 4, 0);
      dach.castShadow = true;
      dach.receiveShadow = true;
      dach.userData.teil = "dach";
      const dachKanten = new THREE.LineSegments(
        new THREE.EdgesGeometry(dachG),
        new THREE.LineBasicMaterial({ color: FARBE.kante }),
      );
      dach.add(dachKanten);
      dach.userData.kanten = dachKanten;
      geschoss(8.0, [dach]);

      /* Fassade: vier Achsen zur Straße, Ladenzone, Gauben. Die Fenster
         tragen kein userData.teil und sind deshalb nicht anklickbar —
         ein Klick trifft immer das Geschoss dahinter. */
      const FENSTER = new THREE.MeshLambertMaterial({ color: 0xbdb8af });
      const ACHSEN = 4;
      for (let g = 0; g < 3; g++) {
        const traeger = geschosse[2 + g].children[0];
        for (let i = 0; i < ACHSEN; i++) {
          const f = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.5, 0.12), FENSTER);
          f.position.set((i - (ACHSEN - 1) / 2) * (VB / ACHSEN), 0.25, VT / 2 + 0.06);
          traeger.add(f);
        }
      }
      const schaufenster = new THREE.Mesh(new THREE.BoxGeometry(VB * 0.86, 1.9, 0.12), FENSTER);
      schaufenster.position.set(0, -0.25, VT / 2 + 0.06);
      geschosse[1].children[0].add(schaufenster);

      for (let i = 0; i < ACHSEN; i++) {
        const g = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 1.5), stein());
        g.position.set((i - (ACHSEN - 1) / 2) * (VB / ACHSEN), 1.0, VT / 4 - 0.2);
        g.castShadow = true;
        g.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(g.geometry),
          new THREE.LineBasicMaterial({ color: FARBE.kante }),
        ));
        const scheibe = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 0.1), FENSTER);
        scheibe.position.set(0, 0.05, 0.78);
        g.add(scheibe);
        dach.add(g);
      }

      const fest = new THREE.Group();
      haus.add(fest);
      const kern = koerper(4.2, GH * 5 + 0.6, 3.4, -1.0, 0.9, -VT / 2 - 0.9, "treppe");
      kern.rotation.y = -WINKEL / 2.2;
      fest.add(kern);
      haus.position.y = 0.01;

      const teile: Teilmesh[] = [];
      haus.traverse((o) => {
        const m = o as Teilmesh;
        if (m.isMesh && m.userData.teil) teile.push(m);
      });

      function faerbe(schluessel: string) {
        teile.forEach((m) => {
          const an = m.userData.teil === schluessel;
          (m.material as THREE.MeshLambertMaterial).color.setHex(an ? FARBE.bronze : FARBE.stein);
          const k = m.userData.kanten;
          if (k) (k.material as THREE.LineBasicMaterial).color.setHex(an ? FARBE.dunkel : FARBE.kante);
        });
      }
      faerbe(START);

      /* Eigene Maus- und Fingerführung: OrbitControls liegt nur als
         ES-Modul mit eigenem Pfad vor, und Drehen, Neigen und Zoomen
         sind in dreißig Zeilen erledigt. */
      const SICHT = { laenge: 1.17, hoehe: 0.3, ferne: 58 };
      let laenge = SICHT.laenge, hoehe = SICHT.hoehe, ferne = SICHT.ferne;
      let zieh: { x: number; y: number; weg: number } | null = null;

      function stelleKamera() {
        hoehe = Math.max(0.06, Math.min(1.3, hoehe));
        ferne = Math.max(34, Math.min(95, ferne));
        kamera.position.set(
          Math.sin(laenge) * Math.cos(hoehe) * ferne,
          Math.sin(hoehe) * ferne,
          Math.cos(laenge) * Math.cos(hoehe) * ferne,
        );
        kamera.lookAt(-2.0, 7.0, -3.0);
      }

      const lw = leinwand.current;
      const strahl = new THREE.Raycaster();
      const zeiger = new THREE.Vector2();

      const beiDown = (e: PointerEvent) => {
        zieh = { x: e.clientX, y: e.clientY, weg: 0 };
        lw.setPointerCapture(e.pointerId);
      };
      const beiMove = (e: PointerEvent) => {
        if (!zieh) return;
        const dx = e.clientX - zieh.x, dy = e.clientY - zieh.y;
        zieh.weg += Math.abs(dx) + Math.abs(dy);
        laenge -= dx * 0.0062;
        hoehe += dy * 0.0045;
        zieh.x = e.clientX;
        zieh.y = e.clientY;
        stelleKamera();
      };
      const beiUp = (e: PointerEvent) => {
        // Ein Klick ist ein Zeigen, kein Drehen.
        if (zieh && zieh.weg < 6) {
          const r = lw.getBoundingClientRect();
          zeiger.x = ((e.clientX - r.left) / r.width) * 2 - 1;
          zeiger.y = -((e.clientY - r.top) / r.height) * 2 + 1;
          strahl.setFromCamera(zeiger, kamera);
          const treffer = strahl.intersectObjects(teile, false);
          if (treffer.length) {
            const k = (treffer[0].object as Teilmesh).userData.teil!;
            faerbe(k);
            setGewaehlt(k);
          }
        }
        zieh = null;
      };
      const beiRad = (e: WheelEvent) => {
        e.preventDefault();
        ferne += e.deltaY * 0.014;
        stelleKamera();
      };

      lw.addEventListener("pointerdown", beiDown);
      lw.addEventListener("pointermove", beiMove);
      lw.addEventListener("pointerup", beiUp);
      lw.addEventListener("pointercancel", () => { zieh = null; });
      lw.addEventListener("wheel", beiRad, { passive: false });

      let zielOffen = false;
      let fortschritt = 0;
      const sanft = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      steuerung.current = {
        oeffne: (a: boolean) => { zielOffen = a; },
        zurueck: () => {
          laenge = SICHT.laenge; hoehe = SICHT.hoehe; ferne = SICHT.ferne;
          stelleKamera();
        },
      };

      function passe() {
        const b = lw.clientWidth, h = lw.clientHeight;
        if (!b || !h) return;
        zeichner.setSize(b, h, false);
        kamera.aspect = b / h;
        kamera.updateProjectionMatrix();
      }
      const groesse = new ResizeObserver(passe);
      groesse.observe(lw);

      let laeuft = true;
      function bild() {
        if (!laeuft) return;
        const ziel = zielOffen ? 1 : 0;
        fortschritt += (ziel - fortschritt) * (sanft ? 1 : 0.1);
        geschosse.forEach((g) => { g.position.y = (g.userData.hub as number) * fortschritt; });
        fest.position.z = -fortschritt * 7;
        fest.position.x = fortschritt * 3;
        zeichner.render(szene, kamera);
        requestAnimationFrame(bild);
      }

      passe();
      stelleKamera();
      bild();
      setBereit(true);

      aufraeumen = () => {
        laeuft = false;
        groesse.disconnect();
        lw.removeEventListener("pointerdown", beiDown);
        lw.removeEventListener("pointermove", beiMove);
        lw.removeEventListener("pointerup", beiUp);
        lw.removeEventListener("wheel", beiRad);
        zeichner.dispose();
      };
    }

    return () => {
      abgebrochen = true;
      beobachter.disconnect();
      aufraeumen?.();
    };
  }, []);

  const t = TEILE[gewaehlt] ?? TEILE[START];

  return (
    <div className="s-haus" ref={halter}>
      <div className="s-haus-buehne">
        <canvas ref={leinwand} className="s-haus-leinwand" />
        {!bereit && <p className="s-haus-laedt">Modell wird geladen …</p>}
        <div className="s-haus-schalter">
          <button
            type="button"
            aria-pressed={offen}
            onClick={() => { setOffen(!offen); steuerung.current?.oeffne(!offen); }}
          >
            {offen ? "Geschosse zusammen" : "Geschosse auseinander"}
          </button>
          <button type="button" onClick={() => steuerung.current?.zurueck()}>
            Ansicht zurücksetzen
          </button>
        </div>
        <p className="s-haus-hinweis">Ziehen zum Drehen · Scrollen zum Zoomen</p>
      </div>

      <div className="s-haus-tafel">
        <p className="s-augbraue">{t.augbraue}</p>
        <h3>{t.titel}</h3>
        <p className="s-haus-lage">{t.lage}</p>
        <dl className="s-haus-werte">
          {t.werte.map(([name, wert, wach]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd className={wach ? "wach" : undefined}>{wert}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
