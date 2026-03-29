// ─────────────────────────────────────────────────────────────────────────────
// Circa Sensor Node — ESP-NOW firmware
//
// Communication: ESP-NOW unicast → Base Station MAC
// Sensors:
//   GPIO 35 = DO  (D35 pin label on board)
//   GPIO 36 = AO  (VP pin label on board = GPIO36)
//     ⚠ NOTE: Move AO wire from D19 → D34. GPIO19 is not ADC-capable on ESP32.
//
// Behaviour: always-on loop — read every SLEEP_SECONDS, no deep sleep
// Sensor stays powered for stable AO readings (no warm-up jitter)
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ── Node identity ─────────────────────────────────────────────────────────────
#define NODE_ID  "node-001"

// ── Sensor pins ───────────────────────────────────────────────────────────────
#define SOIL_DO_PIN  35
#define SOIL_AO_PIN  32   // D32 = GPIO32, ADC1_CH4, works with WiFi

// ── Calibration — capacitive: HIGH = dry, LOW = wet ──────────────────────────
#define SOIL_DRY_RAW  4095   // in open air (consistent)
#define SOIL_WET_RAW  3000   // fully wet threshold — readings below this = 100%

// ── Timing ────────────────────────────────────────────────────────────────────
#define SLEEP_SECONDS  30

// ── WiFi channel — must match the base station SoftAP channel ─────────────────
#define WIFI_CHANNEL  1

// ── Base station MAC address ──────────────────────────────────────────────────
// Broadcast — base identifies node by sender MAC in the receive callback.
// More reliable than unicast when base runs SoftAP (no ACK issues).
static uint8_t BASE_ADDR[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

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
  delay(500);  // let resistive sensor output settle after wake
  long sum = 0;
  for (int i = 0; i < 16; i++) {
    sum += analogRead(SOIL_AO_PIN);
    delay(10);
  }
  int raw = (int)(sum / 16);
  Serial.printf("[Node] avg_raw=%d\n", raw);
  // HIGH = dry, LOW = wet
  bool doWet = (digitalRead(SOIL_DO_PIN) == LOW);
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

// ─────────────────────────────────────────────────────────────────────────────
// Setup — runs once, WiFi + ESP-NOW init
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.printf("\n[Node %s] Start\n", NODE_ID);

  pinMode(SOIL_DO_PIN, INPUT);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  delay(100);
  uint8_t ch; wifi_second_chan_t sc;
  esp_wifi_get_channel(&ch, &sc);
  Serial.printf("[WiFi] Channel set to %d (actual=%d)\n", WIFI_CHANNEL, ch);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init failed — rebooting in 5s");
    delay(5000);
    ESP.restart();
    return;
  }
  esp_now_register_send_cb(onSendDone);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BASE_ADDR, 6);
  peer.channel = WIFI_CHANNEL;
  peer.ifidx   = WIFI_IF_STA;
  peer.encrypt = false;
  esp_err_t add_err = esp_now_add_peer(&peer);
  Serial.printf("[ESP-NOW] Peer add err=%d\n", add_err);

  // Let sensor warm up after power-on
  Serial.println("[Node] Sensor warm-up 2s...");
  delay(2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop — read + send every SLEEP_SECONDS, no deep sleep
// ─────────────────────────────────────────────────────────────────────────────

void loop() {
  NodePacket pkt = {};
  strlcpy(pkt.id, NODE_ID, sizeof(pkt.id));
  pkt.soil_pct = readSoilPct();
  int rawAo = analogRead(SOIL_AO_PIN);
  pkt.soil_wet = pkt.soil_pct >= 50.0f;  // wet if moisture >= 50%
  Serial.printf("[Node %s] raw_AO=%d  soil=%.1f%%  wet=%s  DO=%s\n",
    NODE_ID, rawAo, pkt.soil_pct,
    pkt.soil_wet ? "YES" : "NO",
    digitalRead(SOIL_DO_PIN) == LOW ? "LOW(wet)" : "HIGH(dry)");

  sendDone = false; sendOK = false;
  esp_err_t send_err = esp_now_send(BASE_ADDR, (const uint8_t *)&pkt, sizeof(pkt));
  Serial.printf("[ESP-NOW] Send queued err=%d\n", send_err);

  uint32_t t0 = millis();
  while (!sendDone && millis() - t0 < 1000) delay(5);
  Serial.printf("[Node %s] Send %s — next in %ds\n", NODE_ID, sendOK ? "OK" : "FAIL", SLEEP_SECONDS);

  delay(SLEEP_SECONDS * 1000UL);
}
