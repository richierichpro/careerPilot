import { NavLink, Navigate, Outlet, Route, Routes } from "react-router-dom";
import Onboarding from "./pages/Onboarding";
import Applications from "./pages/Applications";
import DemoJobApplication from "./pages/demo/DemoJobApplication";

function CareerPilotShell() {
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
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<CareerPilotShell />}>
        <Route path="/" element={<Navigate to="/onboarding" replace />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/applications" element={<Applications />} />
      </Route>
      {/* Demo job application: a fictional company's careers page, rendered
          standalone (no CareerPilot chrome) since it stands in for a real
          third-party site the extension operates on. */}
      <Route path="/demo/northwind-backend-engineer" element={<DemoJobApplication />} />
    </Routes>
  );
}
