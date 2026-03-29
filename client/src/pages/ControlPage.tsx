import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { IconType } from 'react-icons';
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowRight,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDroplet,
  FiPlay,
  FiPlus,
  FiPower,
  FiRefreshCw,
  FiRotateCcw,
  FiRotateCw,
  FiSend,
  FiSliders,
  FiSquare,
  FiTarget,
  FiTrash2,
  FiXCircle,
} from 'react-icons/fi';
import { useFieldStore } from '../lib/socket';
import {
  TurretApiClient,
  SPEED_MIN, SPEED_MAX, SPEED_DEFAULT,
  SERVO_MIN, SERVO_MAX, SERVO_HOME,
  STEPS_PER_REV, PUMP_MAX_MS,
} from '../lib/turretApi';
import type { HardwareResult, StepperDir, NodeReading } from '../lib/turretApi';
import './ControlPage.css';

const SERVER = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// ── Types ────────────────────────────────────────────────────
interface Schedule {
  id: string;
  name: string;
  station_id: string;
  trigger: { type: 'time' | 'condition'; cron?: string; metric?: string; operator?: string; threshold?: number };
  conditions: any[];
  actions: { type: string; angle?: number; duration?: number }[];
  enabled: boolean;
  created_at: string;
}

type Tab = 'scheduler' | 'turret';

export default function ControlPage() {
  const [activeTab, setActiveTab] = useState<Tab>('scheduler');

  return (
    <div className="control-page">
      {/* ── Tab rail ── */}
      <div className="control-tabs">
        <TabBtn id="tab-scheduler" label="Scheduler" Icon={FiCalendar}      active={activeTab === 'scheduler'} onClick={() => setActiveTab('scheduler')} />
        <TabBtn id="tab-turret"    label="Turret"    Icon={FiSliders}       active={activeTab === 'turret'}    onClick={() => setActiveTab('turret')} />
        <div className="tab-indicator" style={{ '--idx': ['scheduler','turret'].indexOf(activeTab) } as any} />
      </div>

      <div className="control-body fade-in" key={activeTab}>
        {activeTab === 'scheduler' && <SchedulerTab />}
        {activeTab === 'turret'    && <TurretTab />}
      </div>
    </div>
  );
}

