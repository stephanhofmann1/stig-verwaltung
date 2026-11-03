import { query } from "@/lib/db";
import { mietzusammensetzung } from "@/lib/dokumente";

/**
 * Objekte als eigene Ebene der Anwendung.
 *
 * Bis hierhin gab es die Objektzahlen nur einmal: ausgerechnet in der
 * Objektseite selbst. Wer wissen wollte, wie seine drei Haeuser stehen,
 * musste drei Seiten einzeln aufrufen -- und die Uebersicht /objekte haette
 * dieselbe Rechnung ein zweites Mal gebraucht. Zwei Rechnungen fuer eine
 * Zahl laufen auseinander; beim Wort "Leerstand" ist das in dieser
 * Anwendung schon passiert (Cockpit und Objektseite meinten Verschiedenes).
 *
 * Deshalb steht die Ableitung hier, einmal, und beide Seiten lesen sie:
 * /objekte ueber objektUebersicht(), /objekt/[id] ueber
 * einheitenDesObjekts() plus objektKennzahlen().
 *
 * Zur Vorsicht bei "frei": Aus "kein Mietverhaeltnis erfasst" folgt nicht
 * "leer". Die Spalte belegung_gepflegt (db/017) sagt, ob jemand die
 * Belegung dieser Einheit wirklich gepflegt hat; solange sie aus ist, gilt
 * die Einheit als "Belegung offen" und nicht als frei. Der umgekehrte
 * Vorgabewert hat im September 2026 dazu gefuehrt, dass vermietete Zimmer
 * oeffentlich angeboten wurden.
 */

/** Eine Einheit mit allem, was Uebersicht und Objektseite davon brauchen. */
export interface ObjektEinheit {
  id: string;
  objekt_id: string;
  bezeichnung: string;
  etage: string | null;
  art: string;
  flaeche_qm: string | null;
  schluessel: string | null;
  eltern_id: string | null;
  eltern: string | null;
  vermarktung: string;
  verfuegbar_ab: string | null;
  belegung_gepflegt: boolean;
  angebot_kaltmiete: string | null;
  angebot_nebenkosten: string | null;
  mv_id: string | null;
  mieter: string | null;
  beginn: string | null;
  ende: string | null;
  status: string | null;
  m_kalt: string | null;
  m_nk: string | null;
  m_moebel: string | null;
  m_gesamt: string | null;
}

/** Ein Objekt mit seinen Kennzahlen -- eine Zeile der Uebersicht. */
export interface ObjektZeile {
  id: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  notizen: string | null;
  zahlungsdaten_ab: string | null;
  zahlen: ObjektKennzahlen;
}

export interface ObjektKennzahlen {
  /** Summe der heute gueltigen Mieten aller laufenden Mietverhaeltnisse. */
  sollMonat: number;
  /** Einheiten ohne Gemeinschaftsflaechen -- das, was einzeln vermietet wird. */
  einzeln: number;
  /** Davon belegt (eigener Vertrag oder Vertrag ueber die WG-Etage). */
  belegt: number;
  /**
   * Frei UND angeboten: die vermarktbaren Einheiten ohne Mietverhaeltnis.
   * Ohne Gemeinschaftsflaechen, ohne "nicht anbieten", ohne "im Bau" und
   * ohne die, deren Belegung nicht gepflegt ist (die stehen in
   * belegungOffen). Dieselbe Richtung wie im Cockpit: Aus fehlenden Daten
   * entsteht nie "frei".
   */
  angebotenFrei: ObjektEinheit[];
  /** Ohne Mietverhaeltnis, aber Belegung nie gepflegt -- keine Aussage. */
  belegungOffen: number;
  /** Angebotsmiete der angeboten-freien Einheiten, je Monat. */
  entgangeneAngebotsmiete: number;
  /** Summe der erfassten Flaechen in m². */
  flaeche: number;
  /** Einheiten ohne Flaechenangabe -- macht die Summe lesbar. */
  ohneFlaeche: number;
}

