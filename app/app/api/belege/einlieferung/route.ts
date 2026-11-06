import { NextResponse } from "next/server";
import { angemeldeteSitzung } from "@/lib/anmeldung";
import { one, query } from "@/lib/db";
import { lieseBeleg } from "@/lib/belegtext";
import { pruefeKostenart } from "@/lib/kostenarten";
import {
  ablageMarke,
  findeSummeMehrererRechnungen,
  legeAb,
  sucheDublette,
  werteBelegAus,
  zaehleBelegstuecke,
  type BelegBefund,
} from "@/lib/belege";
import { uebernehmeSichereBelege } from "@/lib/belegabgleich";
import { findeAlleReferenzen } from "@/lib/referenzen";
import {
  type Zulieferung,
  datumFeld,
  geld,
  liesZulieferungen,
  nurName,
  text,
  widerspruch,
  zahl,
} from "@/lib/gegenprobe";
import { leseTar, TarFehler, MAX_EINTRAEGE } from "@/lib/tar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Belege als Archiv einliefern.
 *
 * WOFÜR
 *
 * Der Einzelupload (api/belege/upload) nimmt 20 Dateien und verlangt
 * dazwischen eine Sichtung am Bildschirm. Das ist der richtige Weg für
 * den täglichen Beleg und der falsche für einen Altbestand: Am 05.11.2026
 * waren es 297 Dateien, und beim fünfzehnten Formular sieht niemand mehr
 * hin. Eine Sichtung, die ermüdet, schützt nicht mehr.
 *
 * WAS AN DIE STELLE DER SICHTUNG TRITT
 *
 * Nicht nichts. Jeder Beleg wird zweimal unabhängig gelesen:
 *
 *   1. vom Regelwerk hier im Portal (lib/belege.ts, aus der Textebene),
 *   2. von der Beifügung -- einer Datei `einordnung.json` im Archiv, die
 *      je Beleg vorab ermittelte Felder mitbringt.
 *
 * Stimmen Betrag und Datum überein, hat der Beleg zwei Zeugen und geht
 * durch. Weichen sie ab, wird er trotzdem angelegt -- mit `abweichung`
 * gefüllt, und der selbsttätige Abgleich lässt ihn liegen
 * (lib/belegabgleich.ts: offeneBelege filtert darauf). Ein fehlender
 * Beleg fällt auf, ein falsch gelesener nicht; deshalb eingebucht und
 * markiert statt weggelassen.
 *
 * Felder, die nur eine Quelle kennt, werden von dieser übernommen, und
 * `notizen` hält fest, welche es war. Ohne diesen Satz wäre später nicht
 * mehr unterscheidbar, was aus dem Beleg gelesen und was zugeliefert
 * wurde.
 *
 * WAS NICHT ZUGELIEFERT WERDEN DARF
 *
 * Kostenart nur aus dem bekannten Katalog (pruefeKostenart) -- eine
 * erfundene Kostenart liesse sich später nicht auswerten und stünde doch
 * in den Büchern. Umlagefähigkeit nur als true/false/null, wobei null
 * ungeklärt heisst und nicht "nein": Eine Vorgabe, die sich im Zweifel
 * festlegt, fällt erst auf, wenn ein Mieter die Abrechnung prüft -- und
 * dann ist die Frist nach § 556 Abs. 3 BGB abgelaufen.
 */

/** Zwei Beträge gelten als gleich, wenn sie auf den Cent gleich sind. */







/** Nur der letzte Pfadteil, ohne Verzeichnisse. */

