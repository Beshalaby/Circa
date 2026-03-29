import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls, OrthographicCamera, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  EDITOR_FIELD_EXTRUSION_DEPTH,
  FIELD_GRID_CELL_METERS,
  MIN_EDGE_LENGTH_M,
  buildPolygonExtrudedMeshGeometry,
  edgeLengthsM,
  isSimplePolygon,
  polygonBoundingBox,
  polygonCenter,
  type FieldCornerM,
} from '../lib/fieldShape';
import { useFieldShapeStore } from '../lib/fieldShapeStore';
import './FieldShapeEditor.css';

/** World Y (meters) of the plot “floating” above empty space — not tied to stored vertex coords. */
const PLOT_ELEVATION = 12;

const FieldEditorUiContext = createContext<{
  hoveredEdge: number | null;
  setHoveredEdge: Dispatch<SetStateAction<number | null>>;
  cornerDragging: boolean;
  setCornerDragging: Dispatch<SetStateAction<boolean>>;
  /** Polygon center (XZ) when a corner drag started — keeps OrbitControls target stable while dragging. */
  cornerDragAnchorRef: RefObject<{ x: number; z: number } | null>;
} | null>(null);

function useFieldEditorUi() {
  const ctx = useContext(FieldEditorUiContext);
  if (!ctx) throw new Error('useFieldEditorUi must be used within FieldEditorUiProvider');
  return ctx;
}

function FieldEditorUiProvider({ children }: { children: ReactNode }) {
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [cornerDragging, setCornerDragging] = useState(false);
  const cornerDragAnchorRef = useRef<{ x: number; z: number } | null>(null);
  const value = useMemo(
    () => ({
      hoveredEdge,
      setHoveredEdge,
      cornerDragging,
      setCornerDragging,
      cornerDragAnchorRef,
    }),
    [hoveredEdge, cornerDragging],
  );
  return (
    <FieldEditorUiContext.Provider value={value}>{children}</FieldEditorUiContext.Provider>
  );
}

/** World Y of the top face of the extruded field mesh (group is offset by PLOT_ELEVATION). */
const PLOT_TOP_Y = EDITOR_FIELD_EXTRUSION_DEPTH;

/** Meters: wide hit strip along each edge (top-down interaction). */
const EDGE_RIBBON_WIDTH = 4.2;

