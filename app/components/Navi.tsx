"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const PUNKTE = [
  { href: "/", text: "Freigabe" },
  { href: "/mietenbuch", text: "Mietenbuch" },
  { href: "/vorgaenge", text: "Vorgänge" },
  { href: "/zahlungen", text: "Zahlungen" },
  { href: "/belege", text: "Belege" },
  { href: "/stammdaten", text: "Stammdaten" },
  { href: "/mahnwesen", text: "Rückstände" },
  { href: "/konten", text: "Konten" },
  { href: "/bank", text: "Bank" },
  { href: "/laeufe", text: "Läufe" },
];

export function Navi({ benutzer }: { benutzer: string | null }) {
  const pfad = usePathname();
  const router = useRouter();

  if (pfad === "/anmelden") return null;

  async function abmelden() {
    await fetch("/api/anmelden", { method: "DELETE" });
    router.replace("/anmelden");
    router.refresh();
  }

  return (
    <nav className="navi">
      {PUNKTE.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          data-aktiv={
            p.href === "/"
              ? pfad === "/"
                ? "ja"
                : "nein"
              : pfad.startsWith(p.href)
                ? "ja"
                : "nein"
          }
        >
          {p.text}
        </Link>
      ))}
      {benutzer && (
        <button
          onClick={abmelden}
          data-art="still"
          style={{
            border: "none",
            background: "none",
            padding: 0,
            fontWeight: 400,
            fontSize: "0.9375rem",
            marginLeft: "auto",
          }}
        >
          Abmelden
        </button>
      )}
    </nav>
  );
}
