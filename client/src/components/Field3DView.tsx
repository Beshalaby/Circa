/**
 * Field3DView — perspective 3D visualisation for the dashboard.
 * Dark aesthetic: animated grid ground, amber base-station towers,
 * green floating node gems, connection lines station→node.
 */
import { useEffect, useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useFieldStore } from '../lib/socket';
import type { BaseStation, Node } from '../lib/socket';
import {
  buildFieldGroundGeometry,
  DEFAULT_FIELD_POLYGON,
  DEFAULT_NODE_IRRIGATION_RADIUS_M,
  DEFAULT_TURRET_THROW_RADIUS_M,
  FIELD_GRID_CELL_METERS,
  isSimplePolygon,
  polygonBoundingBox,
  polygonPointFromNormalized,
} from '../lib/fieldShape';
import type { FieldCornerM, FieldPolygon } from '../lib/fieldShape';
import { useFieldShapeStore } from '../lib/fieldShapeStore';
import { useDevicePlacementStore } from '../lib/devicePlacementStore';
import './Field3DView.css';

// ─── helpers ──────────────────────────────────────────────────────────────────

function dedupeFinitePoints(vertices: FieldPolygon): FieldPolygon {
  const out: FieldPolygon = [];
  for (const p of vertices ?? []) {
    if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, z: p.z });
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) out.pop();
  }
  return out;
}

function convexHull(points: FieldPolygon): FieldPolygon {
  if (points.length <= 3) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.z - b.z : a.x - b.x));
  const cross = (o: FieldCornerM, a: FieldCornerM, b: FieldCornerM) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: FieldCornerM[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: FieldCornerM[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function sanitizeVertices(vertices: FieldPolygon): FieldPolygon {
  if (!Array.isArray(vertices) || vertices.length < 3) return DEFAULT_FIELD_POLYGON;
  const cleaned = dedupeFinitePoints(vertices);
  if (cleaned.length < 3) return DEFAULT_FIELD_POLYGON;
  if (isSimplePolygon(cleaned)) return cleaned;
  const hull = convexHull(cleaned);
  if (hull.length >= 3 && isSimplePolygon(hull)) return hull;
  return DEFAULT_FIELD_POLYGON;
}

function toXZ(fx: number, fy: number, vertices: FieldPolygon): { x: number; z: number } {
  const p = polygonPointFromNormalized(fx, fy, vertices);
  return { x: p.x, z: p.z };
}

/** Node colour based on soil moisture percentage. */
function moistureCol(pct: number | undefined): string {
  if (pct === undefined) return '#4abe82';
  if (pct < 25) return '#e2a030';
  if (pct < 45) return '#7ec88a';
  if (pct < 65) return '#2db876';
  return '#12e877';
}

// ─── shaders ──────────────────────────────────────────────────────────────────

const GROUND_VS = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Light editorial ground — near-white base, visible gray grid lines
const GROUND_FS = /* glsl */ `
uniform float uTime;
uniform float uCell;
varying vec3 vWorldPos;
void main() {
  vec2 xz = vWorldPos.xz;
  vec2 g = fract(xz / uCell);
  float edge = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  float line = 1.0 - smoothstep(0.0, 0.05, edge);
  vec3 base = vec3(0.975, 0.972, 0.965);
  vec3 ink  = vec3(0.38,  0.36,  0.32);
  float breathe = sin(uTime * 0.35 + xz.x * 0.08)
                * sin(uTime * 0.28 + xz.y * 0.07) * 0.010;
  vec3 col = mix(base, ink, line * 0.62);
  col += breathe;
  gl_FragColor = vec4(col, 1.0);
}`;

// ─── FieldGround ──────────────────────────────────────────────────────────────

function FieldGround({ vertices }: { vertices: FieldPolygon }) {
  const geo = useMemo(() => buildFieldGroundGeometry(vertices, 2), [vertices]);
  useEffect(() => () => geo.dispose(), [geo]);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uCell: { value: FIELD_GRID_CELL_METERS } }),
    [],
  );
  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh geometry={geo} receiveShadow>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={GROUND_VS}
        fragmentShader={GROUND_FS}
      />
    </mesh>
  );
}

// ─── FieldBorder3D ─────────────────────────────────────────────────────────────

