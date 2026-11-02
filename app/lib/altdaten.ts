import { query, one, tx } from "./db";

/**
 * Übernimmt die Altdaten in die Plattform.
 *
 * Die Logik stand bis hierhin in import/importieren.mts und lief nur als
 * Skript auf dem Server. Das war der Grund, warum die Plattform leer
 * blieb: Die Auslieferung spielt den Import nicht mit ein, und die
 * Datendatei liegt zu Recht nicht im Repository -- sie enthält Namen,
 * Geburtsdaten und Voranschriften echter Mieter.
 *
 * Als Funktion ist sie von zwei Seiten aufrufbar: weiterhin vom Skript,
 * und von /api/altdaten/import, dem die Datei über den Browser übergeben
 * wird. Der Weg über den Browser ist der wichtigere -- er braucht keinen
 * Terminalzugang, und die Datei geht direkt an den eigenen Server, nicht
 * über ein Repository.
 *
 * Wiederholbar: Jedes Mietverhältnis hängt am natürlichen Schlüssel aus
 * db/017 (einheit_id + kontakt_id + beginn). Ein zweiter Lauf legt deshalb
 * nichts doppelt an. Das ist kein Komfort, sondern Voraussetzung: Ein
 * Import, den man nicht gefahrlos wiederholen kann, wird beim ersten
 * Fehler zum Datensalat.
 *
 * Den Mandanten setzt der Aufrufer -- über das Sitzungscookie (Route) oder
 * mitMandant im Skript. Hier wird er nicht angefasst.
 */

interface Zeile {
  _block?: string;
  objekt?: string; einheit?: string; gruppe?: string | null;
  anzeigename?: string; rufname?: string;
  email?: string | null; telefon?: string | null;
  geburtsdatum?: string | null; geburtsort?: string | null;
  anschrift_vorher?: string | null; melde_zusatz?: string | null;
  beginn?: string; ende?: string | null; befristet?: boolean;
  vertrag_datum?: string | null; kuendigungsverzicht_monate?: number;
  status?: string; moebliert?: boolean;
  kaltmiete?: number | null; nebenkosten?: number | null;
  moeblierungszuschlag?: number | null; gesamtmiete?: number | null;
  kaution?: number | null; kaution_raten?: number;
  abrechnung_ab?: string | null;
  quelle?: string; notizen?: string; offen?: string;
}

/** Die Blöcke, die altdaten.json tragen kann. */
export const ALTDATEN_BLOECKE = [
  "objekte",
  "mietverhaeltnisse",
  "fristen",
  "mietanpassungen",
] as const;

/**
 * Ist das wirklich die Altdaten-Datei?
 *
 * Ohne diese Prüfung läuft der Import über eine beliebige JSON-Datei
 * durch, meldet "0 angelegt" und sieht aus wie ein geglückter Lauf über
 * leere Daten. Genau dann würde man glauben, die Plattform sei gefüllt.
 */
