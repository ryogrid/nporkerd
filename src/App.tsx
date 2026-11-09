// Route switching per design/07 §1: state-based router keyed by the URL path
// (real paths like /room/:id work on reload because the static host falls back
// to index.html). The concrete pages (Register/Login/Lobby/Room) are built in
// Phase 7; for now this placeholder confirms the shell is live.
export function App() {
  return <div className="nporkerd-app">nporkerd shell online — pages arrive in Phase 7.</div>;
}
