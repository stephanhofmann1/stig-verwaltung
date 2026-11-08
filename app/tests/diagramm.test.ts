import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  achsenstufen,
  balkenGruppe,
  endlich,
  flaechePfad,
  lesbareStufe,
  linienPfad,
  reihenPunkte,
  ringAnteil,
  skala,
  stapel,
  ZIELBREITE,
  zeichenbreite,
} from "../lib/diagramm";

/**
 * Tests fuer das Rechnen hinter den Diagrammen.
 *
 * Eine Grafik wird noch bereitwilliger geglaubt als eine Zahl: Sie sieht aus
 * wie eine Beobachtung. Darum pruefen diese Tests vor allem die Faelle, in
 * denen ein Bild eine Aussage behaupten wuerde, die in den Daten nicht steht:
 *
 *   - Aus keiner Zahl darf keine Null werden. Eine Linie, die auf Null
 *     faellt, weil Daten fehlen, erzeugt am Ende ein Mahnschreiben an
 *     jemanden, der bezahlt hat.
 *   - Kein `NaN` darf ins Markup. `height="NaN"` laesst das SVG stumm
 *     verschwinden; die Zahl fehlt dann, ohne dass es auffaellt.
 *   - Gestapelte Segmente muessen zusammen genau die Gesamthoehe ergeben.
 *     Eine Luecke aus Rundung sieht aus wie ein Posten, den es nicht gibt.
 */

/** Hilft beim Pruefen: nichts im Ergebnis darf NaN oder Infinity sein. */
function alleEndlich(werte: number[], was: string): void {
  for (const w of werte) {
    assert.ok(
      Number.isFinite(w),
      `${was}: ${w} ist keine endliche Zahl und wuerde so ins Markup geraten`,
    );
  }
}

// ---------------------------------------------------------------------------
// endlich()
// ---------------------------------------------------------------------------

describe("endlich", () => {
  // Verhindert: ein `numeric` aus Postgres kommt als "" oder als NaN an und
  // wird zu height="NaN". Das SVG verschwindet lautlos.
  test("laesst echte Zahlen durch und faengt alles andere ab", () => {
    assert.equal(endlich(0), 0);
    assert.equal(endlich(-12.5), -12.5);
    assert.equal(endlich(NaN), null);
    assert.equal(endlich(Infinity), null);
    assert.equal(endlich(-Infinity), null);
    assert.equal(endlich(null), null);
    assert.equal(endlich(undefined), null);
  });

  test("die Null bleibt eine Null und wird nicht zu null", () => {
    // Sonst wuerde ein Monat mit nachweislich 0 EUR zur Luecke -- und damit
    // zur Aussage "unbekannt", wo "nichts" bekannt ist.
    assert.notEqual(endlich(0), null);
  });
});

// ---------------------------------------------------------------------------
// Lesbare Stufen
// ---------------------------------------------------------------------------

describe("lesbare Achsenstufe", () => {
  // Verhindert: eine Achse, die bei 4.731 EUR endet. Niemand rechnet beim
  // Lesen eines Balkens, er vergleicht ihn mit der Gitterlinie darueber --
  // und die muss eine Zahl sein, die man im Kopf behaelt.
  test("4.731 wird 5.000 — nachgerechnet", () => {
    // floor(log10(4731)) = 3  ->  Potenz 1.000
    // 4731 / 1000 = 4,731     ->  erste Stufe >= 4,731 aus [1; 2; 2,5; 5] = 5
    // 5 * 1.000 = 5.000
    assert.equal(lesbareStufe(4731), 5000);
  });

  test("die vier Stufen 1, 2, 2,5 und 5 werden alle getroffen", () => {
    assert.equal(lesbareStufe(1), 1);
    assert.equal(lesbareStufe(1.2), 2);
    assert.equal(lesbareStufe(2.1), 2.5);
    assert.equal(lesbareStufe(2.6), 5);
    assert.equal(lesbareStufe(9000), 10000);
    // Genau auf der Potenz: 1.000 bleibt 1.000 und wird nicht 2.000.
    assert.equal(lesbareStufe(1000), 1000);
    // Unter eins: 0,42 -> Potenz 0,1 -> Rest 4,2 -> Stufe 5 -> 0,5
    assert.equal(lesbareStufe(0.42), 0.5);
  });

  test("0, Negatives und Unzahlen ergeben 0 und keinen Fehler", () => {
    assert.equal(lesbareStufe(0), 0);
    assert.equal(lesbareStufe(-5), 0);
    assert.equal(lesbareStufe(NaN), 0);
    assert.equal(lesbareStufe(Infinity), 0);
    assert.equal(lesbareStufe(null), 0);
  });
});

