export type Kategorie =
  | "mieter"
  | "handwerker"
  | "behoerde"
  | "rechnung"
  | "interessent"
  | "mahnwesen"
  | "werbung"
  | "sonstige";

export type VorgangStatus = "offen" | "wartet" | "erledigt";
export type Richtung = "ein" | "aus";
export type NachrichtStatus = "empfangen" | "entwurf" | "gesendet" | "verworfen";

export interface Vorgang {
  id: string;
  nummer: number;
  betreff: string;
  kategorie: Kategorie;
  status: VorgangStatus;
  heikel: boolean;
  objekt_id: string | null;
  einheit_id: string | null;
  kontakt_id: string | null;
  frist: string | null;
  angelegt_am: string;
  geaendert_am: string;
}

export interface Nachricht {
  id: string;
  vorgang_id: string;
  richtung: Richtung;
  status: NachrichtStatus;
  von_email: string;
  von_name: string | null;
  an_emails: string[];
  cc_emails: string[];
  betreff: string;
  koerper_text: string;
  message_id: string | null;
  in_reply_to: string | null;
  referenzen: string[];
  verfasst_von: "agent" | "mensch" | null;
  agent_notiz: string | null;
  empfangen_am: string | null;
  gesendet_am: string | null;
  angelegt_am: string;
}

export interface Kontakt {
  id: string;
  anzeigename: string;
  rolle:
    | "mieter"
    | "handwerker"
    | "behoerde"
    | "versorger"
    | "interessent"
    | "sonstige";
  firma: string | null;
  telefon: string | null;
}

export const KATEGORIE_LABEL: Record<Kategorie, string> = {
  mieter: "Mieter",
  handwerker: "Handwerker",
  behoerde: "Behörde",
  rechnung: "Rechnung",
  interessent: "Interessent",
  mahnwesen: "Mahnwesen",
  werbung: "Werbung",
  sonstige: "Sonstige",
};

export const STATUS_LABEL: Record<VorgangStatus, string> = {
  offen: "Offen",
  wartet: "Wartet",
  erledigt: "Erledigt",
};

/**
 * Kategorien, bei denen niemals automatisch ein Entwurf verschickt wird.
 * Hier entstehen rechtlich wirksame Erklärungen mit Fristen.
 */
export const HEIKLE_KATEGORIEN: Kategorie[] = ["mahnwesen", "behoerde"];