export async function POST(req: Request) {
  // Eigene Prüfung, auch wenn die Middleware den Pfad abdeckt: Eine
  // Route, die Dateien auf die Platte schreibt und Zeilen in die
  // Buchführung legt, soll nicht davon abhängen, dass eine andere Datei
  // richtig konfiguriert bleibt.
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  if (sitzung.rolle === "lesen") {
    return NextResponse.json(
      { fehler: "Nur Leserecht — Belege einliefern darf diese Rolle nicht." },
      { status: 403 },
    );
  }

  const typ = req.headers.get("content-type") ?? "";
  if (!typ.includes("multipart/form-data")) {
    return NextResponse.json(
      { fehler: "Bitte als Formular mit dem Feld „archiv“ senden." },
      { status: 415 },
    );
  }

  const form = await req.formData();
  const datei = form.get("archiv");
  if (!(datei instanceof File) || datei.size === 0) {
    return NextResponse.json({ fehler: "Kein Archiv erhalten." }, { status: 400 });
  }

  const roh = Buffer.from(await datei.arrayBuffer());
  const marke = ablageMarke(roh);

  // Dieselbe Lieferung zweimal ist ein Versehen -- und der Hinweis darauf
  // ist nützlicher als 297 Dublettenmeldungen.
  const schon = await one<{ id: string; angelegt_am: string }>(
    `SELECT id, angelegt_am::text FROM beleg_lieferung WHERE marke = $1`,
    [marke],
  );
  if (schon) {
    return NextResponse.json(
      {
        fehler: `Dieses Archiv wurde am ${schon.angelegt_am.slice(0, 16)} schon eingeliefert.`,
        lieferung_id: schon.id,
      },
      { status: 409 },
    );
  }

  let eintraege;
  try {
    eintraege = leseTar(roh);
  } catch (e) {
    if (e instanceof TarFehler) {
      return NextResponse.json({ fehler: e.message }, { status: 400 });
    }
    throw e;
  }

  // --- Beifügung herausnehmen ---------------------------------------------
  let beifuegung: Record<string, Zulieferung> = {};
  let beifuegungDa = false;
  let beifuegungUmschlag = false;
  const rest = [];
  for (const e of eintraege) {
    if (nurName(e.name) === "einordnung.json") {
      beifuegungDa = true;
      let geparst: unknown;
      try {
        geparst = JSON.parse(e.inhalt.toString("utf8"));
      } catch {
        return NextResponse.json(
          { fehler: "einordnung.json im Archiv ist kein gültiges JSON." },
          { status: 400 },
        );
      }
      const gelesen = liesZulieferungen(geparst);
      if ("fehler" in gelesen) {
        return NextResponse.json(
          { fehler: `einordnung.json: ${gelesen.fehler}` },
          { status: 400 },
        );
      }
      beifuegung = gelesen.je;
      beifuegungUmschlag = gelesen.umschlag;
      continue;
    }
    rest.push(e);
  }

  if (rest.length === 0) {
    return NextResponse.json(
      { fehler: "Das Archiv enthält nur die Beifügung und keine Belege." },
      { status: 400 },
    );
  }
  if (rest.length > MAX_EINTRAEGE) {
    return NextResponse.json(
      { fehler: `Höchstens ${MAX_EINTRAEGE} Belege je Lieferung.` },
      { status: 400 },
    );
  }

  // Eine Beifügung, die keinen einzigen Beleg im Archiv trifft, ist
  // falsch geschlüsselt. Am 05.11.2026 ging genau das durch: 100
  // Rechnungen wurden mit einer Lesung eingebucht, die Meldung lautete
  // "0 Auffällige", und das klang wie Einigkeit. Lieber hier abweisen
  // als mit einem Zeugen weitermachen, den niemand gezählt hat.
  if (beifuegungDa) {
    const imArchiv = new Set(rest.map((e) => nurName(e.name)));
    const treffer = Object.keys(beifuegung).filter((k) => imArchiv.has(k)).length;
    if (treffer === 0) {
      return NextResponse.json(
        {
          fehler:
            `einordnung.json trifft keinen der ${rest.length} Belege im Archiv. ` +
            "Die Schlüssel müssen die Dateinamen der Belege sein.",
          beispiele_beifuegung: Object.keys(beifuegung).slice(0, 5),
          beispiele_archiv: [...imArchiv].slice(0, 5),
        },
        { status: 400 },
      );
    }
  }

  // --- Objekte auflösen ----------------------------------------------------
  // Die Beifügung nennt das Objekt beim Ort ("giessen"), nicht bei seiner
  // Kennung -- die kennt sie nicht und soll sie nicht kennen müssen.
  const objekte = await query<{ id: string; ort: string; name: string }>(
    `SELECT id, ort, name FROM objekt`,
  );
  function objektId(w: unknown): string | null {
    const s = text(w, 60)?.toLowerCase();
    if (!s || s === "unklar" || s === "privat") return null;
    const suchbegriff = s.replace(/ss/g, "ß");
    const treffer = objekte.find(
      (o) =>
        o.ort.toLowerCase().includes(suchbegriff) ||
        o.ort.toLowerCase().replace(/ß/g, "ss").includes(s) ||
        o.name.toLowerCase().includes(s),
    );
    return treffer?.id ?? null;
  }

  const [lieferung] = await query<{ id: string }>(
    `INSERT INTO beleg_lieferung (dateiname, groesse_bytes, marke, enthalten)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [nurName(datei.name || "lieferung.tgz"), roh.length, marke, rest.length],
  );

  let mitWiderspruch = 0;
  let zweiZeugen = 0;
  const bericht: Array<{ datei: string; grund: string }> = [];
  const angelegt: Array<{
    datei: string;
    beleg_id: string;
    betrag: number | null;
    abweichung: string | null;
  }> = [];

  for (const e of rest) {
    const name = nurName(e.name);
    const gelesen = await lieseBeleg(e.inhalt);

    // Der Dateityp wird am Inhalt entschieden, nicht an der Endung.
    if (gelesen.art === "unbekannt") {
      bericht.push({
        datei: name,
        grund: "Weder PDF noch Bild — unabhängig davon, was die Endung sagt.",
      });
      continue;
    }

    const dublette = await sucheDublette(e.inhalt);
    if (dublette) {
      bericht.push({ datei: name, grund: "Liegt schon in der Ablage (gleicher Inhalt)." });
      continue;
    }

    // Quelle 1: das Regelwerk. Kein Sprachmodell an dieser Stelle -- bei
    // 300 Belegen wäre das ein Kostenfaktor und eine dritte Meinung, wo
    // zwei sich schon widersprechen können.
    const regel: BelegBefund = werteBelegAus(gelesen.text, name);

    // Quelle 2: die Beifügung, gesucht unter dem vollen Pfad und unter
    // dem reinen Dateinamen.
    const bei: Zulieferung = beifuegung[nurName(e.name)] ?? beifuegung[name] ?? {};

    const betragBei = zahl(bei.brutto);
    const datumBei = datumFeld(bei.datum);
    const betragRegel = regel.betrag_brutto ?? null;
    const datumRegel = regel.belegdatum ?? null;

    // Derselbe Vergleich wie in der nachgeholten Gegenprobe -- eine
    // Regel, eine Stelle.
    const vergleich = widerspruch(
      { betrag: betragRegel, datum: datumRegel },
      { betrag: betragBei, datum: datumBei },
    );

    // Mehr als ein Belegstueck in einer Datei: Der Betrag ist dann nicht
    // bestimmbar, solange die Summenregel nicht greift -- findeBetrag
    // nimmt den letzten im Text, und das kann die Quittung einer
    // fremden Bestellung sein (05.11.2026: 13,20 EUR statt 41,39 EUR).
    // Vermerkt statt verschwiegen: Der selbsttaetige Abgleich laesst
    // Belege mit Abweichung liegen, und genau das soll hier geschehen.
    const stuecke = zaehleBelegstuecke(gelesen.text);
    const uneindeutig =
      stuecke > 1 && findeSummeMehrererRechnungen(gelesen.text) === null
        ? `Mehrere Belegstücke in einer Datei (${stuecke}). Betrag nicht eindeutig.`
        : null;
    const abweichung = [vergleich, uneindeutig].filter(Boolean).join("; ") || null;
    if (abweichung) mitWiderspruch += 1;
    if (bei.brutto !== undefined || bei.datum !== undefined) zweiZeugen += 1;

    const betrag = betragRegel ?? betragBei;
    const belegdatum = datumRegel ?? datumBei;
    const aussteller = regel.aussteller ?? text(bei.aussteller, 120);
    const belegnummer = regel.belegnummer ?? text(bei.belegnummer, 60);

    const art = pruefeKostenart(bei.kostenart);
    const umlage =
      bei.umlagefaehig === true ? true : bei.umlagefaehig === false ? false : null;
    const anlagegut =
      bei.anlagegut === true ? true : bei.anlagegut === false ? false : null;

    let pfad: string;
    try {
      pfad = await legeAb(e.inhalt, name);
    } catch (f) {
      bericht.push({
        datei: name,
        grund: `Ablage nicht beschreibbar: ${(f as Error).message}`,
      });
      continue;
    }

    const quellen: string[] = [];
    if (betragRegel !== null || datumRegel !== null) quellen.push("Textebene");
    if (betragBei !== null || datumBei !== null) quellen.push("Beifügung");
    const notiz =
      `Sammel-Einlieferung. Felder aus: ${quellen.join(" und ") || "keiner Quelle"}.` +
      (gelesen.ohne_textebene ? " Keine Textebene im Beleg." : "") +
      (text(bei.begruendung, 300) ? ` Einordnung: ${text(bei.begruendung, 300)}` : "");

    const [b] = await query<{ id: string }>(
      `INSERT INTO beleg (art, richtung, aussteller, belegnummer, belegdatum,
                          betrag_brutto, dateiname, ablage_pfad, notizen,
                          objekt_id, kostenart, umlagefaehig, anlagegut,
                          lieferung_id, abweichung)
       VALUES ($1,'eingang',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        gelesen.ohne_textebene ? "quittung" : "rechnung",
        aussteller,
        belegnummer,
        belegdatum,
        betrag,
        name,
        pfad,
        notiz,
        objektId(bei.objekt),
        art?.schluessel ?? null,
        umlage,
        anlagegut,
        lieferung.id,
        abweichung,
      ],
    );

    // Referenznummern mitschreiben. Sie sind der verlässlichste Weg zur
    // Abbuchung: Bei Amazon steht die Bestellnummer im Verwendungszweck,
    // die Rechnungsnummer nie. Der Dateiname zaehlt mit -- bei der
    // eigenen Rechnung eines Marketplace-Haendlers steht die
    // Bestellnummer nur dort.
    for (const r of findeAlleReferenzen(gelesen.text, name)) {
      await query(
        `INSERT INTO beleg_referenz (beleg_id, art, wert, normiert)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (mandant_id, beleg_id, art, normiert) DO NOTHING`,
        [b.id, r.art, r.wert, r.normiert],
      );
    }

    angelegt.push({ datei: name, beleg_id: b.id, betrag, abweichung });
  }

  const auffaellig = angelegt.filter((a) => a.abweichung).length;

  await query(
    `UPDATE beleg_lieferung
        SET uebernommen = $2, abgelehnt = $3, auffaellig = $4, bericht = $5::jsonb
      WHERE id = $1`,
    [
      lieferung.id,
      angelegt.length,
      bericht.length,
      auffaellig,
      JSON.stringify(bericht),
    ],
  );

  // Der vorhandene Abgleich entscheidet über die Zuordnung, nicht diese
  // Route. Belege mit Abweichung bleiben dabei aussen vor.
  const abgleich =
    angelegt.length > 0
      ? await uebernehmeSichereBelege()
      : { uebernommen: 0, offen: 0 };

  return NextResponse.json({
    lieferung_id: lieferung.id,
    enthalten: rest.length,
    angelegt: angelegt.length,
    abgelehnt: bericht.length,
    auffaellig,
    // Nicht die Groesse der Beifuegung, sondern wie viele Belege sie
    // wirklich erreicht hat. Der Unterschied ist der ganze Punkt: Eine
    // Beifuegung, die danebengreift, sah vorher aus wie Einigkeit.
    mit_zwei_zeugen: zweiZeugen,
    mit_widerspruch: mitWiderspruch,
    beifuegung: beifuegungDa
      ? {
          eintraege: Object.keys(beifuegung).length,
          umschlag: beifuegungUmschlag,
          ohne_zweite_lesung: rest.length - zweiZeugen,
        }
      : null,
    abgleich,
    bericht,
  });
}