describe("Achsenstufen", () => {
  test("vier Abschnitte ergeben fuenf Werte — nachgerechnet", () => {
    // 0 + 5000 * i/4 fuer i = 0..4
    assert.deepEqual(achsenstufen(5000, 4), [0, 1250, 2500, 3750, 5000]);
  });

  test("mit negativem Rand laufen die Stufen durch die Null", () => {
    // -200 + 700 * i/4 fuer i = 0..4
    assert.deepEqual(achsenstufen(500, 4, -200), [-200, -25, 150, 325, 500]);
  });

  test("ohne Spanne gibt es keine Gitterlinien", () => {
    // Keine erfundene Achse: Vier Linien um ein leeres Feld lesen sich wie
    // "gemessen und nichts gefunden".
    assert.deepEqual(achsenstufen(0, 4), []);
    assert.deepEqual(achsenstufen(NaN, 4), []);
    assert.deepEqual(achsenstufen(-10, 4), []);
  });

  test("anzahl 0 fuehrt nicht zur Division durch Null", () => {
    assert.deepEqual(achsenstufen(100, 0), [0, 100]);
  });
});

// ---------------------------------------------------------------------------
// Skala
// ---------------------------------------------------------------------------

describe("Skala", () => {
  test("Abbildung Wert auf Pixel — nachgerechnet", () => {
    // max = lesbareStufe(4731) = 5.000; min = 0; Spanne = 5.000; Hoehe 100
    // y(w) = 100 * (5000 - w) / 5000
    //   y(5000) = 0 ; y(2500) = 50 ; y(4731) = 100*269/5000 = 5,38
    const s = skala([1200, 4731, 0], 100);
    assert.equal(s.max, 5000);
    assert.equal(s.min, 0);
    assert.equal(s.nulllinie, 100);
    assert.equal(s.y(5000), 0);
    assert.equal(s.y(2500), 50);
    assert.equal(s.y(4731), 5.38);
    assert.equal(s.laenge(4731), 94.62);
    // Vier Abschnitte waeren 1.250er-Schritte; fuenf sind 1.000er, und der
    // Abstand ist damit selbst eine lesbare Stufe. Siehe waehleGitter().
    assert.deepEqual(s.gitter, [0, 1000, 2000, 3000, 4000, 5000]);
    assert.equal(s.leer, false);
  });

  test("leere Reihe: keine Skala, kein NaN, erkennbarer Leerzustand", () => {
    const s = skala([], 100);
    assert.equal(s.leer, true, "eine leere Reihe muss als leer gemeldet werden");
    assert.equal(s.max, 0);
    assert.equal(s.nulllinie, 100);
    alleEndlich([s.y(5), s.laenge(5), s.nulllinie, s.max, s.min], "leere Skala");
    assert.deepEqual(s.gitter, []);
  });

  test("alle Werte 0: keine Division durch Null, kein NaN, leer", () => {
    // Das ist der Fall "Konto angelegt, noch nichts eingelesen". Ein
    // Diagramm mit Hoehe 0 wuerde behaupten, es sei gemessen worden.
    const s = skala([0, 0, 0], 100);
    assert.equal(s.leer, true);
    assert.equal(s.laenge(0), 0);
    alleEndlich([s.y(0), s.laenge(0), s.nulllinie], "Nullreihe");
  });

  test("ein einziger Wert fuellt die Skala, ohne sie zu sprengen", () => {
    // max = lesbareStufe(450) = 500; y(450) = 100*(500-450)/500 = 10
    const s = skala([450], 100);
    assert.equal(s.leer, false);
    assert.equal(s.max, 500);
    assert.equal(s.y(450), 10);
    assert.equal(s.laenge(450), 90);
  });

  test("negative Werte werden nicht auf 0 geklemmt — nachgerechnet", () => {
    // Sonst verschwindet ein Monat mit mehr Ausgaben als Einnahmen aus dem
    // Bild, und der Verlauf sieht gesund aus.
    // max = 500; min = -lesbareStufe(200) = -200; Spanne = 700
    // nulllinie = 100 * 500/700 = 71,43
    // y(-200) = 100 * (500+200)/700 = 100 -> laenge = 100 - 71,43 = 28,57
    const s = skala([-200, 500], 100);
    assert.equal(s.max, 500);
    assert.equal(s.min, -200);
    assert.equal(s.nulllinie, 71.43);
    assert.equal(s.y(-200), 100);
    assert.equal(s.laenge(-200), 28.57);
    assert.ok(s.laenge(-200) > 0, "ein negativer Wert braucht eine Hoehe");
  });

  test("ein Wert viel groesser als alle anderen loescht die kleinen nicht aus", () => {
    // Darlehensauszahlung neben Monatsmieten. Der kleine Balken wird winzig
    // -- aber er bleibt groesser als 0, und die Begleittabelle hat die Zahl.
    const s = skala([10, 10, 10000], 100);
    assert.equal(s.max, 10000);
    assert.ok(s.laenge(10) > 0, "der kleine Wert darf nicht auf 0 fallen");
    assert.ok(s.laenge(10) < 1, "er darf aber auch nicht uebertrieben werden");
    assert.equal(s.laenge(10000), 100);
  });

  test("NaN und Infinity in der Reihe veraendern die Skala nicht und erzeugen kein NaN", () => {
    const s = skala([NaN, Infinity, -Infinity, 500, null, undefined], 100);
    assert.equal(s.max, 500, "nur die echte Zahl bestimmt die Achse");
    assert.equal(s.min, 0);
    alleEndlich(
      [s.y(NaN), s.y(Infinity), s.laenge(NaN), s.laenge(Infinity), s.nulllinie],
      "Skala mit Unzahlen",
    );
    // Eine Unzahl ist eine Luecke und kein Nullwert: Laenge 0, also wird
    // nichts gezeichnet -- und nicht ein Balken bis zur Nulllinie.
    assert.equal(s.laenge(NaN), 0);
  });

  test("eine Hoehe von NaN macht die Skala nicht unbrauchbar", () => {
    const s = skala([100], NaN);
    alleEndlich([s.hoehe, s.nulllinie, s.y(100), s.laenge(100)], "Hoehe NaN");
    assert.equal(s.hoehe, 0);
  });

  test("Werte ueber dem Rand werden geklemmt, nicht hinausgezeichnet", () => {
    const s = skala([100], 100);
    assert.equal(s.y(999999), 0);
    assert.equal(s.laenge(999999), s.nulllinie);
  });
});

