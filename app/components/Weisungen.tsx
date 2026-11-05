"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KATEGORIE_LABEL, type Kategorie } from "@/lib/typen";
import type { Ebene } from "@/lib/weisungen";

/**
 * Die Weisungsseite — das, was aus der Mail-Funktion ein Postfach macht.
 *
 * WARUM DAS HIER STEHT
 *
 * Eine Korrektur, die man bei jeder Mail neu eintippen muss, ist keine
 * Hilfe. Die Anweisung am einzelnen Entwurf (EntwurfAnweisung.tsx) loest
 * den Einzelfall; diese Seite loest den Dauerfall. Drei Ebenen, von
 * allgemein nach eng -- und bei Widerspruch gilt die engere.
 *
 * ZWEI ENTSCHEIDUNGEN ZUR FORM
 *
 *   1. Abschalten steht vor Loeschen. Eine Weisung hat Entwuerfe
 *      gepraegt, die versendet wurden; wer spaeter fragt, warum eine Mail
 *      so klang, soll sie noch finden. Der Loeschknopf steht deshalb
 *      hinten und ist still -- er ist fuer den Tippfehler von vor zwei
 *      Minuten.
 *
 *   2. Ueber jeder Ebene steht, WO sie wirkt, nicht nur wie sie heisst.
 *      "Je Kontakt" allein sagt einem Vermieter nicht, dass damit auch
 *      die Sprache der Antwort gemeint sein kann.
 *
 * WAS EINE WEISUNG NICHT KANN
 *
 * Der Text wandert in einen Prompt. Er kann also alles verlangen, auch
 * "sende das sofort" -- und bewirkt es nicht. Nicht, weil der Text
 * geprueft wird, sondern weil hinter dem Entwurf im Code kein Versandweg
 * liegt (siehe Kopf von lib/weisungen.ts und lib/agent.ts). Der Satz
 * unten auf der Seite sagt das dem Nutzer, damit er es nicht ausprobiert
 * und damit er sich darauf verlassen kann.
 */

export interface WeisungZeile {
  id: string;
  ebene: Ebene;
  kategorie: Kategorie | null;
  kontakt_id: string | null;
  weisungstext: string;
  aktiv: boolean;
  rang: number;
}

export interface KontaktZeile {
  id: string;
  anzeigename: string;
  rolle: string;
}

const EBENE_LABEL: Record<Ebene, string> = {
  allgemein: "Für alles",
  kategorie: "Je Kategorie",
  kontakt: "Je Kontakt",
};

const EBENE_ERKLAERUNG: Record<Ebene, string> = {
  allgemein:
    "Gilt in jedem Entwurf, egal von wem die Mail kommt. Zum Beispiel: " +
    "„schreib kurz, höchstens fünf Sätze“ oder „nie ohne Anrede mit Namen“.",
  kategorie:
    "Gilt für alle Mails einer Kategorie. Zum Beispiel: „bei Handwerkern " +
    "immer nach einem Termin fragen“.",
  kontakt:
    "Gilt nur für Mails dieses einen Kontakts und schlägt die beiden " +
    "anderen Ebenen. Zum Beispiel: „der schreibt Englisch, antworte auf " +
    "Englisch“.",
};

const KATEGORIEN = Object.keys(KATEGORIE_LABEL) as Kategorie[];
const EBENEN: Ebene[] = ["allgemein", "kategorie", "kontakt"];

type Meldung = { art: "gut" | "fehler"; text: string };

