"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LocationMap from "@/components/portal/LocationMap";
import LocationPanel from "@/components/portal/LocationPanel";
import LocationSelector from "@/components/portal/LocationSelector";
import {
  getLocationsForPin,
  type LocationEntry,
} from "@/lib/locationCatalog";
import { usePortalState } from "@/lib/hooks/usePortalState";
import { sanitizeCallbackUrl, softwareConfig } from "@/lib/softwareConfig";

function buildLoginUrl(location: LocationEntry, callbackUrl: string | null) {
  if (!callbackUrl) return location.loginUrl;

  if (
    location.loginUrl.startsWith("http://") ||
    location.loginUrl.startsWith("https://")
  ) {
    const url = new URL(location.loginUrl);
    url.searchParams.set("callbackUrl", callbackUrl);
    return url.toString();
  }

  const separator = location.loginUrl.includes("?") ? "&" : "?";
  return `${location.loginUrl}${separator}callbackUrl=${encodeURIComponent(
    callbackUrl,
  )}`;
}

export default function LocationPortal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const portalState = usePortalState();
  const autoSelectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const manualSelectionRef = useRef(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedLocation, setSelectedLocation] =
    useState<LocationEntry | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<
    LocationEntry[] | null
  >(null);

  const callbackUrl = useMemo(() => {
    const raw = searchParams?.get("callbackUrl");
    if (!raw) return null;
    const sanitized = sanitizeCallbackUrl(raw);
    return sanitized === "/" ? null : sanitized;
  }, [searchParams]);

  useEffect(() => {
    if (!portalState.isLoaded || !isMapReady) return;
    if (selectedLocation) return;
    if (!portalState.lastLocation) return;
    if (manualSelectionRef.current) return;
    const rememberedLocation = portalState.lastLocation;

    autoSelectTimeoutRef.current = setTimeout(() => {
      if (manualSelectionRef.current) return;
      setSelectedLocation(rememberedLocation);
      setSelectedLocations(getLocationsForPin(rememberedLocation));
    }, 900);

    return () => {
      if (autoSelectTimeoutRef.current) {
        clearTimeout(autoSelectTimeoutRef.current);
        autoSelectTimeoutRef.current = null;
      }
    };
  }, [
    isMapReady,
    portalState.isLoaded,
    portalState.lastLocation,
    selectedLocation,
  ]);

  const handleSelectPhysicalLocation = (location: LocationEntry) => {
    manualSelectionRef.current = true;
    if (autoSelectTimeoutRef.current) {
      clearTimeout(autoSelectTimeoutRef.current);
      autoSelectTimeoutRef.current = null;
    }
    setSelectedLocation(location);
    setSelectedLocations(getLocationsForPin(location));
  };

  const handleSelectLocation = (location: LocationEntry) => {
    if (location.status !== "active" || !location.loginUrl) return;
    portalState.rememberLocation(location);
    const target = buildLoginUrl(location, callbackUrl);

    if (target.startsWith("http://") || target.startsWith("https://")) {
      window.location.href = target;
      return;
    }

    router.push(target);
  };

  if (!portalState.isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Loading map...
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-white">
      <LocationMap
        selectedLocation={selectedLocation}
        onMapReady={() => setIsMapReady(true)}
        onSelectLocations={(locations) => {
          const location = locations[0];
          if (location) {
            handleSelectPhysicalLocation(location);
            return;
          }
          setSelectedLocation(null);
          setSelectedLocations(null);
        }}
      />

      <div className="pointer-events-none absolute left-4 top-4 z-30 flex flex-col gap-3 sm:left-6">
        <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <img
            src={softwareConfig.logoUrl}
            alt={softwareConfig.name}
            className="h-10 w-10 rounded-xl"
          />
          <div className="hidden sm:block">
            <p className="text-sm font-black">{softwareConfig.name}</p>
            <p className="text-xs text-slate-400">Location portal</p>
          </div>
        </div>

        <LocationSelector
          selectedLocation={selectedLocation}
          onSelectLocation={handleSelectPhysicalLocation}
        />
      </div>

      <LocationPanel
        selectedLocations={selectedLocations}
        onSelectLocation={handleSelectLocation}
      />
    </div>
  );
}