// ---------------------------------------------------------------------------
// Balken
// ---------------------------------------------------------------------------

describe("Balkengruppe", () => {
  test("Rechtecke je Spur — nachgerechnet", () => {
    // Breite 300, drei Werte -> Spur 100; luft 0 -> Balkenbreite 100
    // max = lesbareStufe(100) = 100 -> nulllinie = 100
    const { felder, spur } = balkenGruppe([100, null, 50], 300, 100, {
      luft: 0,
    });
    assert.equal(spur, 100);
    assert.deepEqual(
      felder.map((f) => [f.x, f.y, f.breite, f.hoehe, f.luecke]),
      [
        [0, 0, 100, 100, false],
        [100, 100, 100, 0, true],
        [200, 50, 100, 50, false],
      ],
    );
    assert.deepEqual(
      felder.map((f) => f.mitte),
      [50, 150, 250],
    );
  });

  test("eine Luecke bleibt eine Luecke und wird nicht Hoehe 0 auf der Achse", () => {
    // `luecke: true` ist der Unterschied, an dem die Komponente entscheidet,
    // ob sie ein blasses Band statt eines Balkens zeichnet. Ohne das Feld
    // waere ein fehlender Monat optisch ein Monat mit 0 EUR.
    const { felder } = balkenGruppe([null, 100], 200, 100);
    assert.equal(felder[0].luecke, true);
    assert.equal(felder[0].wert, null);
    assert.equal(felder[1].luecke, false);
  });

  test("leere Reihe: keine Felder, keine Division durch Null", () => {
    const { felder, spur, skala: s } = balkenGruppe([], 300, 100);
    assert.deepEqual(felder, []);
    assert.equal(spur, 0);
    assert.equal(s.leer, true);
  });

  test("negative Werte haengen unter der Nulllinie — nachgerechnet", () => {
    // max = 100; min = -50; Spanne 150; nulllinie = 100*100/150 = 66,67
    // y(-50) = 100*(100+50)/150 = 100 -> laenge 33,33
    const { felder } = balkenGruppe([-50, 100], 200, 100, { luft: 0 });
    assert.equal(felder[0].negativ, true);
    assert.equal(felder[0].y, 66.67, "das Rechteck beginnt an der Nulllinie");
    assert.equal(felder[0].hoehe, 33.33);
    assert.equal(felder[1].negativ, false);
    assert.equal(felder[1].hoehe, 66.67);
    // Zusammen genau die Gesamthoehe -- die Nulllinie liegt richtig.
    assert.equal(felder[0].hoehe + felder[1].hoehe, 100);
  });

  test("NaN in der Reihe wird zur Luecke und nicht zu height=NaN", () => {
    const { felder } = balkenGruppe([NaN, Infinity, 100], 300, 100);
    assert.equal(felder[0].luecke, true);
    assert.equal(felder[1].luecke, true);
    alleEndlich(
      felder.flatMap((f) => [f.x, f.y, f.breite, f.hoehe, f.mitte]),
      "Balkenfelder",
    );
  });

  test("zwoelf Monate passen in dieselbe Breite wie drei", () => {
    const a = balkenGruppe(new Array(12).fill(100), 300, 100);
    const b = balkenGruppe(new Array(3).fill(100), 300, 100);
    assert.equal(a.spur, 25);
    assert.equal(b.spur, 100);
    assert.ok(a.felder[11].x + a.felder[11].breite <= 300);
  });
});

