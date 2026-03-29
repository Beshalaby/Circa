import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { connectSocket } from './lib/socket';
import AppShell from './components/AppShell';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import ConfigurePage from './pages/ConfigurePage';
import ControlPage from './pages/ControlPage';
import PredictionPage from './pages/PredictionPage';
import './App.css';

export default function App() {
  useEffect(() => {
    connectSocket();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/configure" element={<ConfigurePage />} />
          <Route path="/pair"      element={<Navigate to="/configure" replace />} />
          <Route path="/control"   element={<ControlPage />} />
          <Route path="/prediction" element={<PredictionPage />} />
          <Route path="*"          element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
