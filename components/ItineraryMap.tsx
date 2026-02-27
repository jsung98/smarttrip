"use client";

import { useMemo, useEffect, useState } from "react";
import { GoogleMap, Marker, Polyline, useJsApiLoader } from "@react-google-maps/api";

export type MapPoint = {
  name: string;
  lat: number;
  lon: number;
  address?: string;
  dayNum?: number;
  order?: number;
  section?: string;
};

type ItineraryMapProps = {
  points: MapPoint[];
  selectedDay?: number | "all";
};

const SECTION_ORDER: Record<string, number> = {
  오전: 1,
  점심: 2,
  오후: 3,
  저녁: 4,
  밤: 5,
};

const palette = ["#7c3aed", "#0ea5e9", "#f97316", "#16a34a", "#e11d48", "#14b8a6"];

function normalizeSection(section?: string) {
  if (!section) return "";
  const trimmed = section.replace(/\s+/g, "").replace(/\(.*\)/g, "");
  return trimmed;
}

function getDayColor(dayNum?: number) {
  const day = dayNum ?? 1;
  return palette[(day - 1) % palette.length];
}

export default function ItineraryMap({ points, selectedDay = "all" }: ItineraryMapProps) {
  if (!points.length) return null;

  const filtered =
    selectedDay === "all"
      ? points
      : points.filter((p) => (p.dayNum ?? 1) === selectedDay);

  const mapKey = selectedDay === "all" ? "all" : String(selectedDay);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    language: "ko",
    region: "kr",
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dayA = a.dayNum ?? 1;
      const dayB = b.dayNum ?? 1;
      if (dayA !== dayB) return dayA - dayB;
      const sectionA = normalizeSection(a.section);
      const sectionB = normalizeSection(b.section);
      const sectionRankA = SECTION_ORDER[sectionA] ?? 99;
      const sectionRankB = SECTION_ORDER[sectionB] ?? 99;
      if (sectionRankA !== sectionRankB) return sectionRankA - sectionRankB;
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  const byDay = useMemo(() => {
    const map = new Map<number, MapPoint[]>();
    for (const p of sorted) {
      const day = p.dayNum ?? 1;
      const list = map.get(day) ?? [];
      list.push(p);
      map.set(day, list);
    }
    return map;
  }, [sorted]);

  const [mapRef, setMapRef] = useState<google.maps.Map | null>(null);

  useEffect(() => {
    if (mapRef) setMapRef(null);
  }, [mapKey]);

  useEffect(() => {
    if (!mapRef || !sorted.length) return;
    if (sorted.length === 1) {
      mapRef.setCenter({ lat: sorted[0].lat, lng: sorted[0].lon });
      mapRef.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    sorted.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
    mapRef.fitBounds(bounds, 80);
  }, [mapRef, sorted]);

  if (!filtered.length) {
    return (
      <div className="flex h-80 w-full items-center justify-center rounded-2xl border border-white/40 bg-white/80 text-sm text-slate-600 shadow-lg">
        해당 날짜에 표시할 장소가 없습니다.
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="flex h-80 w-full items-center justify-center rounded-2xl border border-white/40 bg-white/80 text-sm text-rose-600 shadow-lg">
        Google Maps API 키가 설정되지 않았습니다.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-80 w-full items-center justify-center rounded-2xl border border-white/40 bg-white/80 text-sm text-rose-600 shadow-lg">
        지도를 불러오지 못했습니다.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-80 w-full animate-pulse rounded-2xl border border-white/40 bg-white/80 shadow-lg" />
    );
  }

  const center = { lat: sorted[0].lat, lng: sorted[0].lon };

  return (
    <div className="h-80 w-full overflow-hidden rounded-2xl border border-white/40 shadow-lg">
      <GoogleMap
        key={`map-${mapKey}`}
        onLoad={(map) => setMapRef(map)}
        mapContainerClassName="h-full w-full"
        center={center}
        zoom={12}
        options={{
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
        }}
      >
        {[...byDay.entries()].map(([day, list]) => {
          if (list.length < 2) return null;
          const line = list.map((p) => ({ lat: p.lat, lng: p.lon }));
          return (
            <Polyline
              key={`line-${day}`}
              path={line}
              options={{ strokeColor: getDayColor(day), strokeOpacity: 0.8, strokeWeight: 4 }}
            />
          );
        })}
        {sorted.map((p, idx) => {
          const order = p.order ?? idx + 1;
          const label = String(order);
          return (
            <Marker
              key={`${p.name}-${idx}`}
              position={{ lat: p.lat, lng: p.lon }}
              label={{ text: label, color: "#ffffff", fontSize: "11px", fontWeight: "700" }}
              title={p.name}
            />
          );
        })}
      </GoogleMap>
    </div>
  );
}