// ---------------------------------------------------------------------------
// Stapel
// ---------------------------------------------------------------------------

describe("Stapel", () => {
  test("drei gleiche Teile ergeben zusammen GENAU die Gesamthoehe", () => {
    // Der teure Fehler: 100 / 3 = 33,333... Rundete man jede Laenge
    // einzeln, kaeme 3 * 33,33 = 99,99 heraus -- ein halber Pixel Luft am
    // Ende des Balkens, der aussieht wie ein vierter Posten.
    // Gerechnet wird darum ueber die Grenzen: 33,33 | 66,67 | 100.
    const { segmente } = stapel(
      [
        { name: "a", wert: 1 },
        { name: "b", wert: 1 },
        { name: "c", wert: 1 },
      ],
      100,
    );
    assert.deepEqual(
      segmente.map((s) => [s.versatz, s.laenge]),
      [
        [0, 33.33],
        [33.33, 33.34],
        [66.67, 33.33],
      ],
    );
    const summe = segmente.reduce((s, g) => s + g.laenge, 0);
    assert.equal(summe.toFixed(1), (100).toFixed(1));
    assert.ok(Math.abs(summe - 100) < 1e-6, "kein Rest aus Rundung");
  });

  test("der letzte Versatz plus Laenge trifft die Gesamthoehe auf den Pixel", () => {
    const { segmente } = stapel(
      [
        { name: "a", wert: 410.55 },
        { name: "b", wert: 89.45 },
        { name: "c", wert: 713.33 },
      ],
      247,
    );
    const letzter = segmente[segmente.length - 1];
    assert.equal(letzter.versatz + letzter.laenge, 247);
  });

  test("alle Teile 0: keine Division durch Null, kein NaN, erkennbar leer", () => {
    const st = stapel(
      [
        { name: "a", wert: 0 },
        { name: "b", wert: 0 },
      ],
      100,
    );
    assert.equal(st.leer, true, "ohne Bezug ist nichts zu zeichnen");
    alleEndlich(
      st.segmente.flatMap((s) => [s.versatz, s.laenge]),
      "Nullstapel",
    );
    assert.deepEqual(
      st.segmente.map((s) => s.laenge),
      [0, 0],
    );
  });

  test("ein negativer Teil wird gemeldet und nicht stillschweigend auf 0 geklemmt", () => {
    // Geklemmt saehe die Grafik richtig aus, und der Fehler in den Daten
    // bliebe unentdeckt. Der Wert bleibt deshalb im Ergebnis stehen, und
    // `ungueltig` zwingt die Komponente, ihn zu benennen.
    const st = stapel(
      [
        { name: "a", wert: 100 },
        { name: "b", wert: -20 },
      ],
      100,
    );
    assert.equal(st.ungueltig, true);
    assert.equal(st.segmente[1].ungueltig, true);
    assert.equal(st.segmente[1].wert, -20, "der Wert bleibt sichtbar");
    assert.equal(st.segmente[1].laenge, 0, "gezeichnet wird er nicht");
    assert.equal(st.segmente[0].laenge, 100);
  });

  test("NaN als Teil wird gemeldet und erzeugt kein NaN in der Laenge", () => {
    const st = stapel(
      [
        { name: "a", wert: NaN },
        { name: "b", wert: Infinity },
        { name: "c", wert: 50 },
      ],
      100,
    );
    assert.equal(st.ungueltig, true);
    assert.equal(st.segmente[0].wert, null);
    alleEndlich(
      st.segmente.flatMap((s) => [s.versatz, s.laenge]),
      "Stapel mit Unzahlen",
    );
    assert.equal(st.summe, 50);
  });

  test("mit eigenem Bezug bleibt der nicht erklaerte Rest sichtbar leer", () => {
    // Das ist die Aussage der Mietstruktur-Karte: Erklaeren die Posten das
    // Soll nicht vollstaendig, darf sich der Streifen nicht selbst auf
    // 100 Prozent normieren -- sonst verschwindet die Differenz.
    const st = stapel(
      [
        { name: "a", wert: 40 },
        { name: "b", wert: 20 },
      ],
      100,
      100,
    );
    assert.equal(st.bezug, 100);
    assert.equal(st.summe, 60);
    assert.deepEqual(
      st.segmente.map((s) => s.laenge),
      [40, 20],
    );
  });

  test("keine Teile: leer, ohne Fehler", () => {
    const st = stapel([], 100);
    assert.equal(st.leer, true);
    assert.deepEqual(st.segmente, []);
  });
});

