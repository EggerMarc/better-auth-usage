import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createUsageTracker } from "@eggermarc/better-auth-usage/client";

// Landing = ~1:1 of how you'd use the plugin. The tracker discovers the
// server's realtime WS (Durable Object) and falls back to polling.
//
// Wrong. Use env from actual env
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";
const tracker = createUsageTracker({ baseURL: `${SERVER_URL}/api/auth` });

function App() {
  // TODO: flesh out with TanStack Router routes (landing + live example),
  // Use example from examples/react to build this page.
  // using `tracker.track({ referenceId, features })` + the React hooks from
  // "@eggermarc/better-auth-usage/react". See ref/apps/web for the full scaffold.
  return (
    <main style={{ fontFamily: "system-ui", padding: 48 }}>
      <h1>better-auth-usage</h1>
      <p>Cloudflare-native usage metering for better-auth.</p>
      <p>Server: {SERVER_URL}</p>
    </main>
  );
}

void tracker;
createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
