import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useFieldStore } from '../lib/socket';
import CircaLogo from './CircaLogo';
import './AppShell.css';

const NAV = [
  { to: '/dashboard', icon: '⊞', label: 'Dashboard' },
  { to: '/field',     icon: '◈', label: 'Field' },
  { to: '/configure', icon: '⊕', label: 'Configure' },
  { to: '/control',   icon: '⊡', label: 'Control' },
];

export default function AppShell() {
  const connected = useFieldStore((s) => s.connected);
  const location = useLocation();

  const activeLabel = NAV.find((n) => location.pathname.startsWith(n.to))?.label ?? '';

  return (
    <div className="app-shell">
      {/* ── Sidebar (editorial rail — matches landing) ── */}
      <nav className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <CircaLogo className="sidebar-wordmark" />
        </div>

        <div className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
            >
              <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="sidebar-footer">
          <div
            className={`sidebar-live ${connected ? 'online' : 'offline'}`}
            title={connected ? 'Socket connected' : 'Disconnected'}
          >
            <span className="sidebar-live-dot" />
            <span className="sidebar-live-label mono">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="main-content">
        <header className="top-bar">
          <span className="top-bar-title">{activeLabel}</span>
          <div className="top-bar-right">
            <div className={`conn-pill ${connected ? 'online' : 'offline'}`}>
              <span className="dot" />
              {connected ? 'Live' : 'Offline'}
            </div>
          </div>
        </header>
        <div className="page-content fade-in">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
