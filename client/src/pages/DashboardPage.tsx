import { useState } from 'react';
import { useFieldStore } from '../lib/socket';
import type { BaseStation, Node } from '../lib/socket';
import Field3DView from '../components/Field3DView';
import StatsPanel from '../components/StatsPanel';
import {
  DEFAULT_NODE_IRRIGATION_RADIUS_M,
  DEFAULT_TURRET_THROW_RADIUS_M,
} from '../lib/fieldShape';
import './DashboardPage.css';

function MoistureBar({ pct }: { pct: number | undefined }) {
  const color =
    pct === undefined ? 'var(--gray-300)'
    : pct < 20 ? '#ef4444'
    : pct < 40 ? '#f97316'
    : pct < 60 ? '#eab308'
    : '#4ade80';
  return (
    <div className="dashboard-inspector-bar-wrap">
      <div className="dashboard-inspector-bar">
        <div className="dashboard-inspector-bar-fill" style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      <span className="dashboard-inspector-bar-value mono" style={{ color }}>
        {pct !== undefined ? `${pct.toFixed(1)}%` : '—'}
      </span>
    </div>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-inspector-row">
      <span className="dashboard-inspector-row-label mono">{label}</span>
      <span className="dashboard-inspector-row-value mono">{value}</span>
    </div>
  );
}

