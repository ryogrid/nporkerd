// Landing screen for visitors without a session.
import { Card } from "../components/Card";
import { Chip } from "../components/Chips";
import { Navigate } from "../lib/router";

export function HomePage({ navigate, expired, invited }: { navigate: Navigate; expired: boolean; invited: boolean }) {
  return (
    <div className="landing">
      <div>
        <h1>
          Texas Hold'em,<br /><em>with friends</em>, in your browser.
        </h1>
        <p>
          Open a table, share the link, and play live no-limit hold'em with play-money chips.
          No downloads, no email, no passwords — your account is a private key you keep.
        </p>
        {invited ? (
          <p className="badge badge-gold" style={{ fontSize: 14, padding: "6px 12px" }}>♠ You've been invited to a table — sign in to take a seat.</p>
        ) : null}
        {expired ? (
          <p className="error-text" style={{ fontSize: 15 }}>Your session expired — log in again to continue.</p>
        ) : null}
        <div className="row">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate("/register")}>
            Create a free account
          </button>
          <button type="button" className="btn btn-lg" onClick={() => navigate("/login")}>
            I have a key
          </button>
        </div>
        <p className="faint" style={{ marginTop: 18 }}>Every new player starts with 10,000 chips.</p>
      </div>
      <div className="landing-cards" aria-hidden="true">
        <Card card={12} anim="deal" />
        <Card card={13 + 12} anim="deal" delayMs={120} />
        <Card card={26 + 11} anim="deal" delayMs={240} />
        <div className="landing-chips">
          <Chip color="c-red" large /><Chip color="c-black" large /><Chip color="c-gold" large /><Chip color="c-blue" large />
        </div>
      </div>
    </div>
  );
}
