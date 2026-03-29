# Circa — Smart Farming Dashboard

Real-time field monitoring and irrigation control for ESP32-based turret systems.

## Architecture

```
ESP32 Base Stations / Nodes
        │ MQTT publish
        ▼
Mosquitto Broker (port 1883)
        │ subscribe
        ▼
Node.js Server (port 3001) ──WebSocket──► React Frontend (port 5173)
        │
        ▼
   Supabase DB (persistence)
```

## Quick Start

### 1. Start the MQTT Broker

```bash
docker compose up -d
```

> Requires Docker Desktop. Mosquitto will run on port 1883 (MQTT) and 9001 (WebSocket).

### 2. Configure Environment Variables

```bash
# Server
cp server/.env.example server/.env
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, MQTT_BROKER=mqtt://localhost:1883

# Frontend
cp client/.env.example client/.env
# Fill in: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SOCKET_URL=http://localhost:3001
# Optional: VITE_GEMINI_API_KEY (for AI chat)
```

### 3. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run `supabase/schema.sql`
3. Copy Project URL + anon key into your `.env` files

### 4. Start the Backend

```bash
cd server
npm install
npm run dev
```

### 5. Start the Frontend

```bash
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Firmware Setup (ESP32)

### Required Libraries (Arduino Library Manager)

- **PubSubClient** by Nick O'Leary
- **DHT sensor library** by Adafruit
- **Adafruit Unified Sensor**
- **ESP32Servo**
- **ArduinoJson**

### Flash a Base Station

1. Open `firmware/base_station/base_station.ino` in Arduino IDE
2. Edit `firmware/config.h`:
   - Set `WIFI_SSID`, `WIFI_PASSWORD`
   - Set `MQTT_BROKER` to your machine's local IP
   - Set `DEVICE_ID` to e.g. `"station-001"`
   - Verify pin assignments match your wiring
3. Select **ESP32 Dev Module** board
4. Flash!

### Flash a Node

1. Open `firmware/node/node.ino`
2. Edit `config.h` with a unique `DEVICE_ID` (e.g. `"node-001"`)
3. Flash!

### Wire the Base Station

| Component | ESP32 Pin |
|-----------|-----------|
| DHT22 data | GPIO 4 |
| Soil sensor (analog) | GPIO 34 |
| Servo signal | GPIO 18 |
| Pump relay | GPIO 19 |

---

## Pairing a Device

1. In the dashboard, go to **Pair** → **Add Device**
2. Enter the same `DEVICE_ID` you set in `config.h`
3. Enter the physical field coordinates (0–1 normalized)
4. Power on the ESP32 — it will appear online in the field view

---

## MQTT Topic Reference

| Topic | Direction | Description |
|-------|-----------|-------------|
| `circa/station/{id}/humidity` | ESP32 → Server | % relative humidity |
| `circa/station/{id}/temperature` | ESP32 → Server | °C |
| `circa/station/{id}/soil_moisture` | ESP32 → Server | % moisture |
| `circa/node/{id}/soil_moisture` | ESP32 → Server | % moisture |
| `circa/node/{id}/status` | ESP32 → Server | 1=online |
| `circa/control/{id}/turret` | Server → ESP32 | `{"action":"fire","angle":90,"duration":5000}` |
| `circa/control/{id}/pump` | Server → ESP32 | `{"action":"on"\|"off"}` |

---

## Testing without Hardware

Use `mosquitto_pub` to simulate sensor readings:

```bash
# Simulate temperature reading
mosquitto_pub -h localhost -t "circa/station/station-001/temperature" -m '{"value":24.5}'

# Simulate soil moisture
mosquitto_pub -h localhost -t "circa/node/node-001/soil_moisture" -m '{"value":35.0}'
```
