import { useState } from "react";

type Props = {
  onLogin: (username: string) => void;
  existingUsers?: string[];
};

export function LoginScreen({ onLogin, existingUsers = [] }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [focusedUser, setFocusedUser] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onLogin(username.trim());
  }

  return (
    <div className="xp-login">
      <div className="xp-login-top">
        <img src="/assets/xp-logo-small.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div>
          <div className="xp-login-brand-1">Microsoft</div>
          <div className="xp-login-brand-2">Windows<span>XP</span></div>
        </div>
      </div>
      <div className="xp-login-divider" />
      <div className="xp-login-main">
        <div className="xp-login-left">
          <h2>To begin, click your user name</h2>
        </div>
        <div className="xp-login-users">
          {existingUsers.map((u) => (
            <div
              key={u}
              className="xp-user-tile"
              onClick={() => {
                setUsername(u);
                onLogin(u);
              }}
            >
              <img src="/assets/avatars/user.svg" alt="" />
              <div className="xp-user-tile-body">
                <div className="xp-user-name">{u}</div>
                <div className="xp-user-hint">click to sign in</div>
              </div>
            </div>
          ))}
          <form
            className="xp-user-tile"
            onClick={() => setFocusedUser("__new")}
            onSubmit={submit}
          >
            <img src="/assets/avatars/user.svg" alt="" />
            <div className="xp-user-tile-body">
              <div className="xp-user-name">
                {existingUsers.length ? "New user" : "user"}
              </div>
              {focusedUser === "__new" ? (
                <>
                  <input
                    autoFocus
                    name="xp-username"
                    placeholder="pick a username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                  />
                  <input
                    type="password"
                    name="xp-password"
                    placeholder="type your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                  />
                  <div className="xp-user-hint">Hint: anything works</div>
                  <button type="submit" disabled={!canSubmit}>
                    →
                  </button>
                </>
              ) : (
                <div className="xp-user-hint">click to sign in</div>
              )}
            </div>
          </form>
        </div>
      </div>
      <div className="xp-login-divider" />
      <div className="xp-login-bottom">
        <div>After you log on, you can add or change accounts.</div>
        <div>Just click Control Panel, and then click User Accounts.</div>
      </div>
    </div>
  );
}
