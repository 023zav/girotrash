import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  GIRONA_CENTER,
  SERVICE_RADIUS_M,
  MAP_CONFIG,
  haversineDistance,
} from '../lib/constants';

interface Props {
  onLocationSelect: (lat: number, lon: number) => void;
  selectedLat?: number;
  selectedLon?: number;
}

export default function MapView({
  onLocationSelect,
  selectedLat,
  selectedLon,
}: Props) {
  const { t } = useTranslation();
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'locating' | 'found' | 'error' | 'outside'
  >('idle');

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: GIRONA_CENTER,
      zoom: MAP_CONFIG.defaultZoom,
      minZoom: MAP_CONFIG.minZoom,
      maxZoom: MAP_CONFIG.maxZoom,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: MAP_CONFIG.maxZoom,
    }).addTo(map);

    // Zoom control bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Service area boundary
    L.circle(GIRONA_CENTER, {
      radius: SERVICE_RADIUS_M,
      color: '#2d6a4f',
      weight: 2,
      dashArray: '8, 8',
      fillColor: '#2d6a4f',
      fillOpacity: 0.04,
      interactive: false,
    }).addTo(map);

    // Restrict panning
    const bounds = L.latLng(GIRONA_CENTER[0], GIRONA_CENTER[1]).toBounds(
      SERVICE_RADIUS_M * 3
    );
    map.setMaxBounds(bounds);

    // Locate button
    const LocateControl = L.Control.extend({
      options: { position: 'bottomright' as L.ControlPosition },
      onAdd() {
        const btn = L.DomUtil.create('button', 'locate-btn');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;
        btn.title = t('map.locateMe');
        L.DomEvent.disableClickPropagation(btn);
        btn.addEventListener('click', () => doGeolocate(map));
        return btn;
      },
    });
    new LocateControl().addTo(map);

    mapRef.current = map;

    // Initial geolocation
    doGeolocate(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle map click to place marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function handleClick(e: L.LeafletMouseEvent) {
      placeMarker(e.latlng.lat, e.latlng.lng);
    }

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker with external coords
  useEffect(() => {
    if (selectedLat != null && selectedLon != null) {
      placeMarker(selectedLat, selectedLon, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLat, selectedLon]);

  const clampToServiceArea = useCallback(
    (lat: number, lon: number): [number, number] => {
      const dist = haversineDistance(
        lat,
        lon,
        GIRONA_CENTER[0],
        GIRONA_CENTER[1]
      );
      if (dist <= SERVICE_RADIUS_M) return [lat, lon];

      const bearing = Math.atan2(
        lon - GIRONA_CENTER[1],
        lat - GIRONA_CENTER[0]
      );
      const offsetLat =
        (SERVICE_RADIUS_M / 111320) * Math.cos(bearing);
      const offsetLon =
        (SERVICE_RADIUS_M /
          (111320 * Math.cos((GIRONA_CENTER[0] * Math.PI) / 180))) *
        Math.sin(bearing);
      return [GIRONA_CENTER[0] + offsetLat, GIRONA_CENTER[1] + offsetLon];
    },
    []
  );

  const placeMarker = useCallback(
    (lat: number, lon: number, notify = true) => {
      const map = mapRef.current;
      if (!map) return;

      const [clampedLat, clampedLon] = clampToServiceArea(lat, lon);

      if (markerRef.current) {
        markerRef.current.setLatLng([clampedLat, clampedLon]);
      } else {
        const icon = L.divIcon({
          className: 'report-pin',
          iconSize: [36, 36],
          iconAnchor: [18, 36],
        });

        const marker = L.marker([clampedLat, clampedLon], {
          icon,
          draggable: true,
        }).addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          const [newLat, newLon] = clampToServiceArea(pos.lat, pos.lng);
          marker.setLatLng([newLat, newLon]);
          onLocationSelect(newLat, newLon);
        });

        markerRef.current = marker;
      }

      if (notify) {
        onLocationSelect(clampedLat, clampedLon);
      }
    },
    [clampToServiceArea, onLocationSelect]
  );

  function doGeolocate(map: L.Map) {
    if (!navigator.geolocation) {
      setLocationStatus('error');
      return;
    }

    setLocationStatus('locating');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const dist = haversineDistance(
          latitude,
          longitude,
          GIRONA_CENTER[0],
          GIRONA_CENTER[1]
        );

        // Show user dot
        if (userMarkerRef.current) map.removeLayer(userMarkerRef.current);
        const userIcon = L.divIcon({
          className: 'user-dot',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        userMarkerRef.current = L.marker([latitude, longitude], {
          icon: userIcon,
          interactive: false,
        }).addTo(map);

        if (dist > SERVICE_RADIUS_M) {
          setLocationStatus('outside');
          map.setView(GIRONA_CENTER, MAP_CONFIG.defaultZoom);
        } else {
          setLocationStatus('found');
          map.setView([latitude, longitude], MAP_CONFIG.defaultZoom);
          placeMarker(latitude, longitude);
        }
      },
      () => {
        setLocationStatus('error');
        map.setView(GIRONA_CENTER, MAP_CONFIG.defaultZoom);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  return (
    <>
      <div ref={containerRef} className="map-container" />
      {locationStatus === 'error' && (
        <div className="banner error">
          <span>{t('map.locationError')}</span>
          <button onClick={() => mapRef.current && doGeolocate(mapRef.current)}>
            {t('map.retry')}
          </button>
        </div>
      )}
      {locationStatus === 'outside' && (
        <div className="banner">
          <span>{t('map.outsideArea')}</span>
        </div>
      )}
      {locationStatus === 'locating' && (
        <div className="banner">
          <span>{t('map.locating')}</span>
          <div className="spinner dark" />
        </div>
      )}
    </>
  );
}
