import { useMemo, useRef, useState, Suspense, useEffect, useLayoutEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useFieldStore } from '../lib/socket';
import type { BaseStation, Node } from '../lib/socket';
import {
  DEFAULT_FIELD_POLYGON,
  DEFAULT_NODE_IRRIGATION_RADIUS_M,
  DEFAULT_TURRET_THROW_RADIUS_M,
  FIELD_GRID_CELL_METERS,
  buildFieldGroundGeometry,
  isSimplePolygon,
  normalizedFromFieldPoint,
  polygonBoundingBox,
  polygonPointFromNormalized,
} from '../lib/fieldShape';
import type { FieldCornerM, FieldPolygon } from '../lib/fieldShape';
import { useDevicePlacementStore } from '../lib/devicePlacementStore';
import { useFieldShapeStore } from '../lib/fieldShapeStore';
import './FieldCanvas.css';

// Amber colour used for the node placement constraint ring
const CONSTRAINT_RING_COLOR = '#f59e0b';

function fieldToXZ(fx: number, fy: number, boundary: FieldPolygon) {
  const p = polygonPointFromNormalized(fx, fy, boundary);
  return { x: p.x, z: p.z };
}

function moistureHex(pct: number | undefined): string {
  if (pct === undefined) return '#9e9991';
  if (pct < 25) return '#8b6914';
  if (pct < 45) return '#6b6560';
  if (pct < 65) return '#5a7a52';
  return '#2d7a4f';
}

const GROUND_VS = `varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GROUND_FS = `uniform float uTime;
uniform float uCell;
varying vec3 vWorldPos;
void main() {
  vec2 xz = vWorldPos.xz;
  vec2 g = fract(xz / uCell);
  float edge = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  float line = 1.0 - smoothstep(0.0, 0.04, edge);
  vec3 base = vec3(0.97, 0.97, 0.96);
  vec3 ink = vec3(0.5, 0.48, 0.45);
  float breathe = sin(uTime * 0.35 + xz.x * 0.08) * sin(uTime * 0.28 + xz.y * 0.07) * 0.014;
  vec3 col = mix(base, ink, line * 0.48);
  col += breathe;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Skip raycasting so hits reach the ground (marker / overlay pickers). */
const noRaycast: THREE.Object3D['raycast'] = () => undefined;

function dedupeFinitePoints(vertices: FieldPolygon): FieldPolygon {
  const out: FieldPolygon = [];
  for (const p of vertices ?? []) {
    if (!p || typeof p.x !== 'number' || typeof p.z !== 'number') continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, z: p.z });
  }
  // Drop duplicate closing point if persisted.
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
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: FieldCornerM[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function sanitizeFieldVertices(vertices: FieldPolygon): FieldPolygon {
  if (!Array.isArray(vertices) || vertices.length < 3) return DEFAULT_FIELD_POLYGON;
  const cleaned = dedupeFinitePoints(vertices);
  if (cleaned.length < 3) return DEFAULT_FIELD_POLYGON;
  if (isSimplePolygon(cleaned)) return cleaned;

  // Preserve the user's footprint as much as possible: if the path is invalid for triangulation,
  // render a simple convex hull of their points instead of resetting to a default square.
  const hull = convexHull(cleaned);
  if (hull.length >= 3 && isSimplePolygon(hull)) return hull;

  return DEFAULT_FIELD_POLYGON;
}

function useSafeFieldVertices(): FieldPolygon {
  const rawVertices = useFieldShapeStore((s) => s.vertices);
  return useMemo(() => sanitizeFieldVertices(rawVertices), [rawVertices]);
}

/** Subdivided field mesh in the XZ plane (meters), UVs follow normalized plot coords. */
function AliveGround({
  onPlacementClick,
}: {
  onPlacementClick?: ((worldX: number, worldZ: number) => void) | null;
}) {
  const vertices = useSafeFieldVertices();
  const geo = useMemo(() => buildFieldGroundGeometry(vertices, 2), [vertices]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uCell: { value: FIELD_GRID_CELL_METERS } }),
    [],
  );
  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh
      geometry={geo}
      receiveShadow
      onClick={(e) => {
        if (onPlacementClick) {
          e.stopPropagation();
          onPlacementClick(e.point.x, e.point.z);
        }
      }}
    >
      <shaderMaterial
        ref={mat}
        attach="material"
        uniforms={uniforms}
        vertexShader={GROUND_VS}
        fragmentShader={GROUND_FS}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function FieldBorder() {
  const vertices = useSafeFieldVertices();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = vertices.length;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = vertices[i].x;
      positions[i * 3 + 1] = 0.004;
      positions[i * 3 + 2] = vertices[i].z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [vertices]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineLoop geometry={geo}>
      <lineBasicMaterial color="#d0cbc2" transparent opacity={0.95} />
    </lineLoop>
  );
}

