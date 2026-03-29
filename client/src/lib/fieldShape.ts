import * as THREE from 'three';
import { ShapeUtils } from 'three';

/** One vertex of the field boundary in meters (X / Z on the ground plane). CCW from above. */
export type FieldCornerM = { x: number; z: number };

export type FieldPolygon = FieldCornerM[];

/** Default plot is a centered square (side length in meters). */
export const DEFAULT_FIELD_SIDE_M = 100;

export function defaultCenteredRectangle(widthM: number, heightM: number): FieldPolygon {
  const hx = widthM / 2;
  const hz = heightM / 2;
  return [
    { x: -hx, z: -hz },
    { x: hx, z: -hz },
    { x: hx, z: hz },
    { x: -hx, z: hz },
  ];
}

export const DEFAULT_FIELD_POLYGON = defaultCenteredRectangle(DEFAULT_FIELD_SIDE_M, DEFAULT_FIELD_SIDE_M);

/** Cross-hatch / grid on the field surface in world XZ — same spacing in editor and live view. */
export const FIELD_GRID_CELL_METERS = 10;

/** Default wet-irrigation radius drawn around each node (meters); override per-node with `irrigation_radius_m`. */
export const DEFAULT_NODE_IRRIGATION_RADIUS_M = 12;

/** Default max water throw from the base turret (meters); override per-station with `turret_range_m`. */
export const DEFAULT_TURRET_THROW_RADIUS_M = 28;

/** Earlier app default (100×60); rehydrated saves match this — migrate to {@link DEFAULT_FIELD_POLYGON}. */
export const LEGACY_DEFAULT_FIELD_POLYGON_100_60 = defaultCenteredRectangle(100, 60);

export function polygonsPositionsEqual(a: FieldPolygon, b: FieldPolygon, eps = 1e-6): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > eps || Math.abs(a[i].z - b[i].z) > eps) return false;
  }
  return true;
}

/** @deprecated use FieldPolygon */
export type FieldQuad = [FieldCornerM, FieldCornerM, FieldCornerM, FieldCornerM];

export function polygonBoundingBox(v: FieldPolygon): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of v) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function polygonCenter(v: FieldPolygon): FieldCornerM {
  const b = polygonBoundingBox(v);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/**
 * Map normalized device coords (0–1) into the polygon’s axis-aligned bounding box (meters).
 * field_x: west→east, field_y: south→north in bbox space — same semantics as the original rectangle map.
 */
export function polygonPointFromNormalized(fx: number, fy: number, vertices: FieldPolygon): FieldCornerM {
  const b = polygonBoundingBox(vertices);
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxZ - b.minZ, 1e-6);
  return {
    x: b.minX + fx * w,
    z: b.minZ + fy * h,
  };
}

/** Inverse of bbox-normalized coords (for placing devices from a world XZ hit on the ground). */
export function normalizedFromFieldPoint(
  x: number,
  z: number,
  vertices: FieldPolygon,
): { field_x: number; field_y: number } {
  const b = polygonBoundingBox(vertices);
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxZ - b.minZ, 1e-6);
  const field_x = Math.min(1, Math.max(0, (x - b.minX) / w));
  const field_y = Math.min(1, Math.max(0, (z - b.minZ) / h));
  return { field_x, field_y };
}

export function edgeLengthsM(vertices: FieldPolygon): number[] {
  const n = vertices.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    out.push(Math.hypot(b.x - a.x, b.z - a.z));
  }
  return out;
}

/** Smallest allowed edge length when editing numerically (meters). */
export const MIN_EDGE_LENGTH_M = 0.25;

function cross2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function onSegment(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): boolean {
  const minx = Math.min(ax, bx) - 1e-9;
  const maxx = Math.max(ax, bx) + 1e-9;
  const minz = Math.min(az, bz) - 1e-9;
  const maxz = Math.max(az, bz) + 1e-9;
  return px >= minx && px <= maxx && pz >= minz && pz <= maxz
    && Math.abs(cross2(ax - px, az - pz, bx - px, bz - pz)) < 1e-8;
}

function segmentsIntersectProper(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const d1 = cross2(cx - ax, cz - az, bx - ax, bz - az);
  const d2 = cross2(dx - ax, dz - az, bx - ax, bz - az);
  const d3 = cross2(ax - cx, az - cz, dx - cx, dz - cz);
  const d4 = cross2(bx - cx, bz - cz, dx - cx, dz - cz);
  if (
    ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9))
    && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
  ) {
    return true;
  }
  if (Math.abs(d1) < 1e-9 && onSegment(cx, cz, ax, az, bx, bz)) return true;
  if (Math.abs(d2) < 1e-9 && onSegment(dx, dz, ax, az, bx, bz)) return true;
  if (Math.abs(d3) < 1e-9 && onSegment(ax, az, cx, cz, dx, dz)) return true;
  if (Math.abs(d4) < 1e-9 && onSegment(bx, bz, cx, cz, dx, dz)) return true;
  return false;
}

/** True if boundary is a simple closed polygon (no self-intersections). */
export function isSimplePolygon(vertices: FieldPolygon): boolean {
  const n = vertices.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      const adj = (i === j) || ((i + 1) % n === j) || (i === (j + 1) % n) || (((i + 1) % n) === ((j + 1) % n));
      if (adj) continue;
      if (segmentsIntersectProper(a1.x, a1.z, a2.x, a2.z, b1.x, b1.z, b2.x, b2.z)) return false;
    }
  }
  return true;
}

