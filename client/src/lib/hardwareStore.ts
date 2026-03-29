import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_HARDWARE_URL = 'http://192.168.4.1';

export interface HardwareStore {
  urls: Record<string, string>;
  setUrl: (stationId: string, url: string) => void;
  getUrl: (stationId: string) => string;
}

export const useHardwareStore = create<HardwareStore>()(
  persist(
    (set, get) => ({
      urls: {},
      setUrl: (stationId, url) =>
        set((s) => ({ urls: { ...s.urls, [stationId]: url } })),
      getUrl: (stationId) => get().urls[stationId] ?? DEFAULT_HARDWARE_URL,
    }),
    {
      name: 'circa-hardware-urls',
      partialize: (s) => ({ urls: s.urls }),
    },
  ),
);
