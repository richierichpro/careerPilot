import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import Onboarding from "./pages/Onboarding";
import Applications from "./pages/Applications";

export default function App() {
  return (
    <div className="app-shell">
      <nav className="topnav">
        <span className="brand">CareerPilot</span>
        <div className="nav-links">
          <NavLink to="/onboarding" className={({ isActive }) => (isActive ? "active" : "")}>
            Profile
          </NavLink>
          <NavLink to="/applications" className={({ isActive }) => (isActive ? "active" : "")}>
            Applications
          </NavLink>
        </div>
      </nav>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/onboarding" replace />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/applications" element={<Applications />} />
        </Routes>
      </main>
    </div>
  );
}
