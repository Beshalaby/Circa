import { useCallback, useMemo, useState } from 'react';
import { useFieldStore } from '../lib/socket';
import type { BaseStation } from '../lib/socket';
import { useDevicePlacementStore } from '../lib/devicePlacementStore';
import { useHardwareStore } from '../lib/hardwareStore';
import { useFieldShapeStore } from '../lib/fieldShapeStore';
import {
  DEFAULT_FIELD_POLYGON,
  DEFAULT_TURRET_THROW_RADIUS_M,
  polygonPointFromNormalized,
} from '../lib/fieldShape';
import FieldShapeEditor from '../components/FieldShapeEditor';
import FieldCanvas from '../components/FieldCanvas';
import StatsPanel from '../components/StatsPanel';
import './ConfigurePage.css';

type ConfigureTab = 'field' | 'devices';

const CROP_TYPES = ['wheat', 'corn', 'cotton', 'rice', 'other'];

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({
  id,
  label,
  icon,
  active,
  onClick,
}: {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button id={id} className={`configure-tab-btn ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="configure-tab-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConfigurePage() {
  const [activeTab, setActiveTab] = useState<ConfigureTab>('field');

  return (
    <div className="configure-page">
      <div className="configure-tabs">
        <TabBtn
          id="tab-field"
          label="Field Configuration"
          icon="⊞"
          active={activeTab === 'field'}
          onClick={() => setActiveTab('field')}
        />
        <TabBtn
          id="tab-devices"
          label="Devices"
          icon="◈"
          active={activeTab === 'devices'}
          onClick={() => setActiveTab('devices')}
        />
        <div
          className="configure-tab-indicator"
          style={{ '--idx': activeTab === 'field' ? 0 : 1 } as React.CSSProperties}
        />
      </div>

      <div className="configure-tab-body fade-in" key={activeTab}>
        {activeTab === 'field' && <FieldShapeEditor />}
        {activeTab === 'devices' && <DevicesTab />}
      </div>
    </div>
  );
}

// ─── Devices tab ──────────────────────────────────────────────────────────────

function DevicesTab() {
  const { stations, nodes } = useFieldStore();
  const [addMode, setAddMode] = useState(false);
  const [pickedX, setPickedX] = useState<number | null>(null);
  const [pickedY, setPickedY] = useState<number | null>(null);

  const handlePick = useCallback((x: number, y: number) => {
    setPickedX(x);
    setPickedY(y);
  }, []);

  const handleEnterAdd = useCallback(() => {
    setAddMode(true);
    setPickedX(null);
    setPickedY(null);
  }, []);

  const handleExitAdd = useCallback(() => {
    setAddMode(false);
    setPickedX(null);
    setPickedY(null);
  }, []);

  return (
    <div className="configure-devices-body">
      <div className="configure-devices-map">
        <FieldCanvas
          variant="full"
          fitView
          disableZoom
          onMapPositionPick={addMode ? handlePick : undefined}
          groundPickOnly={addMode}
        />
      </div>
      <aside className="configure-devices-side">
        {addMode ? (
          <AddDeviceForm
            stations={stations}
            pickedX={pickedX}
            pickedY={pickedY}
            onCancel={handleExitAdd}
            onSaved={handleExitAdd}
          />
        ) : (
          <DeviceListPanel
            stations={stations}
            nodes={nodes}
            onAddDevice={handleEnterAdd}
          />
        )}
      </aside>
    </div>
  );
}

// ─── Device list panel ────────────────────────────────────────────────────────

const SERVER = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

function DeviceListPanel({
  stations,
  nodes,
  onAddDevice,
}: {
  stations: ReturnType<typeof useFieldStore>['stations'];
  nodes: ReturnType<typeof useFieldStore>['nodes'];
  onAddDevice: () => void;
}) {
  const { removeStation, removeNode } = useFieldStore();

  const handleDeleteStation = async (id: string) => {
    if (!confirm(`Delete station "${id}"? Its nodes will also be removed.`)) return;
    removeStation(id);
    nodes.filter((n) => n.station_id === id).forEach((n) => removeNode(n.id));
    await fetch(`${SERVER}/api/stations/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const handleDeleteNode = async (id: string) => {
    if (!confirm(`Delete node "${id}"?`)) return;
    removeNode(id);
    await fetch(`${SERVER}/api/stations/nodes/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  return (
    <>
      <div className="configure-side-header">
        <span className="configure-side-kicker mono">Devices</span>
        <button className="btn-primary configure-add-btn" onClick={onAddDevice}>
          ⊕ Add Device
        </button>
      </div>
      <div className="configure-side-list">
        {stations.length === 0 && (
          <p className="configure-empty-hint">No devices yet — click Add Device to register your ESP32.</p>
        )}
        {stations.map((st) => (
          <div key={st.id} className="configure-device-row">
            <div className="configure-device-info">
              <span className="configure-device-name">{st.name}</span>
              <span className="configure-device-id mono">{st.id}</span>
            </div>
            <button
              className="configure-delete-btn"
              title="Remove station"
              onClick={() => handleDeleteStation(st.id)}
            >
              ✕
            </button>
          </div>
        ))}
        {nodes.map((n) => (
          <div key={n.id} className="configure-device-row configure-device-row--node">
            <div className="configure-device-info">
              <span className="configure-device-name">{n.name}</span>
              <span className="configure-device-id mono">{n.id}</span>
            </div>
            <button
              className="configure-delete-btn"
              title="Remove node"
              onClick={() => handleDeleteNode(n.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <StatsPanel stations={stations} nodes={nodes} />
      </div>
    </>
  );
}

// ─── Inline add-device form ───────────────────────────────────────────────────

function AddDeviceForm({
  stations,
  pickedX,
  pickedY,
  onCancel,
  onSaved,
}: {
  stations: BaseStation[];
  pickedX: number | null;
  pickedY: number | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { upsertStation, upsertNode } = useFieldStore();
  const setStationField = useDevicePlacementStore((s) => s.setStationField);
  const setNodeField = useDevicePlacementStore((s) => s.setNodeField);
  const rawFieldVertices = useFieldShapeStore((s) => s.vertices);
  const setHardwareUrl = useHardwareStore((s) => s.setUrl);

  const [deviceType, setDeviceType] = useState<'station' | 'node'>('station');
  const [form, setForm] = useState({ id: '', name: '', crop_type: 'wheat', station_id: '', hardware_url: '' });
  const [positionError, setPositionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setPositionError(null);
  };

  const constraintStation: BaseStation | null = useMemo(
    () =>
      deviceType === 'node' && form.station_id
        ? (stations.find((s) => s.id === form.station_id) ?? null)
        : null,
    [deviceType, form.station_id, stations],
  );

  const validateNodePosition = useCallback((): string | null => {
    if (deviceType !== 'node' || !form.station_id || pickedX === null || pickedY === null)
      return null;
    const station = stations.find((s) => s.id === form.station_id);
    if (!station) return null;

    const verts =
      Array.isArray(rawFieldVertices) && rawFieldVertices.length >= 3
        ? rawFieldVertices
        : DEFAULT_FIELD_POLYGON;

    const sPos = polygonPointFromNormalized(station.field_x, station.field_y, verts);
    const nPos = polygonPointFromNormalized(pickedX, pickedY, verts);
    const dist = Math.hypot(nPos.x - sPos.x, nPos.z - sPos.z);
    const maxDist = station.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M;

    if (dist > maxDist) {
      return `Node is ${dist.toFixed(0)} m from station — max turret range is ${maxDist.toFixed(0)} m. Move closer (amber ring).`;
    }
    return null;
  }, [deviceType, form.station_id, pickedX, pickedY, stations, rawFieldVertices]);

  const canSave =
    form.id.trim() !== '' &&
    form.name.trim() !== '' &&
    pickedX !== null &&
    (deviceType === 'station' || form.station_id !== '');

  const handleSave = async () => {
    const err = validateNodePosition();
    if (err) {
      setPositionError(err);
      return;
    }

    setSaving(true);
    const base = {
      id: form.id.trim(),
      name: form.name.trim(),
      field_x: pickedX!,
      field_y: pickedY!,
      crop_type: form.crop_type,
      online: false,
    };

    if (deviceType === 'station') {
      upsertStation({ ...base, humidity: undefined, temperature: undefined, soil_moisture: undefined });
      setStationField(base.id, base.field_x, base.field_y);
      if (form.hardware_url.trim()) {
        setHardwareUrl(base.id, form.hardware_url.trim());
      }
      await fetch(`${import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'}/api/stations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base),
      }).catch(() => {});
    } else {
      upsertNode({ ...base, station_id: form.station_id, soil_moisture: undefined });
      setNodeField(base.id, base.field_x, base.field_y);
      await fetch(`${import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'}/api/stations/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, station_id: form.station_id }),
      }).catch(() => {});
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div className="configure-add-form">
      <div className="configure-side-header">
        <span className="configure-side-kicker mono">Add Device</span>
        <button className="btn-ghost configure-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div className="configure-add-form-body">
        {/* Type toggle */}
        <div className="configure-type-toggle">
          {(['station', 'node'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`configure-type-btn ${deviceType === t ? 'selected' : ''}`}
              onClick={() => setDeviceType(t)}
            >
              <span className="configure-type-icon">{t === 'station' ? '⊟' : '◈'}</span>
              <span className="configure-type-label">
                {t === 'station' ? 'Base Station' : 'Sensor Node'}
              </span>
            </button>
          ))}
        </div>

        {/* Map pick readout */}
        <div className="configure-pick-readout">
          <span className="label">Position on field</span>
          <div className={`configure-pick-values mono ${pickedX !== null ? 'is-set' : ''}`}>
            {pickedX !== null ? (
              <>
                <span>X {pickedX.toFixed(4)}</span>
                <span>Y {pickedY!.toFixed(4)}</span>
              </>
            ) : (
              <span className="configure-pick-pending">— click the map to set position</span>
            )}
          </div>
        </div>

        {/* Fields */}
        <div className="configure-field-row">
          <label className="label" htmlFor="add-device-id">Device ID</label>
          <input
            id="add-device-id"
            className="input"
            placeholder={deviceType === 'station' ? 'station-001' : 'node-001'}
            value={form.id}
            onChange={(e) => update('id', e.target.value)}
          />
        </div>

        <div className="configure-field-row">
          <label className="label" htmlFor="add-device-name">Display Name</label>
          <input
            id="add-device-name"
            className="input"
            placeholder="North Field Station"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </div>

        <div className="configure-field-row">
          <label className="label" htmlFor="add-device-crop">Crop Type</label>
          <select
            id="add-device-crop"
            className="input"
            value={form.crop_type}
            onChange={(e) => update('crop_type', e.target.value)}
          >
            {CROP_TYPES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {deviceType === 'node' && (
          <div className="configure-field-row">
            <label className="label" htmlFor="add-device-station">Parent Station</label>
            <select
              id="add-device-station"
              className="input"
              value={form.station_id}
              onChange={(e) => update('station_id', e.target.value)}
            >
              <option value="">Select station…</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {constraintStation && (
              <p className="configure-constraint-hint">
                ◉ Place within the amber ring — turret range{' '}
                <strong>
                  {(constraintStation.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M).toFixed(0)}&nbsp;m
                </strong>{' '}
                from <strong>{constraintStation.name}</strong>
              </p>
            )}
          </div>
        )}

        {deviceType === 'station' && (
          <div className="configure-field-row">
            <label className="label" htmlFor="add-device-hw-url">
              Hardware URL <span className="configure-optional">(optional)</span>
            </label>
            <input
              id="add-device-hw-url"
              className="input mono"
              placeholder="http://192.168.4.1"
              value={form.hardware_url}
              onChange={(e) => update('hardware_url', e.target.value)}
            />
            <p className="configure-field-hint">
              IP of the ESP32 SoftAP — used by the Control page to send commands.
            </p>
          </div>
        )}

        {positionError && (
          <p className="configure-position-error">⚠ {positionError}</p>
        )}

        <p className="configure-note">
          💡 Ensure your ESP32 has <code>{form.id || '…'}</code> set as <code>DEVICE_ID</code> in{' '}
          <code>config.h</code>.
        </p>

        <div className="configure-add-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save device'}
          </button>
        </div>
      </div>
    </div>
  );
}