// ---------------------------------------------------------------------------
// Linien
// ---------------------------------------------------------------------------

describe("Linienpfad", () => {
  test("ein durchgehender Zug", () => {
    assert.equal(
      linienPfad([
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]),
      "M 0,10 L 10,0",
    );
  });

  test("eine Luecke trennt den Pfad — der wichtigste Fall", () => {
    // Wuerde die Linie durchgezogen, behauptete sie fuer den fehlenden
    // Monat einen Zwischenwert: eine Zahl, die niemand kennt.
    const d = linienPfad([
      { x: 0, y: 10 },
      { x: 10, y: 8 },
      null,
      { x: 30, y: 4 },
      { x: 40, y: 2 },
    ]);
    assert.equal(d, "M 0,10 L 10,8 M 30,4 L 40,2");
    assert.equal(d.split("M").length - 1, 2, "zwei getrennte Abschnitte");
    assert.ok(!d.includes("L 30,4 L 40,2 M"), "keine Bruecke ueber die Luecke");
  });

  test("ein einzelner Punkt wird gezeichnet und nicht verschluckt", () => {
    // `M` allein zeichnet nichts. Mit dem `L` auf sich selbst setzt ein
    // runder Linienkopf einen Punkt -- der einzige Monat mit Daten bleibt
    // sichtbar.
    assert.equal(linienPfad([{ x: 5, y: 5 }]), "M 5,5 L 5,5");
  });

  test("leere Reihe ergibt einen leeren Pfad und kein 'M NaN'", () => {
    assert.equal(linienPfad([]), "");
    assert.equal(linienPfad([null, null]), "");
  });

  test("NaN-Koordinaten werden zur Luecke, nicht zu 'M NaN,5'", () => {
    const d = linienPfad([
      { x: NaN, y: 5 },
      { x: 10, y: 5 },
      { x: 20, y: Infinity },
    ]);
    assert.ok(!d.includes("NaN"), `kein NaN im Pfad, war: ${d}`);
    assert.ok(!d.includes("Infinity"), `kein Infinity im Pfad, war: ${d}`);
    assert.equal(d, "M 10,5 L 10,5");
  });
});

describe("Flaechenpfad", () => {
  test("die Flaeche schliesst auf der Grundlinie — nachgerechnet", () => {
    assert.equal(
      flaechePfad(
        [
          { x: 0, y: 10 },
          { x: 10, y: 8 },
        ],
        20,
      ),
      "M 0,20 L 0,10 L 10,8 L 10,20 Z",
    );
  });

  test("eine Luecke bekommt keine Flaeche uebergespannt", () => {
    // Eine Flaeche ueber die Luecke faerbt einen Monat ein, ueber den
    // nichts bekannt ist -- optisch dieselbe Luege wie eine Nulllinie.
    const d = flaechePfad(
      [{ x: 0, y: 10 }, null, { x: 20, y: 5 }],
      20,
    );
    assert.equal(d.split("Z").length - 1, 2, "zwei geschlossene Formen");
    assert.equal(d, "M 0,20 L 0,10 L 0,20 Z M 20,20 L 20,5 L 20,20 Z");
  });

  test("eine Grundlinie von NaN ergibt keinen Pfad", () => {
    assert.equal(flaechePfad([{ x: 0, y: 1 }], NaN), "");
  });
});

