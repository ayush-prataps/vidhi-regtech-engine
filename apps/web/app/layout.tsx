import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "Vidhi — Agentic Compliance Engine",
  description: "Grounded regulatory obligation graph and automated compliance tracker for SEBI intermediaries.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <nav className="navbar">
            <div className="navbar-inner">
              <Link href="/" className="brand">
                <span>Vidhi</span>
                <span className="brand-badge">SEBI TechSprint</span>
              </Link>
              <div className="nav-links">
                <Link href="/" className="nav-link">
                  <span>Obligations Graph</span>
                </Link>
                <Link href="/gaps" className="nav-link">
                  <span>Gap Alerts</span>
                </Link>
                <Link href="/changes" className="nav-link">
                  <span>Version Diffs</span>
                </Link>
                <Link href="/audit" className="nav-link">
                  <span>Audit Log</span>
                </Link>
              </div>
            </div>
          </nav>
          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
