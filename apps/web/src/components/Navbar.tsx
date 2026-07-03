import { Link, NavLink } from "react-router-dom";
import type { MeDto } from "@asst3d/shared";

interface Props {
  me: MeDto | null;
}

export function Navbar({ me }: Props) {
  return (
    <>
      <header className="nav">
        <Link to="/" className="nav-logo">
          <img src="/logo.png" alt="" className="nav-logo-img" /> Formora
        </Link>
        <nav className="nav-links">
          <NavLink to="/" end>
            Community
          </NavLink>
          <NavLink to="/workspace">Workspace</NavLink>
          <a href="#api" title="Coming soon" onClick={(e) => e.preventDefault()}>
            API
          </a>
          <a href="#resources" title="Coming soon" onClick={(e) => e.preventDefault()}>
            Resources
          </a>
        </nav>
        <div className="nav-right">
          {me && !me.capacityOk && (
            <span className="pill pill-warn" title="The app hit its monthly generation cap">
              Capacity reached
            </span>
          )}
          {me && (
            <span className="pill" title="Free generations left on this device">
              ⚡ {me.hasTokenAccess ? "∞" : `${me.freeRemaining}/${me.freeLimit}`} free
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
      <div className="promo-strip">
        <span>
          Unlimited generations, private exports & priority queue — arriving with{" "}
          <strong>token access</strong>.
        </span>
        <button className="btn-mini" disabled title="Payments are not enabled yet">
          🔑 Soon
        </button>
      </div>
    </>
  );
}
