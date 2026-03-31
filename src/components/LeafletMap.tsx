import "leaflet/dist/leaflet.css";
import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
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
  onPinDrop: (lat: number, lon: number) => void;
}

const DEFAULT_CENTER: [number, number] = [41.1579, -8.6291]; // Porto fallback
const DEFAULT_ZOOM = 13;

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

export default function LeafletMap({ initialAddress, onPinDrop }: Props) {
  const [position, setPosition] = React.useState<[number, number]>(DEFAULT_CENTER);
  const mapRef = useRef<L.Map>(null);

  useEffect(() => {
    if (!initialAddress?.trim()) return;

    // Try raw coords first
    const rawMatch = initialAddress.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (rawMatch) {
      const lat = parseFloat(rawMatch[1]);
      const lon = parseFloat(rawMatch[2]);
      if (!isNaN(lat) && !isNaN(lon)) {
        setPosition([lat, lon]);
        mapRef.current?.setView([lat, lon], DEFAULT_ZOOM);
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
          mapRef.current?.setView([lat, lon], DEFAULT_ZOOM);
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
        center={position}
        zoom={DEFAULT_ZOOM}
        style={{ width: "100%", height: "100%" }}
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DraggableMarker position={position} onMove={handleMove} />
        <ClickHandler onClick={handleMove} />
      </MapContainer>
    </Box>
  );
}
