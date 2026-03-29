import type { BaseStation, Node } from '../lib/socket';
import './StatsPanel.css';

interface Props {
  stations: BaseStation[];
  nodes: Node[];
  /** `station:id` or `node:id` for dashboard placement mode */
  selectedKey?: string | null;
  onSelectDevice?: (key: string | null) => void;
}

export default function StatsPanel({ stations, nodes, selectedKey, onSelectDevice }: Props) {
  return (
    <div className="stats-panel">
      {/* Base Stations */}
      {stations.length > 0 && (
        <section className="stats-section">
          <p className="section-title stats-section-title">Base Stations</p>
          {stations.map((s) => (
            <StationRow
              key={s.id}
              station={s}
              selected={Boolean(onSelectDevice && selectedKey === `station:${s.id}`)}
              onSelect={
                onSelectDevice
                  ? () => onSelectDevice(selectedKey === `station:${s.id}` ? null : `station:${s.id}`)
                  : undefined
              }
            />
          ))}
        </section>
      )}

      {/* Nodes grouped by station */}
      {stations.map((s) => {
        const stationNodes = nodes.filter((n) => n.station_id === s.id);
        if (stationNodes.length === 0) return null;
        return (
          <section key={s.id} className="stats-section">
            <p className="section-title stats-section-title">
              {s.name} — Nodes
            </p>
            {stationNodes.map((n) => (
              <NodeRow
                key={n.id}
                node={n}
                selected={Boolean(onSelectDevice && selectedKey === `node:${n.id}`)}
                onSelect={
                  onSelectDevice
                    ? () => onSelectDevice(selectedKey === `node:${n.id}` ? null : `node:${n.id}`)
                    : undefined
                }
              />
            ))}
          </section>
        );
      })}

      {/* Unassigned nodes */}
      {(() => {
        const stationIds = new Set(stations.map((s) => s.id));
        const unassigned = nodes.filter((n) => !stationIds.has(n.station_id));
        if (unassigned.length === 0) return null;
        return (
          <section className="stats-section">
            <p className="section-title stats-section-title">Unassigned Nodes</p>
            {unassigned.map((n) => (
              <NodeRow
                key={n.id}
                node={n}
                selected={Boolean(onSelectDevice && selectedKey === `node:${n.id}`)}
                onSelect={
                  onSelectDevice
                    ? () => onSelectDevice(selectedKey === `node:${n.id}` ? null : `node:${n.id}`)
                    : undefined
                }
              />
            ))}
          </section>
        );
      })()}

      {stations.length === 0 && nodes.length === 0 && (
        <div className="stats-empty">
          <p>No devices found.</p>
          <p>Configure your first base station to get started.</p>
        </div>
      )}
    </div>
  );
}

function StationRow({
  station,
  selected,
  onSelect,
}: {
  station: BaseStation;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const cls = [
    'device-row',
    onSelect ? 'device-row--selectable' : '',
    selected ? 'device-row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const inner = (
    <>
      <div className="device-row-left">
        <span className={`dot ${station.online ? 'dot-green' : 'dot-red'}`} />
        <div>
          <p className="device-name">{station.name}</p>
          <p className="device-id mono">{station.id}</p>
        </div>
      </div>
      <div className="device-metrics">
        <Metric label="H" value={station.humidity !== undefined ? `${station.humidity.toFixed(0)}%` : '--'} />
        <Metric label="T" value={station.temperature !== undefined ? `${station.temperature.toFixed(1)}°` : '--'} />
        <Metric label="S" value={station.soil_moisture !== undefined ? `${station.soil_moisture.toFixed(0)}%` : '--'} />
      </div>
    </>
  );
  if (onSelect) {
    return (
      <button type="button" className={cls} onClick={onSelect}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function NodeRow({
  node,
  selected,
  onSelect,
}: {
  node: Node;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const pct = node.soil_moisture;
  const color = pct === undefined ? 'var(--gray-dark)'
    : pct < 20 ? '#ef4444'
    : pct < 40 ? '#f97316'
    : pct < 60 ? '#eab308'
    : '#4ade80';

  const cls = [
    'device-row',
    onSelect ? 'device-row--selectable' : '',
    selected ? 'device-row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const inner = (
    <>
      <div className="device-row-left">
        <span className={`dot ${node.online ? 'dot-green' : 'dot-red'}`} />
        <div>
          <p className="device-name">{node.name}</p>
          <p className="device-id mono">{node.id}</p>
        </div>
      </div>
      <div className="node-moisture-bar-wrap">
        <div className="node-moisture-bar">
          <div
            className="node-moisture-fill"
            style={{ width: `${pct ?? 0}%`, background: color }}
          />
        </div>
        <span className="device-id mono" style={{ color, minWidth: 36, textAlign: 'right' }}>
          {pct !== undefined ? `${pct.toFixed(0)}%` : '--'}
        </span>
      </div>
    </>
  );
  if (onSelect) {
    return (
      <button type="button" className={cls} onClick={onSelect}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value mono">{value}</span>
    </div>
  );
}
