'use client';

import React, { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import mapboxgl from 'mapbox-gl';
import { Map as ReactMapGL, Popup } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Project } from '@/modules/projects/types/project';
import { evaluateHealthFlags } from '@/modules/projects/lib/healthFlags';
import { getSubsForProject, getChecklistsForProject, getCloseoutForProject } from '@/modules/projects/mock/index';

interface MapboxMapProps {
  projects: Project[];
  onProjectClick: (id: string) => void;
  height?: number | string;
}

const MAP_DEBUG_KEY = 'toolbox:debug-map';

function isMapDebugEnabled(): boolean {
  void MAP_DEBUG_KEY;
  return true;
}

function mapDebug(event: string, details?: Record<string, unknown>) {
  if (isMapDebugEnabled()) {
    console.warn(`[ProjectsMap] ${event}`, details ?? {});
  }
}

function mapWarn(event: string, details?: Record<string, unknown>) {
  if (isMapDebugEnabled()) {
    console.warn(`[ProjectsMap] ${event}`, details ?? {});
  }
}

// ─── Style URLs ──────────────────────────────────────────────────────────────

const MAPBOX_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';
const MAPBOX_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
const OSM_STYLE: mapboxgl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

// ─── Brand tokens ────────────────────────────────────────────────────────────

const NCG_CYAN = '#00AEEF';
const NCG_NAVY = '#1D2C5B';

// Downtown Atlanta — hero starting point
const DOWNTOWN_ATL: [number, number] = [-84.388, 33.749];

// Final resting state (fallback when no projects)
const FINAL_ZOOM = 9.5;
const FINAL_PITCH = 35;
const FINAL_BEARING = 0;
const FIT_PADDING = 60; // px padding when fitting bounds

// ─── Health color expression ─────────────────────────────────────────────────

const healthColor: mapboxgl.ExpressionSpecification = [
  'match',
  ['get', 'health'],
  'red', '#EF4444',
  'yellow', '#EAB308',
  '#22C55E',
];

// ─── GeoJSON helpers ─────────────────────────────────────────────────────────

function hasValidCoordinates(project: Project): boolean {
  return Number.isFinite(project.lat)
    && Number.isFinite(project.lng)
    && project.lat >= -90
    && project.lat <= 90
    && project.lng >= -180
    && project.lng <= 180;
}

function buildGeoJSON(
  projects: Project[],
  healthMap: Record<string, string>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: projects.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        health: healthMap[p.id] ?? 'green',
        job_name: p.job_name,
      },
    })),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export function MapboxMap({ projects, onProjectClick, height = 300 }: MapboxMapProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    mapDebug('component mounted', {
      tokenPresent: Boolean(token),
      tokenLength: token?.length ?? 0,
      projectCount: projects.length,
      height,
    });
  }, [height, projects.length, token]);

  return (
    <MapInteractive
      token={token}
      projects={projects}
      onProjectClick={onProjectClick}
      height={height}
    />
  );
}

// ─── Interactive Map ─────────────────────────────────────────────────────────

interface MapInteractiveProps {
  token?: string;
  projects: Project[];
  onProjectClick: (id: string) => void;
  height: number | string;
}

