"use client";

import "@/lib/amplify"; // configures Amplify before anything renders
import { useCallback, useEffect, useState } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchUserAttributes } from "aws-amplify/auth";
import { Lobby } from "@/components/Lobby";
import { GameRoom } from "@/components/GameRoom";
import { RulesDialog } from "@/components/RulesDialog";

const formFields = {
  signUp: {
    preferred_username: {
      label: "Player name",
      placeholder: "Shown to other players",
      isRequired: true,
      order: 1,
    },
    email: { order: 2 },
    password: { order: 3 },
    confirm_password: { order: 4 },
  },
};

export default function Home() {
  return (
    <main className="auth-shell">
      <Authenticator
        signUpAttributes={["preferred_username"]}
        formFields={formFields}
        components={{
          Header: () => (
            <div className="auth-header">
              <h1>Rent Rush</h1>
              <p className="muted">Sign in to join the lobby. 2-4 players, real-time.</p>
            </div>
          ),
        }}
      >
        {({ user, signOut }) => <App userId={user?.userId ?? ""} signOut={() => signOut?.()} />}
      </Authenticator>
    </main>
  );
}

/** The game id lives in the URL hash so a refresh (or a shared link) reopens the game. */
function readHash(): string | null {
  const m = /^#game=([\w-]+)$/.exec(window.location.hash);
  return m ? m[1] : null;
}

function App({ userId, signOut }: { userId: string; signOut: () => void }) {
  const [name, setName] = useState<string>("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    fetchUserAttributes()
      .then((a) => setName(a.preferred_username ?? "Player"))
      .catch(() => setName("Player"));
  }, [userId]);

  useEffect(() => {
    const sync = () => setGameId(readHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const open = useCallback((id: string | null) => {
    window.location.hash = id ? `game=${id}` : "";
    setGameId(id);
  }, []);

  return (
    <div className="app">
      <header className="site-header">
        <button type="button" className="brand" onClick={() => open(null)}>
          <span className="logo" aria-hidden>
            ◆
          </span>
          Rent Rush
        </button>
        <div className="account">
          <button type="button" className="link" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
          <span className="muted">
            Playing as <strong>{name || "…"}</strong>
          </span>
          <button type="button" className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {gameId ? (
        <GameRoom key={gameId} gameId={gameId} me={userId} onExit={() => open(null)} />
      ) : (
        <Lobby me={userId} myName={name} onOpen={open} />
      )}
      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
