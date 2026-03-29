import { Router } from 'express';
import { supabase } from '../supabase.js';

const router = Router();

/** GET /api/schedules */
router.get('/', async (_req, res) => {
  if (!supabase) return res.json([]);
  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** POST /api/schedules */
router.post('/', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { name, trigger, conditions, actions, enabled, station_id } = req.body;
  const { data, error } = await supabase
    .from('schedules')
    .insert({ name, trigger, conditions, actions, enabled: enabled ?? true, station_id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

/** PATCH /api/schedules/:id */
router.patch('/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const { data, error } = await supabase
    .from('schedules')
    .update(req.body)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

/** DELETE /api/schedules/:id */
router.delete('/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' });
  const { id } = req.params;
  const { error } = await supabase.from('schedules').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

export default router;
