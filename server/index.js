import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { mqttClient, initMQTT } from './mqtt.js';
import controlRouter from './routes/control.js';
import stationsRouter from './routes/stations.js';
import schedulesRouter from './routes/schedules.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

app.use('/api/control', controlRouter);
app.use('/api/stations', stationsRouter);
app.use('/api/schedules', schedulesRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── MQTT → Socket.io bridge ───────────────────────────────────────────
initMQTT((topic, payload) => {
  // Broadcast to all connected dashboard clients
  io.emit('sensor_update', { topic, payload, timestamp: new Date().toISOString() });
});

// Expose io so routes can publish commands
export { io };

// ─── Socket.io ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Client can send turret commands directly via WS too
  socket.on('turret_command', (data) => {
    const topic = `circa/control/${data.stationId}/turret`;
    mqttClient.publish(topic, JSON.stringify(data), { qos: 1 });
    console.log(`[MQTT] Published turret command to ${topic}`);
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[Server] Circa backend running on http://localhost:${PORT}`);
});