// ---------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------

describe("Ring", () => {
  test("ein Viertel ist ein Viertel — nachgerechnet", () => {
    // Umfang 100 (als pathLength am Kreis): Strich 25, Luecke 75.
    const r = ringAnteil(0.25);
    assert.equal(r.umfang, 100);
    assert.equal(r.strokeDasharray, "25 75");
    assert.equal(r.prozent, 25);
  });

  test("ueber 1 legt sich der Ring nicht zweimal herum", () => {
    // Eine Quote von 150 Prozent ist keine Quote mehr. Geklemmt wird mit
    // `anteil()` aus lib/kennzahlen.ts -- nicht mit einer zweiten Fassung.
    assert.equal(ringAnteil(1.5).strokeDasharray, "100 0");
    assert.equal(ringAnteil(1.5).prozent, 100);
  });

  test("Negatives und Unzahlen ergeben einen leeren Ring, kein NaN", () => {
    for (const w of [-0.3, NaN, Infinity, null, undefined]) {
      const r = ringAnteil(w);
      assert.equal(r.strokeDasharray, "0 100", `bei ${String(w)}`);
      assert.ok(!r.strokeDasharray.includes("NaN"));
      assert.ok(Number.isFinite(r.prozent));
    }
  });

  test("ein Umfang von 0 oder NaN faellt auf 100 zurueck", () => {
    assert.equal(ringAnteil(0.5, 0).umfang, 100);
    assert.equal(ringAnteil(0.5, NaN).umfang, 100);
    assert.equal(ringAnteil(0.5, 0).strokeDasharray, "50 50");
  });
});

// ---------------------------------------------------------------------------
// Reihenpunkte
// ---------------------------------------------------------------------------

describe("Reihenpunkte", () => {
  test("Punkte liegen in der Mitte der Spur — nachgerechnet", () => {
    // max = lesbareStufe(30) = 50; Hoehe 100 -> y(10) = 100*(50-10)/50 = 80
    // Breite 300, drei Werte -> Spur 100 -> x = 50, 150, 250
    const s = skala([10, null, 30], 100);
    const p = reihenPunkte([10, null, 30], 300, s);
    assert.deepEqual(p, [{ x: 50, y: 80 }, null, { x: 250, y: 40 }]);
  });

  test("eine Luecke bleibt null und wird nicht zum Punkt auf der Nulllinie", () => {
    // Das ist dieselbe Regel wie ueberall hier: Ein Punkt auf der
    // Nulllinie heisst "nichts bezahlt", null heisst "nicht bekannt".
    const s = skala([100, null], 100);
    assert.equal(reihenPunkte([100, null], 200, s)[1], null);
  });

  test("leere Reihe und Unzahlen erzeugen keine NaN-Koordinaten", () => {
    const s = skala([100], 100);
    assert.deepEqual(reihenPunkte([], 300, s), []);
    const p = reihenPunkte([NaN, Infinity, 100], 300, s);
    assert.deepEqual([p[0], p[1]], [null, null]);
    assert.ok(Number.isFinite(p[2]?.x) && Number.isFinite(p[2]?.y));
  });
});

// ---------------------------------------------------------------------------
// Dieselbe Funktion fuer jede Bestandsgroesse
// ---------------------------------------------------------------------------

