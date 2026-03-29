// ─────────────────────────────────────────────────────────────────────────────
// Circa Turret Station — HTTP API firmware
//
// Runs as a Wi-Fi SoftAP (SSID: Turret-ESP32, IP: 192.168.4.1)
// Exposes a REST API for direct hardware control from the Circa client
// via the server's hardware proxy route.
//
// Pin assignments:
//   GPIO 32 = Stepper EN  (active LOW)
//   GPIO 26 = Stepper STEP (4 µs HIGH pulse per step)
//   GPIO 27 = Stepper DIR  (HIGH = CW, LOW = CCW)
//   GPIO 14 = Servo PWM   (50 Hz, 500–2400 µs)
//   GPIO 25 = Pump relay  (HIGH = on, LOW = off)
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <math.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ── Pin assignments ───────────────────────────────────────────────────────────
#define EN_PIN    32
#define STEP_PIN  26
#define DIR_PIN   27
#define SERVO_PIN 14
#define PUMP_PIN  25

// ── Stepper config ────────────────────────────────────────────────────────────
#define STEPS_PER_REV  8000
#define SPEED_DEFAULT  350
#define SPEED_MIN      50
#define SPEED_MAX      1200

// ── Servo config ──────────────────────────────────────────────────────────────
#define SERVO_HOME      90
#define SERVO_NEAR_DEG  130
#define SERVO_FAR_DEG   45
#define SERVO_PULSE_MIN 500
#define SERVO_PULSE_MAX 2400

// ── Pump config ───────────────────────────────────────────────────────────────
#define PUMP_MAX_MS 60000

// ── SoftAP ───────────────────────────────────────────────────────────────────
#define AP_SSID "Turret-ESP32"

// ── Objects ───────────────────────────────────────────────────────────────────
Servo      turretServo;
WebServer  server(80);

// ── Stepper state ─────────────────────────────────────────────────────────────
bool          stepperRunning  = false;
bool          stepperCW       = true;
unsigned long stepIntervalUs  = 0;      // microseconds between steps
long          jogStepsLeft    = 0;      // 0 = continuous; >0 = jog countdown
long          currentYawSteps = 0;      // software-tracked yaw (wraps 0–STEPS_PER_REV-1)
unsigned long lastStepMicros  = 0;

// ── Pump state ────────────────────────────────────────────────────────────────
bool          pumpIsOn  = false;
unsigned long pumpOffAt = 0;            // millis() auto-off time; 0 = manual

// ─────────────────────────────────────────────────────────────────────────────
// Hardware helpers
// ─────────────────────────────────────────────────────────────────────────────

void doStep() {
  digitalWrite(STEP_PIN, HIGH);
  delayMicroseconds(4);
  digitalWrite(STEP_PIN, LOW);

  if (stepperCW) currentYawSteps++;
  else           currentYawSteps--;

  // Keep within [0, STEPS_PER_REV)
  currentYawSteps = ((currentYawSteps % STEPS_PER_REV) + STEPS_PER_REV) % STEPS_PER_REV;
}

void startStepper(bool cw, int speed) {
  speed = constrain(speed, SPEED_MIN, SPEED_MAX);
  digitalWrite(DIR_PIN, cw ? HIGH : LOW);
  stepperCW       = cw;
  stepIntervalUs  = 1000000UL / speed;
  jogStepsLeft    = 0;
  stepperRunning  = true;
}

void jogStepper(bool cw, int speed, long steps) {
  if (steps <= 0) return;
  speed = constrain(speed, SPEED_MIN, SPEED_MAX);
  digitalWrite(DIR_PIN, cw ? HIGH : LOW);
  stepperCW      = cw;
  stepIntervalUs = 1000000UL / speed;
  jogStepsLeft   = steps;
  stepperRunning = true;
}

void stopStepper() {
  stepperRunning = false;
  jogStepsLeft   = 0;
}

void setServo(int angle) {
  turretServo.write(constrain(angle, 0, 180));
}

