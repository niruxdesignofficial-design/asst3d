import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import type { MeDto } from "@asst3d/shared";
import { getMe } from "./lib/api";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { Workspace } from "./pages/Workspace";

export default function App() {
  const [me, setMe] = useState<MeDto | null>(null);

  const refreshMe = useCallback(() => {
    getMe().then(setMe).catch(() => {});
  }, []);

  useEffect(refreshMe, [refreshMe]);

  return (
    <>
      <Navbar me={me} />
      <Routes>
        <Route path="/" element={<Home me={me} refreshMe={refreshMe} />} />
        <Route path="/workspace" element={<Workspace me={me} refreshMe={refreshMe} />} />
      </Routes>

      <footer className="footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="nav-logo">
              <img src="/logo.png" alt="" className="nav-logo-img" /> Formora
            </div>
            <p className="muted small">
              AI 3D model generation for game developers. Describe it, preview it, ship it.
            </p>
            <span className="footer-status">
              <span className="status-dot" /> All systems operational
            </span>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <Link to="/workspace">Text to 3D</Link>
            <Link to="/workspace">Image to 3D</Link>
            <Link to="/">Community gallery</Link>
          </div>
          <div className="footer-col">
            <h4>Export</h4>
            <span>GLB / GLTF</span>
            <span>FBX</span>
            <span>OBJ · USDZ</span>
          </div>
          <div className="footer-col">
            <h4>Access</h4>
            <span>3 free generations</span>
            <span>Token access — soon</span>
            <span>API — soon</span>
          </div>
          <div className="footer-col">
            <h4>Community</h4>
            <a href="https://x.com/Formora_3D" target="_blank" rel="noopener noreferrer">
              𝕏 @Formora_3D
            </a>
            <Link to="/">Public gallery</Link>
          </div>
        </div>
        <div className="footer-legal muted small">
          © {new Date().getFullYear()} Formora · Sample gallery models from the Khronos glTF
          Sample Assets (CC0 / CC BY 4.0)
        </div>
      </footer>
    </>
  );
}
