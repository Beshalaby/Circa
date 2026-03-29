import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { IconType } from 'react-icons';
import { FiGrid, FiSettings, FiSliders, FiTrendingUp } from 'react-icons/fi';
import CircaLogo from './CircaLogo';
import './AppShell.css';

const NAV = [
  { to: '/dashboard', icon: FiGrid,     label: 'Dashboard' },
  { to: '/configure', icon: FiSettings, label: 'Configure' },
  { to: '/control',   icon: FiSliders,    label: 'Control' },
  { to: '/prediction', icon: FiTrendingUp, label: 'Prediction' },
] satisfies Array<{ to: string; icon: IconType; label: string }>;

export default function AppShell() {
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
              <span className="sidebar-icon" aria-hidden="true"><item.icon /></span>
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </div>


      </nav>

      {/* ── Main ── */}
      <div className="main-content">
        <header className="top-bar">
          <span className="top-bar-title">{activeLabel}</span>
          <div className="top-bar-right" />
        </header>
        <div className="page-content fade-in">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
