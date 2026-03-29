import mqtt from 'mqtt';

export let mqttClient;

/**
 * Topic patterns:
 *   circa/station/{id}/humidity
 *   circa/station/{id}/temperature
 *   circa/station/{id}/soil_moisture
 *   circa/node/{id}/soil_moisture
 *   circa/node/{id}/status
 */
function parseTopic(topic, rawPayload) {
  const parts = topic.split('/');
  if (parts.length < 4 || parts[0] !== 'circa') return null;

  const [, entityType, entityId, metric] = parts;
  let value;

  try {
    const parsed = JSON.parse(rawPayload.toString());
    value = parsed.value !== undefined ? parsed.value : parsed;
  } catch {
    value = parseFloat(rawPayload.toString());
  }

  return { entityType, entityId, metric, value };
}

export function initMQTT(onMessage) {
  const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
  mqttClient = mqtt.connect(brokerUrl, {
    clientId: `circa-server-${Date.now()}`,
    reconnectPeriod: 3000,
  });

  mqttClient.on('connect', () => {
    console.log(`[MQTT] Connected to broker: ${brokerUrl}`);
    mqttClient.subscribe('circa/#', { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err);
      else console.log('[MQTT] Subscribed to circa/#');
    });
  });

  mqttClient.on('message', (topic, payload) => {
    const parsed = parseTopic(topic, payload);
    if (!parsed) return;

    const { entityType, entityId, metric, value } = parsed;
    console.log(`[MQTT] ${topic} → ${value}`);

    onMessage(topic, { entityType, entityId, metric, value });
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
  });

  mqttClient.on('offline', () => {
    console.warn('[MQTT] Client offline, retrying...');
  });
}
