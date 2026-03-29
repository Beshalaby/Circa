import { Router } from 'express';
import { mqttClient } from '../mqtt.js';

const router = Router();

/**
 * GET /api/control/hardware/proxy?target=<full-esp32-url>
 *
 * Dumb HTTP proxy to the ESP32's local HTTP API.
 * The client supplies the full target URL (read from its local hardwareStore).
 * Routing through the server avoids CORS restrictions in the browser.
 */
router.get('/hardware/proxy', async (req, res) => {
  const { target } = req.query;
  if (!target || typeof target !== 'string') {
    return res.status(400).json({ error: 'target query parameter is required' });
  }

  // Basic safety: only allow http/https and local-ish targets
  let parsedUrl;
  try {
    parsedUrl = new URL(target);
  } catch {
    return res.status(400).json({ error: 'target is not a valid URL' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'target must use http or https' });
  }

  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(502).json({ error: 'Proxy fetch failed', detail: err?.message });
  }
});

/**
 * POST /api/control/turret
 * Body: { stationId, angle, duration, action: 'fire'|'stop' }
 */
router.post('/turret', (req, res) => {
  const { stationId, angle, duration, action } = req.body;
  if (!stationId || !action) {
    return res.status(400).json({ error: 'stationId and action are required' });
  }

  const topic = `circa/control/${stationId}/turret`;
  const payload = JSON.stringify({ angle, duration, action, timestamp: Date.now() });

  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) return res.status(500).json({ error: 'MQTT publish failed' });
    res.json({ success: true, topic, payload: JSON.parse(payload) });
  });
});

/**
 * POST /api/control/pump
 * Body: { stationId, action: 'on'|'off', duration }
 */
router.post('/pump', (req, res) => {
  const { stationId, action, duration } = req.body;
  if (!stationId || !action) {
    return res.status(400).json({ error: 'stationId and action are required' });
  }

  const topic = `circa/control/${stationId}/pump`;
  const payload = JSON.stringify({ action, duration, timestamp: Date.now() });

  mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) return res.status(500).json({ error: 'MQTT publish failed' });
    res.json({ success: true, topic, payload: JSON.parse(payload) });
  });
});

export default router;