function contourVector2(vertices: FieldPolygon): THREE.Vector2[] {
  return vertices.map((v) => new THREE.Vector2(v.x, v.z));
}

/** CCW in XZ when seen from +Y (positive ShapeUtils area). */
export function orientCounterClockwise(vertices: FieldPolygon): FieldPolygon {
  const c = contourVector2(vertices);
  if (ShapeUtils.isClockWise(c)) {
    return [...vertices].reverse();
  }
  return vertices;
}

export function triangulatePolygon(vertices: FieldPolygon): { oriented: FieldPolygon; faces: number[][] } {
  const oriented = orientCounterClockwise(vertices);
  const faces = ShapeUtils.triangulateShape(contourVector2(oriented), []);
  return { oriented, faces };
}

type Vec3 = { x: number; y: number; z: number };

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function edgeKey(i: number, j: number): string {
  return i < j ? `${i}_${j}` : `${j}_${i}`;
}

/**
 * Subdivide a triangle mesh (by midpoint subdivision) for smoother shading.
 */
function subdivideIndexed(
  verts: Vec3[],
  uvs: [number, number][],
  faces: number[][],
  passes: number,
): { verts: Vec3[]; uvs: [number, number][]; faces: number[][] } {
  let v = [...verts];
  let uv = [...uvs];
  let tris = faces.map((t) => [...t]);

  for (let p = 0; p < passes; p++) {
    const midCache = new Map<string, number>();
    const midOf = (i: number, j: number): number => {
      const k = edgeKey(i, j);
      const existing = midCache.get(k);
      if (existing !== undefined) return existing;
      const m = midpoint(v[i], v[j]);
      const uvm: [number, number] = [(uv[i][0] + uv[j][0]) / 2, (uv[i][1] + uv[j][1]) / 2];
      v.push(m);
      uv.push(uvm);
      const idx = v.length - 1;
      midCache.set(k, idx);
      return idx;
    };

    const next: number[][] = [];
    for (const [a, b, c] of tris) {
      const mab = midOf(a, b);
      const mbc = midOf(b, c);
      const mca = midOf(c, a);
      next.push([a, mab, mca], [mab, b, mbc], [mca, mbc, c], [mab, mbc, mca]);
    }
    tris = next;
  }

  return { verts: v, uvs: uv, faces: tris };
}

export function buildFieldGroundGeometry(vertices: FieldPolygon, subdivPasses = 2): THREE.BufferGeometry {
  const bb = polygonBoundingBox(vertices);
  const bw = Math.max(bb.maxX - bb.minX, 1e-6);
  const bh = Math.max(bb.maxZ - bb.minZ, 1e-6);
  const uvFor = (x: number, z: number): [number, number] => [
    (x - bb.minX) / bw,
    (z - bb.minZ) / bh,
  ];

  const { oriented, faces } = triangulatePolygon(vertices);
  const baseVerts: Vec3[] = oriented.map((p) => ({ x: p.x, y: 0, z: p.z }));
  const baseUvs: [number, number][] = oriented.map((p) => uvFor(p.x, p.z));
  const faceIdx = faces.map((f) => [...f]);

  const { verts, uvs, faces: subFaces } = subdivideIndexed(baseVerts, baseUvs, faceIdx, subdivPasses);

  const pos = new Float32Array(verts.length * 3);
  const uvArr = new Float32Array(verts.length * 2);
  const indices: number[] = [];
  for (let i = 0; i < verts.length; i++) {
    pos[i * 3] = verts[i].x;
    pos[i * 3 + 1] = verts[i].y;
    pos[i * 3 + 2] = verts[i].z;
    uvArr[i * 2] = uvs[i][0];
    uvArr[i * 2 + 1] = uvs[i][1];
  }
  for (const t of subFaces) {
    indices.push(t[0], t[1], t[2]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Triangulated fill mesh (no subdivision), same UVs as ground — for editor preview. */
export function buildPolygonFillGeometry(vertices: FieldPolygon): THREE.BufferGeometry {
  const { oriented, faces } = triangulatePolygon(vertices);
  const pos: number[] = [];
  const idx: number[] = [];
  const y = 0.001;
  for (const p of oriented) {
    pos.push(p.x, y, p.z);
  }
  for (const f of faces) {
    idx.push(f[0], f[1], f[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Vertical thickness (meters) for the configure-editor field solid. */
export const EDITOR_FIELD_EXTRUSION_DEPTH = 1.35;

/**
 * Solid extruded mesh: footprint in XZ, thickness along +local Y after placement
 * (bottom y = 0, top y = depth in the mesh’s local space).
 */
export function buildPolygonExtrudedMeshGeometry(
  vertices: FieldPolygon,
  depth: number = EDITOR_FIELD_EXTRUSION_DEPTH,
): THREE.BufferGeometry {
  const { oriented } = triangulatePolygon(vertices);
  const shape = new THREE.Shape();
  shape.moveTo(oriented[0].x, oriented[0].z);
  for (let i = 1; i < oriented.length; i++) {
    shape.lineTo(oriented[i].x, oriented[i].z);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(0.08, depth * 0.08),
    bevelSize: Math.min(0.06, depth * 0.06),
    bevelSegments: 2,
    curveSegments: 16,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth, 0);
  geo.computeVertexNormals();
  return geo;
}
