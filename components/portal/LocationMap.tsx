"use client";

import { useEffect, useRef, useState } from "react";
import Map, {
  Marker,
  NavigationControl,
  type MapRef,
} from "react-map-gl/mapbox";
import {
  getLocationsForPin,
  getMapPins,
  getSelectedCamera,
  type LocationEntry,
} from "@/lib/locationCatalog";

type LocationMapProps = {
  selectedLocation: LocationEntry | null;
  onSelectLocations: (locations: LocationEntry[]) => void;
  onMapReady?: () => void;
};

const mapPins = getMapPins();
const OVERVIEW_STYLE = "mapbox://styles/mapbox/dark-v11";
const SELECTED_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";

export default function LocationMap({
  selectedLocation,
  onSelectLocations,
  onMapReady,
}: LocationMapProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const mapRef = useRef<MapRef | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const mapStyle = selectedLocation ? SELECTED_STYLE : OVERVIEW_STYLE;

  useEffect(() => {
    if (!isMapReady || !selectedLocation) return;
    const camera = getSelectedCamera(selectedLocation);
    mapRef.current?.flyTo({
      center: [selectedLocation.lng, selectedLocation.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
      duration: 1400,
      essential: true,
    });
  }, [isMapReady, selectedLocation]);

  const setupMapEnhancements = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    try {
      map.setFog({
        color: "rgb(9, 15, 28)",
        "high-color": "rgb(33, 71, 128)",
        "horizon-blend": 0.18,
        "space-color": "rgb(2, 6, 23)",
        "star-intensity": 0.18,
      });

      if (map.getSource("mapbox-dem") === undefined) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.25 });

      if (!map.getLayer("portal-3d-buildings")) {
        const layers = map.getStyle().layers ?? [];
        const labelLayer = layers.find(
          (layer) =>
            layer.type === "symbol" &&
            "text-field" in ((layer as any).layout ?? {}),
        );
        map.addLayer(
          {
            id: "portal-3d-buildings",
            source: "composite",
            "source-layer": "building",
            filter: ["==", "extrude", "true"],
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": "#243044",
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                15,
                ["get", "height"],
              ],
              "fill-extrusion-base": [
                "interpolate",
                ["linear"],
                ["zoom"],
                14,
                0,
                15,
                ["get", "min_height"],
              ],
              "fill-extrusion-opacity": 0.72,
            },
          },
          labelLayer?.id,
        );
      }
    } catch {
      // Some Mapbox styles omit terrain/building sources; the map still works.
    }
  };

  const handleMapLoad = () => {
    setupMapEnhancements();
    setIsMapReady(true);
    onMapReady?.();
  };

  if (!mapboxToken) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-950 p-8 text-center text-amber-100">
        Mapbox is not configured. Use the location list below to continue.
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-slate-950">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: -89.5,
          latitude: 38.3,
          zoom: 3.35,
          pitch: 45,
          bearing: -12,
        }}
        mapboxAccessToken={mapboxToken}
        mapStyle={mapStyle}
        minZoom={2.4}
        maxZoom={18}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleMapLoad}
        onStyleData={setupMapEnhancements}
      >
        <NavigationControl position="top-right" showCompass={false} />

        {mapPins.map((pin) => {
          const locations = getLocationsForPin(pin);
          const hasActive = locations.some(
            (location) => location.status === "active",
          );
          const isSelected = locations.some(
            (location) => location.id === selectedLocation?.id,
          );
          const isMuted = !!selectedLocation && !isSelected;
          const label =
            locations.length > 1
              ? `${pin.city}, ${pin.state} (${locations.length})`
              : `${pin.city}, ${pin.state}`;

          return (
            <Marker
              key={`${pin.lat}-${pin.lng}`}
              longitude={pin.lng}
              latitude={pin.lat}
              anchor="bottom"
              onClick={(event) => {
                event.originalEvent.stopPropagation();
                onSelectLocations(locations);
              }}
            >
              <button
                type="button"
                aria-label={`Select ${label}`}
                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-black shadow-xl transition hover:scale-110 ${
                  hasActive
                    ? "border-blue-100 bg-blue-500 text-white shadow-blue-500/40"
                    : "border-slate-300/30 bg-slate-900/90 text-slate-300 shadow-black/40"
                } ${isSelected ? "scale-125 ring-4 ring-white/35" : ""} ${
                  isMuted ? "opacity-35 grayscale" : ""
                }`}
              >
                {hasActive ? (
                  <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/50" />
                ) : null}
                <span className="relative">{locations.length}</span>
                <span className="pointer-events-none absolute bottom-12 left-1/2 hidden w-max -translate-x-1/2 rounded-full bg-slate-950/95 px-3 py-1 text-[11px] font-semibold text-white shadow-xl ring-1 ring-white/10 group-hover:block">
                  {label}
                </span>
              </button>
            </Marker>
          );
        })}

        {selectedLocation ? (
          <Marker
            longitude={selectedLocation.lng}
            latitude={selectedLocation.lat}
            anchor="center"
          >
            <div className="pointer-events-none relative flex h-24 w-24 items-center justify-center">
              <span className="absolute h-24 w-24 animate-ping rounded-full border border-blue-200/70 bg-blue-400/10" />
              <span className="absolute h-16 w-16 rounded-full border border-white/70 bg-blue-500/15 shadow-[0_0_40px_rgba(59,130,246,0.85)]" />
              <span className="relative h-4 w-4 rounded-full border-2 border-white bg-blue-400 shadow-[0_0_22px_rgba(255,255,255,0.85)]" />
              <span className="absolute top-20 w-max rounded-full border border-white/15 bg-slate-950/90 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-2xl backdrop-blur">
                {selectedLocation.city} {selectedLocation.locationLabel}
              </span>
            </div>
          </Marker>
        ) : null}
      </Map>

      {selectedLocation ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.12)_46%,rgba(2,6,23,0.55)_100%)]" />
      ) : null}

      <div className="pointer-events-none absolute bottom-5 left-5 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-xs text-slate-300 shadow-xl backdrop-blur-xl">
        <span className="font-bold text-white">10 locations</span>
        <span className="mx-2 text-slate-500">/</span>
        <span>1 live dashboard</span>
      </div>
    </div>
  );
}
