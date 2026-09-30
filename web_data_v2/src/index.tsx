import { render } from "preact";
import { LocationProvider, Route, Router } from "preact-iso";

import { Header } from "./components/Header.tsx";
import { Footer } from "./components/Footer.tsx";
import { Devices } from "./pages/devices.tsx";
import { NotFound } from "./pages/_404.tsx";
import "./style.css";
import { Log } from "./pages/log";
import { Settings } from "./pages/settings";
import { FirmwareUpdater } from "./components/FirmwareUpdater";
import { ToastProvider } from "./components/ToastProvider";

export function App() {
  return (
    <ToastProvider>
      <LocationProvider>
        <Header />
        <FirmwareUpdater />
        <main>
          <Router>
            <Route path="/" component={Devices} />
            <Route path="/log" component={Log} />
            <Route path="/settings" component={Settings} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <Footer />
      </LocationProvider>
    </ToastProvider>
  );
}

render(<App />, document.getElementById("app")!);