export function Weisungen({
  weisungen,
  kontakte,
}: {
  weisungen: WeisungZeile[];
  kontakte: KontaktZeile[];
}) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  const [ebene, setEbene] = useState<Ebene>("allgemein");
  const [kategorie, setKategorie] = useState<Kategorie>("handwerker");
  const [kontaktId, setKontaktId] = useState<string>(kontakte[0]?.id ?? "");
  const [text, setText] = useState("");

  /** Offene Textfelder beim Bearbeiten, je Weisung. */
  const [bearbeitet, setBearbeitet] = useState<Record<string, string>>({});

  const blockiert = busy || laeuft;
  const kontaktName = (id: string | null) =>
    kontakte.find((k) => k.id === id)?.anzeigename ?? "unbekannter Kontakt";

  async function ruf(
    methode: "POST" | "PATCH" | "DELETE",
    koerper: Record<string, unknown> | null,
    erfolg: string,
    abfrage = "",
  ) {
    setBusy(true);
    setMeldung(null);
    try {
      const r = await fetch(`/api/weisungen${abfrage}`, {
        method: methode,
        ...(koerper
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(koerper),
            }
          : {}),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        fehler?: string;
      };
      if (!r.ok || !d.ok) {
        setMeldung({ art: "fehler", text: d.fehler ?? "Das hat nicht geklappt." });
        return false;
      }
      setMeldung({ art: "gut", text: erfolg });
      start(() => router.refresh());
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function anlegen() {
    const ok = await ruf(
      "POST",
      {
        ebene,
        weisungstext: text,
        ...(ebene === "kategorie" ? { kategorie } : {}),
        ...(ebene === "kontakt" ? { kontakt_id: kontaktId } : {}),
      },
      "Weisung angelegt. Sie wirkt ab dem nächsten Entwurf.",
    );
    if (ok) setText("");
  }

  const nachEbene = (e: Ebene) =>
    weisungen
      .filter((w) => w.ebene === e)
      .sort((a, b) => a.rang - b.rang || a.weisungstext.localeCompare(b.weisungstext));

  return (
    <>
      {/* --- Anlegen --------------------------------------------------- */}
      <section className="abschnitt">
        <div className="titelzeile" data-rang="klein">
          <h2>Neue Weisung</h2>
          <span className="zaehler ziffern">
            {weisungen.filter((w) => w.aktiv).length} aktiv
          </span>
        </div>

        <div className="feldraster">
          <label className="feld">
            Ebene
            <select
              value={ebene}
              onChange={(e) => setEbene(e.target.value as Ebene)}
              disabled={blockiert}
            >
              {EBENEN.map((e) => (
                <option key={e} value={e}>
                  {EBENE_LABEL[e]}
                </option>
              ))}
            </select>
          </label>

          {ebene === "kategorie" && (
            <label className="feld">
              Kategorie
              <select
                value={kategorie}
                onChange={(e) => setKategorie(e.target.value as Kategorie)}
                disabled={blockiert}
              >
                {KATEGORIEN.map((k) => (
                  <option key={k} value={k}>
                    {KATEGORIE_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {ebene === "kontakt" && (
            <label className="feld">
              Kontakt
              <select
                value={kontaktId}
                onChange={(e) => setKontaktId(e.target.value)}
                disabled={blockiert || kontakte.length === 0}
              >
                {kontakte.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.anzeigename} ({k.rolle})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="erklaerung">{EBENE_ERKLAERUNG[ebene]}</p>

        <label className="feld">
          Weisung
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            spellCheck
            disabled={blockiert}
            placeholder="z. B. schreib kurz, höchstens fünf Sätze"
          />
        </label>

        <div className="knopfreihe">
          <button
            onClick={anlegen}
            disabled={
              blockiert ||
              text.trim().length < 3 ||
              (ebene === "kontakt" && !kontaktId)
            }
          >
            Weisung anlegen
          </button>
          {ebene === "kontakt" && kontakte.length === 0 && (
            <span className="rueckmeldung" data-art="warn">
              Es gibt noch keinen Kontakt, an dem eine Weisung hängen könnte.
            </span>
          )}
        </div>

        {meldung && (
          <div
            className="meldung"
            data-art={meldung.art === "gut" ? "gut" : "fehler"}
          >
            <strong>
              {meldung.art === "gut" ? "Übernommen" : "Nicht geändert"}
            </strong>
            {meldung.text}
          </div>
        )}
      </section>

      {/* --- Bestand --------------------------------------------------- */}
      {EBENEN.map((e) => {
        const liste = nachEbene(e);
        return (
          <section className="abschnitt" key={e}>
            <div className="titelzeile" data-rang="klein">
              <h2>{EBENE_LABEL[e]}</h2>
              <span className="zaehler ziffern">{liste.length}</span>
            </div>

            {liste.length === 0 ? (
              <div className="leer">
                <strong>Keine Weisung auf dieser Ebene</strong>
                {EBENE_ERKLAERUNG[e]}
              </div>
            ) : (
              <div className="register">
                {liste.map((w) => {
                  const offen = bearbeitet[w.id] !== undefined;
                  return (
                    <div className="posten" data-still="ja" key={w.id}>
                      <span className="nummer">
                        {w.aktiv ? (
                          <span className="marker" data-art="gut">
                            aktiv
                          </span>
                        ) : (
                          <span className="marker">aus</span>
                        )}
                      </span>
                      <span className="betreff">
                        {offen ? (
                          <textarea
                            value={bearbeitet[w.id]}
                            rows={2}
                            disabled={blockiert}
                            onChange={(ev) =>
                              setBearbeitet((b) => ({
                                ...b,
                                [w.id]: ev.target.value,
                              }))
                            }
                          />
                        ) : (
                          w.weisungstext
                        )}
                      </span>
                      <span className="zeit">
                        {w.ebene === "kategorie" && w.kategorie
                          ? KATEGORIE_LABEL[w.kategorie]
                          : w.ebene === "kontakt"
                            ? kontaktName(w.kontakt_id)
                            : ""}
                      </span>
                      <span className="unterzeile">
                        {offen ? (
                          <>
                            <button
                              disabled={
                                blockiert || bearbeitet[w.id].trim().length < 3
                              }
                              onClick={async () => {
                                const ok = await ruf(
                                  "PATCH",
                                  { id: w.id, weisungstext: bearbeitet[w.id] },
                                  "Weisung geändert. Sie wirkt ab dem nächsten Entwurf.",
                                );
                                if (ok) {
                                  setBearbeitet((b) => {
                                    const n = { ...b };
                                    delete n[w.id];
                                    return n;
                                  });
                                }
                              }}
                            >
                              Übernehmen
                            </button>
                            <button
                              data-art="still"
                              disabled={blockiert}
                              onClick={() =>
                                setBearbeitet((b) => {
                                  const n = { ...b };
                                  delete n[w.id];
                                  return n;
                                })
                              }
                            >
                              Abbrechen
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              data-art="still"
                              disabled={blockiert}
                              onClick={() =>
                                setBearbeitet((b) => ({
                                  ...b,
                                  [w.id]: w.weisungstext,
                                }))
                              }
                            >
                              Ändern
                            </button>
                            <button
                              data-art="still"
                              disabled={blockiert}
                              onClick={() =>
                                ruf(
                                  "PATCH",
                                  { id: w.id, aktiv: !w.aktiv },
                                  w.aktiv
                                    ? "Abgeschaltet. Sie prägt keinen neuen Entwurf mehr und bleibt nachlesbar."
                                    : "Wieder eingeschaltet.",
                                )
                              }
                            >
                              {w.aktiv ? "Abschalten" : "Einschalten"}
                            </button>
                            <button
                              data-art="still"
                              disabled={blockiert}
                              onClick={() =>
                                ruf(
                                  "DELETE",
                                  null,
                                  "Gelöscht.",
                                  `?id=${encodeURIComponent(w.id)}`,
                                )
                              }
                            >
                              Löschen
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <p className="hinweis abschnitt">
        Die Weisungen gehen bei jedem Entwurf in den Auftrag an das
        Sprachmodell. Widersprechen sie sich, gilt die engere: „Je Kontakt“
        schlägt „Je Kategorie“ schlägt „Für alles“. An jedem Entwurf steht
        unter „Worauf das beruht“, welche davon gewirkt haben — eine
        unsichtbare Dauerweisung wäre schlimmer als keine.
      </p>
      <p className="hinweis">
        Eine Weisung kann nichts auslösen. Sie verändert Inhalt, Ton und
        Sprache eines Entwurfs; sie kann keine Mail versenden, keinen
        Termin zusagen und keine Freigabe ersetzen — auch dann nicht, wenn
        es so in ihr steht. Gesendet wird allein, was in der Freigabe
        angeklickt wird.
      </p>
    </>
  );
}
