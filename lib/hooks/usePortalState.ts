"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocationById, type LocationEntry } from "@/lib/locationCatalog";

const LAST_LOCATION_KEY = "tfpPortalLastLocation";

export { LAST_LOCATION_KEY };

export function usePortalState() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastLocationId, setLastLocationId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLastLocationId(window.localStorage.getItem(LAST_LOCATION_KEY));
    } catch {
      setLastLocationId(null);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const rememberLocation = useCallback((location: LocationEntry) => {
    setLastLocationId(location.id);
    try {
      window.localStorage.setItem(LAST_LOCATION_KEY, location.id);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, []);

  const clearLastLocation = useCallback(() => {
    setLastLocationId(null);
    try {
      window.localStorage.removeItem(LAST_LOCATION_KEY);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, []);

  return {
    isLoaded,
    lastLocation: getLocationById(lastLocationId),
    rememberLocation,
    clearLastLocation,
  };
}
