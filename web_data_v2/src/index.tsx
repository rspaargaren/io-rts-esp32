import { render } from "preact";
import { LocationProvider, Route, Router } from "preact-iso";

import { Header } from "./components/Header.tsx";
import { Footer } from "./components/Footer.tsx";
import { Devices } from "./pages/devices.tsx";
import { NotFound } from "./pages/_404.tsx";
import "./style.css";
import { Log } from "./pages/log";
import { Settings } from "./pages/settings";

export function App() {
  return (
    <LocationProvider>
      <Header />
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
  );
}

render(<App />, document.getElementById("app")!);