export function pruefeAltdaten(daten: unknown): {
  bloecke: string[];
  fehler: string | null;
} {
  if (daten === null || typeof daten !== "object" || Array.isArray(daten)) {
    return { bloecke: [], fehler: "Die Datei enthält kein Objekt." };
  }
  const d = daten as Record<string, unknown>;
  const bloecke = ALTDATEN_BLOECKE.filter((b) => Array.isArray(d[b]));
  if (bloecke.length === 0) {
    const gefunden = Object.keys(d).slice(0, 12).join(", ") || "nichts";
    return {
      bloecke: [],
      fehler:
        "Das sieht nicht nach den Altdaten aus. Erwartet wird eine " +
        `JSON-Datei mit mindestens einem der Blöcke: ` +
        `${ALTDATEN_BLOECKE.join(", ")}. Gefunden wurden: ${gefunden}.`,
    };
  }
  return { bloecke: [...bloecke], fehler: null };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function importiere(
  daten: any,
  echt: boolean,
): Promise<string[]> {
  /** Ab wann die Plattform abrechnet. Siehe _abrechnung_ab_hinweis in altdaten.json. */
  const abrechnungAb: string | null = daten._abrechnung_ab ?? null;
  const bericht: string[] = [];
  const sage = (s: string) => { bericht.push(s); };

  sage(echt ? "=== IMPORT (schreibend) ===" : "=== PROBELAUF — es wird nichts geschrieben ===");
  sage(echt ? "=== IMPORT (schreibend) ===" : "=== PROBELAUF — es wird nichts geschrieben ===");

  // --- Objekte, die es noch nicht gibt ---
  for (const o of daten.objekte ?? []) {
    const da = await one<{ id: string }>("SELECT id FROM objekt WHERE name = $1", [o.name]);
    if (da) { sage(`Objekt vorhanden: ${o.name}`); continue; }
    if (!echt) { sage(`WÜRDE ANLEGEN  Objekt ${o.name} mit ${o.einheiten.length} Einheit(en)`); continue; }
    const neu = await one<{ id: string }>(
      `INSERT INTO objekt (name, strasse, plz, ort) VALUES ($1,$2,$3,$4) RETURNING id`,
      [o.name, o.strasse, o.plz, o.ort]);
    for (const e of o.einheiten) {
      await query(
        `INSERT INTO einheit (objekt_id, bezeichnung, etage, art, flaeche_qm,
                              schluessel, angebot_kaltmiete, angebot_nebenkosten)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [neu!.id, e.bezeichnung, e.etage, e.art, e.flaeche_qm,
         e.schluessel, e.angebot_kaltmiete, e.angebot_nebenkosten]);
    }
    sage(`ANGELEGT       Objekt ${o.name} mit ${o.einheiten.length} Einheit(en)`);
  }

  // --- Einheiten nachziehen: Lage und Fläche aus belegten Quellen ---
  //
  // Die Einheiten in Ludwigshafen stehen seit db/006 als Platzhalter
  // ("Zuschnitt noch einzutragen"). Erst jetzt gibt es belegte Zahlen.
  for (const e of daten.einheiten_aktualisieren ?? []) {
    const da = await one<{ id: string; etage: string | null; flaeche_qm: string | null }>(
      `SELECT e.id, e.etage, e.flaeche_qm::text FROM einheit e
         JOIN objekt o ON o.id = e.objekt_id
        WHERE o.name = $1 AND e.bezeichnung = $2`, [e.objekt, e.bezeichnung]);
    if (!da) { sage(`FEHLT          Einheit ${e.objekt} ${e.bezeichnung}`); continue; }
    // Nur setzen, was die Zeile wirklich nennt: COALESCE lässt vorhandene
    // Werte stehen, wenn das Feld fehlt. Sonst würde eine Zeile, die nur
    // ein Datum nachträgt, Etage und Fläche löschen.
    const was = [
      e.etage ? `Etage ${e.etage}` : null,
      e.flaeche_qm ? `${e.flaeche_qm} m²` : null,
      e.verfuegbar_ab ? `frei ab ${e.verfuegbar_ab}` : null,
      e.vermarktungshinweis ? "Hinweis" : null,
    ].filter(Boolean).join(", ");

    if (!echt) { sage(`WÜRDE SETZEN   ${e.bezeichnung}: ${was}`); continue; }
    await query(
      `UPDATE einheit
          SET etage               = COALESCE($2, etage),
              flaeche_qm          = COALESCE($3, flaeche_qm),
              verfuegbar_ab       = COALESCE($4::date, verfuegbar_ab),
              vermarktungshinweis = COALESCE($5, vermarktungshinweis)
        WHERE id = $1`,
      [da.id, e.etage ?? null, e.flaeche_qm ?? null,
       e.verfuegbar_ab ?? null, e.vermarktungshinweis ?? null]);
    sage(`GESETZT        ${e.bezeichnung}: ${was}`);
  }

  // --- Mietverhältnisse ---
  let angelegt = 0, vorhanden = 0, fehlend = 0;
  for (const z of daten.mietverhaeltnisse as Zeile[]) {
    if (z._block) { sage(""); sage(`-- ${z._block}`); continue; }

    const e = await one<{ id: string; objekt: string }>(
      `SELECT e.id, o.name AS objekt FROM einheit e JOIN objekt o ON o.id = e.objekt_id
        WHERE o.name = $1 AND e.bezeichnung = $2`, [z.objekt, z.einheit]);
    if (!e) {
      sage(`FEHLT          Einheit "${z.einheit}" in "${z.objekt}" — ${z.anzeigename} nicht importiert`);
      fehlend++; continue;
    }

    // Gibt es den Kontakt schon? Über die E-Mail, sonst über den Namen.
    let k = z.email
      ? await one<{ id: string }>(
          `SELECT k.id FROM kontakt k JOIN kontakt_email ke ON ke.kontakt_id = k.id
            WHERE lower(ke.email) = lower($1)`, [z.email])
      : await one<{ id: string }>(
          `SELECT id FROM kontakt WHERE anzeigename = $1 AND rolle = 'mieter'`, [z.anzeigename]);

    const schonDa = k ? await one<{ id: string }>(
      `SELECT id FROM mietverhaeltnis WHERE einheit_id = $1 AND kontakt_id = $2 AND beginn = $3`,
      [e.id, k.id, z.beginn]) : null;

    const geld = z.kaltmiete !== null && z.kaltmiete !== undefined
      ? `${z.kaltmiete} EUR` : "ohne Miete";
    const etikett = `${z.anzeigename} · ${z.objekt} ${z.einheit} · ab ${z.beginn} · ${geld}`;

    if (schonDa) { sage(`vorhanden      ${etikett}`); vorhanden++; continue; }
    if (!echt)   { sage(`WÜRDE ANLEGEN  ${etikett}`); angelegt++; continue; }

    await tx(async (c) => {
      if (!k) {
        const r = await c.query(
          `INSERT INTO kontakt (anzeigename, rufname, rolle, geburtsdatum, geburtsort)
           VALUES ($1,$2,'mieter',$3,$4) RETURNING id`,
          [z.anzeigename, z.rufname ?? null, z.geburtsdatum ?? null, z.geburtsort ?? null]);
        k = { id: r.rows[0].id };
        if (z.email) {
          await c.query(
            `INSERT INTO kontakt_email (kontakt_id, email, ist_primaer) VALUES ($1,$2,true)`,
            [k.id, z.email]);
        }
        if (z.telefon) {
          await c.query(
            `INSERT INTO kontakt_telefon (kontakt_id, nummer_e164) VALUES ($1,$2)`,
            [k.id, z.telefon]);
        }
      }
      await c.query(
        `INSERT INTO mietverhaeltnis
           (einheit_id, kontakt_id, beginn, ende, status, befristet,
            vertrag_datum, kuendigungsverzicht_monate, moebliert, melde_zusatz,
            anschrift_vorher, kaltmiete, nebenkosten, moeblierungszuschlag,
            gesamtmiete, kaution, kaution_raten, abrechnung_ab, notizen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [e.id, k!.id, z.beginn, z.ende ?? null, z.status ?? "aktiv",
         z.befristet ?? false, z.vertrag_datum ?? null,
         z.kuendigungsverzicht_monate ?? 0, z.moebliert ?? false,
         z.melde_zusatz ?? null, z.anschrift_vorher ?? null,
         z.kaltmiete ?? null, z.nebenkosten ?? null, z.moeblierungszuschlag ?? null,
         z.gesamtmiete ?? null, z.kaution ?? null, z.kaution_raten ?? 1,
         // Nie frueher als der Mietbeginn -- die Datenbank weist das sonst ab.
         (() => { const a = z.abrechnung_ab ?? abrechnungAb;
                  return a && a > (z.beginn ?? "") ? a : null; })(),
         [z.notizen, z.offen ? "OFFEN: " + z.offen : null,
          z.quelle ? "Quelle: " + z.quelle : null].filter(Boolean).join("\n\n") || null]);
    });
    sage(`ANGELEGT       ${etikett}`);
    angelegt++;
  }

  // --- Kuendigungen (db/017) ---
  //
  // Eine Kuendigung ohne festes Auszugsdatum ist der haeufigste Fall in
  // WGs: Der Termin haengt am Nachmieter. Genau den kann beginn/ende nicht
  // ausdruecken -- ein Pseudodatum in `ende` waere eine Zusage, die
  // niemand gegeben hat.
  for (const kg of daten.kuendigungen ?? []) {
    const k = await one<{ id: string }>(
      `SELECT id FROM kontakt WHERE anzeigename = $1 AND rolle = 'mieter'`,
      [kg.anzeigename]);
    const v = k ? await one<{ id: string }>(
      `SELECT id FROM mietverhaeltnis WHERE kontakt_id = $1 AND status <> 'beendet'
        ORDER BY beginn DESC LIMIT 1`, [k.id]) : null;
    if (!v) { sage(`FEHLT          Mietverhältnis für Kündigung ${kg.anzeigename}`); continue; }

    const da = await one<{ id: string }>(
      `SELECT id FROM kuendigung WHERE mietverhaeltnis_id = $1 AND zurueckgenommen_am IS NULL`,
      [v.id]);
    const etikett = `Kündigung ${kg.anzeigename} vom ${kg.eingegangen_am}` +
      (kg.nachmieter_gesucht ? " (Nachmieter gesucht, kein Termin)" : ` zum ${kg.zum_datum}`);
    if (da)    { sage(`vorhanden      ${etikett}`); continue; }
    if (!echt) { sage(`WÜRDE ANLEGEN  ${etikett}`); continue; }

    await tx(async (c) => {
      await c.query(
        `INSERT INTO kuendigung (mietverhaeltnis_id, eingegangen_am, durch,
                                 zum_datum, nachmieter_gesucht, notizen)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [v.id, kg.eingegangen_am, kg.durch, kg.zum_datum ?? null,
         kg.nachmieter_gesucht ?? false, kg.notizen ?? null]);
      // Der Status am Mietverhältnis muss mitgehen, sonst widersprechen
      // sich Tabelle und Mietverhältnis.
      await c.query(
        `UPDATE mietverhaeltnis SET status = 'gekuendigt' WHERE id = $1 AND status = 'aktiv'`,
        [v.id]);
    });
    sage(`ANGELEGT       ${etikett}`);
  }

  // --- Mietanpassungen: welcher Betrag galt ab wann (db/022) ---
  //
  // Ohne sie bekäme jeder rückwirkende Monat den HEUTIGEN Betrag. Bei den
  // drei Altmietverhältnissen in Gießen wäre das ab Dezember 2025 je rund
  // 110 bis 260 Euro zu viel im Monat -- und Sollstellungen lassen sich
  // nachträglich nicht korrigieren.
  if (daten.mietanpassungen?.length) {
    sage("");
    sage("-- Mietanpassungen");
  }
  let anpassungen = 0;
  for (const a of daten.mietanpassungen ?? []) {
    const k = await one<{ id: string }>(
      `SELECT id FROM kontakt WHERE anzeigename = $1 AND rolle = 'mieter'`,
      [a.anzeigename]);
    const v = k ? await one<{ id: string }>(
      `SELECT id FROM mietverhaeltnis WHERE kontakt_id = $1 ORDER BY beginn DESC LIMIT 1`,
      [k.id]) : null;
    if (!v) { sage(`FEHLT          Mietverhältnis für ${a.anzeigename}`); continue; }

    const da = await one<{ id: string }>(
      `SELECT id FROM mietanpassung WHERE mietverhaeltnis_id = $1 AND gilt_ab = $2`,
      [v.id, a.gilt_ab]);
    const etikett = `${a.anzeigename} ab ${a.gilt_ab}: ` +
      `${a.gesamtmiete ?? a.kaltmiete} EUR (${a.grund})`;
    if (da)    { sage(`vorhanden      ${etikett}`); continue; }
    if (!echt) { sage(`WÜRDE ANLEGEN  ${etikett}`); anpassungen++; continue; }

    await query(
      `INSERT INTO mietanpassung (mietverhaeltnis_id, gilt_ab, kaltmiete,
                                  nebenkosten, gesamtmiete, grund, beleg)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [v.id, a.gilt_ab, a.kaltmiete ?? null, a.nebenkosten ?? null,
       a.gesamtmiete ?? null, a.grund ?? "vertrag", a.beleg ?? null]);
    sage(`ANGELEGT       ${etikett}`);
    anpassungen++;
  }

  // --- Fristen -------------------------------------------------------------
  //
  // Fristen, die Geld oder Rechte kosten, wenn sie verstreichen. Sie standen
  // bisher in Projektdokumenten; ein Dokument warnt niemanden. Als Daten
  // liest der tägliche Lagebericht sie und meldet sie, je näher sie kommen.
  if (daten.fristen?.length) {
    sage("");
    sage("-- Fristen");
  }
  let fristen = 0;
  for (const f of daten.fristen ?? []) {
    const o = f.objekt
      ? await one<{ id: string }>(`SELECT id FROM objekt WHERE name = $1`,
          [f.objekt])
      : null;
    if (f.objekt && !o) {
      sage(`FEHLT          Objekt "${f.objekt}" für Frist ${f.bezeichnung}`);
      continue;
    }
    const da = await one<{ id: string }>(
      `SELECT id FROM frist WHERE bezeichnung = $1 AND faellig_am = $2`,
      [f.bezeichnung, f.faellig_am]);
    const etikett = `${f.faellig_am}: ${f.bezeichnung.slice(0, 60)}`;
    if (da)    { sage(`vorhanden      ${etikett}`); continue; }
    if (!echt) { sage(`WÜRDE ANLEGEN  ${etikett}`); fristen++; continue; }

    await query(
      `INSERT INTO frist (objekt_id, bezeichnung, faellig_am, grundlage,
                          betrag, haengt_an)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [o?.id ?? null, f.bezeichnung, f.faellig_am, f.grundlage ?? null,
       f.betrag ?? null, f.haengt_an ?? null]);
    sage(`ANGELEGT       ${etikett}`);
    fristen++;
  }

  sage("");
  sage(`=== ${echt ? "Importiert" : "Würde anlegen"}: ${angelegt} · vorhanden: ${vorhanden} · Einheit fehlt: ${fehlend} · Mietanpassungen: ${anpassungen} · Fristen: ${fristen} ===`);
  for (const n of daten._nicht_importiert ?? []) sage(`bewusst ausgelassen: ${n.was}`);

  return bericht;
}