/** Die Lieferungen, neueste zuerst. */
export async function GET() {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }
  const zeilen = await query(`
    SELECT l.id, l.dateiname, l.groesse_bytes::text, l.enthalten,
           l.uebernommen, l.abgelehnt, l.auffaellig,
           l.angelegt_am::text, l.bericht
      FROM beleg_lieferung l
     ORDER BY l.angelegt_am DESC
     LIMIT 50
  `);
  return NextResponse.json({ lieferungen: zeilen });
}

/**
 * Eine ganze Lieferung zurücknehmen.
 *
 * WOFÜR
 *
 * Eine Einlieferung bringt bis zu 500 Belege auf einmal. Ist mit dem
 * Stapel etwas nicht in Ordnung -- falsch erzeugte Dateien, der falsche
 * Mandant, ein Fehler in der Beifügung --, gab es bisher keinen Weg
 * zurück. Am 06.11.2026 lagen so 61 Zahlungsnachweise mit einem falsch
 * gelesenen Datum in der Ablage; erzeugt waren sie von mir, der Fehler
 * steckte im Dokument, und zu reparieren war nichts: Neu einliefern
 * hätte Dubletten ergeben.
 *
 * Wer stapelweise einliefern kann, muss stapelweise zurücknehmen
 * können. Sonst wird aus jedem Fehler ein dauerhafter Eintrag in den
 * Büchern.
 *
 * WAS SIE NICHT ANFASST
 *
 * Belege, die schon einer Buchung zugeordnet sind. Die Zuordnung ist
 * eine Entscheidung -- maschinell oder von Hand --, und ein
 * Löschbefehl auf eine Lieferung soll sie nicht stillschweigend
 * mitnehmen. Solche Belege bleiben stehen und werden gezählt; wer sie
 * wirklich los will, löst erst die Zuordnung (siehe
 * /api/belege/zuordnungen).
 *
 * Die abgelegte Datei bleibt auf der Platte. Sie ist der einzige
 * Originalbeleg, den es gibt, und sie kostet wenig. Ein Löschbefehl,
 * der Originale vernichtet, ist eine andere Entscheidung als dieser.
 */