/** World XZ cross-hatch; shader avoids brittle cap UVs on extruded meshes. */
const FIELD_PATTERN_VS = `
varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FIELD_PATTERN_FS = `
uniform float uCell;
varying vec3 vWorldPos;
void main() {
  vec2 xz = vWorldPos.xz;
  vec2 g = fract(xz / uCell);
  float edge = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  float line = 1.0 - smoothstep(0.0, 0.04, edge);
  vec3 base = vec3(1.0);
  vec3 ink = vec3(0.39, 0.36, 0.33);
  gl_FragColor = vec4(mix(base, ink, line * 0.5), 1.0);
}`;

type OrthoFit = { halfX: number; halfZ: number; cx: number; cz: number };

function EditorCameraFit() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const { camera, size } = useThree();
  const { cornerDragging } = useFieldEditorUi();
  const lastFitRef = useRef<OrthoFit | null>(null);

  useLayoutEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    if (!(ortho instanceof THREE.OrthographicCamera)) return;

    const applyFit = (fit: OrthoFit) => {
      ortho.position.set(fit.cx, 140, fit.cz);
      ortho.rotation.set(-Math.PI / 2, 0, 0);
      ortho.left = -fit.halfX;
      ortho.right = fit.halfX;
      ortho.top = fit.halfZ;
      ortho.bottom = -fit.halfZ;
      ortho.zoom = 1;
      ortho.near = 0.5;
      ortho.far = 4000;
      ortho.updateProjectionMatrix();
    };

    /**
     * Refitting the ortho every vertex tick while dragging grows the frustum with the bbox, so
     * meters-per-pixel keeps increasing — tiny mouse motion adds huge world deltas (“runaway” width).
     * Hold the previous fit until the drag ends; mouse ↔ world stays 1:1 for the whole stroke.
     */
    if (cornerDragging && lastFitRef.current) {
      applyFit(lastFitRef.current);
      return;
    }

    const bb = polygonBoundingBox(vertices);
    const cx = (bb.minX + bb.maxX) / 2;
    const cz = (bb.minZ + bb.maxZ) / 2;
    const fw = Math.max(bb.maxX - bb.minX, 8);
    const fh = Math.max(bb.maxZ - bb.minZ, 8);
    const pad = Math.max(fw, fh) * 0.11 + 10;
    const halfFieldX = fw / 2 + pad;
    const halfFieldZ = fh / 2 + pad;
    /**
     * Frustum half-extents in **meters** with halfX / halfZ = canvas aspect so a square stays square on screen.
     */
    const viewAspect = size.width / Math.max(size.height, 1);
    let halfX = halfFieldX;
    let halfZ = halfFieldZ;
    if (halfFieldX / halfFieldZ > viewAspect) {
      halfZ = halfFieldX / viewAspect;
    } else {
      halfX = halfFieldZ * viewAspect;
    }
    const fit: OrthoFit = { halfX, halfZ, cx, cz };
    lastFitRef.current = fit;
    applyFit(fit);
  }, [vertices, camera, size.width, size.height, cornerDragging]);
  return null;
}

function FieldOutline() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = vertices.length;
    const positions = new Float32Array(n * 3);
    const y = PLOT_TOP_Y + 0.04;
    for (let i = 0; i < n; i++) {
      positions[i * 3] = vertices[i].x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = vertices[i].z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [vertices]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineLoop geometry={geo}>
      <lineBasicMaterial color="#252220" />
    </lineLoop>
  );
}

function HoveredEdgeHighlight() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const { hoveredEdge } = useFieldEditorUi();
  const geo = useMemo(() => {
    if (hoveredEdge === null) return null;
    const n = vertices.length;
    const a = vertices[hoveredEdge];
    const b = vertices[(hoveredEdge + 1) % n];
    const g = new THREE.BufferGeometry();
    const y = PLOT_TOP_Y + 0.06;
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([a.x, y, a.z, b.x, y, b.z], 3),
    );
    return g;
  }, [vertices, hoveredEdge]);
  useEffect(() => {
    if (!geo) return;
    return () => geo.dispose();
  }, [geo]);
  if (!geo) return null;
  return (
    <line geometry={geo}>
      <lineBasicMaterial color="#2d5f82" />
    </line>
  );
}

function FieldMesh() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const geo = useMemo(
    () => buildPolygonExtrudedMeshGeometry(vertices, EDITOR_FIELD_EXTRUSION_DEPTH),
    [vertices],
  );
  const uniforms = useMemo(
    () => ({
      uCell: { value: FIELD_GRID_CELL_METERS },
    }),
    [],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} castShadow>
      <shaderMaterial
        attach="material"
        uniforms={uniforms}
        vertexShader={FIELD_PATTERN_VS}
        fragmentShader={FIELD_PATTERN_FS}
        toneMapped={false}
      />
    </mesh>
  );
}

function CornerHandle({ index }: { index: number }) {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const setVertex = useFieldShapeStore((s) => s.setVertex);
  const { setCornerDragging, cornerDragAnchorRef } = useFieldEditorUi();
  const { raycaster, camera, gl } = useThree();
  const drag = useRef(false);
  const captureId = useRef<number>(-1);
  const handleR = useMemo(() => {
    const bb = polygonBoundingBox(vertices);
    const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 12);
    return Math.max(2.05, Math.min(5, span * 0.032));
  }, [vertices]);
  const plane = useMemo(
    () =>
      new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -(PLOT_ELEVATION + EDITOR_FIELD_EXTRUSION_DEPTH),
      ),
    [],
  );
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const pos = vertices[index];

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      const rect = el.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const q = useFieldShapeStore.getState().vertices;
        const next: FieldCornerM = { x: hit.x, z: hit.z };
        const trial = q.map((p, j) => (j === index ? next : p));
        if (isSimplePolygon(trial)) setVertex(index, next);
      }
    };
    const end = () => {
      drag.current = false;
      setCornerDragging(false);
      cornerDragAnchorRef.current = null;
      if (captureId.current >= 0) {
        try {
          el.releasePointerCapture(captureId.current);
        } catch {
          /* ignore */
        }
        captureId.current = -1;
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
    };
  }, [camera, cornerDragAnchorRef, gl, hit, index, ndc, plane, raycaster, setCornerDragging, setVertex]);

  return (
    <group position={[pos.x, PLOT_TOP_Y + 0.15 + handleR * 0.5, pos.z]}>
      <mesh
        castShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          const verts = useFieldShapeStore.getState().vertices;
          cornerDragAnchorRef.current = polygonCenter(verts);
          drag.current = true;
          setCornerDragging(true);
          captureId.current = e.pointerId;
          gl.domElement.setPointerCapture(e.pointerId);
        }}
      >
        <sphereGeometry args={[handleR, 20, 20]} />
        <meshStandardMaterial color="#3d3832" roughness={0.38} metalness={0.15} />
      </mesh>
      <Billboard follow position={[0, handleR + 1.15, 0]}>
        <Text
          fontSize={Math.min(2.1, handleR * 0.85)}
          color="#1a1816"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.06}
          outlineColor="#ffffff"
          outlineOpacity={0.95}
        >
          {(index + 1).toString()}
        </Text>
      </Billboard>
    </group>
  );
}

/** Wide, flat pick box on the top of the mesh — easy to hit from a top-down camera. */
function EdgePickRibbon({ edgeIndex }: { edgeIndex: number }) {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const insertVertexOnEdge = useFieldShapeStore((s) => s.insertVertexOnEdge);
  const { hoveredEdge, setHoveredEdge } = useFieldEditorUi();
  const n = vertices.length;
  const a = vertices[edgeIndex];
  const b = vertices[(edgeIndex + 1) % n];
  const { midY, midX, midZ, len, rotY } = useMemo(() => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.max(Math.hypot(dx, dz), 0.001);
    return {
      midX: (a.x + b.x) / 2,
      midZ: (a.z + b.z) / 2,
      midY: PLOT_TOP_Y + 0.02,
      len: length,
      rotY: Math.atan2(dx, dz),
    };
  }, [a, b]);
  const hover = hoveredEdge === edgeIndex;
  return (
    <mesh
      position={[midX, midY, midZ]}
      rotation={[0, rotY, 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHoveredEdge(edgeIndex);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHoveredEdge((prev) => (prev === edgeIndex ? null : prev));
      }}
      onClick={(e) => {
        e.stopPropagation();
        insertVertexOnEdge(edgeIndex);
      }}
    >
      <boxGeometry args={[EDGE_RIBBON_WIDTH, 0.35, len + 0.55]} />
      <meshBasicMaterial
        transparent
        color={hover ? '#4d7eab' : '#8a97a3'}
        opacity={hover ? 0.33 : 0.12}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Mid-edge label (same numbering as sidebar); raycast disabled so ribbons stay easy to click. */
function EdgeLabel({ edgeIndex }: { edgeIndex: number }) {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const groupRef = useRef<THREE.Group>(null);
  const n = vertices.length;
  const a = vertices[edgeIndex];
  const b = vertices[(edgeIndex + 1) % n];
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  const bb = useMemo(() => polygonBoundingBox(vertices), [vertices]);
  const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 12);
  const fontSize = Math.max(1.35, Math.min(2, span * 0.024));
  const i1 = edgeIndex + 1;
  const i2 = ((edgeIndex + 1) % n) + 1;
  const label = `${i1}→${i2}`;

  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.raycast = () => {};
      }
    });
  }, [vertices, edgeIndex, label]);

  return (
    <group ref={groupRef} position={[midX, PLOT_TOP_Y + 0.5, midZ]}>
      <Billboard follow>
        <Text
          fontSize={fontSize}
          color="#1a1816"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.055}
          outlineColor="#ffffff"
          outlineOpacity={0.95}
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

function FloatingFieldGroup() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  return (
    <group position={[0, PLOT_ELEVATION, 0]}>
      <FieldMesh />
      <FieldOutline />
      <HoveredEdgeHighlight />
      {vertices.map((_, i) => (
        <EdgePickRibbon key={`edge-${i}-${vertices.length}`} edgeIndex={i} />
      ))}
      {vertices.map((_, i) => (
        <EdgeLabel key={`edge-lbl-${i}-${vertices.length}`} edgeIndex={i} />
      ))}
      {vertices.map((_, i) => (
        <CornerHandle key={`vh-${i}-${vertices.length}`} index={i} />
      ))}
    </group>
  );
}

function EditorScene() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const { cornerDragging, cornerDragAnchorRef } = useFieldEditorUi();
  const c = polygonCenter(vertices);
  const anchor = cornerDragging ? cornerDragAnchorRef.current : null;
  const orbitX = anchor ? anchor.x : c.x;
  const orbitZ = anchor ? anchor.z : c.z;
  const bb = useMemo(() => polygonBoundingBox(vertices), [vertices]);
  const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 24);
  const cx = (bb.minX + bb.maxX) / 2;
  const cz = (bb.minZ + bb.maxZ) / 2;
  const targetY = PLOT_ELEVATION + EDITOR_FIELD_EXTRUSION_DEPTH * 0.55;

  return (
    <>
      <color attach="background" args={['#ffffff']} />
      <OrthographicCamera makeDefault manual near={0.5} far={4000} />
      <EditorCameraFit />
      <hemisphereLight args={['#ffffff', '#e8e8e8', 0.72]} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[cx + 48, PLOT_ELEVATION + 120, cz + 36]}
        intensity={0.52}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={1}
        shadow-camera-far={360}
        shadow-camera-left={-span * 1.25}
        shadow-camera-right={span * 1.25}
        shadow-camera-top={span * 1.25}
        shadow-camera-bottom={-span * 1.25}
      />
      <FloatingFieldGroup />
      <OrbitControls
        enableRotate={false}
        enablePan
        enableZoom
        minZoom={0.35}
        maxZoom={32}
        target={[orbitX, targetY, orbitZ]}
      />
    </>
  );
}

function RectangleResetForm() {
  const resetRectangle = useFieldShapeStore((s) => s.resetRectangle);
  const wRef = useRef<HTMLInputElement>(null);
  const hRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const w = parseFloat(wRef.current?.value || '100');
    const h = parseFloat(hRef.current?.value || '100');
    resetRectangle(Number.isFinite(w) ? w : 100, Number.isFinite(h) ? h : 100);
  };

  return (
    <div className="field-shape-reset">
      <span className="field-shape-reset-label mono">New rectangle (m)</span>
      <div className="field-shape-reset-row">
        <label className="field-shape-reset-field">
          <span>Width</span>
          <input
            ref={wRef}
            type="number"
            min={1}
            step={0.5}
            className="input mono"
            defaultValue={100}
          />
        </label>
        <label className="field-shape-reset-field">
          <span>Height</span>
          <input
            ref={hRef}
            type="number"
            min={1}
            step={0.5}
            className="input mono"
            defaultValue={100}
          />
        </label>
        <button type="button" className="btn-primary field-shape-reset-btn" onClick={apply}>
          Apply
        </button>
      </div>
      <p className="field-shape-hint">
        Replaces the outline with a centered rectangle. Your devices still use 0–1 coordinates over the plot’s box.
      </p>
    </div>
  );
}

function EdgeLengthInput({ edgeIndex, lengthM, n }: { edgeIndex: number; lengthM: number; n: number }) {
  const setEdgeLength = useFieldShapeStore((s) => s.setEdgeLength);
  const [draft, setDraft] = useState(() => lengthM.toFixed(1));
  useEffect(() => {
    setDraft(lengthM.toFixed(1));
  }, [lengthM]);
  const commit = () => {
    const normalized = draft.replace(',', '.').trim();
    const v = parseFloat(normalized);
    if (!Number.isFinite(v)) {
      setDraft(lengthM.toFixed(1));
      return;
    }
    const ok = setEdgeLength(edgeIndex, v);
    if (!ok) setDraft(lengthM.toFixed(1));
  };
  const targetCorner = ((edgeIndex + 1) % n) + 1;
  return (
    <label className="field-shape-edge-length-wrap">
      <input
        type="number"
        className="input mono field-shape-edge-length-input"
        min={MIN_EDGE_LENGTH_M}
        step={0.1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label={`Edge ${edgeIndex + 1} to ${targetCorner}, length in meters (moves corner ${targetCorner})`}
      />
      <span className="mono field-shape-edge-length-unit">m</span>
    </label>
  );
}

function MeasurementsPanel() {
  const vertices = useFieldShapeStore((s) => s.vertices);
  const insertVertexOnEdge = useFieldShapeStore((s) => s.insertVertexOnEdge);
  const removeVertex = useFieldShapeStore((s) => s.removeVertex);
  const edges = useMemo(() => edgeLengthsM(vertices), [vertices]);
  const n = vertices.length;

  return (
    <div className="field-shape-controls">
      <details className="field-shape-measurements">
        <summary className="field-shape-measurements-summary mono">Edge lengths &amp; split</summary>
        <p className="field-shape-edge-length-hint">
          Type a length in meters, then press Enter or click away — the end corner of that edge slides along the same line. Values that would cross edges are ignored.
        </p>
        <ul className="field-shape-edges">
          {edges.map((m, i) => (
            <li key={`e-${i}-${n}`}>
              <span className="field-shape-edge-label">
                Edge {i + 1}→{((i + 1) % n) + 1}
              </span>
              <EdgeLengthInput edgeIndex={i} lengthM={m} n={n} />
              <button
                type="button"
                className="btn-ghost field-shape-edge-add"
                onClick={() => insertVertexOnEdge(i)}
                title="Insert a corner at the midpoint of this edge"
              >
                Split
              </button>
            </li>
          ))}
        </ul>
      </details>
      {n > 3 && (
        <details className="field-shape-measurements">
          <summary className="field-shape-measurements-summary mono">Corners ({n})</summary>
          <ul className="field-shape-verts">
            {vertices.map((v, i) => (
              <li key={`v-${i}`}>
                <span className="mono field-shape-vert-coord">
                  #{i + 1} · {v.x.toFixed(1)} m, {v.z.toFixed(1)} m
                </span>
                <button
                  type="button"
                  className="btn-ghost field-shape-vert-remove"
                  onClick={() => removeVertex(i)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const FIELD_STEPS_UI_KEY = 'circa-field-shape-steps-minimized';

function FieldStepsOverlay() {
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem(FIELD_STEPS_UI_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setMinimized((m) => {
      const next = !m;
      try {
        localStorage.setItem(FIELD_STEPS_UI_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="field-shape-canvas-overlay">
      <div
        className={
          minimized
            ? 'field-shape-steps-shell field-shape-steps-shell--minimized'
            : 'field-shape-steps-shell'
        }
      >
        <div className="field-shape-steps-bar">
          <span id="field-shape-steps-label" className="field-shape-steps-bar-label mono">
            Quick tips
          </span>
          <button
            type="button"
            className="btn-ghost field-shape-steps-toggle"
            onClick={toggle}
            aria-expanded={!minimized}
            aria-controls="field-shape-steps-list"
          >
            {minimized ? 'Show' : 'Hide'}
          </button>
        </div>
        <ol
          id="field-shape-steps-list"
          className="field-shape-steps"
          aria-labelledby="field-shape-steps-label"
          hidden={minimized}
        >
          <li>
            <strong>Drag</strong> big spheres — move corners
          </li>
          <li>
            <strong>Click</strong> the wide shaded band on an edge — new corner
          </li>
          <li>
            Optional: <strong>scroll</strong> to zoom · drag to pan
          </li>
        </ol>
      </div>
    </div>
  );
}

function FieldShapeEditorInner() {
  return (
    <section className="field-shape-editor card" aria-label="Field boundary">
      <header className="field-shape-editor-head">
        <div>
          <p className="field-shape-kicker mono">Field boundary</p>
          <h2 className="field-shape-title">Outline your field</h2>
          <p className="field-shape-desc">
            Drag the <strong>corner spheres</strong> or click a <strong>shaded strip</strong> along an edge to add a corner. The mesh shows a <strong>cross pattern</strong> like rows; view stays top-down.
          </p>
        </div>
      </header>
      <div className="field-shape-body">
        <div className="field-shape-canvas-wrap">
          <FieldStepsOverlay />
          <Canvas
            orthographic
            shadows
            gl={{ antialias: true, alpha: false }}
            className="field-shape-canvas-gl"
            dpr={[1, 2]}
          >
            <Suspense fallback={null}>
              <EditorScene />
            </Suspense>
          </Canvas>
        </div>
        <div className="field-shape-side">
          <div className="field-shape-side-intro">
            <p className="field-shape-side-tip">
              The plot is framed large by default. Invalid drags (lines crossing) are ignored.
            </p>
          </div>
          <MeasurementsPanel />
          <RectangleResetForm />
        </div>
      </div>
    </section>
  );
}

export default function FieldShapeEditor() {
  return (
    <FieldEditorUiProvider>
      <FieldShapeEditorInner />
    </FieldEditorUiProvider>
  );
}
