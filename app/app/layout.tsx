import type { Metadata, Viewport } from "next";
// Die Schrift kommt über @import am Anfang von globals.css --
// @fontsource-variable/archivo, eine Variable Font mit Gewichtsachse
// 100--900. Verwendet wird sie über die Marke --schrift.
import "./globals.css";
import { Navi } from "@/components/Navi";
import { angemeldeterBenutzer } from "@/lib/anmeldung";

/**
 * Titel und Beschreibung stehen im Browsertab, im Lesezeichen und in der
 * Vorschau eines geteilten Links. Sie nennen deshalb kein Objekt: Sobald
 * ein zweiter Vermieter die Anwendung benutzt, stünden dort die Immobilien
 * eines Fremden. Welche Objekte verwaltet werden, steht auf den Seiten --
 * dort kommt es aus den Daten.
 *
 * icons verweist auf app/icon.svg. Next trägt das Zeichen über die
 * Dateikonvention ohnehin ein; der ausdrückliche Eintrag hält den Verweis
 * auch dort, wo die Metadaten von Hand gelesen werden.
 */
export const metadata: Metadata = {
  title: "Hausverwaltung",
  description: "Mieten, Zahlungen, Vorgänge und Freigaben an einer Stelle",
  icons: { icon: "/icon.svg" },
};

/**
 * Gestaltung, nicht Inhalt.
 *
 * width=device-width ist die Voraussetzung dafür, dass die Seiten auf dem
 * Telefon in Gerätebreite rechnen statt in 980 px -- ohne das greift keine
 * der schmalen Regeln aus globals.css.
 *
 * themeColor färbt die Browserleiste auf dem Telefon in den
 * Seitenhintergrund (--grund), getrennt für hell und dunkel. Die Werte
 * stehen hier als Hex, weil die Metadaten keine CSS-Marken auflösen --
 * sie müssen zu --grund bzw. --dk-grund in globals.css passen.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F7F9" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1116" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const benutzer = await angemeldeterBenutzer();
  return (
    <html lang="de">
      <body>
        <header className="kopf">
          <div className="kopf-innen">
            <div className="marke">
              STIG <span>Verwaltung</span>
            </div>
            <Navi benutzer={benutzer} />
          </div>
        </header>
        <main className="rahmen">{children}</main>
      </body>
    </html>
  );
}