const EINHEITEN_SQL = `
    SELECT e.id, e.objekt_id, e.bezeichnung, e.etage, e.art,
           e.flaeche_qm::text, e.schluessel, e.eltern_id,
           eltern.bezeichnung AS eltern,
           e.vermarktung, e.verfuegbar_ab::text, e.belegung_gepflegt,
           e.angebot_kaltmiete::text, e.angebot_nebenkosten::text,
           mv.id AS mv_id, k.anzeigename AS mieter,
           mv.beginn::text, mv.ende::text, mv.status,
           -- Die Miete, die heute gilt: miete_am() aus db/022 nimmt die
           -- juengste Anpassung und faellt sonst auf das Mietverhaeltnis
           -- zurueck. Hier nicht nachgerechnet -- dieselbe Regel wie in
           -- der Sollstellung.
           m.kaltmiete::text            AS m_kalt,
           m.nebenkosten::text          AS m_nk,
           m.moeblierungszuschlag::text AS m_moebel,
           m.gesamtmiete::text          AS m_gesamt
      FROM einheit e
      LEFT JOIN einheit eltern ON eltern.id = e.eltern_id
      LEFT JOIN LATERAL (
            SELECT * FROM mietverhaeltnis x
             WHERE x.einheit_id = e.id
               AND x.status <> 'beendet'
               AND (x.ende IS NULL OR x.ende >= current_date)
             ORDER BY x.beginn DESC LIMIT 1) mv ON true
      LEFT JOIN kontakt k ON k.id = mv.kontakt_id
      LEFT JOIN LATERAL miete_am(mv.id, current_date) m ON true`;

/** Sortierung: WG-Etage vor ihren Zimmern, danach alphabetisch. */
const SORTIERUNG = `
     ORDER BY COALESCE(eltern.bezeichnung, e.bezeichnung),
              (e.eltern_id IS NOT NULL), e.bezeichnung`;

/** Die Einheiten eines Objekts, in der Reihenfolge der Objektseite. */
export async function einheitenDesObjekts(
  objektId: string,
): Promise<ObjektEinheit[]> {
  return query<ObjektEinheit>(
    `${EINHEITEN_SQL}
     WHERE e.objekt_id = $1
     ${SORTIERUNG}`,
    [objektId],
  );
}

/**
 * Die heute gueltige Gesamtmiete einer Einheit, oder null ohne Vertrag.
 *
 * Bewusst nicht neu zusammengerechnet: mietzusammensetzung() entscheidet
 * auch, ob die zugesagte Gesamtmiete die Summe der Posten schlaegt. Genau
 * daran ist der Moeblierungszuschlag schon einmal verloren gegangen.
 */
export function mieteDerEinheit(e: ObjektEinheit): number | null {
  if (!e.mv_id) return null;
  return mietzusammensetzung({
    kaltmiete: e.m_kalt,
    nebenkosten: e.m_nk,
    moeblierung: e.m_moebel,
    gesamtmiete: e.m_gesamt,
  }).summe;
}

/** Die Einheiten mit eigenem laufenden Mietverhaeltnis. */
export function eigeneMietverhaeltnisse(
  einheiten: ObjektEinheit[],
): Set<string> {
  return new Set(einheiten.filter((e) => e.mv_id).map((e) => e.id));
}

/**
 * Belegt heisst: eigener Vertrag ODER Vertrag an der WG-Etage darueber.
 *
 * Im 2. OG laeuft ein Altmietverhaeltnis ueber die ganze Etage; ohne den
 * zweiten Zweig waeren die fuenf Zimmer darunter "frei".
 */
export function istBelegt(
  e: ObjektEinheit,
  mitVertrag: Set<string>,
): boolean {
  if (e.mv_id) return true;
  return e.eltern_id ? mitVertrag.has(e.eltern_id) : false;
}