function FieldBorder3D({ vertices }: { vertices: FieldPolygon }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = vertices.length;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = vertices[i].x;
      pos[i * 3 + 1] = 0.08;
      pos[i * 3 + 2] = vertices[i].z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [vertices]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineLoop geometry={geo}>
      <lineBasicMaterial color="#c4972a" transparent opacity={0.75} />
    </lineLoop>
  );
}

// ─── ConnectionLine ────────────────────────────────────────────────────────────

function ConnectionLine({
  fromX,
  fromZ,
  toX,
  toZ,
}: {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts = new Float32Array([fromX, 0.14, fromZ, toX, 0.14, toZ]);
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return g;
  }, [fromX, fromZ, toX, toZ]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    // @ts-expect-error – R3F lowercase line maps to THREE.Line
    <line geometry={geo}>
      <lineBasicMaterial color="#c4972a" transparent opacity={0.45} />
    </line>
  );
}

// ─── Station3D ─────────────────────────────────────────────────────────────────

function Station3D({
  station,
  ms,
  vertices,
  onSelect,
  isSelected,
}: {
  station: BaseStation;
  ms: number;
  vertices: FieldPolygon;
  onSelect?: (s: BaseStation) => void;
  isSelected?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.MeshBasicMaterial>(null);
  const { x, z } = toXZ(station.field_x, station.field_y, vertices);
  const col = '#c4972a';
  const em  = '#b07a14';
  const turretR = station.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (groupRef.current) {
      const sc = 1 + Math.sin(t * 1.4) * 0.012;
      groupRef.current.scale.set(sc, 1, sc);
    }
    if (glowRef.current) {
      glowRef.current.opacity = 0.12 + Math.sin(t * 1.9) * 0.07;
    }
  });

  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onSelect?.(station); }}
      onPointerEnter={() => { document.body.style.cursor = 'pointer'; }}
      onPointerLeave={() => { document.body.style.cursor = 'auto'; }}
    >
      {/* Turret range ring on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1} position={[0, 0.02, 0]}>
        <ringGeometry args={[turretR - 0.7, turretR + 0.7, 72]} />
        <meshBasicMaterial color="#1d6a94" transparent opacity={0.2} depthWrite={false} />
      </mesh>

      {/* Selection highlight ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} renderOrder={1}>
          <ringGeometry args={[2.9 * ms, 3.7 * ms, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}

      <group ref={groupRef}>
        {/* Hex base platform */}
        <mesh position={[0, 0.1 * ms, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <ringGeometry args={[1.45 * ms, 2.6 * ms, 6]} />
          <meshStandardMaterial color={col} roughness={0.45} metalness={0.4} emissive={em} emissiveIntensity={0.15} />
        </mesh>
        <mesh position={[0, 0.09 * ms, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.45 * ms, 6]} />
          <meshStandardMaterial color={col} roughness={0.6} metalness={0.25} emissive={em} emissiveIntensity={0.06} />
        </mesh>

        {/* Main body */}
        <mesh position={[0, 1.9 * ms, 0]} castShadow>
          <cylinderGeometry args={[0.48 * ms, 0.7 * ms, 3.2 * ms, 8]} />
          <meshStandardMaterial color={col} roughness={0.35} metalness={0.45} emissive={em} emissiveIntensity={0.12} />
        </mesh>

        {/* Turret head */}
        <mesh position={[0, 3.55 * ms, 0]} castShadow>
          <cylinderGeometry args={[0.63 * ms, 0.48 * ms, 0.65 * ms, 8]} />
          <meshStandardMaterial color={col} roughness={0.3} metalness={0.5} emissive={em} emissiveIntensity={0.22} />
        </mesh>

        {/* Barrel */}
        <mesh position={[0.5 * ms, 3.6 * ms, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.14 * ms, 0.19 * ms, 0.9 * ms, 6]} />
          <meshStandardMaterial color={col} roughness={0.25} metalness={0.6} emissive={em} emissiveIntensity={0.28} />
        </mesh>

        {/* Online glow ring */}
        <mesh position={[0, 0.22 * ms, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6 * ms, 2.8 * ms, 48]} />
          <meshBasicMaterial ref={glowRef} color="#c4972a" transparent opacity={0.18} depthWrite={false} />
        </mesh>

        {/* Point light glow */}
        <pointLight
          position={[0, 4.5 * ms, 0]}
          color="#c4972a"
          intensity={ms * 0.9}
          distance={turretR * 0.55}
          decay={2}
        />
      </group>
    </group>
  );
}

// ─── Node3D ────────────────────────────────────────────────────────────────────

