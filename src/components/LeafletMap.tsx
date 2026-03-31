import "leaflet/dist/leaflet.css";
import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L, { type LeafletMouseEvent } from "leaflet";
import { Box } from "@mui/material";

// Fix Leaflet's default icon paths broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Props {
  initialAddress: string;
  initialCoordinate?: { lat: number; lon: number };
  onPinDrop: (lat: number, lon: number) => void;
}

const DEFAULT_CENTER: [number, number] = [41.1579, -8.6291]; // Porto fallback
const DEFAULT_ZOOM = 13;

// Uses useMap() inside MapContainer context to imperatively pan/zoom
function MapController({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView(target, DEFAULT_ZOOM);
  }, [map, target]);
  return null;
}

function DraggableMarker({ position, onMove }: {
  position: [number, number];
  onMove: (lat: number, lon: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);

  const eventHandlers = {
    dragend() {
      const marker = markerRef.current;
      if (marker) {
        const { lat, lng } = marker.getLatLng();
        onMove(lat, lng);
      }
    },
  };

  return (
    <Marker draggable eventHandlers={eventHandlers} position={position} ref={markerRef} />
  );
}

function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function LeafletMap({ initialAddress, initialCoordinate, onPinDrop }: Props) {
  const [position, setPosition] = useState<[number, number]>(
    initialCoordinate ? [initialCoordinate.lat, initialCoordinate.lon] : DEFAULT_CENTER,
  );
  const [target, setTarget] = useState<[number, number] | null>(
    initialCoordinate ? [initialCoordinate.lat, initialCoordinate.lon] : null,
  );

  useEffect(() => {
    // If we already have exact coordinates, skip geocoding entirely
    if (initialCoordinate) {
      const pos: [number, number] = [initialCoordinate.lat, initialCoordinate.lon];
      setPosition(pos);
      setTarget(pos);
      return;
    }

    if (!initialAddress?.trim()) return;

    // Try raw coords first
    const rawMatch = initialAddress.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (rawMatch) {
      const lat = parseFloat(rawMatch[1]);
      const lon = parseFloat(rawMatch[2]);
      if (!isNaN(lat) && !isNaN(lon)) {
        setPosition([lat, lon]);
        setTarget([lat, lon]);
        return;
      }
    }

    const nominatimUrl =
      (import.meta as any).env?.PUBLIC_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
    fetch(`${nominatimUrl}/search?q=${encodeURIComponent(initialAddress)}&format=json&limit=1`, {
      headers: { "Accept-Language": "en", "User-Agent": "Convocados/1.0" },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.[0]) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          setPosition([lat, lon]);
          setTarget([lat, lon]);
        }
      })
      .catch(() => {});
  }, [initialAddress]);

  const handleMove = (lat: number, lon: number) => {
    setPosition([lat, lon]);
    onPinDrop(lat, lon);
  };

  return (
    <Box sx={{ width: "100%", height: 400 }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController target={target} />
        <DraggableMarker position={position} onMove={handleMove} />
        <ClickHandler onClick={handleMove} />
      </MapContainer>
    </Box>
  );
}
