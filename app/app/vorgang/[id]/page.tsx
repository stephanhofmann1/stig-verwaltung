import Link from "next/link";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { KATEGORIE_LABEL, STATUS_LABEL } from "@/lib/typen";
import type { Kategorie, VorgangStatus } from "@/lib/typen";
import { aktenzeichen, zeitpunkt } from "@/lib/formate";
import { EntwurfKarte } from "@/components/EntwurfKarte";

export const dynamic = "force-dynamic";

interface Kopf {
  id: string;
  nummer: number;
  betreff: string;
  kategorie: Kategorie;
  status: VorgangStatus;
  heikel: boolean;
  frist: string | null;
  kontakt_name: string | null;
}

interface Eintrag {
  id: string;
  richtung: "ein" | "aus";
  status: string;
  kanal: string;
  von_email: string;
  von_name: string | null;
  an_emails: string[];
  betreff: string;
  koerper_text: string;
  verfasst_von: "agent" | "mensch" | null;
  agent_notiz: string | null;
  empfangen_am: string | null;
  gesendet_am: string | null;
  angelegt_am: string;
}

export default async function Vorgangsakte({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const kopf = await one<Kopf>(
    `SELECT v.id, v.nummer, v.betreff, v.kategorie, v.status, v.heikel,
            v.frist, k.anzeigename AS kontakt_name
       FROM vorgang v
       LEFT JOIN kontakt k ON k.id = v.kontakt_id
      WHERE v.id = $1`,
    [id],
  );
  if (!kopf) notFound();

  const eintraege = await query<Eintrag>(
    `SELECT id, richtung, status, kanal, von_email, von_name, an_emails,
            betreff, koerper_text, verfasst_von, agent_notiz,
            empfangen_am, gesendet_am, angelegt_am
       FROM nachricht
      WHERE vorgang_id = $1 AND status <> 'verworfen'
      ORDER BY angelegt_am ASC`,
    [id],
  );

  return (
    <>
      <div className="akte-kopf">
        <span className="aktenzeichen ziffern">{aktenzeichen(kopf.nummer)}</span>
        <div>
          <h1>{kopf.betreff}</h1>
          <div className="akte-meta">
            <span>{kopf.kontakt_name ?? "Unbekannter Absender"}</span>
            <span>{KATEGORIE_LABEL[kopf.kategorie]}</span>
            <span>{STATUS_LABEL[kopf.status]}</span>
            {kopf.heikel && (
              <span className="marker" data-art="heikel">
                heikel — nicht automatisch beantworten
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="verlauf">
        {eintraege.map((e) =>
          e.status === "entwurf" ? (
            <EntwurfKarte
              key={e.id}
              id={e.id}
              betreff={e.betreff}
              koerper={e.koerper_text}
              empfaenger={e.an_emails}
              verfasstVon={e.verfasst_von}
              notiz={e.agent_notiz}
            />
          ) : (
            <article key={e.id} className="eintrag" data-richtung={e.richtung}>
              <div className="eintrag-kopf">
                <span className="absender">
                  {e.richtung === "ein"
                    ? (e.von_name ?? e.von_email)
                    : "STIG Verwaltung"}
                </span>
                <span className="zeit">
                  {zeitpunkt(e.gesendet_am ?? e.empfangen_am ?? e.angelegt_am)}
                </span>
                {e.kanal === "whatsapp" && (
                  <span className="marker" data-art="whatsapp">
                    WhatsApp
                  </span>
                )}
                {e.richtung === "aus" && e.verfasst_von === "agent" && (
                  <span className="marker" data-art="agent">
                    vorgeschrieben
                  </span>
                )}
              </div>
              <p className="eintrag-text">{e.koerper_text}</p>
            </article>
          ),
        )}
      </div>

      <div className="knopfreihe">
        <Link href="/vorgaenge" className="rueckmeldung">
          Zurück zur Übersicht
        </Link>
      </div>
    </>
  );
}
