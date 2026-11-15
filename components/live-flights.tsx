"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import type { LiveAircraft, LiveFlightsPayload } from "../lib/adsb/types";

const ARCHIPELAGO_BOUNDS: [[number, number], [number, number]] = [
  [-25.6, 14.6],
  [-22.4, 17.35],
];

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

function intlLocale(locale: Locale) {
  if (locale === "en") return "en-GB";
  if (locale === "fr") return "fr-FR";
  return "pt-PT";
}

function formatNumber(locale: Locale, value: number, digits = 0) {
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

function themeName() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function styleForTheme() {
  return themeName() === "dark"
    ? "https://tiles.openfreemap.org/styles/dark"
    : "https://tiles.openfreemap.org/styles/positron";
}

function planeName(plane: LiveAircraft) {
  return plane.callsign ?? plane.registration ?? plane.hex.toUpperCase();
}

function detailLine(plane: LiveAircraft) {
  const name = planeName(plane);
  return [plane.aircraftType, plane.registration]
    .filter((part): part is string => Boolean(part) && part !== name)
    .join(" · ");
}

function statRows(plane: LiveAircraft, locale: Locale): [string, string][] {
  const rows: [string, string][] = [];
  if (plane.onGround) {
    rows.push([t("flights.altitude", undefined, locale), t("flights.ground", undefined, locale)]);
  } else if (plane.altitudeFeet != null) {
    rows.push([
      t("flights.altitude", undefined, locale),
      t("flights.feet", { value: formatNumber(locale, plane.altitudeFeet) }, locale),
    ]);
  }
  if (plane.groundSpeedKnots != null) {
    rows.push([
      t("flights.speed", undefined, locale),
      t("flights.knots", { value: formatNumber(locale, plane.groundSpeedKnots) }, locale),
    ]);
  }
  if (plane.trackDegrees != null) {
    rows.push([
      t("flights.heading", undefined, locale),
      t("flights.degrees", { value: formatNumber(locale, plane.trackDegrees) }, locale),
    ]);
  }
  if (plane.seenSeconds != null) {
    rows.push([
      t("flights.seen", undefined, locale),
      t("flights.seconds", { value: formatNumber(locale, plane.seenSeconds, plane.seenSeconds < 10 ? 1 : 0) }, locale),
    ]);
  }
  return rows;
}

function isPayload(value: unknown): value is LiveFlightsPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as LiveFlightsPayload;
  return (
    (body.status === "available" || body.status === "unavailable" || body.status === "unconfigured") &&
    Array.isArray(body.aircraft)
  );
}

function quietPayload(): LiveFlightsPayload {
  return {
    status: "unavailable",
    stale: false,
    source: "adsb.lol",
    license: "Open Data Commons Open Database License (ODbL) v1.0",
    location: { name: "Ilha do Maio", latitude: 0, longitude: 0 },
    region: "Cabo Verde",
    radiusNauticalMiles: 0,
    retrievedAt: null,
    aircraft: [],
    truncated: false,
    caveats: [],
    retryAfterSeconds: null,
  };
}

async function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  const mod = (await import("maplibre-gl")) as unknown as typeof import("maplibre-gl") & {
    default?: typeof import("maplibre-gl");
  };
  if (mod.default && typeof mod.default.Map === "function") return mod.default;
  return mod;
}

