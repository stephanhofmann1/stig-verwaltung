import type { Metadata } from "next";
import "./globals.css";
import { Navi } from "@/components/Navi";
import { angemeldeterBenutzer } from "@/lib/anmeldung";

export const metadata: Metadata = {
  title: "STIG Verwaltung",
  description: "Vorgänge, Nachrichten und Freigaben für Westanlage 9 und Ludwigshafen",
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
