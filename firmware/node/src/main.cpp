// ─────────────────────────────────────────────────────────────────────────────
// Circa Sensor Node — ESP-NOW firmware
//
// Communication: ESP-NOW unicast → Base Station MAC
// Sensors:
//   GPIO 18 = DO  (digital threshold; LOW = wet, HIGH = dry)
//   GPIO 34 = AO  (analog moisture reading)
//     ⚠ NOTE: Move AO wire from D19 → D34. GPIO19 is not ADC-capable on ESP32.
//
// Behaviour: wake → read → send → deep-sleep (SLEEP_SECONDS)
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ── Node identity ─────────────────────────────────────────────────────────────
#define NODE_ID  "node-001"

// ── Sensor pins ───────────────────────────────────────────────────────────────
#define SOIL_DO_PIN  18
#define SOIL_AO_PIN  34

// ── Calibration ───────────────────────────────────────────────────────────────
#define SOIL_DRY_RAW  3200
#define SOIL_WET_RAW  1500

// ── Timing ────────────────────────────────────────────────────────────────────
#define SLEEP_SECONDS  30

// ── WiFi channel — must match the base station SoftAP channel ─────────────────
#define WIFI_CHANNEL  1

// ── Base station MAC address ──────────────────────────────────────────────────
// Printed during base station flash: "MAC: a4:f0:0f:91:2a:e4"
// Unicast is used because broadcast is unreliable when base is in AP mode.
static uint8_t BASE_ADDR[6] = { 0xa4, 0xf0, 0x0f, 0x91, 0x2a, 0xe4 };

// ─────────────────────────────────────────────────────────────────────────────
// Packet — must match NodePacket in base station main.cpp exactly
// ─────────────────────────────────────────────────────────────────────────────
typedef struct __attribute__((packed)) {
  char  id[16];
  float soil_pct;
  bool  soil_wet;
} NodePacket;

static volatile bool sendDone = false;
static volatile bool sendOK   = false;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

float readSoilPct() {
  int raw = analogRead(SOIL_AO_PIN);
  float pct = (float)(SOIL_DRY_RAW - raw) / (float)(SOIL_DRY_RAW - SOIL_WET_RAW) * 100.0f;
  return constrain(pct, 0.0f, 100.0f);
}

void IRAM_ATTR onSendDone(const uint8_t *mac, esp_now_send_status_t status) {
  sendOK   = (status == ESP_NOW_SEND_SUCCESS);
  sendDone = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup — runs once per wake cycle, then deep-sleeps
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.printf("\n[Node %s] Wake\n", NODE_ID);

  pinMode(SOIL_DO_PIN, INPUT);

  // WiFi STA mode, no connection, lock to channel 1 to match base AP
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  delay(100);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init failed — sleeping");
    esp_deep_sleep(SLEEP_SECONDS * 1000000ULL);
    return;
  }
  esp_now_register_send_cb(onSendDone);

  // Register base station as unicast peer
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BASE_ADDR, 6);
  peer.channel = WIFI_CHANNEL;
  peer.ifidx   = WIFI_IF_STA;
  peer.encrypt = false;
  esp_err_t add_err = esp_now_add_peer(&peer);
  Serial.printf("[ESP-NOW] Peer add err=%d\n", add_err);

  // Read sensors
  NodePacket pkt = {};
  strlcpy(pkt.id, NODE_ID, sizeof(pkt.id));
  pkt.soil_pct = readSoilPct();
  pkt.soil_wet = (digitalRead(SOIL_DO_PIN) == LOW);
  Serial.printf("[Node %s] soil=%.1f%%  wet=%s\n", NODE_ID, pkt.soil_pct, pkt.soil_wet ? "YES" : "NO");

  // Send unicast to base
  esp_err_t send_err = esp_now_send(BASE_ADDR, (const uint8_t *)&pkt, sizeof(pkt));
  Serial.printf("[ESP-NOW] Send queued err=%d\n", send_err);

  // Wait for callback
  uint32_t t0 = millis();
  while (!sendDone && millis() - t0 < 1000) delay(5);
  Serial.printf("[Node %s] Send %s — sleeping %ds\n", NODE_ID, sendOK ? "OK" : "FAIL", SLEEP_SECONDS);

  delay(50);
  esp_deep_sleep(SLEEP_SECONDS * 1000000ULL);
}

void loop() {}