function Node3D({
  node,
  ms,
  vertices,
  onSelect,
  isSelected,
}: {
  node: Node;
  ms: number;
  vertices: FieldPolygon;
  onSelect?: (n: Node) => void;
  isSelected?: boolean;
}) {
  const gemRef = useRef<THREE.Mesh>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { x, z } = toXZ(node.field_x, node.field_y, vertices);
  const col = moistureCol(node.soil_moisture);
  const irrR = node.irrigation_radius_m ?? DEFAULT_NODE_IRRIGATION_RADIUS_M;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (gemRef.current) {
      gemRef.current.rotation.y = t * 0.45;
      gemRef.current.position.y = 0.7 * ms + Math.sin(t * 1.3 + x * 0.08) * 0.1 * ms;
    }
    if (glowMatRef.current) {
      glowMatRef.current.opacity = 0.1 + Math.sin(t * 2.3 + z * 0.08) * 0.06;
    }
  });

  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onSelect?.(node); }}
      onPointerEnter={() => { document.body.style.cursor = 'pointer'; }}
      onPointerLeave={() => { document.body.style.cursor = 'auto'; }}
    >
      {/* Irrigation zone */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1} position={[0, 0.03, 0]}>
        <circleGeometry args={[irrR, 48]} />
        <meshBasicMaterial color="#1b4332" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1} position={[0, 0.04, 0]}>
        <ringGeometry args={[Math.max(0.2, irrR - 0.4), irrR + 0.25, 48]} />
        <meshBasicMaterial color={col} transparent opacity={0.28} depthWrite={false} />
      </mesh>

      {/* Selection highlight disc */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={1}>
          <ringGeometry args={[0.8 * ms, 1.2 * ms, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}

      {/* Stem */}
      <mesh position={[0, 0.35 * ms, 0]}>
        <cylinderGeometry args={[0.055 * ms, 0.07 * ms, 0.65 * ms, 6]} />
        <meshStandardMaterial
          color={col}
          roughness={0.55}
          metalness={0.15}
          emissive={col}
          emissiveIntensity={0.1}
        />
      </mesh>

      {/* Gem — animated via ref */}
      <mesh ref={gemRef} castShadow>
        <octahedronGeometry args={[0.36 * ms, 0]} />
        <meshStandardMaterial
          color={col}
          roughness={0.15}
          metalness={0.5}
          emissive={col}
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* Ground glow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.75 * ms, 32]} />
        <meshBasicMaterial ref={glowMatRef} color={col} transparent opacity={0.12} depthWrite={false} />
      </mesh>

      {/* Point light */}
      <pointLight
        position={[0, 0.7 * ms, 0]}
        color={col}
        intensity={ms * 0.28}
        distance={irrR * 0.85}
        decay={2}
      />
    </group>
  );
}

// ─── Scene3D ───────────────────────────────────────────────────────────────────

function Scene3D({
  cx,
  cz,
  tgtZ,
  span,
  stations,
  nodes,
  vertices,
  onSelect,
  selectedId,
}: {
  cx: number;
  cz: number;
  tgtZ: number;
  span: number;
  stations: BaseStation[];
  nodes: Node[];
  vertices: FieldPolygon;
  onSelect?: (item: BaseStation | Node | null) => void;
  selectedId?: string | null;
}) {
  const ms = THREE.MathUtils.clamp(span * 0.013, 0.9, 3.8);
  const shadowPad = span * 1.1;

  return (
    <>
      {/* Lighting — tuned for white / editorial background */}
      <ambientLight intensity={1.1} color="#f8f6f2" />
      <directionalLight
        position={[cx + span * 0.55, span * 0.9, cz - span * 0.35]}
        intensity={0.6}
        color="#fffaf2"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={span * 4}
        shadow-camera-left={-shadowPad}
        shadow-camera-right={shadowPad}
        shadow-camera-top={shadowPad}
        shadow-camera-bottom={-shadowPad}
      />
      {/* Soft amber kicker from opposite side */}
      <directionalLight
        position={[cx - span * 0.4, span * 0.4, cz + span * 0.6]}
        intensity={0.18}
        color="#e8a830"
      />

      {/* Ground & border */}
      <FieldGround vertices={vertices} />
      <FieldBorder3D vertices={vertices} />

      {/* Connection lines drawn first (under markers) */}
      {nodes.map((node) => {
        const st = stations.find((s) => s.id === node.station_id);
        if (!st) return null;
        const nPos = toXZ(node.field_x, node.field_y, vertices);
        const sPos = toXZ(st.field_x, st.field_y, vertices);
        return (
          <ConnectionLine
            key={`conn-${node.id}`}
            fromX={nPos.x}
            fromZ={nPos.z}
            toX={sPos.x}
            toZ={sPos.z}
          />
        );
      })}

      {/* Base stations */}
      {stations.map((s) => (
        <Station3D
          key={s.id}
          station={s}
          ms={ms}
          vertices={vertices}
          onSelect={onSelect}
          isSelected={selectedId === s.id}
        />
      ))}

      {/* Sensor nodes */}
      {nodes.map((n) => (
        <Node3D
          key={n.id}
          node={n}
          ms={ms}
          vertices={vertices}
          onSelect={onSelect}
          isSelected={selectedId === n.id}
        />
      ))}

      {/* Camera controls — pan + zoom only; rotation locked so the field stays top-down.
          Left-drag is remapped to pan so the user can pan intuitively. */}
      <OrbitControls
        target={[cx, 0, tgtZ]}
        enableRotate={false}
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.1}
        minDistance={span * 0.2}
        maxDistance={span * 3.5}
        screenSpacePanning
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
      />
    </>
  );
}