export function LiveFlights({
  locale,
  radiusNm,
  refreshMs,
  latitude,
  longitude,
}: {
  locale: Locale;
  radiusNm: number;
  refreshMs: number;
  latitude: number;
  longitude: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const libRef = useRef<Awaited<ReturnType<typeof loadMapLibre>> | null>(null);
  const popupRef = useRef<{ remove: () => void } | null>(null);
  const aircraftRef = useRef<LiveAircraft[]>([]);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const openPopupRef = useRef<(plane: LiveAircraft) => void>(() => {});
  const [payload, setPayload] = useState<LiveFlightsPayload | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/flights");
        const body: unknown = await response.json();
        if (cancelled) return;
        if (isPayload(body)) setPayload(body);
        else setPayload((current) => (current?.status === "available" ? current : quietPayload()));
      } catch {
        if (!cancelled) setPayload((current) => (current?.status === "available" ? current : quietPayload()));
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [refreshMs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    let observer: MutationObserver | null = null;
    let listening = false;

    function paint(target: import("maplibre-gl").Map) {
      if (!target.getLayer("aircraft-points")) return;
      const dark = themeName() === "dark";
      target.setPaintProperty("aircraft-points", "circle-color", [
        "case",
        ["==", ["get", "onGround"], 1],
        dark ? "#9a9aa3" : "#6e6e73",
        dark ? "#f5f5f7" : "#111111",
      ]);
      target.setPaintProperty("aircraft-points", "circle-stroke-color", dark ? "#141416" : "#ffffff");
    }

    function mountLayers(target: import("maplibre-gl").Map) {
      if (!target.getSource("aircraft")) {
        target.addSource("aircraft", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        target.addLayer({
          id: "aircraft-points",
          type: "circle",
          source: "aircraft",
          paint: { "circle-radius": 6, "circle-stroke-width": 1.5 },
        });
      }
      paint(target);
      const onClick = (event: { features?: { properties?: { hex?: unknown } }[] }) => {
        const hex = event.features?.[0]?.properties?.hex;
        if (typeof hex !== "string") return;
        const plane = aircraftRef.current.find((item) => item.hex === hex);
        if (!plane) return;
        setSelected(hex);
        openPopupRef.current(plane);
        document.getElementById(`flight-${hex}`)?.scrollIntoView({ block: "nearest" });
      };
      const onEnter = () => {
        target.getCanvas().style.cursor = "pointer";
      };
      const onLeave = () => {
        target.getCanvas().style.cursor = "";
      };
      if (!listening) {
        listening = true;
        target.on("click", "aircraft-points", onClick);
        target.on("mouseenter", "aircraft-points", onEnter);
        target.on("mouseleave", "aircraft-points", onLeave);
      }
      setMapReady(true);
    }

    void (async () => {
      try {
        const maplibregl = await loadMapLibre();
        if (cancelled) return;
        libRef.current = maplibregl;
        let style: string | typeof OSM_STYLE = styleForTheme();
        try {
          const probe = await fetch(styleForTheme());
          if (!probe.ok) style = OSM_STYLE;
        } catch {
          style = OSM_STYLE;
        }
        if (cancelled) return;
        map = new maplibregl.Map({
          container,
          style,
          bounds: ARCHIPELAGO_BOUNDS,
          fitBoundsOptions: { padding: 28 },
          attributionControl: { compact: false },
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        const maio = document.createElement("div");
        maio.className = "live-flights-maio";
        maio.textContent = "Maio";
        new maplibregl.Marker({ element: maio, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(map);
        map.on("style.load", () => {
          if (map) mountLayers(map);
        });
        mapRef.current = map;
        observer = new MutationObserver(() => {
          if (!map) return;
          setMapReady(false);
          map.setStyle(styleForTheme());
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
      libRef.current = null;
      setMapReady(false);
    };
  }, [latitude, longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("aircraft") as import("maplibre-gl").GeoJSONSource | undefined;
    if (!source || source.type !== "geojson") return;
    const aircraft = (payload?.aircraft ?? []).filter(
      (plane) => plane && Number.isFinite(plane.latitude) && Number.isFinite(plane.longitude),
    );
    aircraftRef.current = aircraft;
    source.setData({
      type: "FeatureCollection",
      features: aircraft.map((plane) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [plane.longitude, plane.latitude] },
        properties: { hex: plane.hex, onGround: plane.onGround ? 1 : 0 },
      })),
    });
  }, [payload, mapReady]);

  openPopupRef.current = (plane) => {
    const map = mapRef.current;
    const maplibregl = libRef.current;
    if (!map || !maplibregl) return;
    popupRef.current?.remove();
    const root = document.createElement("div");
    const title = document.createElement("p");
    title.className = "live-flights-call";
    title.textContent = planeName(plane);
    root.append(title);
    const meta = detailLine(plane);
    if (meta) {
      const line = document.createElement("p");
      line.className = "live-flights-meta";
      line.textContent = meta;
      root.append(line);
    }
    const rows = statRows(plane, localeRef.current);
    if (rows.length) {
      const stats = document.createElement("dl");
      stats.className = "live-flights-stats";
      for (const [label, value] of rows) {
        const item = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        item.append(dt, dd);
        stats.append(item);
      }
      root.append(stats);
    }
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
      .setLngLat([plane.longitude, plane.latitude])
      .setDOMContent(root)
      .addTo(map);
  };

  function focusAircraft(hex: string) {
    setSelected(hex);
    const map = mapRef.current;
    const plane = aircraftRef.current.find((item) => item.hex === hex);
    if (!map || !plane) return;
    const center: [number, number] = [plane.longitude, plane.latitude];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) map.jumpTo({ center, zoom: Math.max(map.getZoom(), 7) });
    else map.flyTo({ center, zoom: Math.max(map.getZoom(), 7) });
    openPopupRef.current(plane);
  }

  const aircraft = (payload?.aircraft ?? []).filter(
    (plane) => plane && Number.isFinite(plane.latitude) && Number.isFinite(plane.longitude),
  );
  const quiet = payload?.status === "unconfigured" || payload?.status === "unavailable";
  const updated = payload?.retrievedAt
    ? new Date(payload.retrievedAt).toLocaleTimeString(intlLocale(locale), {
        timeZone: "Atlantic/Cape_Verde",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  let statusText = t("flights.loading", undefined, locale);
  if (quiet) statusText = t("flights.unavailable", undefined, locale);
  else if (payload?.status === "available" && aircraft.length === 0) statusText = t("flights.empty", undefined, locale);
  else if (payload?.status === "available") statusText = t("flights.count", { n: aircraft.length }, locale);

  return (
    <section className="live-flights wrap" id="voos" aria-labelledby="voos-titulo">
      <div className="live-flights-head">
        <h2 id="voos-titulo">{t("flights.title", undefined, locale)}</h2>
        <p>{t("flights.intro", { radius: radiusNm }, locale)}</p>
      </div>
      <div className="live-flights-layout">
        <div className="live-flights-map" role="region" aria-label={t("flights.map", undefined, locale)}>
          <div ref={containerRef} className="live-flights-map-canvas" />
          {mapFailed ? <p className="live-flights-map-note">{t("flights.mapUnavailable", undefined, locale)}</p> : null}
        </div>
        <div className="live-flights-panel">
          <p className="live-flights-status" aria-live="polite">{statusText}</p>
          {!payload ? (
            <div aria-hidden="true">
              <div className="live-flights-skeleton" />
              <div className="live-flights-skeleton" />
              <div className="live-flights-skeleton" />
            </div>
          ) : null}
          {payload?.status === "available" && aircraft.length > 0 ? (
            <ul className="live-flights-list live-flights-scroll">
              {aircraft.map((plane) => {
                const name = planeName(plane);
                const meta = detailLine(plane);
                return (
                  <li key={plane.hex}>
                    <button
                      id={`flight-${plane.hex}`}
                      type="button"
                      className="live-flights-item"
                      aria-current={selected === plane.hex ? "true" : undefined}
                      aria-label={t("flights.showOnMap", { name }, locale)}
                      onClick={() => focusAircraft(plane.hex)}
                    >
                      <span className="live-flights-call">{name}</span>
                      {meta ? <span className="live-flights-meta">{meta}</span> : null}
                      <span className="live-flights-stats">
                        {statRows(plane, locale).map(([label, value]) => (
                          <span key={label}>
                            <span>{label}</span>
                            <span>{value}</span>
                          </span>
                        ))}
                      </span>
                      {plane.emergency ? (
                        <span className="live-flights-alert">{t("flights.emergency", { kind: plane.emergency }, locale)}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {payload?.truncated ? (
            <p className="live-flights-note">{t("flights.truncated", { n: aircraft.length }, locale)}</p>
          ) : null}
          {updated ? (
            <p className="live-flights-updated">
              {t("flights.updated", { time: updated }, locale)}
              {payload?.stale ? ` · ${t("flights.stale", undefined, locale)}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      <p className="live-flights-note">{t("flights.note", undefined, locale)}</p>
      <p className="live-flights-credit">
        Data: <a href="https://adsb.lol">adsb.lol</a>{" "}
        (<a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="license">ODbL</a>)
      </p>
    </section>
  );
}
