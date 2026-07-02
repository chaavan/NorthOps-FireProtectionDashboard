export type Brand = "TFP" | "TFS" | "TIS";

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
  TFP: "Total Fire Protection",
  TFS: "Total Fire & Security",
  TIS: "Total Industrial Solutions",
};

export const brandBadgeClasses: Record<Brand, string> = {
  TFP: "bg-blue-500/15 text-blue-200 ring-blue-400/40",
  TFS: "bg-slate-400/15 text-slate-100 ring-slate-300/40",
  TIS: "bg-amber-400/15 text-amber-100 ring-amber-300/40",
};

export const locationCatalog: LocationEntry[] = [
  {
    id: "tfp-grand-rapids",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "Headquarters",
    city: "Grand Rapids",
    state: "MI",
    address: "5385 Patterson Ave SE, Suite C",
    phone: "616.735.2300 / 800.513.7804",
    lat: 42.8791,
    lng: -85.5436,
    region: "Midwest",
    loginUrl: "/login",
    status: "active",
    selectedZoom: 17.8,
    selectedPitch: 66,
    selectedBearing: -28,
  },
  {
    id: "tfp-traverse-city",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "North",
    city: "Traverse City",
    state: "MI",
    address: "4576 US-31",
    phone: "231.778.0497",
    lat: 44.7278,
    lng: -85.6744,
    region: "Midwest",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.2,
    selectedPitch: 64,
    selectedBearing: -18,
  },
  {
    id: "tfp-berthoud",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "West",
    city: "Berthoud",
    state: "CO",
    address: "80 Gateway Cir",
    phone: "970.613.1370",
    lat: 40.3083,
    lng: -105.0811,
    region: "Mountain West",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.5,
    selectedPitch: 65,
    selectedBearing: -22,
  },
  {
    id: "tfp-fort-myers",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "Southwest Florida",
    city: "Fort Myers",
    state: "FL",
    address: "5610 Zip Dr",
    phone: "239.309.8424",
    lat: 26.6406,
    lng: -81.8723,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.3,
    selectedPitch: 64,
    selectedBearing: -20,
  },
  {
    id: "tfp-pensacola",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "Gulf Coast",
    city: "Pensacola",
    state: "FL",
    address: "6260 Technology Dr, Unit A",
    phone: "850.517.4470",
    lat: 30.4213,
    lng: -87.2169,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.4,
    selectedPitch: 65,
    selectedBearing: -24,
  },
  {
    id: "tfp-bozeman",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "Rocky Mountain",
    city: "Bozeman",
    state: "MT",
    address: "182 Durston Rd Ste D",
    phone: "406.296.8525",
    lat: 45.6805,
    lng: -111.0447,
    region: "Mountain West",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.5,
    selectedPitch: 66,
    selectedBearing: -18,
  },
  {
    id: "tfs-grand-rapids",
    brand: "TFS",
    brandName: brandLabels.TFS,
    locationLabel: "Headquarters",
    city: "Grand Rapids",
    state: "MI",
    address: "5385 Patterson Ave SE, Suite C",
    phone: "616.735.2300 / 800.513.7804",
    lat: 42.8791,
    lng: -85.5436,
    region: "Midwest",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.8,
    selectedPitch: 66,
    selectedBearing: -28,
  },
  {
    id: "tis-grand-rapids",
    brand: "TIS",
    brandName: brandLabels.TIS,
    locationLabel: "Michigan",
    city: "Grand Rapids",
    state: "MI",
    address: "5385 Patterson Ave SE, Suite C",
    phone: "833.847.3473",
    lat: 42.8791,
    lng: -85.5436,
    region: "Midwest",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.8,
    selectedPitch: 66,
    selectedBearing: -28,
  },
  {
    id: "tfp-sarasota",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "Sun Coast",
    city: "Sarasota",
    state: "FL",
    address: "410 Interstate Ct",
    phone: "941.233.9833",
    lat: 27.3364,
    lng: -82.5307,
    region: "Florida",
    loginUrl: "",
    status: "coming_soon",
    selectedZoom: 17.2,
    selectedPitch: 64,
    selectedBearing: -20,
  },
  {
    id: "tfp-panama-city-beach",
    brand: "TFP",
    brandName: brandLabels.TFP,
    locationLabel: "Northwest Florida",
    city: "Panama City Beach",
    state: "FL",
    address: "1904 Cauley Ave",
    phone: "850.913.9291",
    lat: 30.1766,
    lng: -85.8055,
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