/** Alle Zahlen eines Objekts aus seinen Einheiten. */
export function objektKennzahlen(
  einheiten: ObjektEinheit[],
): ObjektKennzahlen {
  const mitVertrag = eigeneMietverhaeltnisse(einheiten);
  const belegt = (e: ObjektEinheit) => istBelegt(e, mitVertrag);
  const einzelnVermietet = einheiten.filter((e) => e.art !== "gemeinschaft");

  const sollMonat = einheiten.reduce(
    (s, e) => s + (mieteDerEinheit(e) ?? 0),
    0,
  );

  // Leerstand nur dort, wo die Belegung gepflegt ist und die Einheit
  // ueberhaupt angeboten wird. Eine Gemeinschaftsflaeche steht nie leer --
  // sie wird gar nicht einzeln vermietet.
  const angebotenFrei = einzelnVermietet.filter(
    (e) => !belegt(e) && e.belegung_gepflegt && e.vermarktung === "anbieten",
  );
  const belegungOffen = einzelnVermietet.filter(
    (e) => !belegt(e) && !e.belegung_gepflegt,
  ).length;

  const entgangeneAngebotsmiete = angebotenFrei.reduce(
    (s, e) =>
      s +
      mietzusammensetzung({
        kaltmiete: e.angebot_kaltmiete,
        nebenkosten: e.angebot_nebenkosten,
        moeblierung: null,
        gesamtmiete: null,
      }).summe,
    0,
  );

  // Flaechen: nur summieren, was da ist, und sagen, wie viel fehlt. Eine
  // Summe aus halben Angaben sieht vollstaendig aus und ist es nicht.
  const mitFlaeche = einheiten.filter((e) => e.flaeche_qm !== null);

  return {
    sollMonat: Math.round(sollMonat * 100) / 100,
    einzeln: einzelnVermietet.length,
    belegt: einzelnVermietet.filter(belegt).length,
    angebotenFrei,
    belegungOffen,
    entgangeneAngebotsmiete:
      Math.round(entgangeneAngebotsmiete * 100) / 100,
    flaeche: mitFlaeche.reduce((s, e) => s + Number(e.flaeche_qm), 0),
    ohneFlaeche: einheiten.length - mitFlaeche.length,
  };
}

interface Objektkopf {
  id: string;
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  notizen: string | null;
  zahlungsdaten_ab: string | null;
}

/**
 * Alle Objekte mit ihren Kennzahlen.
 *
 * Zwei Abfragen statt einer je Objekt: die Koepfe und, in einem Zug, die
 * Einheiten aller Objekte. Die Gruppierung passiert hier, weil die
 * Belegung ueber eltern_id laeuft und sich in SQL nur umstaendlich
 * ausdruecken liesse -- und weil dieselbe Ableitung dann fuer Uebersicht
 * und Detailseite gilt.
 *
 * Objekte ohne Einheiten bleiben in der Liste. Ein leeres Haus ist eine
 * Aussage; es stillschweigend weglassen waere eine stille Luecke.
 */
export async function objektUebersicht(): Promise<ObjektZeile[]> {
  const koepfe = await query<Objektkopf>(
    `SELECT id, name, strasse, plz, ort, notizen, zahlungsdaten_ab::text
       FROM objekt ORDER BY name`,
  );
  const einheiten = await query<ObjektEinheit>(
    `${EINHEITEN_SQL} ${SORTIERUNG}`,
  );

  const nachObjekt = new Map<string, ObjektEinheit[]>();
  for (const e of einheiten) {
    const liste = nachObjekt.get(e.objekt_id);
    if (liste) liste.push(e);
    else nachObjekt.set(e.objekt_id, [e]);
  }

  return koepfe.map((k) => ({
    ...k,
    zahlen: objektKennzahlen(nachObjekt.get(k.id) ?? []),
  }));
}