function DeviceInspector({
  item,
  stations,
  onClose,
}: {
  item: BaseStation | Node;
  stations: BaseStation[];
  onClose: () => void;
}) {
  const isStation = 'humidity' in item;
  const station = item as BaseStation;
  const node = item as Node;
  const parentStation = isStation ? null : stations.find((s) => s.id === node.station_id);

  return (
    <div className="dashboard-inspector">
      <div className="dashboard-inspector-head">
        <div>
          <span className={`dashboard-inspector-type mono dashboard-inspector-type--${isStation ? 'station' : 'node'}`}>
            {isStation ? 'Base Station' : 'Sensor Node'}
          </span>
          <h2 className="dashboard-inspector-name">{item.name}</h2>
          <p className="dashboard-inspector-id mono">{item.id}</p>
        </div>
        <button type="button" className="dashboard-inspector-close" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </div>

      <div className="dashboard-inspector-section">
        <p className="dashboard-inspector-section-title mono">Sensors</p>

        {isStation ? (
          <>
            <div className="dashboard-inspector-row">
              <span className="dashboard-inspector-row-label mono">Soil moisture</span>
              <MoistureBar pct={station.soil_moisture} />
            </div>
            <InspectorRow
              label="Humidity"
              value={station.humidity !== undefined ? `${station.humidity.toFixed(1)}%` : '—'}
            />
            <InspectorRow
              label="Temperature"
              value={station.temperature !== undefined ? `${station.temperature.toFixed(1)} °C` : '—'}
            />
          </>
        ) : (
          <div className="dashboard-inspector-row">
            <span className="dashboard-inspector-row-label mono">Soil moisture</span>
            <MoistureBar pct={node.soil_moisture} />
          </div>
        )}
      </div>

      <div className="dashboard-inspector-section">
        <p className="dashboard-inspector-section-title mono">Config</p>
        <InspectorRow label="Crop type" value={item.crop_type || '—'} />
        {isStation ? (
          <InspectorRow
            label="Turret reach"
            value={`${(station.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M).toFixed(0)} m`}
          />
        ) : (
          <>
            <InspectorRow
              label="Irrigation radius"
              value={`${(node.irrigation_radius_m ?? DEFAULT_NODE_IRRIGATION_RADIUS_M).toFixed(0)} m`}
            />
            <InspectorRow
              label="Parent station"
              value={parentStation ? parentStation.name : node.station_id || '—'}
            />
          </>
        )}
      </div>

      <div className="dashboard-inspector-section">
        <p className="dashboard-inspector-section-title mono">Field position</p>
        <InspectorRow label="X (E→W)" value={`${(item.field_x * 100).toFixed(1)}%`} />
        <InspectorRow label="Y (S→N)" value={`${(item.field_y * 100).toFixed(1)}%`} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { stations, nodes } = useFieldStore();
  const [selected, setSelected] = useState<BaseStation | Node | null>(null);

  const handleSelect = (item: BaseStation | Node | null) => setSelected(item);

  const handleListSelect = (key: string | null) => {
    if (!key) { setSelected(null); return; }
    const [kind, id] = key.split(':');
    if (kind === 'station') setSelected(stations.find((s) => s.id === id) ?? null);
    else setSelected(nodes.find((n) => n.id === id) ?? null);
  };

  const selectedKey = selected
    ? ('humidity' in selected ? `station:${selected.id}` : `node:${selected.id}`)
    : null;

  const avgMoisture = (() => {
    const all = [
      ...stations.map((s) => s.soil_moisture).filter((v) => v !== undefined),
      ...nodes.map((n) => n.soil_moisture).filter((v) => v !== undefined),
    ] as number[];
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  })();

  const avgTemp = (() => {
    const temps = stations.map((s) => s.temperature).filter((v) => v !== undefined) as number[];
    return temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  })();

  const avgHumidity = (() => {
    const hs = stations.map((s) => s.humidity).filter((v) => v !== undefined) as number[];
    return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
  })();

  const kpis: {
    label: string;
    value: string;
    tone: 'normal' | 'warn' | 'alert';
  }[] = [
    {
      label: 'Avg moisture',
      value: avgMoisture !== null ? `${avgMoisture.toFixed(1)}%` : '—',
      tone: avgMoisture !== null && avgMoisture < 30 ? 'warn' : 'normal',
    },
    { label: 'Temperature', value: avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : '—', tone: 'normal' },
    { label: 'Humidity', value: avgHumidity !== null ? `${avgHumidity.toFixed(1)}%` : '—', tone: 'normal' },
    {
      label: 'Base stations',
      value: `${stations.length}`,
      tone: 'normal',
    },
    {
      label: 'Nodes',
      value: `${nodes.length}`,
      tone: 'normal',
    },
  ];

  return (
    <div className="dashboard">
      {/* ── KPI bar ───────────────────────────────────────── */}
      <header className="dashboard-stat-bar" aria-label="Field overview">
        <div className="dashboard-stat-bar-inner">
          {kpis.map((row, i) => (
            <div
              key={row.label}
              className={[
                'dashboard-stat-item',
                `dashboard-stat-item--${row.tone}`,
              ].join(' ')}
            >
              <div className="dashboard-stat-item-top">
                <span className="dashboard-stat-label">{row.label}</span>
                <span className="dashboard-stat-idx mono" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <span className="dashboard-stat-value mono">{row.value}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────── */}
      <div className="dashboard-body">
        {/* 3-D field visualization */}
        <div className="dashboard-3d-wrap">
          <div className="dashboard-3d-label-bar">
            <span className="dashboard-3d-kicker mono">Field — 3D view</span>
            <span className="dashboard-3d-hint mono">Drag to pan · Scroll to zoom · Click device to inspect</span>
          </div>
          <div className="dashboard-3d-canvas">
            <Field3DView onSelect={handleSelect} selectedId={selected?.id ?? null} />
          </div>
        </div>

        {/* Info panel — inspector or device list */}
        <aside className="dashboard-info-panel">
          {selected ? (
            <DeviceInspector item={selected} stations={stations} onClose={() => setSelected(null)} />
          ) : (
            <>
              <header className="dashboard-info-header">
                <span className="dashboard-info-kicker mono">Devices</span>
                <span className="dashboard-info-hint mono">Click a marker to inspect</span>
              </header>
              <StatsPanel
                stations={stations}
                nodes={nodes}
                selectedKey={selectedKey}
                onSelectDevice={handleListSelect}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
