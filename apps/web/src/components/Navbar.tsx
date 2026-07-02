import { Link, NavLink } from "react-router-dom";
import type { MeDto } from "@asst3d/shared";

interface Props {
  me: MeDto | null;
}

export function Navbar({ me }: Props) {
  return (
    <header className="nav">
      <Link to="/" className="nav-logo">
        <span className="nav-logo-mark">▲</span> ASST 3D
      </Link>
      <nav className="nav-links">
        <NavLink to="/" end>
          Comunidad
        </NavLink>
        <NavLink to="/workspace">Workspace</NavLink>
      </nav>
      <div className="nav-right">
        {me && !me.capacityOk && (
          <span className="pill pill-warn" title="La app llegó a su tope de generación de este mes">
            Capacidad completa
          </span>
        )}
        {me && (
          <span
            className="pill"
            title="Generaciones gratis restantes en este dispositivo"
          >
            ⚡ {me.hasTokenAccess ? "∞" : `${me.freeRemaining}/${me.freeLimit}`} gratis
          </span>
        )}
        <Link to="/workspace" className="btn-primary nav-cta">
          Workspace
        </Link>
        <span className="avatar-dot big" title={me ? `guest ${me.deviceId.slice(0, 6)}` : "guest"}>
          G
        </span>
      </div>
    </header>
  );
}
