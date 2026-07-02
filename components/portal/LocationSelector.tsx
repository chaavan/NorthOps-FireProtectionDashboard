"use client";

import {
  getSelectableLocations,
  type LocationEntry,
} from "@/lib/locationCatalog";

type LocationSelectorProps = {
  selectedLocation: LocationEntry | null;
  onSelectLocation: (location: LocationEntry) => void;
};

const selectableLocations = getSelectableLocations();

export default function LocationSelector({
  selectedLocation,
  onSelectLocation,
}: LocationSelectorProps) {
  return (
    <div className="pointer-events-auto w-full max-w-xs rounded-2xl border border-white/10 bg-slate-950/75 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <label
        htmlFor="portal-location-select"
        className="mb-2 block text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400"
      >
        Select location
      </label>
      <select
        id="portal-location-select"
        value={selectedLocation?.id ?? ""}
        onChange={(event) => {
          const location = selectableLocations.find(
            (candidate) => candidate.id === event.target.value,
          );
          if (location) onSelectLocation(location);
        }}
        className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-500/30"
      >
        <option value="" disabled className="bg-slate-950 text-slate-400">
          Select location
        </option>
        {selectableLocations.map((location) => (
          <option
            key={location.id}
            value={location.id}
            className="bg-slate-950 text-white"
          >
            {location.city}, {location.state} - {location.locationLabel}
            {location.cardCount > 1 ? ` (${location.cardCount})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
