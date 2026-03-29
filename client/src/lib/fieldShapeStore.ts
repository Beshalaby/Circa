import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_FIELD_POLYGON,
  defaultCenteredRectangle,
  isSimplePolygon,
  LEGACY_DEFAULT_FIELD_POLYGON_100_60,
  MIN_EDGE_LENGTH_M,
  polygonsPositionsEqual,
  type FieldCornerM,
  type FieldPolygon,
} from './fieldShape';

export interface FieldShapeStore {
  vertices: FieldPolygon;
  setVertices: (v: FieldPolygon) => void;
  setVertex: (index: number, corner: FieldCornerM) => void;
  insertVertexOnEdge: (edgeStartIndex: number) => void;
  removeVertex: (index: number) => void;
  /** Move the end vertex of the edge along its ray so its length becomes `lengthM` (meters). Returns whether the polygon stayed simple. */
  setEdgeLength: (edgeStartIndex: number, lengthM: number) => boolean;
  resetRectangle: (widthM: number, heightM: number) => void;
}

export const useFieldShapeStore = create<FieldShapeStore>()(
  persist(
    (set) => ({
      vertices: DEFAULT_FIELD_POLYGON,
      setVertices: (vertices) => set({ vertices: vertices.length >= 3 ? [...vertices] : DEFAULT_FIELD_POLYGON }),
      setVertex: (index, corner) =>
        set((s) => {
          if (index < 0 || index >= s.vertices.length) return s;
          const next = s.vertices.map((p, i) => (i === index ? { ...corner } : p));
          return isSimplePolygon(next) ? { vertices: next } : s;
        }),
      insertVertexOnEdge: (edgeStartIndex) =>
        set((s) => {
          const n = s.vertices.length;
          if (n < 3 || edgeStartIndex < 0 || edgeStartIndex >= n) return s;
          const a = s.vertices[edgeStartIndex];
          const b = s.vertices[(edgeStartIndex + 1) % n];
          const mid: FieldCornerM = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          const next = [
            ...s.vertices.slice(0, edgeStartIndex + 1),
            mid,
            ...s.vertices.slice(edgeStartIndex + 1),
          ];
          return isSimplePolygon(next) ? { vertices: next } : s;
        }),
      removeVertex: (index) =>
        set((s) => {
          const n = s.vertices.length;
          if (n <= 3 || index < 0 || index >= n) return s;
          const next = s.vertices.filter((_, i) => i !== index);
          return isSimplePolygon(next) ? { vertices: next } : s;
        }),
      setEdgeLength: (edgeStartIndex, lengthM) => {
        let ok = false;
        set((s) => {
          const n = s.vertices.length;
          if (n < 3 || edgeStartIndex < 0 || edgeStartIndex >= n) return s;
          const L = Number(lengthM);
          if (!Number.isFinite(L)) return s;
          const len = Math.max(MIN_EDGE_LENGTH_M, L);
          const a = s.vertices[edgeStartIndex];
          const j = (edgeStartIndex + 1) % n;
          const b = s.vertices[j];
          const vx = b.x - a.x;
          const vz = b.z - a.z;
          const d = Math.hypot(vx, vz);
          if (d < 1e-9) return s;
          const nx = vx / d;
          const nz = vz / d;
          const newB: FieldCornerM = { x: a.x + nx * len, z: a.z + nz * len };
          const next = s.vertices.map((p, i) => (i === j ? newB : p));
          if (!isSimplePolygon(next)) return s;
          ok = true;
          return { vertices: next };
        });
        return ok;
      },
      resetRectangle: (widthM, heightM) =>
        set({
          vertices: defaultCenteredRectangle(Math.max(1, widthM), Math.max(1, heightM)),
        }),
    }),
    {
      name: 'circa-field-shape',
      version: 3,
      migrate: (persistedState, fromVersion) => {
        const p = persistedState as { vertices?: FieldCornerM[] } | null | undefined;
        if (!p || !Array.isArray(p.vertices)) return persistedState as { vertices: FieldPolygon };
        if (
          fromVersion < 3 &&
          polygonsPositionsEqual(p.vertices, LEGACY_DEFAULT_FIELD_POLYGON_100_60)
        ) {
          return { vertices: [...DEFAULT_FIELD_POLYGON] };
        }
        return p as { vertices: FieldPolygon };
      },
      partialize: (s) => ({ vertices: s.vertices }),
      merge: (persisted, current) => {
        const p = persisted as { vertices?: FieldCornerM[]; quad?: FieldCornerM[] } | undefined;
        if (!p || typeof p !== 'object') return current;
        if (Array.isArray(p.vertices) && p.vertices.length >= 3) {
          let v = p.vertices;
          if (polygonsPositionsEqual(v, LEGACY_DEFAULT_FIELD_POLYGON_100_60)) {
            v = [...DEFAULT_FIELD_POLYGON];
          }
          return { ...current, vertices: v };
        }
        if (Array.isArray(p.quad) && p.quad.length === 4) {
          let v: FieldPolygon = [...p.quad];
          if (polygonsPositionsEqual(v, LEGACY_DEFAULT_FIELD_POLYGON_100_60)) {
            v = [...DEFAULT_FIELD_POLYGON];
          }
          return { ...current, vertices: v };
        }
        return current;
      },
    },
  ),
);