describe("Skala und Stapel ueber Bestandsgroessen hinweg", () => {
  // Verhindert den Fehler, der erst beim ZWEITEN Kunden auffaellt -- und dort
  // als unbrauchbares Diagramm, nicht als Absturz.
  //
  // Diese Anwendung wird mehreren Verwaltern angeboten. Eine Skala, die auf
  // einen Betragsbereich geeicht ist (feste Stufenbreiten, feste
  // Achsengrenzen, Schwellen wie "ab 5.000 EUR"), liefert einem Verwalter mit
  // Einzelzimmern um 400 EUR eine einzige Saeule und einem Verwalter mit
  // einem Gewerbeobjekt von 80.000 EUR achtzig. Beide Faelle laufen hier
  // durch dieselbe Funktion, ohne Sonderfall und ohne Schalter -- und die
  // Stufenbreite entsteht aus den Daten.

  /** Hoechstens drei geltende Stellen -- so viel behaelt man im Kopf. */
  function glatt(n: number): boolean {
    if (n === 0) return true;
    const potenz = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 2);
    return Math.abs(n / potenz - Math.round(n / potenz)) < 1e-6;
  }

  test("Einzelzimmer um 400 € bekommen lesbare Achsenstufen", () => {
    // max = lesbareStufe(420) = 500 ; Abstand 100 -> 0 | 100 | ... | 500
    const s = skala([380, 400, 420], 100);
    assert.equal(s.max, 500);
    assert.deepEqual(s.gitter, [0, 100, 200, 300, 400, 500]);
    assert.ok(s.gitter.every(glatt), "jede Gitterlinie muss ablesbar sein");
  });

  test("ein Gewerbeobjekt von 80.000 € bekommt sie aus derselben Funktion", () => {
    // max = lesbareStufe(80.000): Potenz 10.000, Rest 8 -> ueber 5 -> 100.000
    // Gitter = 0 | 25.000 | 50.000 | 75.000 | 100.000
    const s = skala([12000, 74000, 80000], 100);
    assert.equal(s.max, 100000);
    assert.deepEqual(s.gitter, [0, 25000, 50000, 75000, 100000]);
    assert.ok(s.gitter.every(glatt), "jede Gitterlinie muss ablesbar sein");
  });

  test("Cent-Betraege und Millionenbetraege ebenso — kein Sonderfall", () => {
    for (const spitze of [0.42, 7, 95, 480, 2750, 64000, 2_150_000]) {
      const s = skala([spitze], 100);
      assert.ok(s.max >= spitze, `die Achse muss ${spitze} enthalten`);
      assert.ok(glatt(s.max), `die Achsengrenze ${s.max} ist nicht ablesbar`);
      assert.equal(
        lesbareStufe(s.max),
        s.max,
        "eine Achsengrenze muss selbst schon eine Stufe sein",
      );
      assert.ok(
        s.gitter.every(glatt),
        `Gitterlinien bei Spitze ${spitze}: ${s.gitter.join(", ")}`,
      );
      assert.ok(s.laenge(spitze) > 0 && s.laenge(spitze) <= 100);
    }
  });

  test("der Stapel trifft die Gesamthoehe bei 400 € wie bei 80.000 €", () => {
    for (const faktor of [1, 200]) {
      const st = stapel(
        [
          { name: "Kaltmiete", wert: 210.33 * faktor },
          { name: "Betriebskosten", wert: 79.67 * faktor },
          { name: "ohne Aufteilung", wert: 110 * faktor },
        ],
        320,
      );
      const summe = st.segmente.reduce((s, g) => s + g.laenge, 0);
      assert.equal(summe.toFixed(1), (320).toFixed(1), `Faktor ${faktor}`);
      const letzter = st.segmente[st.segmente.length - 1];
      assert.equal(letzter.versatz + letzter.laenge, 320, `Faktor ${faktor}`);
    }
  });
});

/**
 * Der Massstab der Diagramme.
 *
 * ANLASS (08.11.2026)
 *
 * Stephan: "Formatierung der Diagramme ... sieht alles schlecht
 * formatiert aus."
 *
 * Nachgemessen im gebauten Portal: Das Histogramm der Mietstruktur hatte
 * ein viewBox von 204 x 102 und wurde mit width="100%" auf 1144 px
 * gezogen -- Faktor 5,6. Der Cashflow ueber zwoelf Monate hatte 622 x 162
 * und denselben Platz -- Faktor 1,8. Striche ueberstehen das
 * (vector-effect: non-scaling-stroke), Schrift nicht: Die
 * Achsenbeschriftung ist als 10 px angelegt und erschien als 56 px
 * beziehungsweise 18 px.
 *
 * Das ist der ganze Befund: Nicht die Diagramme waren falsch gezeichnet,
 * sondern ihr Massstab hing an der Datenmenge. Je weniger Daten, desto
 * groeber das Bild.
 */