export async function DELETE(anfrage: Request) {
  const sitzung = await angemeldeteSitzung();
  if (!sitzung || sitzung.rolle === "mieter" || sitzung.rolle === "lesen") {
    return NextResponse.json({ fehler: "nicht berechtigt" }, { status: 403 });
  }

  let id = "";
  try {
    const b = await anfrage.json();
    if (b && typeof b === "object" && typeof b.lieferung_id === "string") {
      id = b.lieferung_id;
    }
  } catch {
    /* unten als fehlender Wert behandelt */
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json(
      { fehler: "Keine gültige Kennung der Lieferung." },
      { status: 400 },
    );
  }

  const [lieferung] = await query<{ id: string; dateiname: string }>(
    `SELECT id, dateiname FROM beleg_lieferung WHERE id = $1`,
    [id],
  );
  if (!lieferung) {
    return NextResponse.json(
      { fehler: "Diese Lieferung gibt es nicht." },
      { status: 404 },
    );
  }

  // Erst zählen, was bleibt -- damit die Antwort es nennen kann.
  const [{ zugeordnet }] = await query<{ zugeordnet: string }>(
    `SELECT count(*)::text AS zugeordnet
       FROM beleg bg
      WHERE bg.lieferung_id = $1
        AND EXISTS (SELECT 1 FROM belegbuchung bb WHERE bb.beleg_id = bg.id)`,
    [id],
  );

  const geloescht = await query<{ id: string }>(
    `DELETE FROM beleg bg
      WHERE bg.lieferung_id = $1
        AND NOT EXISTS (SELECT 1 FROM belegbuchung bb WHERE bb.beleg_id = bg.id)
      RETURNING bg.id`,
    [id],
  );

  // Die Lieferung selbst verschwindet nur, wenn nichts mehr an ihr
  // hängt. Sonst bliebe ein Beleg ohne Herkunft zurück.
  let lieferungWeg = false;
  if (Number(zugeordnet) === 0) {
    await query(`DELETE FROM beleg_lieferung WHERE id = $1`, [id]);
    lieferungWeg = true;
  }

  return NextResponse.json({
    ok: true,
    lieferung: lieferung.dateiname,
    geloescht: geloescht.length,
    behalten_weil_zugeordnet: Number(zugeordnet),
    lieferung_entfernt: lieferungWeg,
    hinweis:
      Number(zugeordnet) > 0
        ? `${zugeordnet} Belege sind einer Buchung zugeordnet und bleiben stehen. ` +
          "Erst die Zuordnung lösen, dann noch einmal zurücknehmen."
        : "Die Lieferung ist vollständig zurückgenommen. Die abgelegten Dateien bleiben auf der Platte.",
  });
}
