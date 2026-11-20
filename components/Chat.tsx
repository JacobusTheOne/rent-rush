"use client";

import { useEffect, useRef, useState } from "react";
import { TOKEN_COLORS } from "@/game/board";
import { CHAT_MAX_LENGTH, type ChatMessage, type GameState } from "@/game/engine";
import { errorMessage } from "@/lib/api";

const OPEN_KEY = "rent-rush:chat-open";
const PREVIEW_MS = 5000;

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Private mode etc.: the chat just starts closed next time.
  }
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Table chat: a floating button (with an unread count) that opens a small chat window.
 * While it's closed, a new message pops up briefly as a preview.
 */
export function Chat({ state, me, onSend }: { state: GameState; me: string; onSend: (text: string) => Promise<void> }) {
  const messages = state.chat ?? [];
  const lastId = messages.at(-1)?.id ?? 0;
  const [open, setOpen] = useState(false);
  // Messages up to this id have been seen (old messages don't count as unread when you arrive).
  const [seen, setSeen] = useState(lastId);
  const [preview, setPreview] = useState<ChatMessage | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const meP = state.players.find((p) => p.id === me);
  const canChat = !!meP && !meP.bot;
  const color = (id: string) => {
    const p = state.players.find((x) => x.id === id);
    return p ? TOKEN_COLORS[p.token % TOKEN_COLORS.length] : undefined;
  };

  // Remember whether the window was open (after mount, so the server render matches).
  useEffect(() => setOpen(readOpen()), []);

  // Open: everything is read, and the newest message is in view.
  useEffect(() => {
    if (!open) return;
    setSeen(lastId);
    setPreview(null);
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, lastId]);

  // Closed: show someone else's new message for a few seconds.
  useEffect(() => {
    if (open) return;
    const newest = messages.at(-1);
    if (!newest || newest.id <= seen || newest.from === me) return;
    setPreview(newest);
    const t = setTimeout(() => setPreview(null), PREVIEW_MS);
    return () => clearTimeout(t);
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unread = open ? 0 : messages.filter((m) => m.id > seen && m.from !== me).length;

  const toggle = (next: boolean) => {
    setOpen(next);
    saveOpen(next);
    if (next) requestAnimationFrame(() => input.current?.focus());
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(t);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  return (
    <div className={`chat ${open ? "open" : ""}`}>
      {open && (
        <section className="chat-window" aria-label="Table chat">
          <header className="chat-head">
            <strong>💬 Table chat</strong>
            <button type="button" className="secondary tiny" aria-label="Close chat" onClick={() => toggle(false)}>
              ✕
            </button>
          </header>
          <ol ref={list} className="chat-list" aria-live="polite">
            {messages.length === 0 && <li className="muted small chat-empty">No messages yet. Say hi!</li>}
            {messages.map((m) => (
              <li key={m.id} className={m.from === me ? "mine" : ""}>
                <span className="chat-name" style={{ color: color(m.from) }}>
                  {m.from === me ? "You" : m.name}
                </span>
                <span className="chat-time muted">{clock(m.at)}</span>
                <div className="chat-text">{m.text}</div>
              </li>
            ))}
          </ol>
          {error && <p className="error small chat-error">{error}</p>}
          {canChat ? (
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                ref={input}
                type="text"
                value={text}
                maxLength={CHAT_MAX_LENGTH}
                placeholder="Message the table…"
                aria-label="Message"
                enterKeyHint="send"
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" disabled={sending || !text.trim()}>
                Send
              </button>
            </form>
          ) : (
            <p className="muted small">Only players at this table can chat.</p>
          )}
        </section>
      )}

      {!open && preview && (
        <button type="button" className="chat-preview" onClick={() => toggle(true)}>
          <span className="chat-name" style={{ color: color(preview.from) }}>
            {preview.name}
          </span>{" "}
          {preview.text}
        </button>
      )}

      <button
        type="button"
        className="chat-toggle"
        aria-expanded={open}
        aria-label={unread ? `Chat, ${unread} new` : open ? "Hide chat" : "Open chat"}
        onClick={() => toggle(!open)}
      >
        💬
        {unread > 0 && <span className="count-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
    </div>
  );
}
