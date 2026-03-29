import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CircaLogo from '../components/CircaLogo';
import './LandingPage.css';

// ── ASCII characters for the field ──────────────────────────
const CHARS = '·∿~=+−|/\\.:,;!?@#$%^&*()[]{}01<>≈≡∂∑∏√±×÷∞∠∆∇⊕⊗◦●○◆◇▲△▷▻';

function buildGrid(cols: number, rows: number): string[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => CHARS[Math.floor(Math.random() * CHARS.length)])
  );
}

// ── Animated ASCII canvas ────────────────────────────────────
function AsciiField() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gridRef   = useRef<string[][]>([]);
  const frameRef  = useRef<number>(0);
  const [, forceUpdate] = useState(0);

  const CHAR_W = 11;
  const CHAR_H = 18;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    function sizeGrid() {
      // Never wider than the container (nowrap rows) — avoids document horizontal scroll
      const w = el.clientWidth;
      const h = el.clientHeight;
      const cols = Math.max(1, Math.floor(w / CHAR_W));
      const rows = Math.max(1, Math.floor(h / CHAR_H) + 1);
      gridRef.current = buildGrid(cols, rows);
      forceUpdate((n: number) => n + 1);
    }

    sizeGrid();
    const ro = new ResizeObserver(() => sizeGrid());
    ro.observe(el);

    let frame = 0;
    function animate() {
      frame++;
      if (frame % 8 === 0 && gridRef.current.length > 0) {
        gridRef.current = gridRef.current.map((row) =>
          row.map((c) =>
            Math.random() < 0.015
              ? CHARS[Math.floor(Math.random() * CHARS.length)]
              : c
          )
        );
        forceUpdate((n: number) => n + 1);
      }
      frameRef.current = requestAnimationFrame(animate);
    }
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const grid = gridRef.current;

  return (
    <div ref={canvasRef} className="ascii-field" aria-hidden="true">
      {grid.map((row, ri) => (
        <div key={ri} className="ascii-row">
          {row.map((ch, ci) => (
            <span key={ci} className="ascii-char">{ch}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Main landing page ────────────────────────────────────────
export default function LandingPage() {
  const navigate = useNavigate();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = time.toLocaleTimeString('en-GB', { hour12: false });
  const dateStr = time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const enter = () => navigate('/dashboard');

  return (
    <div className="landing">

      {/* ── Header bar ── */}
      <header className="landing-header">
        <div className="landing-brand">
          <CircaLogo className="landing-logo-name" />
        </div>
        <nav className="landing-nav">
          <span className="landing-time mono">{timeStr} UTC{time.getTimezoneOffset() <= 0 ? '+' : ''}{-(time.getTimezoneOffset() / 60)}</span>
        </nav>
      </header>

      {/* ── ASCII backdrop ── */}
      <AsciiField />

      {/* ── Gradient fade so headline is readable ── */}
      <div className="landing-fade" />

      {/* ── Main content (bottom-left editorial layout) ── */}
      <main className="landing-content">

        {/* Headline block */}
        <div className="landing-headline-block">
          <h1 className="landing-headline">
            <span className="landing-headline-line">Precision</span>
            <span className="landing-headline-line">Irrigation &amp;</span>
            <span className="landing-headline-line landing-headline-accent">Field Intelligence.</span>
          </h1>
        </div>

        {/* Info row */}
        <div className="landing-info-row">
          <div className="landing-info-left">
            <p className="landing-meta mono">CIRCA AGRI-TECH · {dateStr}</p>
            <p className="landing-desc">
              Real-time monitoring and precision irrigation control<br />
              for ESP32-based turret systems across your field.
            </p>
          </div>

          <div className="landing-info-links">
            <button id="landing-enter" className="landing-link-btn active" onClick={enter}>
              Enter Dashboard →
            </button>
            <a className="landing-link-btn" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <a className="landing-link-btn" href="#firmware">Firmware</a>
            <a className="landing-link-btn" href="#docs">Docs</a>
          </div>
        </div>

      </main>

    </div>
  );
}