describe("Der Massstab haengt nicht mehr an der Datenmenge", () => {
  test("viele Werte fuellen die Zielbreite", () => {
    // Zwoelf Monate: 1040/12 = 86,67 je Spur -- unter der Obergrenze 88,
    // also wird die Zielbreite ausgeschoepft.
    assert.equal(zeichenbreite(12, 88), ZIELBREITE);
  });

  test("wenige Werte bekommen keine uebergrossen Spuren", () => {
    // Ohne Obergrenze waeren es 1040/4 = 260 je Spur. Vier Balken, jeder
    // ein Viertel der Seite breit -- das ist kein Diagramm mehr.
    assert.equal(zeichenbreite(4, 88), 352);
  });

  test("ein einzelner Wert bleibt ein einzelner Balken", () => {
    assert.equal(zeichenbreite(1, 88), 88);
  });

  test("die Breite waechst nie ueber die Zielbreite", () => {
    for (const anzahl of [1, 4, 12, 24, 36, 120, 365]) {
      assert.ok(
        zeichenbreite(anzahl, 88) <= ZIELBREITE,
        `${anzahl} Werte ergaben ${zeichenbreite(anzahl, 88)}`,
      );
    }
  });

  test("die Breite waechst monoton mit der Anzahl", () => {
    // Sonst sieht ein Diagramm mit mehr Daten kleiner aus als eines mit
    // weniger -- und der Vergleich zweier Monate nebeneinander luegt.
    let vorher = 0;
    for (const anzahl of [1, 2, 3, 4, 6, 12, 24]) {
      const jetzt = zeichenbreite(anzahl, 88);
      assert.ok(jetzt >= vorher, `${anzahl}: ${jetzt} < ${vorher}`);
      vorher = jetzt;
    }
  });

  test("keine Werte heisst keine Breite", () => {
    assert.equal(zeichenbreite(0, 88), 0);
    assert.equal(zeichenbreite(-3, 88), 0);
  });

  test("unbrauchbare Angaben ergeben kein NaN im viewBox", () => {
    // Ein NaN im viewBox laesst das <svg> verschwinden -- lautlos, ohne
    // Fehler in der Konsole.
    for (const w of [zeichenbreite(NaN, 88), zeichenbreite(12, NaN), zeichenbreite(12, 0)]) {
      assert.ok(Number.isFinite(w), `${w} ist keine Zahl`);
    }
    // Ohne brauchbare Zielbreite bleibt die alte Rechnung uebrig.
    assert.equal(zeichenbreite(12, 88, 0), 1056);
  });
});

describe("Die Diagramme skalieren ihre Schrift nicht hoch", () => {
  const QUELLE = readFileSync(
    new URL("../components/Diagramm.tsx", import.meta.url),
    "utf8",
  );

  test("jede Zeichenflaeche hat eine Obergrenze in Pixeln", () => {
    /*
      Die Obergrenze ist das Gegenstueck zur Zeichenbreite: Sie sorgt
      dafuer, dass der Massstab hoechstens 1:1 ist. Ohne sie zieht
      width="100%" das Bild auf die Spaltenbreite, und die 10px der
      Achse werden wieder zu 18px oder 56px.
    */
    /*
      Gezaehlt werden die drei Diagramme mit Achsen -- Balken,
      Stapelbalken und Verlauf. Sie tragen className="diagramm-flaeche"
      ohne Zusatz und zeichnen in einem viewBox, dessen Breite aus den
      Daten entsteht. Genau dort entstand der Massstabsfehler.

      Nicht dabei sind Ring, Sparkline und Streifen: Sie tragen eine
      zweite Klasse, haben ein festes viewBox und sind bewusst Zierat in
      Zeilenhoehe -- ein Ring in 120x120 auf die Spaltenbreite gezogen
      ist eine Absicht, keine Panne.
    */
    const flaechen = QUELLE.match(/className="diagramm-flaeche"/g) ?? [];
    const grenzen = QUELLE.match(/maxWidth: `\$\{achsenbreite \+ breite\}px`/g) ?? [];
    assert.equal(flaechen.length, 3, "Es sollten drei Diagramme mit Achsen sein");
    assert.equal(
      grenzen.length,
      flaechen.length,
      "Jedes Diagramm mit Achsen braucht die Obergrenze.",
    );
  });

  test("die Breite kommt aus zeichenbreite() und nicht aus der Anzahl", () => {
    assert.doesNotMatch(
      QUELLE,
      /const breite = \w+\.length \* spur/,
      "posten.length * spur war genau die Rechnung, die den Massstab " +
        "an die Datenmenge gehaengt hat.",
    );
    const n = (QUELLE.match(/zeichenbreite\(/g) ?? []).length;
    assert.equal(n, 3, `zeichenbreite() steht ${n}-mal statt 3-mal`);
  });
});
