import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'data');
const DB_FILE   = join(DATA_DIR, 'stations.json');

// ─── Local JSON helpers ──────────────────────────────────────────────────────

function readDb() {
  if (!existsSync(DB_FILE)) return { stations: [], nodes: [] };
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { stations: [], nodes: [] };
  }
}

function writeDb(db) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();

/** GET /api/stations — list all base stations and nodes */
router.get('/', (_req, res) => {
  res.json(readDb());
});

/** POST /api/stations — register or update a base station */
router.post('/', (req, res) => {
  const { id, name, field_x, field_y, crop_type } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });

  const db = readDb();
  const existing = db.stations.findIndex((s) => s.id === id);
  const record = { id, name, field_x: field_x ?? 0.5, field_y: field_y ?? 0.5, crop_type: crop_type ?? 'wheat' };

  if (existing >= 0) {
    db.stations[existing] = { ...db.stations[existing], ...record };
  } else {
    db.stations.push(record);
  }

  writeDb(db);
  res.json(record);
});

/** DELETE /api/stations/:id — remove a base station and its nodes */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.stations = db.stations.filter((s) => s.id !== id);
  db.nodes    = db.nodes.filter((n) => n.station_id !== id);
  writeDb(db);
  res.json({ ok: true });
});

/** POST /api/stations/nodes — register or update a node */
router.post('/nodes', (req, res) => {
  const { id, station_id, name, field_x, field_y, crop_type } = req.body;
  if (!id || !station_id || !name) return res.status(400).json({ error: 'id, station_id and name are required' });

  const db = readDb();
  const existing = db.nodes.findIndex((n) => n.id === id);
  const record = { id, station_id, name, field_x: field_x ?? 0.5, field_y: field_y ?? 0.5, crop_type: crop_type ?? 'wheat' };

  if (existing >= 0) {
    db.nodes[existing] = { ...db.nodes[existing], ...record };
  } else {
    db.nodes.push(record);
  }

  writeDb(db);
  res.json(record);
});

/** DELETE /api/stations/nodes/:id — remove a node */
router.delete('/nodes/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.nodes = db.nodes.filter((n) => n.id !== id);
  writeDb(db);
  res.json({ ok: true });
});

/** GET /api/stations/readings/:entityId — stub (no Supabase; real data via Socket.IO) */
router.get('/readings/:entityId', (_req, res) => {
  res.json([]);
});

export default router;