function MapInteractive({ token, projects, onProjectClick, height }: MapInteractiveProps) {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredFeature, setHoveredFeature] = useState<{
    lng: number;
    lat: number;
    id: string;
    job_name: string;
    health: string;
  } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const usesMapboxStyle = Boolean(token);
  const mapStyle = usesMapboxStyle ? (isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT) : OSM_STYLE;

  const validProjects = useMemo(() => projects.filter(hasValidCoordinates), [projects]);
  const invalidProjects = useMemo(
    () => projects
      .filter((project) => !hasValidCoordinates(project))
      .map((project) => ({
        id: project.id,
        jobNumber: project.job_number,
        jobName: project.job_name,
        lat: project.lat,
        lng: project.lng,
      })),
    [projects],
  );

  const healthMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const project of projects) {
      const subs = getSubsForProject(project.id);
      const checklists = getChecklistsForProject(project.id);
      const closeout = getCloseoutForProject(project.id);
      map[project.id] = evaluateHealthFlags(project, subs, checklists, closeout).health;
    }
    return map;
  }, [projects]);

  const geojson = useMemo(() => buildGeoJSON(validProjects, healthMap), [validProjects, healthMap]);

  useEffect(() => {
    mapDebug('data prepared', {
      totalProjects: projects.length,
      validCoordinateProjects: validProjects.length,
      invalidCoordinateProjects: invalidProjects.length,
      invalidSamples: invalidProjects.slice(0, 5),
      styleKind: usesMapboxStyle ? 'mapbox' : 'osm-fallback',
      theme: isDark ? 'dark' : 'light',
    });
  }, [invalidProjects, isDark, projects.length, usesMapboxStyle, validProjects.length]);

  // Dynamic bounding box from actual project locations
  const bounds = useMemo(() => {
    if (!validProjects.length) return null;
    const b = new mapboxgl.LngLatBounds();
    validProjects.forEach((p) => b.extend([p.lng, p.lat]));
    return b;
  }, [validProjects]);

  // ── Refs so event callbacks always see fresh data ──
  const geojsonRef = useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>(geojson);
  const isDarkRef = useRef(isDark);
  const onProjectClickRef = useRef(onProjectClick);
  const pulseIdRef = useRef<number>(0);
  const isStyleTransitioningRef = useRef<boolean>(false);
  const boundsRef = useRef(bounds);

  useEffect(() => {
    isDarkRef.current = isDark;
  }, [isDark]);

  useEffect(() => {
    onProjectClickRef.current = onProjectClick;
  }, [onProjectClick]);

  useEffect(() => {
    geojsonRef.current = geojson;
  }, [geojson]);

  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  // Keep the canvas in sync when the dashboard row height changes after async data loads.
  useEffect(() => {
    if (!mapLoaded) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;

    const resizeMap = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const map = mapRef.current?.getMap();
        if (!map) {
          return;
        }

        map.resize();
        mapDebug('container resize handled', {
          container: {
            width: container.clientWidth,
            height: container.clientHeight,
          },
          canvas: {
            width: map.getCanvas().clientWidth,
            height: map.getCanvas().clientHeight,
          },
        });
      });
    };

    resizeMap();

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelAnimationFrame(frameId);
      };
    }

    const observer = new ResizeObserver(() => {
      resizeMap();
    });

    observer.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [mapLoaded]);

  // ── Sync GeoJSON source when projects change ──
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) {
      mapDebug('geojson sync skipped', { reason: 'map not ready', featureCount: geojson.features.length });
      return;
    }
    if (isStyleTransitioningRef.current) {
      mapDebug('geojson sync skipped', { reason: 'style transitioning', featureCount: geojson.features.length });
      return;
    }
    if (!map.isStyleLoaded()) {
      mapDebug('geojson sync skipped', { reason: 'style not loaded', featureCount: geojson.features.length });
      return;
    }
    const src = map.getSource('projects') as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(geojson);
      mapDebug('geojson source updated', { featureCount: geojson.features.length });
    } else {
      mapDebug('geojson source missing during sync', { featureCount: geojson.features.length });
    }
  }, [geojson]);

  // ── Cleanup pulse on unmount ──
  useEffect(() => {
    return () => { cancelAnimationFrame(pulseIdRef.current); };
  }, []);

  // ── Add all custom layers (reads from refs — safe in any callback) ──
  const addAllLayers = useCallback((map: mapboxgl.Map) => {
    const gj = geojsonRef.current;
    const dark = isDarkRef.current;

    // Use empty FeatureCollection if no data yet — layers still get correct paint properties
    const data: GeoJSON.FeatureCollection<GeoJSON.Point> = gj ?? {
      type: 'FeatureCollection',
      features: [],
    };

    mapDebug('adding layers', {
      featureCount: data.features.length,
      styleLoaded: map.isStyleLoaded(),
      styleKind: usesMapboxStyle ? 'mapbox' : 'osm-fallback',
      canvas: {
        width: map.getCanvas().clientWidth,
        height: map.getCanvas().clientHeight,
      },
    });

    // ── Clean up any stale custom layers from previous style ──
    const customLayers = ['project-pins', 'project-pins-pulse', 'project-pins-shadow', 'road-motorway-glow', 'road-motorway-core', 'sky'];
    for (const layerId of customLayers) {
      try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch { /* ok */ }
    }
    try { if (map.getSource('projects')) map.removeSource('projects'); } catch { /* ok */ }

    if (usesMapboxStyle) {
      // Terrain DEM
      try {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 0.4 });
      } catch { /* ok */ }

      // Sky
      try {
        map.addLayer({
          id: 'sky', type: 'sky',
          paint: {
            'sky-type': 'gradient',
            'sky-gradient': dark
              ? ['interpolate', ['linear'], ['sky-radial-progress'], 0.8, 'rgba(0,20,40,1)', 1, 'rgba(3,8,20,1)']
              : ['interpolate', ['linear'], ['sky-radial-progress'], 0.8, 'rgba(180,210,240,1)', 1, 'rgba(230,240,255,1)'],
            'sky-gradient-center': [0, 0],
            'sky-gradient-radius': 90,
            'sky-opacity': ['interpolate', ['exponential', 0.1], ['zoom'], 5, 0, 22, 1],
          },
        });
      } catch { /* ok */ }
    }

    // Highway glow (dark only — only if composite source exists)
    if (dark && map.getSource('composite')) {
      try {
        const beforeId = map.getStyle().layers?.find(l => l.type === 'symbol' && /road|highway/i.test(l.id))?.id;
        map.addLayer({ id: 'road-motorway-glow', type: 'line', source: 'composite', 'source-layer': 'road', filter: ['==', ['get', 'class'], 'motorway'], paint: { 'line-color': NCG_CYAN, 'line-width': 12, 'line-opacity': 0.15, 'line-blur': 4 } }, beforeId);
        map.addLayer({ id: 'road-motorway-core', type: 'line', source: 'composite', 'source-layer': 'road', filter: ['==', ['get', 'class'], 'motorway'], paint: { 'line-color': NCG_CYAN, 'line-width': 3, 'line-opacity': 0.9 } }, beforeId);
      } catch { /* ok */ }
    }

    // GeoJSON source + pin layers
    try {
      map.addSource('projects', { type: 'geojson', data });
    } catch (error) {
      mapWarn('failed to add projects source', {
        message: error instanceof Error ? error.message : String(error),
        featureCount: data.features.length,
      });
    }

    // Shadow / halo layer (light mode only) — provides contrast on green terrain
    if (!dark) {
      try {
        map.addLayer({
          id: 'project-pins-shadow', type: 'circle', source: 'projects',
          paint: { 'circle-color': 'rgba(0,0,0,0.22)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 20], 'circle-blur': 0.6 },
        });
      } catch { /* ok */ }
    }

    try {
      map.addLayer({
        id: 'project-pins-pulse', type: 'circle', source: 'projects',
        paint: { 'circle-color': healthColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 14, 24], 'circle-opacity': 0.35 },
      });
    } catch { /* ok */ }

    try {
      map.addLayer({
        id: 'project-pins', type: 'circle', source: 'projects',
        paint: { 'circle-color': healthColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 14, 15], 'circle-opacity': 1, 'circle-stroke-color': dark ? '#ffffff' : NCG_NAVY, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 1 },
      });
      mapDebug('project pin layer added', {
        sourceExists: Boolean(map.getSource('projects')),
        pinLayerExists: Boolean(map.getLayer('project-pins')),
      });
    } catch (error) {
      mapWarn('failed to add project pin layer', {
        message: error instanceof Error ? error.message : String(error),
        sourceExists: Boolean(map.getSource('projects')),
      });
    }

  }, [usesMapboxStyle]);

  // ── onLoad ──
  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    setMapLoaded(true);

    mapDebug('load event', {
      styleKind: usesMapboxStyle ? 'mapbox' : 'osm-fallback',
      featureCount: geojsonRef.current.features.length,
      canvas: {
        width: map.getCanvas().clientWidth,
        height: map.getCanvas().clientHeight,
      },
    });

    const beginStyleTransition = () => {
      isStyleTransitioningRef.current = true;
      setHoveredFeature(null);
    };

    const finishStyleTransition = () => {
      addAllLayers(map);
      isStyleTransitioningRef.current = false;
    };

    // Initial map is ready
    finishStyleTransition();

    // Mark transition as soon as style loading begins
    map.on('styledataloading', (e) => {
      if (e.dataType === 'style') {
        beginStyleTransition();
      }
    });

    // After every theme-triggered style swap, wait for idle then re-add layers.
    // idle = style + tiles + sources are ALL ready.
    map.on('style.load', () => {
      map.once('idle', () => {
        finishStyleTransition();
      });
    });

    map.on('error', (e) => {
      mapWarn('map error event', {
        message: e?.error instanceof Error ? e.error.message : String(e?.error ?? e),
      });
    });

    // Click handler
    map.on('click', 'project-pins', (e) => {
      const feature = e.features?.[0];
      if (feature?.properties?.id) {
        onProjectClickRef.current(feature.properties.id as string);
      }
    });

    // Hover handlers
    map.on('mousemove', 'project-pins', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features?.[0];
      if (feature?.properties && feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        setHoveredFeature({
          lng, lat,
          id: feature.properties.id as string,
          job_name: feature.properties.job_name as string,
          health: feature.properties.health as string,
        });
      }
    });
    map.on('mouseleave', 'project-pins', () => {
      map.getCanvas().style.cursor = '';
      setHoveredFeature(null);
    });

    // Pulse animation
    const duration = 2000;
    const mapForPulse = map;
    function pulse() {
      const t = (performance.now() % duration) / duration;
      const scale = 1 + 0.6 * Math.sin(t * Math.PI);
      const opacity = 0.35 * (1 - Math.sin(t * Math.PI));

      if (!isStyleTransitioningRef.current && mapForPulse.getLayer('project-pins-pulse')) {
        mapForPulse.setPaintProperty('project-pins-pulse', 'circle-radius', [
          'interpolate', ['linear'], ['zoom'], 9, 12 * scale, 14, 24 * scale,
        ]);
        mapForPulse.setPaintProperty('project-pins-pulse', 'circle-opacity', opacity);
      }

      pulseIdRef.current = requestAnimationFrame(pulse);
    }
    pulseIdRef.current = requestAnimationFrame(pulse);

    // Hero animation
    map.jumpTo({ center: DOWNTOWN_ATL, zoom: 14, pitch: 60, bearing: -30 });
    setTimeout(() => {
      const b = boundsRef.current;
      if (b) {
        mapDebug('fit bounds', {
          featureCount: geojsonRef.current.features.length,
          bounds: b.toArray(),
        });
        map.fitBounds(b, {
          padding: FIT_PADDING,
          pitch: FINAL_PITCH,
          bearing: FINAL_BEARING,
          duration: 4000,
          maxZoom: FINAL_ZOOM,
        });
      } else {
        mapDebug('fallback flyTo downtown', { featureCount: geojsonRef.current.features.length });
        map.flyTo({
          center: DOWNTOWN_ATL,
          zoom: FINAL_ZOOM, pitch: FINAL_PITCH, bearing: FINAL_BEARING,
          duration: 4000, essential: true,
        });
      }
    }, 800);
  }, [addAllLayers, usesMapboxStyle]);

  // Look up full project for hover card
  const hoveredProject = useMemo(() => {
    if (!hoveredFeature) return null;
    return projects.find((p) => p.id === hoveredFeature.id) ?? null;
  }, [hoveredFeature, projects]);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactMapGL
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={{ longitude: DOWNTOWN_ATL[0], latitude: DOWNTOWN_ATL[1], zoom: 14 }}
        style={{ width: '100%', height }}
        mapStyle={mapStyle}
        styleDiffing={false}
        onLoad={onMapLoad}
      >
        {hoveredFeature && hoveredProject && (
          <Popup
            longitude={hoveredFeature.lng}
            latitude={hoveredFeature.lat}
            anchor="top"
            closeButton={false}
            closeOnClick={false}
            closeOnMove={false}
            offset={14}
            className="pointer-events-none"
            maxWidth="260px"
          >
            <div className="space-y-1 pr-2 py-1">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {hoveredProject.job_number}
              </p>
              <p className="text-sm font-medium leading-snug">
                {hoveredProject.job_name}
              </p>
              <p className="text-xs text-muted-foreground">{hoveredProject.address}</p>
              <p className="text-[11px] text-muted-foreground">
                Phase {hoveredProject.phase}
              </p>
            </div>
          </Popup>
        )}
      </ReactMapGL>
    </div>
  );
}