/** Pulsing amber ring showing the allowed placement radius for a node. */
function PlacementConstraintRing({
  cx,
  cz,
  radius,
}: {
  cx: number;
  cz: number;
  radius: number;
}) {
  const fillRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const op = 0.32 + Math.sin(clock.elapsedTime * 2.6) * 0.14;
    if (ringRef.current) ringRef.current.opacity = op;
    if (fillRef.current) fillRef.current.opacity = op * 0.16;
  });
  return (
    <group position={[cx, 0.026, cz]}>
      {/* Subtle fill */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[radius, 64]} />
        <meshBasicMaterial
          ref={fillRef}
          color={CONSTRAINT_RING_COLOR}
          transparent
          opacity={0.06}
          depthWrite={false}
        />
      </mesh>
      {/* Pulsing border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <ringGeometry args={[Math.max(0.3, radius - 0.6), radius + 0.6, 64]} />
        <meshBasicMaterial
          ref={ringRef}
          color={CONSTRAINT_RING_COLOR}
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function TurretRangeRing({
  cx,
  cz,
  radiusM,
  ignoreRaycast,
}: {
  cx: number;
  cz: number;
  radiusM: number;
  ignoreRaycast?: boolean;
}) {
  const inner = Math.max(0.35, radiusM - 0.4);
  const outer = radiusM + 0.4;

  // Square frame: outer square with an inner square hole, lying flat on the ground.
  const frameGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-outer, -outer);
    shape.lineTo(outer, -outer);
    shape.lineTo(outer, outer);
    shape.lineTo(-outer, outer);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-inner, -inner);
    hole.lineTo(inner, -inner);
    hole.lineTo(inner, inner);
    hole.lineTo(-inner, inner);
    hole.closePath();
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape);
  }, [inner, outer]);

  return (
    <group position={[cx, 0.02, cz]}>
      <mesh
        geometry={frameGeo}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
        raycast={ignoreRaycast ? noRaycast : undefined}
      >
        <meshBasicMaterial
          color="#1d6a94"
          transparent
          opacity={0.38}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function NodeIrrigationDisk({
  cx,
  cz,
  radiusM,
  ignoreRaycast,
}: {
  cx: number;
  cz: number;
  radiusM: number;
  ignoreRaycast?: boolean;
}) {
  return (
    <group position={[cx, 0.018, cz]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
        raycast={ignoreRaycast ? noRaycast : undefined}
      >
        <circleGeometry args={[radiusM, 64]} />
        <meshBasicMaterial
          color="#2d6a4f"
          transparent
          opacity={0.13}
          depthWrite={false}
        />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
        raycast={ignoreRaycast ? noRaycast : undefined}
      >
        <ringGeometry args={[Math.max(0.12, radiusM - 0.3), radiusM + 0.15, 64]} />
        <meshBasicMaterial
          color="#1b4332"
          transparent
          opacity={0.42}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function StationMarker({
  station,
  onPick,
  markerScale,
  showRadii,
  groundPickOnly,
}: {
  station: BaseStation;
  onPick: (s: BaseStation) => void;
  markerScale: number;
  showRadii: boolean;
  groundPickOnly?: boolean;
}) {
  const vertices = useSafeFieldVertices();
  const grp = useRef<THREE.Group>(null);
  const { x, z } = fieldToXZ(station.field_x, station.field_y, vertices);
  const ms = markerScale;
  const turretR = station.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M;
  useFrame(({ clock }) => {
    if (grp.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 1.6) * 0.025;
      grp.current.scale.setScalar(s);
    }
  });
  const col = '#6b5344';
  return (
    <group position={[x, 0, z]}>
      {showRadii && (
        <TurretRangeRing cx={0} cz={0} radiusM={turretR} ignoreRaycast={groundPickOnly} />
      )}
      <group
        ref={grp}
        position={[0, 0.04 + 0.05 * ms, 0]}
        onClick={
          groundPickOnly
            ? undefined
            : (e) => {
                e.stopPropagation();
                onPick(station);
              }
        }
      >
        <mesh
          castShadow
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={groundPickOnly ? noRaycast : undefined}
        >
          <ringGeometry args={[0.42 * ms, 0.72 * ms, 6]} />
          <meshStandardMaterial color={col} roughness={0.85} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.12 * ms, 0]} castShadow raycast={groundPickOnly ? noRaycast : undefined}>
          <cylinderGeometry args={[0.18 * ms, 0.22 * ms, 0.2 * ms, 8]} />
          <meshStandardMaterial color={col} roughness={0.6} metalness={0.15} />
        </mesh>
      </group>
    </group>
  );
}

function NodeMarker({
  node,
  onPick,
  markerScale,
  showRadii,
  groundPickOnly,
}: {
  node: Node;
  onPick: (n: Node) => void;
  markerScale: number;
  showRadii: boolean;
  groundPickOnly?: boolean;
}) {
  const vertices = useSafeFieldVertices();
  const meshRef = useRef<THREE.Mesh>(null);
  const { x, z } = fieldToXZ(node.field_x, node.field_y, vertices);
  const ms = markerScale;
  const col = moistureHex(node.soil_moisture);
  const irrR = node.irrigation_radius_m ?? DEFAULT_NODE_IRRIGATION_RADIUS_M;
  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.elapsedTime * 0.35;
    }
  });
  return (
    <group position={[x, 0, z]}>
      {showRadii && (
        <NodeIrrigationDisk cx={0} cz={0} radiusM={irrR} ignoreRaycast={groundPickOnly} />
      )}
      <mesh
        ref={meshRef}
        position={[0, 0.12 * ms + 0.02, 0]}
        castShadow
        raycast={groundPickOnly ? noRaycast : undefined}
        onClick={
          groundPickOnly
            ? undefined
            : (e) => {
                e.stopPropagation();
                onPick(node);
              }
        }
      >
      <octahedronGeometry args={[0.26 * ms, 0]} />
      <meshStandardMaterial
        color={col}
        roughness={0.45}
        metalness={0.2}
        emissive={col}
        emissiveIntensity={0.08}
      />
      </mesh>
    </group>
  );
}

/**
 * Fits the orthographic camera to show the full field polygon on every canvas resize,
 * matching the FieldShapeEditor's EditorCameraFit approach. When used, drei's
 * <OrthographicCamera> is not rendered — this modifies the R3F default camera directly.
 */
function CameraAutoFit({
  vertices,
  cx,
  cz,
}: {
  vertices: ReturnType<typeof useSafeFieldVertices>;
  cx: number;
  cz: number;
}) {
  const { camera, size } = useThree();

  useLayoutEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    if (!(ortho instanceof THREE.OrthographicCamera)) return;

    const bb = polygonBoundingBox(vertices);
    const fw = Math.max(bb.maxX - bb.minX, 8);
    const fh = Math.max(bb.maxZ - bb.minZ, 8);
    const pad = Math.max(fw, fh) * 0.12 + 10;
    const halfFieldX = fw / 2 + pad;
    const halfFieldZ = fh / 2 + pad;

    const viewAspect = size.width / Math.max(size.height, 1);
    let halfX = halfFieldX;
    let halfZ = halfFieldZ;
    if (halfFieldX / halfFieldZ > viewAspect) {
      halfZ = halfFieldX / viewAspect;
    } else {
      halfX = halfFieldZ * viewAspect;
    }

    ortho.position.set(cx, 58, cz);
    ortho.rotation.set(-Math.PI / 2, 0, 0);
    ortho.left = -halfX;
    ortho.right = halfX;
    ortho.top = halfZ;
    ortho.bottom = -halfZ;
    ortho.zoom = 1;
    ortho.near = 0.5;
    ortho.far = 2600;
    ortho.updateProjectionMatrix();
  }, [camera, size.width, size.height, vertices, cx, cz]);

  return null;
}

