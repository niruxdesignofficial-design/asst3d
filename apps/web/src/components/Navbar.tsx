import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import type { MeDto } from "@asst3d/shared";

interface Props {
  me: MeDto | null;
}

export function Navbar({ me }: Props) {
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropOpen) return;
    const close = (e: MouseEvent) => {
      if (!dropRef.current?.contains(e.target as Node)) setDropOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [dropOpen]);

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
          <div className="nav-drop" ref={dropRef}>
            <button className="nav-drop-btn" onClick={() => setDropOpen((o) => !o)}>
              Resources {dropOpen ? "▴" : "▾"}
            </button>
            {dropOpen && (
              <div className="nav-drop-menu">
                <Link to="/" onClick={() => setDropOpen(false)}>
                  Community gallery
                  <small>Browse every public creation</small>
                </Link>
                <Link to="/workspace" onClick={() => setDropOpen(false)}>
                  Style presets
                  <small>Low-poly · Realistic · Stylized · Pixel 3D</small>
                </Link>
                <span className="drop-soon">
                  Developer API
                  <small>Programmatic generation — coming soon</small>
                </span>
                <span className="drop-soon">
                  Docs & guides
                  <small>Engine import walkthroughs — coming soon</small>
                </span>
              </div>
            )}
          </div>
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
