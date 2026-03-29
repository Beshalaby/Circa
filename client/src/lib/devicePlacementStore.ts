import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Local overrides for `field_x` / `field_y` (dashboard “place on field”); merged over socket/API state. */
export interface DevicePlacementStore {
  stationField: Record<string, { field_x: number; field_y: number }>;
  nodeField: Record<string, { field_x: number; field_y: number }>;
  setStationField: (id: string, field_x: number, field_y: number) => void;
  setNodeField: (id: string, field_x: number, field_y: number) => void;
}

export const useDevicePlacementStore = create<DevicePlacementStore>()(
  persist(
    (set) => ({
      stationField: {},
      nodeField: {},
      setStationField: (id, field_x, field_y) =>
        set((s) => ({
          stationField: { ...s.stationField, [id]: { field_x, field_y } },
        })),
      setNodeField: (id, field_x, field_y) =>
        set((s) => ({
          nodeField: { ...s.nodeField, [id]: { field_x, field_y } },
        })),
    }),
    {
      name: 'circa-device-field-positions',
      partialize: (s) => ({ stationField: s.stationField, nodeField: s.nodeField }),
    },
  ),
);
