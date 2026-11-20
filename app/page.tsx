"use client";

import "@/lib/amplify"; // configures Amplify before anything renders
import { useCallback, useEffect, useState } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession, fetchUserAttributes } from "aws-amplify/auth";
import { setGuestMode } from "@/lib/api";
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

/** A guest's chosen name, remembered in this browser (their anonymous identity is kept by Amplify). */
const GUEST_KEY = "rent-rush:guest-name";

function readGuestName(): string | null {
  try {
    return window.localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

function saveGuestName(name: string | null) {
  try {
    if (name) window.localStorage.setItem(GUEST_KEY, name);
    else window.localStorage.removeItem(GUEST_KEY);
  } catch {
    // Private mode etc.: the guest just has to type their name again next time.
  }
}

export default function Home() {
  // undefined until we've checked this browser for a guest session.
  const [guest, setGuest] = useState<string | null | undefined>(undefined);
  useEffect(() => setGuest(readGuestName()), []);

  if (guest === undefined) return null;
  if (guest) {
    return (
      <GuestApp
        name={guest}
        onLeave={() => {
          saveGuestName(null);
          setGuest(null);
        }}
      />
    );
  }
  return (
    <main className="auth-shell">
      <Authenticator
        signUpAttributes={["preferred_username"]}
        formFields={formFields}
        components={{
          Header: () => (
            <div className="auth-header">
              <h1>Rent Rush</h1>
              {/^#game=/.test(window.location.hash) ? (
                <p className="invite-note">You&apos;ve been invited to a game! Sign in or play as a guest to join.</p>
              ) : (
                <p className="muted">Sign in to join the lobby. 2-4 players, real-time.</p>
              )}
            </div>
          ),
          Footer: () => (
            <GuestEntry
              onStart={(name) => {
                saveGuestName(name);
                setGuest(name);
              }}
            />
          ),
        }}
      >
        {({ user, signOut }) => <SignedInApp userId={user?.userId ?? ""} signOut={() => signOut?.()} />}
      </Authenticator>
    </main>
  );
}

/** The game id lives in the URL hash so a refresh (or a shared link) reopens the game. */
function readHash(): string | null {
  const m = /^#game=([\w-]+)$/.exec(window.location.hash);
  return m ? m[1] : null;
}

/** "Play as guest": pick a name, no account needed. */
function GuestEntry({ onStart }: { onStart: (name: string) => void }) {
  const [name, setName] = useState("");
  const clean = name.replace(/\s+/g, " ").trim();
  const valid = clean.length >= 2 && clean.length <= 20;
  return (
    <form
      className="guest-entry"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onStart(clean);
      }}
    >
      <div className="guest-divider">
        <span>or</span>
      </div>
      <label htmlFor="guest-name">Play as a guest, no account needed</label>
      <div className="row">
        <input
          id="guest-name"
          value={name}
          maxLength={20}
          placeholder="Your player name"
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={!valid}>
          Play as guest
        </button>
      </div>
      <p className="muted small">Your guest games stay in this browser. Sign up any time to keep your name.</p>
    </form>
  );
}

function SignedInApp({ userId, signOut }: { userId: string; signOut: () => void }) {
  const [name, setName] = useState<string>("");
  useEffect(() => {
    setGuestMode(null);
    fetchUserAttributes()
      .then((a) => setName(a.preferred_username ?? "Player"))
      .catch(() => setName("Player"));
  }, [userId]);
  return <App userId={userId} name={name} onSignOut={signOut} signOutLabel="Sign out" />;
}

/** Guests use this browser's anonymous Cognito identity; the server knows them as "guest:<identity id>". */
function GuestApp({ name, onLeave }: { name: string; onLeave: () => void }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setGuestMode(name);
    fetchAuthSession()
      .then((s) => (s.identityId ? setUserId(`guest:${s.identityId}`) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [name]);

  if (failed) {
    return (
      <main className="auth-shell">
        <div className="panel center">
          <p className="error">Couldn't start a guest session. Check your connection and try again.</p>
          <button type="button" onClick={onLeave}>
            Back
          </button>
        </div>
      </main>
    );
  }
  if (!userId) return null;
  return <App userId={userId} name={name} guest onSignOut={onLeave} signOutLabel="Leave guest mode" />;
}

function App({
  userId,
  name,
  guest = false,
  onSignOut,
  signOutLabel,
}: {
  userId: string;
  name: string;
  guest?: boolean;
  onSignOut: () => void;
  signOutLabel: string;
}) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

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
            {guest && <span className="badge">guest</span>}
          </span>
          <button type="button" className="secondary" onClick={onSignOut}>
            {signOutLabel}
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
