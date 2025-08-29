// app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-6 py-20">
        <header className="mb-10">
          <h1 className="text-5xl font-extrabold leading-tight">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              CSV Geocoder
            </span>{" "}
            <span className="text-white">&amp; Mapper</span>
          </h1>
          <p className="text-slate-300 text-lg mt-4">
            Upload a CSV, map your columns, geocode U.S. addresses, and visualize
            them on an interactive map.
          </p>
        </header>

        <div className="flex gap-4">
          <Link
            href="/upload"
            className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 transition-transform duration-200 hover:scale-105"
          >
            Go to Upload
          </Link>

          <a
            href="https://docs.mapbox.com/help/getting-started/access-tokens/"
            target="_blank"
            rel="noreferrer"
            className="px-6 py-3 rounded-xl font-semibold text-white/90 bg-white/10 hover:bg-white/15"
          >
            Mapbox Token Help
          </a>
        </div>

        <section className="mt-14 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
            <h2 className="text-xl font-bold mb-2">1. Upload CSV</h2>
            <p className="text-slate-300 text-sm">
              Drag &amp; drop your CSV. We’ll auto-detect columns and suggest a mapping.
            </p>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
            <h2 className="text-xl font-bold mb-2">2. Parse Addresses</h2>
            <p className="text-slate-300 text-sm">
              Use a full address column or individual parts (street, city, state, ZIP).
            </p>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
            <h2 className="text-xl font-bold mb-2">3. Geocode</h2>
            <p className="text-slate-300 text-sm">
              We’ll fetch lat/lng for valid U.S. addresses with your Mapbox token.
            </p>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
            <h2 className="text-xl font-bold mb-2">4. Visualize &amp; Export</h2>
            <p className="text-slate-300 text-sm">
              See pins on a map and download a cleaned CSV with coordinates.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

