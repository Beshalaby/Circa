// ─────────────────────────────────────────────────────────────
// node.ino — Circa Sensor Node Firmware
// Required libraries:
//   - PubSubClient by Nick O'Leary
//   - ArduinoJson
// ─────────────────────────────────────────────────────────────

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "../config.h"

// ── Objects ───────────────────────────────────────────────────
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ── State ─────────────────────────────────────────────────────
unsigned long lastPublish = 0;

// ── MQTT Topics ───────────────────────────────────────────────
String topicSoil   = "circa/node/" + String(DEVICE_ID) + "/soil_moisture";
String topicStatus = "circa/node/" + String(DEVICE_ID) + "/status";

// ── WiFi ──────────────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[WiFi] Connecting...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[WiFi] Connected: " + WiFi.localIP().toString());
}

// ── MQTT Connect ───────────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Connecting...");
    String clientId = "circa-node-" + String(DEVICE_ID);
    bool connected = (strlen(MQTT_USERNAME) > 0)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());

    if (connected) {
      Serial.println(" connected!");
      // Publish online status (retained)
      mqtt.publish(topicStatus.c_str(), "{\"value\":1}", true);
    } else {
      Serial.print(" failed rc=");
      Serial.println(mqtt.state());
      delay(3000);
    }
  }
}

// ── Soil moisture (0-100%) ─────────────────────────────────────
float readSoilMoisture() {
  int raw = analogRead(NODE_SOIL_PIN);
  float pct = map(raw, SOIL_DRY_VALUE, SOIL_WET_VALUE, 0, 100);
  return constrain(pct, 0.0f, 100.0f);
}

// ── Publish ────────────────────────────────────────────────────
void publishReadings() {
  float soil = readSoilMoisture();
  char buf[64];
  snprintf(buf, sizeof(buf), "{\"value\":%.2f}", soil);
  mqtt.publish(topicSoil.c_str(), buf);
  Serial.printf("[Node %s] Soil: %.1f%%\n", DEVICE_ID, soil);
}

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  connectWiFi();
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setKeepAlive(60);
}

// ── Loop ───────────────────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastPublish >= NODE_PUBLISH_INTERVAL) {
    lastPublish = now;
    publishReadings();
  }
}
