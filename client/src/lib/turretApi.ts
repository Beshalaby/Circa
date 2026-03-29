// ── Hardware constants (matches ESP32 firmware spec) ──────────────────────────
export const STEPS_PER_REV   = 8000;
export const SPEED_DEFAULT   = 350;
export const SPEED_MIN       = 50;
export const SPEED_MAX       = 1200;
export const SERVO_HOME      = 90;
export const SERVO_NEAR      = 130;
export const SERVO_FAR       = 45;
export const SERVO_MIN       = 0;
export const SERVO_MAX       = 180;
export const PUMP_MAX_MS     = 60_000;

export type StepperDir = 'cw' | 'ccw';

export interface HardwareResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * Client for the ESP32 turret HTTP API.
 *
 * Two modes:
 *  - Proxy mode (default): routes through the Circa server's proxy endpoint so
 *    the browser never makes a cross-origin request. Use when the Mac is on the
 *    same network as the ESP32 and the server can reach it.
 *  - Direct mode: calls the ESP32 URL directly from the browser. Use when the
 *    phone is connected to Turret-ESP32 Wi-Fi — the ESP32 serves CORS headers
 *    so the browser can reach it without any proxy.
 */
export class TurretApiClient {
  private proxyBase: string;
  private hardwareUrl: string;
  private direct: boolean;

  /**
   * @param hardwareUrl  Base URL of the ESP32, e.g. "http://192.168.4.1"
   * @param proxyBase    Base URL of the Circa server, e.g. "http://localhost:3001"
   * @param direct       If true, call ESP32 directly (no proxy). Use on phone.
   */
  constructor(hardwareUrl: string, proxyBase: string, direct = false) {
    this.hardwareUrl = hardwareUrl.replace(/\/$/, '');
    this.proxyBase   = proxyBase.replace(/\/$/, '');
    this.direct      = direct;
  }

  private async call(path: string, params: Record<string, string | number> = {}): Promise<HardwareResult> {
    const esp32Url = new URL(this.hardwareUrl + path);
    for (const [k, v] of Object.entries(params)) {
      esp32Url.searchParams.set(k, String(v));
    }

    let fetchUrl: string;
    if (this.direct) {
      // Phone on Turret-ESP32 Wi-Fi — call ESP32 directly (CORS headers present)
      fetchUrl = esp32Url.toString();
    } else {
      // Mac on eduroam — route through server proxy to avoid CORS
      const proxyUrl = new URL(`${this.proxyBase}/api/control/hardware/proxy`);
      proxyUrl.searchParams.set('target', esp32Url.toString());
      fetchUrl = proxyUrl.toString();
    }

    try {
      const res = await fetch(fetchUrl);
      const body = await res.text();
      return { ok: res.ok, status: res.status, body };
    } catch (err: any) {
      return { ok: false, status: 0, body: err?.message ?? 'Network error' };
    }
  }

  /** Check reachability — GETs the root of the ESP32 web server. */
  ping(): Promise<HardwareResult> {
    return this.call('/');
  }

  /** Set servo pitch angle (0–180°). */
  setServo(angle: number): Promise<HardwareResult> {
    return this.call('/api/servo', { angle: Math.round(angle) });
  }

  /** Start continuous stepper rotation. */
  startStepper(dir: StepperDir, speed: number = SPEED_DEFAULT): Promise<HardwareResult> {
    return this.call('/api/stepper/start', { dir, speed: Math.round(speed) });
  }

  /** Rotate exactly N steps then stop. */
  jogStepper(dir: StepperDir, speed: number = SPEED_DEFAULT, steps: number = 100): Promise<HardwareResult> {
    return this.call('/api/stepper/jog', { dir, speed: Math.round(speed), steps: Math.round(steps) });
  }

  /** Stop all stepper motion immediately. */
  stopStepper(): Promise<HardwareResult> {
    return this.call('/api/stepper/stop');
  }

  /**
   * Aim using normalised joystick coordinates (−1.0 to 1.0).
   * The ESP32 converts x/y → yaw + pitch internally.
   */
  aim(x: number, y: number, speed: number = SPEED_DEFAULT): Promise<HardwareResult> {
    return this.call('/api/aim', { x: x.toFixed(4), y: y.toFixed(4), speed: Math.round(speed) });
  }

  /** Turn pump relay on (stays on until pumpOff is called). */
  pumpOn(): Promise<HardwareResult> {
    return this.call('/api/pump/on');
  }

  /** Turn pump relay off. */
  pumpOff(): Promise<HardwareResult> {
    return this.call('/api/pump/off');
  }
}
