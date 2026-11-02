import type { Metadata, Viewport } from "next";
// Die Schrift kommt über @import am Anfang von globals.css --
// @fontsource-variable/archivo, eine Variable Font mit Gewichtsachse
// 100--900. Verwendet wird sie über die Marke --schrift.
import "./globals.css";
import { Navi } from "@/components/Navi";
import { angemeldeterBenutzer } from "@/lib/anmeldung";

export const metadata: Metadata = {
  title: "STIG Verwaltung",
  description: "Vorgänge, Nachrichten und Freigaben für Westanlage 9 und Ludwigshafen",
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