function Scene({
  onPick,
  orthoZoom,
  stations,
  nodes,
  onGroundPlace,
  showRadii,
  groundPickOnly,
  nodeConstraintStation,
  fitView = false,
  disableZoom = false,
}: {
  onPick: (item: BaseStation | Node) => void;
  orthoZoom: number;
  stations: BaseStation[];
  nodes: Node[];
  onGroundPlace: ((field_x: number, field_y: number) => void) | null;
  showRadii: boolean;
  groundPickOnly?: boolean;
  nodeConstraintStation?: BaseStation | null;
  fitView?: boolean;
  disableZoom?: boolean;
}) {
  const vertices = useSafeFieldVertices();
  const bb = useMemo(() => polygonBoundingBox(vertices), [vertices]);
  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 1);
  const pad = span * 0.55 + 8;
  const markerScale = THREE.MathUtils.clamp(span * 0.0085, 0.5, 2.4);
  const camZoom = orthoZoom * (88 / Math.max(span, 35));

  const handleGround = useMemo(() => {
    if (!onGroundPlace) return null;
    return (wx: number, wz: number) => {
      const { field_x, field_y } = normalizedFromFieldPoint(wx, wz, vertices);
      onGroundPlace(field_x, field_y);
    };
  }, [onGroundPlace, vertices]);

  // Compute constraint ring position + radius in world space
  const constraintPos = useMemo(() => {
    if (!nodeConstraintStation) return null;
    const p = polygonPointFromNormalized(
      nodeConstraintStation.field_x,
      nodeConstraintStation.field_y,
      vertices,
    );
    return { x: p.x, z: p.z };
  }, [nodeConstraintStation, vertices]);

  const constraintRadius = nodeConstraintStation
    ? (nodeConstraintStation.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M)
    : 0;

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight
        position={[cx + 12, 28, cz + 8]}
        intensity={0.55}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={Math.max(240, span * 3)}
        shadow-camera-left={bb.minX - pad}
        shadow-camera-right={bb.maxX + pad}
        shadow-camera-top={bb.maxZ + pad}
        shadow-camera-bottom={bb.minZ - pad}
      />
      <AliveGround onPlacementClick={handleGround} />
      <FieldBorder />

      {/* Node placement constraint ring */}
      {constraintPos && (
        <PlacementConstraintRing
          cx={constraintPos.x}
          cz={constraintPos.z}
          radius={constraintRadius}
        />
      )}

      {stations.map((s) => (
        <StationMarker
          key={s.id}
          station={s}
          onPick={onPick}
          markerScale={markerScale}
          showRadii={showRadii}
          groundPickOnly={groundPickOnly}
        />
      ))}
      {nodes.map((n) => (
        <NodeMarker
          key={n.id}
          node={n}
          onPick={onPick}
          markerScale={markerScale}
          showRadii={showRadii}
          groundPickOnly={groundPickOnly}
        />
      ))}
      {fitView ? (
        <CameraAutoFit vertices={vertices} cx={cx} cz={cz} />
      ) : (
        <OrthographicCamera
          makeDefault
          position={[cx, 58, cz]}
          rotation={[-Math.PI / 2, 0, 0]}
          zoom={camZoom}
          near={0.5}
          far={2600}
        />
      )}
      <OrbitControls
        enableRotate={false}
        enablePan
        enableZoom={!disableZoom}
        minZoom={4}
        maxZoom={140}
        target={[cx, 0, cz]}
      />
    </>
  );
}

