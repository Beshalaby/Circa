import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Types ──────────────────────────────────────────────────────
export interface SensorReading {
  entityType: 'station' | 'node';
  entityId: string;
  metric: string;
  value: number;
  timestamp: string;
}

export interface BaseStation {
  id: string;
  name: string;
  field_x: number;
  field_y: number;
  crop_type: string;
  online: boolean;
  humidity?: number;
  temperature?: number;
  soil_moisture?: number;
  /** Max reach of the turret stream from this base (meters); firmware can use for aiming limits. */
  turret_range_m?: number;
}

export interface Node {
  id: string;
  station_id: string;
  name: string;
  field_x: number;
  field_y: number;
  crop_type: string;
  online: boolean;
  soil_moisture?: number;
  /** Radius of intended irrigation / spray catchment at this target (meters). */
  irrigation_radius_m?: number;
}

export interface FieldStore {
  stations: BaseStation[];
  nodes: Node[];
  connected: boolean;
  lastUpdate: string | null;
  setConnected: (v: boolean) => void;
  upsertStation: (s: BaseStation) => void;
  upsertNode: (n: Node) => void;
  removeStation: (id: string) => void;
  removeNode: (id: string) => void;
  applyReading: (r: SensorReading) => void;
}

// ─── Zustand store (persisted to localStorage) ───────────────────
export const useFieldStore = create<FieldStore>()(
  persist(
    (set) => ({
      stations: [],
      nodes: [],
      connected: false,
      lastUpdate: null,
      setConnected: (connected) => set({ connected }),
      upsertStation: (station) =>
        set((s) => {
          const exists = s.stations.find((x) => x.id === station.id);
          return {
            stations: exists
              ? s.stations.map((x) => (x.id === station.id ? { ...x, ...station } : x))
              : [...s.stations, station],
          };
        }),
      upsertNode: (node) =>
        set((s) => {
          const exists = s.nodes.find((x) => x.id === node.id);
          return {
            nodes: exists
              ? s.nodes.map((x) => (x.id === node.id ? { ...x, ...node } : x))
              : [...s.nodes, node],
          };
        }),
      removeStation: (id) =>
        set((s) => ({ stations: s.stations.filter((x) => x.id !== id) })),
      removeNode: (id) =>
        set((s) => ({ nodes: s.nodes.filter((x) => x.id !== id) })),
      applyReading: ({ entityType, entityId, metric, value, timestamp }) =>
        set((s) => {
          if (entityType === 'station') {
            return {
              lastUpdate: timestamp,
              stations: s.stations.map((st) =>
                st.id === entityId ? { ...st, [metric]: value, online: true } : st,
              ),
            };
          }
          return {
            lastUpdate: timestamp,
            nodes: s.nodes.map((n) =>
              n.id === entityId ? { ...n, [metric]: value, online: metric !== 'status' || value > 0 } : n,
            ),
          };
        }),
    }),
    {
      name: 'circa-field-store',
      // Don't persist transient socket state; reset online status on rehydration
      partialize: (s) => ({ stations: s.stations, nodes: s.nodes }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.stations = state.stations.map((st) => ({ ...st, online: false }));
          state.nodes = state.nodes.map((n) => ({ ...n, online: false }));
        }
      },
    },
  ),
);

// ─── Socket singleton ────────────────────────────────────────────
let socket: Socket | null = null;

export function connectSocket() {
  if (socket?.connected) return socket;

  const url = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
  socket = io(url, { transports: ['websocket'] });

  const store = useFieldStore.getState();

  socket.on('connect', () => store.setConnected(true));
  socket.on('disconnect', () => store.setConnected(false));

  socket.on('sensor_update', ({ payload }: { topic: string; payload: SensorReading; timestamp: string }) => {
    store.applyReading({ ...payload, timestamp: new Date().toISOString() });
  });

  return socket;
}

export function sendTurretCommand(stationId: string, angle: number, duration: number) {
  socket?.emit('turret_command', { stationId, angle, duration, action: 'fire' });
}