void setPump(bool on) {
  pumpIsOn = on;
  digitalWrite(PUMP_PIN, on ? HIGH : LOW);
  if (!on) pumpOffAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS helper — call before every server.send()
// Allows the phone browser to call this API directly (cross-origin)
// ─────────────────────────────────────────────────────────────────────────────

void addCORS() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP route handlers
// ─────────────────────────────────────────────────────────────────────────────

void handleRoot() {
  addCORS();
  server.send(200, "application/json",
    "{\"device\":\"Circa Turret\",\"version\":\"2.0.0\","
    "\"yaw_steps\":" + String(currentYawSteps) + ","
    "\"pump\":" + String(pumpIsOn ? "true" : "false") + "}");
}

void handleServo() {
  addCORS();
  if (!server.hasArg("angle")) {
    server.send(400, "application/json", "{\"error\":\"angle required\"}");
    return;
  }
  int angle = server.arg("angle").toInt();
  setServo(angle);
  Serial.printf("[Servo] → %d°\n", constrain(angle, 0, 180));
  server.send(200, "application/json",
    "{\"ok\":true,\"angle\":" + String(constrain(angle, 0, 180)) + "}");
}

void handleStepperStart() {
  addCORS();
  String dir  = server.arg("dir");
  int    speed = server.hasArg("speed") ? server.arg("speed").toInt() : SPEED_DEFAULT;
  bool   cw    = (dir != "ccw");
  startStepper(cw, speed);
  Serial.printf("[Stepper] Start %s @ %d steps/s\n", cw ? "CW" : "CCW", speed);
  server.send(200, "application/json",
    "{\"ok\":true,\"dir\":\"" + String(cw ? "cw" : "ccw") + "\",\"speed\":" + String(speed) + "}");
}

void handleStepperJog() {
  addCORS();
  String dir   = server.arg("dir");
  int    speed = server.hasArg("speed") ? server.arg("speed").toInt() : SPEED_DEFAULT;
  long   steps = server.hasArg("steps") ? server.arg("steps").toInt() : 100;
  bool   cw    = (dir != "ccw");
  jogStepper(cw, speed, steps);
  Serial.printf("[Stepper] Jog %s %ld steps @ %d steps/s\n",
                cw ? "CW" : "CCW", steps, speed);
  server.send(200, "application/json",
    "{\"ok\":true,\"dir\":\"" + String(cw ? "cw" : "ccw") +
    "\",\"speed\":" + String(speed) + ",\"steps\":" + String(steps) + "}");
}

void handleStepperStop() {
  addCORS();
  stopStepper();
  Serial.println("[Stepper] Stop");
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleAim() {
  addCORS();
  if (!server.hasArg("x") || !server.hasArg("y")) {
    server.send(400, "application/json", "{\"error\":\"x and y required\"}");
    return;
  }

  float x     = server.arg("x").toFloat();
  float y     = server.arg("y").toFloat();
  int   speed = server.hasArg("speed") ? server.arg("speed").toInt() : SPEED_DEFAULT;
  speed = constrain(speed, SPEED_MIN, SPEED_MAX);

  // Clamp to unit circle
  float radius = sqrtf(x * x + y * y);
  if (radius > 1.0f) { x /= radius; y /= radius; radius = 1.0f; }
  if (radius < 0.001f) radius = 0.0f;

  // Yaw: atan2(-y, x) → 0–360°  (y is screen-down-positive, ESP32 flips it)
  float yawDeg = atan2f(-y, x) * 180.0f / (float)M_PI;
  if (yawDeg < 0) yawDeg += 360.0f;

  // Convert target yaw to steps and find shortest path
  long targetSteps = (long)(yawDeg / 360.0f * STEPS_PER_REV);
  long diff        = targetSteps - currentYawSteps;
  while (diff >  STEPS_PER_REV / 2) diff -= STEPS_PER_REV;
  while (diff < -STEPS_PER_REV / 2) diff += STEPS_PER_REV;

  if (diff != 0) {
    jogStepper(diff > 0, speed, abs(diff));
  }

  // Pitch: lerp SERVO_NEAR_DEG → SERVO_FAR_DEG over radius 0 → 1
  int pitch = (int)(SERVO_NEAR_DEG + (SERVO_FAR_DEG - SERVO_NEAR_DEG) * radius);
  setServo(pitch);

  Serial.printf("[Aim] x=%.3f y=%.3f → yaw=%.1f° pitch=%d° diff=%ld steps\n",
                x, y, yawDeg, pitch, diff);

  server.send(200, "application/json",
    "{\"ok\":true,\"yaw\":" + String(yawDeg, 1) +
    ",\"pitch\":" + String(pitch) +
    ",\"radius\":" + String(radius, 3) +
    ",\"steps\":" + String(abs(diff)) + "}");
}

void handlePumpOn() {
  addCORS();
  long durationMs = server.hasArg("duration") ? server.arg("duration").toInt() : 0;
  if (durationMs > 0) {
    durationMs = constrain(durationMs, 1, PUMP_MAX_MS);
    pumpOffAt  = millis() + durationMs;
  } else {
    pumpOffAt = 0;
  }
  setPump(true);
  Serial.printf("[Pump] ON%s\n", durationMs > 0 ? (" for " + String(durationMs) + " ms").c_str() : "");
  server.send(200, "application/json", "{\"ok\":true,\"pump\":\"on\"}");
}

void handlePumpOff() {
  addCORS();
  setPump(false);
  Serial.println("[Pump] OFF");
  server.send(200, "application/json", "{\"ok\":true,\"pump\":\"off\"}");
}

void handleNotFound() {
  addCORS();
  server.send(404, "application/json", "{\"error\":\"not found\",\"path\":\"" + server.uri() + "\"}");
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  // Disable brownout detector
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.println("\n[Turret] Booting...");

  // Stepper
  pinMode(EN_PIN,   OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN,  OUTPUT);
  digitalWrite(EN_PIN,   LOW);   // Enable stepper driver (active LOW)
  digitalWrite(STEP_PIN, LOW);
  digitalWrite(DIR_PIN,  HIGH);  // Default CW

  // Pump
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);   // Pump off at boot

  // Servo
  ESP32PWM::allocateTimer(0);
  turretServo.setPeriodHertz(50);
  turretServo.attach(SERVO_PIN, SERVO_PULSE_MIN, SERVO_PULSE_MAX);
  turretServo.write(SERVO_HOME);
  Serial.printf("[Servo] Home → %d°\n", SERVO_HOME);

  // SoftAP
  WiFi.softAP(AP_SSID);
  Serial.print("[WiFi] AP \"" AP_SSID "\" started — IP: ");
  Serial.println(WiFi.softAPIP());

  // HTTP routes
  server.on("/",                  HTTP_GET,     handleRoot);
  server.on("/api/servo",         HTTP_GET,     handleServo);
  server.on("/api/stepper/start", HTTP_GET,     handleStepperStart);
  server.on("/api/stepper/jog",   HTTP_GET,     handleStepperJog);
  server.on("/api/stepper/stop",  HTTP_GET,     handleStepperStop);
  server.on("/api/aim",           HTTP_GET,     handleAim);
  server.on("/api/pump/on",       HTTP_GET,     handlePumpOn);
  server.on("/api/pump/off",      HTTP_GET,     handlePumpOff);
  // CORS preflight — browsers send OPTIONS before cross-origin GET
  server.on("/",                  HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/servo",         HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/stepper/start", HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/stepper/jog",   HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/stepper/stop",  HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/aim",           HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/pump/on",       HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.on("/api/pump/off",      HTTP_OPTIONS, [](){ addCORS(); server.send(204); });
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("[HTTP] Server started on port 80");
  Serial.println("[Turret] Ready — connect to \"" AP_SSID "\"");
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop
// ─────────────────────────────────────────────────────────────────────────────

void loop() {
  server.handleClient();

  // Non-blocking stepper pulse generation
  if (stepperRunning && stepIntervalUs > 0) {
    unsigned long now = micros();
    if (now - lastStepMicros >= stepIntervalUs) {
      lastStepMicros = now;
      doStep();

      if (jogStepsLeft > 0) {
        jogStepsLeft--;
        if (jogStepsLeft == 0) {
          stepperRunning = false;
          Serial.println("[Stepper] Jog complete");
        }
      }
    }
  }

  // Timed pump auto-off
  if (pumpIsOn && pumpOffAt > 0 && millis() >= pumpOffAt) {
    setPump(false);
    Serial.println("[Pump] Auto-off");
  }
}
