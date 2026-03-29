// ─────────────────────────────────────────────────────────────
// base_station.ino — Circa Base Station Firmware
// Required libraries (install via Arduino Library Manager):
//   - PubSubClient by Nick O'Leary
//   - DHT sensor library by Adafruit
//   - Adafruit Unified Sensor
//   - ESP32Servo
// ─────────────────────────────────────────────────────────────

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include "../config.h"

// ── Objects ───────────────────────────────────────────────────
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
DHT dht(DHT_PIN, DHT_TYPE);
Servo turretServo;

// ── State ─────────────────────────────────────────────────────
unsigned long lastPublish = 0;
float currentAngle = 90.0;

// ── MQTT Topics ───────────────────────────────────────────────
String topicHumidity     = "circa/station/" + String(DEVICE_ID) + "/humidity";
String topicTemperature  = "circa/station/" + String(DEVICE_ID) + "/temperature";
String topicSoilMoisture = "circa/station/" + String(DEVICE_ID) + "/soil_moisture";
String topicStatus       = "circa/station/" + String(DEVICE_ID) + "/status";
String topicControl      = "circa/control/" + String(DEVICE_ID) + "/turret";
String topicPump         = "circa/control/" + String(DEVICE_ID) + "/pump";

// ── WiFi Connection ────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.print(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("[WiFi] Connected, IP: ");
  Serial.println(WiFi.localIP());
}

// ── MQTT Callback (receives control commands) ──────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.println("[MQTT] Received on " + String(topic) + ": " + msg);

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, msg);
  if (err) {
    Serial.println("[MQTT] JSON parse error: " + String(err.c_str()));
    return;
  }

  // ── Turret control ──
  if (String(topic) == topicControl) {
    const char* action = doc["action"];
    float angle = doc["angle"] | currentAngle;
    int duration = doc["duration"] | 3000;

    if (String(action) == "fire") {
      Serial.println("[TURRET] Firing at angle: " + String(angle));
      turretServo.write((int)constrain(angle, 0, 180));
      currentAngle = angle;
      digitalWrite(PUMP_RELAY_PIN, HIGH);  // Turn pump ON
      delay(duration);
      digitalWrite(PUMP_RELAY_PIN, LOW);   // Turn pump OFF
    } else if (String(action) == "aim") {
      turretServo.write((int)constrain(angle, 0, 180));
      currentAngle = angle;
    } else if (String(action) == "stop") {
      digitalWrite(PUMP_RELAY_PIN, LOW);
    }
  }

  // ── Pump direct control ──
  if (String(topic) == topicPump) {
    const char* action = doc["action"];
    if (String(action) == "on") {
      digitalWrite(PUMP_RELAY_PIN, HIGH);
    } else {
      digitalWrite(PUMP_RELAY_PIN, LOW);
    }
  }
}

// ── MQTT Connect / Reconnect ───────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Connecting...");
    String clientId = "circa-station-" + String(DEVICE_ID);
    bool connected = (strlen(MQTT_USERNAME) > 0)
      ? mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)
      : mqtt.connect(clientId.c_str());

    if (connected) {
      Serial.println(" connected!");
      mqtt.subscribe(topicControl.c_str());
      mqtt.subscribe(topicPump.c_str());
      // Publish online status
      mqtt.publish(topicStatus.c_str(), "{\"value\":1}", true);
    } else {
      Serial.print(" failed, rc=");
      Serial.println(mqtt.state());
      delay(3000);
    }
  }
}

// ── Soil Moisture (0-100%) ─────────────────────────────────────
float readSoilMoisture() {
  int raw = analogRead(SOIL_SENSOR_PIN);
  float pct = map(raw, SOIL_DRY_VALUE, SOIL_WET_VALUE, 0, 100);
  return constrain(pct, 0, 100);
}

// ── Publish sensor readings ────────────────────────────────────
void publishReadings() {
  float humidity    = dht.readHumidity();
  float temperature = dht.readTemperature();
  float soil        = readSoilMoisture();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("[DHT] Read failed, skipping publish");
    return;
  }

  char buf[64];
  snprintf(buf, sizeof(buf), "{\"value\":%.2f}", humidity);
  mqtt.publish(topicHumidity.c_str(), buf);

  snprintf(buf, sizeof(buf), "{\"value\":%.2f}", temperature);
  mqtt.publish(topicTemperature.c_str(), buf);

  snprintf(buf, sizeof(buf), "{\"value\":%.2f}", soil);
  mqtt.publish(topicSoilMoisture.c_str(), buf);

  Serial.printf("[Sensors] H:%.1f%% T:%.1f°C Soil:%.1f%%\n",
                humidity, temperature, soil);
}

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  digitalWrite(PUMP_RELAY_PIN, LOW);

  turretServo.attach(SERVO_PIN);
  turretServo.write(90); // Center position

  dht.begin();
  connectWiFi();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(60);
}

// ── Loop ───────────────────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastPublish >= STATION_PUBLISH_INTERVAL) {
    lastPublish = now;
    publishReadings();
  }
}
