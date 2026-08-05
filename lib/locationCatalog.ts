/**
 * Demo location catalog for the `/select` location picker and its Mapbox map.
 *
 * Every entry here is fictional: invented street addresses, 555-01xx reserved
 * phone numbers, and city-centroid coordinates rather than real building
 * locations. Replace wholesale with a deployment's real branches if the
 * location picker is ever turned on for production
 * (NEXT_PUBLIC_ENABLE_LOCATION_SELECT).
 */
export type Brand = "NOF" | "NOS" | "NOI";

export type LocationStatus = "active" | "coming_soon";

export type LocationRegion = "Midwest" | "Florida" | "Mountain West";

export type LocationEntry = {
  id: string;
  brand: Brand;
  brandName: string;
  locationLabel: string;
  city: string;
  state: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  region: LocationRegion;
  loginUrl: string;
  status: LocationStatus;
  selectedZoom?: number;
  selectedPitch?: number;
  selectedBearing?: number;
};

export type SelectableLocation = LocationEntry & {
  cardCount: number;
};

export const brandLabels: Record<Brand, string> = {
  NOF: "NorthOps Fire Protection",
  NOS: "NorthOps Fire & Security",
  NOI: "NorthOps Industrial Solutions",
};

export const brandBadgeClasses: Record<Brand, string> = {
  NOF: "bg-blue-500/15 text-blue-200 ring-blue-400/40",
  NOS: "bg-slate-400/15 text-slate-100 ring-slate-300/40",
  NOI: "bg-amber-400/15 text-amber-100 ring-amber-300/40",
};

export const locationCatalog: LocationEntry[] = [
  {
    id: "nof-columbus",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "Headquarters",
    city: "Columbus",
    state: "OH",
    address: "1400 Example Parkway, Suite 200",
    phone: "614.555.0142 / 800.555.0188",
    lat: 39.9612,
    lng: -82.9988,
    region: "Midwest",
    loginUrl: "/login",
    status: "active",
    selectedZoom: 17.8,
    selectedPitch: 66,
    selectedBearing: -28,
  },
  {
    id: "nof-madison",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "North",
    city: "Madison",
    state: "WI",
    address: "820 Sample Ridge Rd",
    phone: "608.555.0119",
    lat: 43.0731,
    lng: -89.4012,
    region: "Midwest",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.2,
    selectedPitch: 64,
    selectedBearing: -18,
  },
  {
    id: "nof-boise",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "West",
    city: "Boise",
    state: "ID",
    address: "45 Placeholder Way",
    phone: "208.555.0173",
    lat: 43.615,
    lng: -116.2023,
    region: "Mountain West",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.5,
    selectedPitch: 65,
    selectedBearing: -22,
  },
  {
    id: "nof-tampa",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "Gulf Coast",
    city: "Tampa",
    state: "FL",
    address: "3300 Fictional Commerce Dr",
    phone: "813.555.0150",
    lat: 27.9506,
    lng: -82.4572,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.3,
    selectedPitch: 64,
    selectedBearing: -20,
  },
  {
    id: "nof-jacksonville",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "Northeast Florida",
    city: "Jacksonville",
    state: "FL",
    address: "760 Specimen Technology Blvd, Unit A",
    phone: "904.555.0126",
    lat: 30.3322,
    lng: -81.6557,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.4,
    selectedPitch: 65,
    selectedBearing: -24,
  },
  {
    id: "nof-ogden",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "Rocky Mountain",
    city: "Ogden",
    state: "UT",
    address: "112 Testing Loop Ste D",
    phone: "801.555.0164",
    lat: 41.223,
    lng: -111.9738,
    region: "Mountain West",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.5,
    selectedPitch: 66,
    selectedBearing: -18,
  },
  {
    id: "nos-columbus",
    brand: "NOS",
    brandName: brandLabels.NOS,
    locationLabel: "Headquarters",
    city: "Columbus",
    state: "OH",
    address: "1400 Example Parkway, Suite 200",
    phone: "614.555.0142 / 800.555.0188",
    lat: 39.9612,
    lng: -82.9988,
    region: "Midwest",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.8,
    selectedPitch: 66,
    selectedBearing: -28,
  },
  {
    id: "noi-columbus",
    brand: "NOI",
    brandName: brandLabels.NOI,
    locationLabel: "Ohio",
    city: "Columbus",
    state: "OH",
    address: "1400 Example Parkway, Suite 200",
    phone: "833.555.0107",
    lat: 39.9612,
    lng: -82.9988,
    region: "Midwest",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.8,
    selectedPitch: 66,
    selectedBearing: -28,
  },
  {
    id: "nof-ocala",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "Central Florida",
    city: "Ocala",
    state: "FL",
    address: "215 Demonstration Ct",
    phone: "352.555.0198",
    lat: 29.1872,
    lng: -82.1401,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.2,
    selectedPitch: 64,
    selectedBearing: -20,
  },
  {
    id: "nof-pensacola-demo",
    brand: "NOF",
    brandName: brandLabels.NOF,
    locationLabel: "Northwest Florida",
    city: "Crestview",
    state: "FL",
    address: "1904 Illustration Ave",
    phone: "850.555.0131",
    lat: 30.7619,
    lng: -86.5705,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.2,
    selectedPitch: 64,
    selectedBearing: -22,
  },
];

export function getLocationById(id: string | null | undefined) {
  if (!id) return null;
  return locationCatalog.find((location) => location.id === id) ?? null;
}

export function getLocationsForPin(location: LocationEntry) {
  return locationCatalog.filter(
    (candidate) =>
      candidate.city === location.city &&
      candidate.state === location.state &&
      candidate.lat === location.lat &&
      candidate.lng === location.lng,
  );
}

export function getMapPins() {
  const seen = new Set<string>();
  return locationCatalog.filter((location) => {
    const key = `${location.lat}:${location.lng}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getSelectableLocations(): SelectableLocation[] {
  return getMapPins().map((location) => ({
    ...location,
    cardCount: getLocationsForPin(location).length,
  }));
}

export function getSelectedCamera(location: LocationEntry) {
  return {
    zoom: location.selectedZoom ?? 17.4,
    pitch: location.selectedPitch ?? 65,
    bearing: location.selectedBearing ?? -24,
  };
}
