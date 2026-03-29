// ─────────────────────────────────────────────────────────────
// config.h — Circa Firmware Configuration
// Copy this file and fill in your values before flashing.
// ─────────────────────────────────────────────────────────────
#pragma once

// ── WiFi ──────────────────────────────────────────────────────
#define WIFI_SSID       "YourWiFiSSID"
#define WIFI_PASSWORD   "YourWiFiPassword"

// ── MQTT Broker ───────────────────────────────────────────────
// IP of the machine running Mosquitto (or your Pi/VPS)
#define MQTT_BROKER     "192.168.1.100"
#define MQTT_PORT       1883
#define MQTT_USERNAME   ""     // leave empty if allow_anonymous true
#define MQTT_PASSWORD   ""

// ── Device Identity ───────────────────────────────────────────
// Each device must have a unique ID
// Base station format: "station-001"
// Node format:         "node-001"
#define DEVICE_ID       "station-001"

// ── Publish intervals (ms) ─────────────────────────────────────
#define STATION_PUBLISH_INTERVAL  30000   // 30 seconds
#define NODE_PUBLISH_INTERVAL     60000   // 60 seconds

// ── Pin Assignments ───────────────────────────────────────────
// Base Station
#define DHT_PIN           4     // DHT22 data pin
#define DHT_TYPE          DHT22
#define SOIL_SENSOR_PIN   34    // Analog soil moisture (ADC1)
#define SERVO_PIN         18    // Turret servo signal
#define PUMP_RELAY_PIN    19    // Water pump relay

// Node
#define NODE_SOIL_PIN     34    // Analog soil moisture (ADC1)

// ── Soil moisture calibration ──────────────────────────────────
// Read raw ADC when dry (air) and when wet (fully submerged)
#define SOIL_DRY_VALUE    4095
#define SOIL_WET_VALUE    1500
