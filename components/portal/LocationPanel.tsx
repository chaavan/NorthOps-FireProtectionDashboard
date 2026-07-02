"use client";

import {
  brandBadgeClasses,
  type LocationEntry,
} from "@/lib/locationCatalog";

type LocationPanelProps = {
  selectedLocations: LocationEntry[] | null;
  onSelectLocation: (location: LocationEntry) => void;
};

function LocationCard({
  location,
  onSelectLocation,
}: {
  location: LocationEntry;
  onSelectLocation: (location: LocationEntry) => void;
}) {
  const isActive = location.status === "active";

  return (
    <button
      type="button"
      onClick={() => onSelectLocation(location)}
      disabled={!isActive}
      className={`group relative w-full rounded-3xl border p-5 text-left shadow-2xl backdrop-blur-xl transition duration-300 ${
        isActive
          ? "border-blue-300/40 bg-blue-500/15 shadow-blue-950/30 hover:-translate-x-1 hover:bg-blue-500/20"
          : "cursor-not-allowed border-white/10 bg-slate-950/65 opacity-80 shadow-black/30"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] ring-1 ${brandBadgeClasses[location.brand]}`}
        >
          {location.brand}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            isActive
              ? "bg-emerald-400/15 text-emerald-200"
              : "bg-slate-500/15 text-slate-300"
          }`}
        >
          {isActive ? "Live" : "Coming soon"}
        </span>
      </div>

      <h3 className="text-lg font-black text-white">
        {location.locationLabel}
      </h3>
      <p className="mt-1 text-sm font-semibold text-blue-100">
        {location.brandName}
      </p>
      <p className="mt-3 text-sm text-slate-300">
        {location.address}, {location.city}, {location.state}
      </p>
      <p className="mt-1 text-xs text-slate-500">{location.phone}</p>

      {isActive ? (
        <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-200">
          Enter dashboard
          <span className="transition group-hover:translate-x-1">-&gt;</span>
        </span>
      ) : null}
    </button>
  );
}

export default function LocationPanel({
  selectedLocations,
  onSelectLocation,
}: LocationPanelProps) {
  if (!selectedLocations?.length) return null;

  const selected = selectedLocations[0];

  return (
    <aside className="pointer-events-none absolute bottom-6 right-4 top-28 z-20 flex w-[min(26rem,calc(100vw-2rem))] items-center sm:right-6">
      <svg
        className="pointer-events-none absolute -left-24 top-1/2 hidden h-52 w-28 -translate-y-1/2 text-blue-300/25 lg:block"
        viewBox="0 0 120 220"
        fill="none"
        aria-hidden
      >
        {selectedLocations.length > 1 ? (
          <path
            d="M2 110 C42 110 54 35 118 35"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="6 7"
          />
        ) : null}
        <path
          d="M2 110 C42 110 58 110 118 110"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="6 7"
        />
        {selectedLocations.length > 2 ? (
          <path
            d="M2 110 C42 110 54 185 118 185"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="6 7"
          />
        ) : null}
        <circle cx="2" cy="110" r="3" fill="currentColor" />
      </svg>

      <div className="pointer-events-auto w-full animate-in slide-in-from-right-8 fade-in duration-500">
        <div className="mb-4 rounded-3xl border border-white/10 bg-slate-950/70 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-blue-300">
            Selected
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">
            {selected.city}, {selected.state}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {selected.locationLabel} / {selected.region}
          </p>
        </div>

        <div className="grid gap-3">
          {selectedLocations.map((location) => (
          <LocationCard
            key={location.id}
            location={location}
            onSelectLocation={onSelectLocation}
          />
          ))}
        </div>
      </div>
    </aside>
  );
}