function TabBtn({
  id,
  label,
  Icon,
  active,
  onClick,
}: {
  id: string;
  label: string;
  Icon: IconType;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button id={id} className={`tab-btn ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="tab-icon" aria-hidden="true"><Icon /></span>
      <span>{label}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// SCHEDULER TAB
// ────────────────────────────────────────────────────────────
function SchedulerTab() {
  const { stations } = useFieldStore();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER}/api/schedules`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setSchedules(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const deleteSchedule = async (id: string) => {
    await fetch(`${SERVER}/api/schedules/${id}`, { method: 'DELETE' }).catch(() => {});
    setSchedules((s) => s.filter((x) => x.id !== id));
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    await fetch(`${SERVER}/api/schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => {});
    setSchedules((s) => s.map((x) => x.id === id ? { ...x, enabled } : x));
  };

  const onCreated = (s: Schedule) => {
    setSchedules((prev) => [s, ...prev]);
    setShowForm(false);
  };

  return (
    <div className="scheduler">
      <div className="scheduler-header">
        <div>
          <h2 className="ctrl-section-title">Automation Schedules</h2>
          <p className="ctrl-section-sub">If-This-Then-That rules for automatic irrigation</p>
        </div>
        <button id="add-schedule-btn" className="btn-primary" onClick={() => setShowForm(true)}>
          <FiPlus aria-hidden="true" />
          <span>New Rule</span>
        </button>
      </div>

      {loading && <div className="flex-center" style={{ padding: 40 }}><div className="spinner" /></div>}

      {!loading && schedules.length === 0 && !showForm && (
        <div className="ctrl-empty card">
          <p>No automation rules yet.</p>
          <p style={{ color: 'var(--gray-mid)', fontSize: 13 }}>Create a rule to automate your turret based on sensor conditions or a time schedule.</p>
        </div>
      )}

      <div className="schedule-list">
        {schedules.map((s) => <ScheduleCard key={s.id} schedule={s} onDelete={deleteSchedule} onToggle={toggleSchedule} />)}
      </div>

      {showForm && (
        <ScheduleForm stations={stations} onCancel={() => setShowForm(false)} onCreated={onCreated} />
      )}
    </div>
  );
}

function ScheduleCard({ schedule, onDelete, onToggle }: {
  schedule: Schedule;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const triggerLabel = schedule.trigger.type === 'time'
    ? (
      <>
        <FiClock aria-hidden="true" />
        <span>{schedule.trigger.cron}</span>
      </>
    )
    : (
      <>
        <FiActivity aria-hidden="true" />
        <span>{schedule.trigger.metric} {schedule.trigger.operator} {schedule.trigger.threshold}%</span>
      </>
    );

  const actionLabel = schedule.actions.map((a) =>
    a.type === 'fire_turret' ? `Fire turret @ ${a.angle}° for ${a.duration}s` : a.type
  ).join(', ');

  return (
    <div className={`schedule-card card ${!schedule.enabled ? 'disabled' : ''}`}>
      <div className="schedule-card-left">
        <div className="schedule-toggle">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => onToggle(schedule.id, e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <div>
          <p className="schedule-name">{schedule.name}</p>
          <p className="schedule-trigger">{triggerLabel}</p>
          <p className="schedule-action"><FiArrowRight aria-hidden="true" /><span>{actionLabel}</span></p>
        </div>
      </div>
      <button className="schedule-delete" onClick={() => onDelete(schedule.id)} title="Delete">
        <FiTrash2 aria-hidden="true" />
      </button>
    </div>
  );
}

function ScheduleForm({ stations, onCancel, onCreated }: {
  stations: any[];
  onCancel: () => void;
  onCreated: (s: Schedule) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    station_id: stations[0]?.id || '',
    trigger_type: 'condition',
    metric: 'soil_moisture',
    operator: '<',
    threshold: 30,
    cron: '0 6 * * *',
    angle: 90,
    duration: 10,
  });
  const [saving, setSaving] = useState(false);

  const upd = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const body = {
      name: form.name,
      station_id: form.station_id,
      trigger: form.trigger_type === 'condition'
        ? { type: 'condition', metric: form.metric, operator: form.operator, threshold: form.threshold }
        : { type: 'time', cron: form.cron },
      conditions: [],
      actions: [{ type: 'fire_turret', angle: form.angle, duration: form.duration }],
      enabled: true,
    };
    const r = await fetch(`${SERVER}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (r?.ok) {
      const data = await r.json();
      onCreated(data);
    } else {
      // Optimistic if no backend
      onCreated({ ...body, id: Date.now().toString(), created_at: new Date().toISOString() } as any);
    }
    setSaving(false);
  };

  return (
    <div className="schedule-form card">
      <h3 className="form-title">New Automation Rule</h3>

      <div className="form-row">
        <label className="label">Rule Name</label>
        <input className="input" placeholder="e.g. Morning irrigation" value={form.name} onChange={(e) => upd('name', e.target.value)} />
      </div>

      <div className="form-row">
        <label className="label">Base Station</label>
        <select className="input" value={form.station_id} onChange={(e) => upd('station_id', e.target.value)}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {stations.length === 0 && <option value="">No stations — add one from the Configure page first</option>}
        </select>
      </div>

      <div className="form-row-split">
        <div>
          <label className="label">Trigger Type</label>
          <select className="input" value={form.trigger_type} onChange={(e) => upd('trigger_type', e.target.value)}>
            <option value="condition">Sensor Condition</option>
            <option value="time">Time (Cron)</option>
          </select>
        </div>

        {form.trigger_type === 'condition' ? (
          <>
            <div>
              <label className="label">Metric</label>
              <select className="input" value={form.metric} onChange={(e) => upd('metric', e.target.value)}>
                <option value="soil_moisture">Soil Moisture</option>
                <option value="humidity">Humidity</option>
                <option value="temperature">Temperature</option>
              </select>
            </div>
            <div>
              <label className="label">Operator</label>
              <select className="input" value={form.operator} onChange={(e) => upd('operator', e.target.value)}>
                <option value="<">below (&lt;)</option>
                <option value=">">above (&gt;)</option>
              </select>
            </div>
            <div>
              <label className="label">Threshold (%)</label>
              <input className="input" type="number" value={form.threshold} onChange={(e) => upd('threshold', parseInt(e.target.value))} />
            </div>
          </>
        ) : (
          <div>
            <label className="label">Cron Expression</label>
            <input className="input mono" placeholder="0 6 * * *" value={form.cron} onChange={(e) => upd('cron', e.target.value)} />
          </div>
        )}
      </div>

      <div className="form-section-title">Action: Fire Turret</div>
      <div className="form-row-split">
        <div>
          <label className="label">Angle (0–180°)</label>
          <input className="input" type="number" min="0" max="180" value={form.angle} onChange={(e) => upd('angle', parseInt(e.target.value))} />
        </div>
        <div>
          <label className="label">Duration (s)</label>
          <input className="input" type="number" min="1" value={form.duration} onChange={(e) => upd('duration', parseInt(e.target.value))} />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!form.name || saving} onClick={handleSave}>
          {saving ? <span className="spinner" /> : 'Save Rule'}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TURRET TAB
// ────────────────────────────────────────────────────────────
function TurretTab() {
  const api = useMemo(() => new TurretApiClient('http://192.168.4.1', SERVER, true), []);

  return (
    <div className="turret-tab">
      <h2 className="ctrl-section-title">Hardware Control</h2>
      <p className="ctrl-section-sub">Direct control of the ESP32 turret base station</p>

      {/* ── Auto-detected base station card ── */}
      <div className="hw-connection card">
        <div className="hw-connection-row">
          <div className="hw-auto-info">
            <span className="label">Base Station</span>
            <span className="hw-url mono">http://192.168.4.1</span>
            <span className="hw-auto-hint">Auto-detected — connect to Turret-ESP32 WiFi</span>
          </div>
        </div>
      </div>

      {/* ── Turret controls — always shown ── */}
      <EmergencyStop api={api} />
      <AimPanel api={api} />
      <StepperPanel api={api} />
      <ServoPanel api={api} />
      <PumpPanel api={api} />

      {/* ── Node sensor readings — always visible ── */}
      <NodeReadingsPanel api={api} />
    </div>
  );
}

// ── Emergency Stop ─────────────────────────────────────────
function EmergencyStop({ api }: { api: TurretApiClient }) {
  const [busy, setBusy] = useState(false);

  const stop = async () => {
    setBusy(true);
    await Promise.all([api.stopStepper(), api.pumpOff()]);
    setBusy(false);
  };

  return (
    <div className="hw-estop-bar">
      <button className="hw-estop-btn" disabled={busy} onClick={stop}>
        {busy ? <span className="spinner hw-estop-spinner" /> : <FiAlertTriangle aria-hidden="true" />}
        <span>Emergency Stop</span>
      </button>
      <span className="hw-estop-hint">Stops stepper + pump immediately</span>
    </div>
  );
}

// ── Joystick pad ───────────────────────────────────────────
function JoystickPad({
  x, y, size = 200,
  onChange,
  onRelease,
}: {
  x: number; y: number; size?: number;
  onChange: (x: number, y: number) => void;
  onRelease?: () => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromEvent = (e: React.PointerEvent | PointerEvent) => {
    if (!padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();
    const r    = rect.width / 2;
    let nx = (e.clientX - (rect.left + r)) / r;
    let ny = (e.clientY - (rect.top  + r)) / r;
    const mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }
    onChange(nx, ny);
  };

  return (
    <div
      ref={padRef}
      className="joystick-pad"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        dragging.current = true;
        padRef.current?.setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => { if (dragging.current) fromEvent(e); }}
      onPointerUp={() => { dragging.current = false; onRelease?.(); }}
      onPointerCancel={() => { dragging.current = false; onRelease?.(); }}
    >
      {/* Crosshair */}
      <div className="joystick-line joystick-h" />
      <div className="joystick-line joystick-v" />
      {/* Inner ring */}
      <div className="joystick-ring joystick-ring--inner" />
      {/* Handle */}
      <div
        className="joystick-handle"
        style={{ left: `${50 + x * 50}%`, top: `${50 + y * 50}%` }}
      />
    </div>
  );
}

// ── Aim Panel (joystick-driven) ─────────────────────────────
function AimPanel({ api }: { api: TurretApiClient }) {
  const [jx, setJx] = useState(0);
  const [jy, setJy] = useState(0);
  const [aimSpeed, setAimSpeed] = useState(SPEED_DEFAULT);
  const [liveMode, setLiveMode] = useState(false);
  const [sprayMs, setSprayMs] = useState(3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<HardwareResult | null>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestXY    = useRef({ x: 0, y: 0 });

  const sendAim = useCallback(async (x: number, y: number) => {
    const r = await api.aim(x, y, aimSpeed);
    setResult(r);
  }, [api, aimSpeed]);

  const handleJoystick = (x: number, y: number) => {
    setJx(x); setJy(y);
    latestXY.current = { x, y };

    if (liveMode) {
      if (throttleRef.current) return; // already scheduled
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
        sendAim(latestXY.current.x, latestXY.current.y);
      }, 150);
    }
  };

  const sendOnce = async () => {
    setBusy('aim');
    setResult(null);
    const r = await api.aim(jx, jy, aimSpeed);
    setResult(r);
    setBusy(null);
  };

  const fire = async () => {
    setBusy('fire');
    setResult(null);
    const aimR = await api.aim(jx, jy, aimSpeed);
    if (!aimR.ok) { setResult(aimR); setBusy(null); return; }
    const pumpR = await api.pumpOn();
    setResult(pumpR);
    setBusy(null);
    // auto-off
    setTimeout(() => api.pumpOff(), sprayMs);
  };

  const radius = Math.min(Math.hypot(jx, jy), 1);
  const yawDeg = (Math.atan2(-jy, jx) * 180 / Math.PI + 360) % 360;

  return (
    <section className="hw-panel card">
      <div className="hw-aim-header">
        <h3 className="hw-panel-title">Aim</h3>
        <label className="hw-live-toggle">
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(e) => setLiveMode(e.target.checked)}
          />
          <span className={`hw-live-pill ${liveMode ? 'active' : ''}`}>Live</span>
        </label>
      </div>

      {liveMode && (
        <p className="hw-panel-sub hw-live-note">
          Aim commands are sent continuously as you drag.
        </p>
      )}

      <div className="hw-aim-body">
        <JoystickPad x={jx} y={jy} size={180} onChange={handleJoystick} />

        <div className="hw-aim-readout">
          <div className="hw-readout-row">
            <span className="hw-readout-label">Yaw</span>
            <span className="hw-readout-val mono">{yawDeg.toFixed(1)}°</span>
          </div>
          <div className="hw-readout-row">
            <span className="hw-readout-label">Radius</span>
            <span className="hw-readout-val mono">{radius.toFixed(2)}</span>
          </div>
          <div className="hw-readout-row">
            <span className="hw-readout-label">X</span>
            <span className="hw-readout-val mono">{jx.toFixed(3)}</span>
          </div>
          <div className="hw-readout-row">
            <span className="hw-readout-label">Y</span>
            <span className="hw-readout-val mono">{jy.toFixed(3)}</span>
          </div>

          <div className="form-row" style={{ marginTop: 12 }}>
            <label className="label">Speed</label>
            <div className="hw-speed-presets">
              {([['Slow', 100], ['Med', 350], ['Fast', 800]] as const).map(([label, val]) => (
                <button
                  key={label}
                  className={`hw-speed-preset ${aimSpeed === val ? 'active' : ''}`}
                  onClick={() => setAimSpeed(val)}
                >{label}</button>
              ))}
            </div>
            <span className="hw-range-hint mono">{aimSpeed} steps/s</span>
          </div>
        </div>
      </div>

      {!liveMode && (
        <button className="btn-primary hw-btn hw-btn--full" disabled={!!busy} onClick={sendOnce}>
          {busy === 'aim' ? <><span className="spinner" /> Aiming…</> : <><FiSend aria-hidden="true" /> Send Aim</>}
        </button>
      )}

      {/* ── Fire row ── */}
      <div className="hw-fire-row">
        <div className="form-row hw-fire-dur">
          <label className="label">Spray — {(sprayMs / 1000).toFixed(0)} s</label>
          <input
            type="range" className="angle-slider"
            min={1000} max={PUMP_MAX_MS} step={1000} value={sprayMs}
            onChange={(e) => setSprayMs(parseInt(e.target.value))}
          />
        </div>
        <button
          className="btn-primary hw-btn hw-fire-btn"
          disabled={!!busy}
          onClick={fire}
        >
          {busy === 'fire' ? <span className="spinner" /> : <><FiTarget aria-hidden="true" /> Fire</>}
        </button>
      </div>

      <HwResult result={result} />
    </section>
  );
}

// ── Stepper Panel ──────────────────────────────────────────
function StepperPanel({ api }: { api: TurretApiClient }) {
  const [speed, setSpeed] = useState(SPEED_DEFAULT);
  const [jogSteps, setJogSteps] = useState(200);
  const [jogDir, setJogDir] = useState<StepperDir>('cw');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<HardwareResult | null>(null);

  const run = async (label: string, fn: () => Promise<HardwareResult>) => {
    setBusy(label);
    setResult(null);
    const r = await fn();
    setResult(r);
    setBusy(null);
  };

  return (
    <section className="hw-panel card">
      <h3 className="hw-panel-title">Stepper — Yaw Rotation</h3>

      <div className="form-row">
        <label className="label">Speed — {speed} steps/s</label>
        <div className="hw-speed-presets">
          {([['Slow', 100], ['Med', 350], ['Fast', 800]] as const).map(([label, val]) => (
            <button
              key={label}
              className={`hw-speed-preset ${speed === val ? 'active' : ''}`}
              onClick={() => setSpeed(val)}
            >{label}</button>
          ))}
        </div>
        <input
          type="range" className="angle-slider"
          min={SPEED_MIN} max={SPEED_MAX} step={50} value={speed}
          onChange={(e) => setSpeed(parseInt(e.target.value))}
        />
      </div>

      <div className="hw-btn-row">
        <button className="btn-primary hw-btn" disabled={!!busy}
          onClick={() => run('cw', () => api.startStepper('cw', speed))}>
          {busy === 'cw' ? <span className="spinner" /> : <><FiRotateCw aria-hidden="true" /> CW</>}
        </button>
        <button className="btn-primary hw-btn" disabled={!!busy}
          onClick={() => run('ccw', () => api.startStepper('ccw', speed))}>
          {busy === 'ccw' ? <span className="spinner" /> : <><FiRotateCcw aria-hidden="true" /> CCW</>}
        </button>
        <button className="btn-ghost hw-btn hw-btn--stop" disabled={busy === 'stop'}
          onClick={() => run('stop', () => api.stopStepper())}>
          {busy === 'stop' ? <span className="spinner" /> : <><FiSquare aria-hidden="true" /> Stop</>}
        </button>
      </div>

      <div className="hw-jog-row">
        <div className="form-row hw-jog-steps">
          <label className="label">Steps</label>
          <input className="input mono" type="number" min="1" max={STEPS_PER_REV * 10}
            value={jogSteps} onChange={(e) => setJogSteps(parseInt(e.target.value))} />
        </div>
        <div className="form-row hw-jog-dir">
          <label className="label">Dir</label>
          <select className="input" value={jogDir} onChange={(e) => setJogDir(e.target.value as StepperDir)}>
            <option value="cw">CW</option>
            <option value="ccw">CCW</option>
          </select>
        </div>
        <button className="btn-primary hw-btn hw-jog-btn" disabled={!!busy}
          onClick={() => run('jog', () => api.jogStepper(jogDir, speed, jogSteps))}>
          {busy === 'jog' ? <span className="spinner" /> : 'Jog'}
        </button>
      </div>

      <HwResult result={result} />
    </section>
  );
}

// ── Servo Panel ────────────────────────────────────────────
function ServoPanel({ api }: { api: TurretApiClient }) {
  const [angle, setAngle] = useState(SERVO_HOME);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HardwareResult | null>(null);

  const send = async (a: number) => {
    setBusy(true);
    setResult(null);
    const r = await api.setServo(a);
    setResult(r);
    setBusy(false);
  };

  const PRESETS = [
    { label: 'Near', value: 130 },
    { label: 'Home', value: SERVO_HOME },
    { label: 'Far',  value: 45 },
  ] as const;

  return (
    <section className="hw-panel card">
      <h3 className="hw-panel-title">Servo — Pitch / Tilt</h3>

      <div className="hw-servo-presets">
        {PRESETS.map(({ label, value }) => (
          <button
            key={label}
            className={`hw-servo-preset ${angle === value ? 'active' : ''}`}
            disabled={busy}
            onClick={() => { setAngle(value); send(value); }}
          >
            <span className="hw-servo-preset-label">{label}</span>
            <span className="hw-servo-preset-deg mono">{value}°</span>
          </button>
        ))}
      </div>

      <div className="form-row">
        <label className="label">Custom — {angle}° <span className="hw-range-hint">({SERVO_MIN}–{SERVO_MAX}°)</span></label>
        <div className="angle-wrap">
          <input type="range" className="angle-slider"
            min={SERVO_MIN} max={SERVO_MAX} value={angle}
            onChange={(e) => setAngle(parseInt(e.target.value))} />
          <span className="angle-val mono">{angle}°</span>
        </div>
      </div>

      <button className="btn-primary hw-btn" disabled={busy} onClick={() => send(angle)}>
        {busy ? <span className="spinner" /> : 'Set Angle'}
      </button>

      <HwResult result={result} />
    </section>
  );
}

// ── Pump Panel ─────────────────────────────────────────────
function PumpPanel({ api }: { api: TurretApiClient }) {
  const [sprayMs, setSprayMs] = useState(5000);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<HardwareResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = async (label: string, fn: () => Promise<HardwareResult>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setBusy(label);
    setResult(null);
    const r = await fn();
    setResult(r);
    setBusy(null);
  };

  const spray = async () => {
    await run('spray', () => api.pumpOn());
    timerRef.current = setTimeout(async () => {
      const r = await api.pumpOff();
      setResult(r);
    }, sprayMs);
  };

  return (
    <section className="hw-panel card">
      <h3 className="hw-panel-title">Pump</h3>

      <div className="hw-btn-row">
        <button className="btn-primary hw-btn hw-pump-on" disabled={!!busy}
          onClick={() => run('on', () => api.pumpOn())}>
          {busy === 'on' ? <span className="spinner" /> : <><FiDroplet aria-hidden="true" /> Pump On</>}
        </button>
        <button className="btn-ghost hw-btn" disabled={!!busy}
          onClick={() => run('off', () => api.pumpOff())}>
          {busy === 'off' ? <span className="spinner" /> : <><FiPower aria-hidden="true" /> Pump Off</>}
        </button>
      </div>

      <div className="hw-spray-row">
        <div className="form-row hw-spray-dur">
          <label className="label">
            Timed spray — {(sprayMs / 1000).toFixed(0)} s
            <span className="hw-range-hint"> (max {PUMP_MAX_MS / 1000} s)</span>
          </label>
          <input type="range" className="angle-slider"
            min={1000} max={PUMP_MAX_MS} step={1000} value={sprayMs}
            onChange={(e) => setSprayMs(parseInt(e.target.value))} />
        </div>
        <button className="btn-primary hw-btn hw-spray-btn" disabled={!!busy} onClick={spray}>
          {busy === 'spray' ? <span className="spinner" /> : <><FiPlay aria-hidden="true" /> Spray</>}
        </button>
      </div>

      <HwResult result={result} />
    </section>
  );
}

// ── Shared result badge ────────────────────────────────────
function HwResult({ result }: { result: HardwareResult | null }) {
  if (!result) return null;
  return (
    <p className={`fire-result ${result.ok ? 'success' : 'error'}`}>
      {result.ok ? <FiCheckCircle aria-hidden="true" /> : <FiXCircle aria-hidden="true" />} {result.ok ? 'OK' : `Error ${result.status}`}
      {result.body ? ` — ${result.body.slice(0, 80)}` : ''}
    </p>
  );
}

// ── Node Readings Panel ─────────────────────────────────────
function NodeReadingsPanel({ api }: { api: TurretApiClient }) {
  const [nodes, setNodes] = useState<NodeReading[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await api.fetchNodes();
    setNodes(data);
    setLastFetch(new Date());
    setLoading(false);
  }, [api]);

  // Auto-refresh every 35 s (slightly longer than node sleep interval)
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 35_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="hw-panel">
      <div className="hw-panel-header">
        <span className="hw-panel-title">Sensor Nodes</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastFetch && (
            <span className="hw-result hw-result--ok" style={{ fontSize: 10 }}>
              {lastFetch.toLocaleTimeString()}
            </span>
          )}
          <button className="btn-ghost hw-ping-btn" onClick={refresh} disabled={loading}>
            {loading ? <span className="spinner" /> : <FiRefreshCw aria-hidden="true" />}
          </button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="hw-empty-hint">
          {loading
            ? 'Searching for nodes…'
            : 'No nodes detected — connect to Turret-ESP32 WiFi and wait up to 30 s for a reading.'}
        </p>
      ) : (
        <div className="node-readings-grid">
          {nodes.map((n) => (
            <div key={n.mac} className={`node-card ${n.soil_wet ? 'node-card--wet' : 'node-card--dry'}`}>
              <div className="node-card-header">
                <span className="node-card-id">{n.id}</span>
                <span className={`hw-badge ${n.last_seen_s < 120 ? 'hw-badge--ok' : 'hw-badge--fail'}`}>
                  {n.last_seen_s < 60 ? `${n.last_seen_s}s ago` : `${Math.floor(n.last_seen_s / 60)}m ago`}
                </span>
              </div>
              <div className="node-soil-bar-wrap">
                <div className="node-soil-bar" style={{ width: `${n.soil_pct}%` }} />
              </div>
              <div className="node-card-row">
                <span className="node-soil-val">{n.soil_pct.toFixed(1)}%</span>
                <span className={`node-wet-badge ${n.soil_wet ? 'wet' : 'dry'}`}>
                  {n.soil_wet ? 'WET' : 'DRY'}
                </span>
              </div>
              <span className="node-mac mono">{n.mac}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


