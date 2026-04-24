import { useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppContext } from '../../App.jsx';
import ProfilePicture from '../ProfilePicture/ProfilePicture.jsx';
import { getCurrentIGT, formatInGameTime } from '../../utils/Helpers/Time.js';
import './GlobalChat.css';

export default function GlobalChat() {
  const { databaseConnection, currentPlayer, timestamp, openPanel } = useContext(AppContext);
  const [messages, setMessages] = useState([]);
  const [players, setPlayers]   = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Lookup of live player records for fallback when a chat message's
  // denormalized username/profilePicture snapshot was lost during a
  // profile-less data import.
  const playersByUUID = useMemo(
    () => Object.fromEntries((players || []).map((p) => [p.UUID, p])),
    [players]
  );

  const load = useCallback(async () => {
    // Only show messages whose inGameTimestamp is <= the current player's IGT.
    // This makes chat behave as if IGT is the only timeline that exists.
    const currentIGT = getCurrentIGT(currentPlayer);
    const [msgs, allPlayers] = await Promise.all([
      databaseConnection.getChatMessages(currentIGT, 200),
      databaseConnection.getAllPlayers(),
    ]);
    setMessages(msgs);
    setPlayers(allPlayers);
  }, [databaseConnection, currentPlayer]);

  useEffect(() => { load(); }, [load, timestamp]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !currentPlayer || sending) return;
    setSending(true);
    try {
      await databaseConnection.sendChatMessage({
        playerUUID: currentPlayer.UUID,
        username: currentPlayer.username || 'Unknown',
        profilePicture: currentPlayer.profilePicture || null,
        message: text,
        inGameTimestamp: getCurrentIGT(currentPlayer),
      });
      setDraft('');
      await load();
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!currentPlayer) {
    return (
      <div className="gchat-wrap">
        <div className="gchat-empty">No active profile.</div>
      </div>
    );
  }

  return (
    <div className="gchat-wrap">
      <div className="gchat-header">
        <span className="gchat-title">GLOBAL CHAT</span>
        <span className="gchat-subtitle">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="gchat-messages">
        {messages.length === 0 && (
          <div className="gchat-empty-state">
            <span className="gchat-empty-icon">◎</span>
            <span>No messages yet. Say something!</span>
          </div>
        )}

        {messages.map((msg) => {
          const isMine = msg.playerUUID === currentPlayer.UUID;
          // Fall back to live player data when the message's denormalized
          // snapshot is missing (typical after a data-only import without
          // the matching profile file).
          const live           = playersByUUID[msg.playerUUID];
          const displayName    = msg.username || live?.username || 'Unknown';
          const displayAvatar  = msg.profilePicture != null ? msg.profilePicture : (live?.profilePicture ?? null);
          const openSender = () => {
            if (msg.playerUUID) openPanel('profile', msg.playerUUID);
          };
          return (
            <div key={msg.UUID} className={`gchat-row ${isMine ? 'gchat-row--mine' : 'gchat-row--theirs'}`}>
              {!isMine && (
                <button
                  type="button"
                  className="gchat-avatar-btn"
                  onClick={openSender}
                  title={`View ${displayName}`}
                >
                  <ProfilePicture src={displayAvatar} username={displayName} size={34} />
                </button>
              )}

              <div className="gchat-bubble-wrap">
                {!isMine && (
                  <button
                    type="button"
                    className="gchat-sender-btn"
                    onClick={openSender}
                    title={`View ${displayName}`}
                  >
                    {displayName}
                  </button>
                )}
                <div className={`gchat-bubble ${isMine ? 'gchat-bubble--mine' : 'gchat-bubble--theirs'}`}>
                  {msg.message}
                </div>
                <div className={`gchat-ts ${isMine ? 'gchat-ts--mine' : ''}`}>
                  {formatInGameTime(msg.inGameTimestamp || 0)}
                </div>
              </div>

              {isMine && (
                <div className="gchat-avatar">
                  <ProfilePicture src={currentPlayer.profilePicture} username={currentPlayer.username || '?'} size={34} />
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="gchat-input-row">
        <input
          ref={inputRef}
          className="gchat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message…"
          maxLength={400}
          disabled={sending}
        />
        <button
          className="gchat-send-btn"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          title="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}