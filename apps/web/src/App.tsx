import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
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
      <footer className="footer muted small">
        ASST 3D — generación de modelos 3D con IA para game-devs
      </footer>
    </>
  );
}