function Inspector({
  item,
  onClose,
}: {
  item: BaseStation | Node;
  onClose: () => void;
}) {
  const isStation = 'humidity' in item;
  return (
    <aside className="field-inspector">
      <div className="field-inspector-head">
        <span className="field-inspector-cluster mono">{isStation ? 'BASE' : 'NODE'}</span>
        <button type="button" className="field-inspector-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <h3 className="field-inspector-name">{item.name}</h3>
      <p className="field-inspector-id mono">{item.id}</p>
      <dl className="field-inspector-dl">
        {isStation && (
          <>
            <div>
              <dt>Humidity</dt>
              <dd className="mono">
                {item.humidity !== undefined ? `${item.humidity.toFixed(1)}%` : '—'}
              </dd>
            </div>
            <div>
              <dt>Temperature</dt>
              <dd className="mono">
                {item.temperature !== undefined ? `${item.temperature.toFixed(1)}°C` : '—'}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Soil</dt>
          <dd className="mono">
            {(item as Node).soil_moisture !== undefined
              ? `${(item as Node).soil_moisture!.toFixed(1)}%`
              : isStation && item.soil_moisture !== undefined
                ? `${item.soil_moisture!.toFixed(1)}%`
                : '—'}
          </dd>
        </div>
        {isStation ? (
          <div>
            <dt>Turret reach</dt>
            <dd className="mono">
              {(item.turret_range_m ?? DEFAULT_TURRET_THROW_RADIUS_M).toFixed(0)} m
            </dd>
          </div>
        ) : (
          <div>
            <dt>Irrigation radius</dt>
            <dd className="mono">
              {((item as Node).irrigation_radius_m ?? DEFAULT_NODE_IRRIGATION_RADIUS_M).toFixed(0)} m
            </dd>
          </div>
        )}
      </dl>
    </aside>
  );
}

export type FieldCanvasVariant = 'preview' | 'full';

interface Props {
  /** Dashboard: compact strip. Field page: larger canvas. */
  variant?: FieldCanvasVariant;
  /** When set with `onPlaced`, clicking the ground sets that device's field position (merged locally). */
  placementMode?: boolean;
  placementTarget?: { kind: 'station' | 'node'; id: string } | null;
  onPlaced?: (field_x: number, field_y: number) => void;
  /** Draw irrigation disks and turret reach rings (default true). */
  showRadii?: boolean;
  /** When set (e.g. add-device flow), ground clicks call this with normalized coords and override placement of an existing selection. */
  onMapPositionPick?: (field_x: number, field_y: number) => void;
  /** Markers ignore raycasts so clicks hit the ground (use with `onMapPositionPick` in pickers). */
  groundPickOnly?: boolean;
  /**
   * When adding a node, pass the parent base station here to overlay a pulsing amber ring
   * showing the allowed placement area (station's turret range).
   */
  nodeConstraintStation?: BaseStation | null;
  /**
   * When true, fits the camera to show the entire field polygon on mount and on every canvas
   * resize (using canvas pixel dimensions). Use on full-size map editors. Default false.
   */
  fitView?: boolean;
  /** Disable scroll-to-zoom (keeps pan). Default false. */
  disableZoom?: boolean;
}

export default function FieldCanvas({
  variant = 'preview',
  placementMode = false,
  placementTarget = null,
  onPlaced,
  showRadii = true,
  onMapPositionPick,
  groundPickOnly = false,
  nodeConstraintStation = null,
  fitView = false,
  disableZoom = false,
}: Props) {
  const [selected, setSelected] = useState<BaseStation | Node | null>(null);
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

  const groundPlaceNormalized =
    onMapPositionPick ??
    (placementMode && placementTarget && onPlaced ? onPlaced : null);
  const placing = Boolean(groundPlaceNormalized);

  return (
    <div
      className={[
        'field-canvas-container',
        `field-canvas-container--${variant}`,
        groundPickOnly ? 'field-canvas-container--modal-picker' : '',
        placing ? 'field-canvas-container--placing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Canvas
        orthographic
        shadows
        gl={{ antialias: true, alpha: true }}
        className="field-canvas-gl"
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene
            stations={stations}
            nodes={nodes}
            onPick={setSelected}
            orthoZoom={variant === 'preview' ? 26 : 22}
            onGroundPlace={groundPlaceNormalized}
            showRadii={showRadii}
            groundPickOnly={groundPickOnly}
            nodeConstraintStation={nodeConstraintStation}
            fitView={fitView}
            disableZoom={disableZoom}
          />
        </Suspense>
      </Canvas>

      {selected && <Inspector item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