// ─── Field3DView (exported) ────────────────────────────────────────────────────

export default function Field3DView({
  onSelect,
  selectedId,
}: {
  onSelect?: (item: BaseStation | Node | null) => void;
  selectedId?: string | null;
}) {
  const rawVertices = useFieldShapeStore((s) => s.vertices);
  const vertices = useMemo(() => sanitizeVertices(rawVertices), [rawVertices]);
  const bb = useMemo(() => polygonBoundingBox(vertices), [vertices]);

  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 1);

  const socketStations = useFieldStore((s) => s.stations);
  const socketNodes = useFieldStore((s) => s.nodes);
  const stationField = useDevicePlacementStore((s) => s.stationField);
  const nodeField = useDevicePlacementStore((s) => s.nodeField);

  const stations = useMemo(
    () => socketStations.map((s) => ({ ...s, ...stationField[s.id] })),
    [socketStations, stationField],
  );
  const nodes = useMemo(
    () => socketNodes.map((n) => ({ ...n, ...nodeField[n.id] })),
    [socketNodes, nodeField],
  );

  // Top-down "from an angle" view (~16° from vertical, X-primary tilt).
  //
  // Camera sits to the upper-right of the field centre, angled primarily in X
  // so the near/far Z edges stay symmetric and don't clip at the bottom.
  // The FOV is widened to ensure the full field comfortably fills the canvas.
  const h    = span * 0.88 + 28;           // height (~116 m for a 100 m field)
  const xOff = span * 0.26 + 7;            // rightward tilt (~16° from vertical)
  const zOff = span * 0.04 + 1;            // tiny forward — Z edges stay centred
  const tgtZ = cz;                          // target at field centre

  const camPos = useMemo<[number, number, number]>(
    () => [cx + xOff, h, cz + zOff],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cx, cz], // recalculate only when the field polygon changes
  );

  return (
    <div className="field-3d-view">
      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ fov: 55, near: 0.5, far: span * 16 + 120, position: camPos }}
        gl={{ antialias: true, alpha: false }}
        shadows
        dpr={[1, 2]}
      >
        <color attach="background" args={['#ffffff']} />
        <Suspense fallback={null}>
          <Scene3D
            cx={cx}
            cz={cz}
            tgtZ={tgtZ}
            span={span}
            stations={stations}
            nodes={nodes}
            vertices={vertices}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        </Suspense>
      </Canvas>

      {/* HUD overlay */}
      <div className="field-3d-hud">
        <span className="field-3d-hud-tag mono">3D FIELD</span>
        <div className="field-3d-hud-counts">
          <span className="field-3d-hud-item mono">
            <span className="field-3d-hud-dot field-3d-hud-dot--station" />
            {stations.length} stations
          </span>
          <span className="field-3d-hud-item mono">
            <span className="field-3d-hud-dot field-3d-hud-dot--node" />
            {nodes.length} nodes
          </span>
        </div>
      </div>

      {/* Empty-state hint */}
      {stations.length === 0 && nodes.length === 0 && (
        <div className="field-3d-empty">
          <p className="mono">No devices · add via Configure</p>
        </div>
      )}
    </div>
  );
}
