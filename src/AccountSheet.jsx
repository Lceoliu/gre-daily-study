import { useEffect, useState } from "react";
import { CloudAlert, CloudCheck, CloudOff, CloudUpload, KeyRound, Loader2, LogOut, Mail, RefreshCw, UserRound, X } from "lucide-react";
import { describeCloudError } from "./cloud/useCloud.js";

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function syncBadge(auth, status) {
  if (!auth.configured || !auth.user) return { icon: UserRound, label: "账户", tone: "plain" };
  if (status.phase === "syncing") return { icon: RefreshCw, label: "正在同步", tone: "busy", spinning: true };
  if (status.phase === "error") return { icon: CloudAlert, label: "同步出错", tone: "warn" };
  if (status.phase === "offline") return { icon: CloudOff, label: "离线", tone: "warn" };
  if (status.pending > 0) return { icon: CloudUpload, label: `${status.pending} 项待上传`, tone: "busy" };
  return { icon: CloudCheck, label: "已同步", tone: "ok" };
}

function statusLine(status) {
  if (status.phase === "syncing") return "正在同步…";
  if (status.phase === "offline") return `离线：${status.pending} 项改动保存在本机，联网后自动上传。`;
  if (status.phase === "error") return status.error;
  if (status.pending > 0) return `${status.pending} 项改动等待上传。`;
  if (status.lastSyncedAt) return `已同步 · ${formatTime(status.lastSyncedAt)}`;
  return "等待首次同步…";
}

function SetupNotice() {
  return (
    <div className="account-body">
      <p className="account-lead">云同步尚未配置。现在所有进度只保存在这台设备的浏览器里。</p>
      <ol className="account-steps">
        <li>在 Supabase 新建项目，在 SQL Editor 运行仓库里的 <code>supabase/migrations</code> 脚本。</li>
        <li>把项目的 URL 和 anon key 设为 GitHub 仓库的 Actions 变量 <code>VITE_SUPABASE_URL</code>、<code>VITE_SUPABASE_ANON_KEY</code>。</li>
        <li>重新部署后，这里会出现登录入口。详细步骤见 README。</li>
      </ol>
    </div>
  );
}

function SignInForm({ auth }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const run = async (operation) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await operation());
    } catch (error) {
      setMessage({ tone: "warn", text: describeCloudError(error) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const address = email.trim();
    if (mode === "signin") {
      run(async () => {
        await auth.signIn(address, password);
        return null;
      });
      return;
    }
    run(async () => {
      const data = await auth.signUp(address, password);
      if (data?.session) return null;
      return { tone: "ok", text: "注册成功。请到邮箱点击确认链接，然后回到这里登录。" };
    });
  };

  const sendLink = () => {
    const address = email.trim();
    if (!address) {
      setMessage({ tone: "warn", text: "先填写邮箱，再发送登录链接。" });
      return;
    }
    run(async () => {
      await auth.sendMagicLink(address);
      return { tone: "ok", text: "登录链接已发送，请在这台设备上打开邮件里的链接。" };
    });
  };

  return (
    <form className="account-body" onSubmit={submit}>
      <p className="account-lead">登录后，词库进度、错题、标记题目和作文草稿会在你的所有设备间同步。</p>
      <div className="account-tabs" role="tablist" aria-label="账户操作">
        <button aria-selected={mode === "signin"} className={mode === "signin" ? "is-active" : ""} role="tab" type="button" onClick={() => setMode("signin")}>登录</button>
        <button aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : ""} role="tab" type="button" onClick={() => setMode("signup")}>注册</button>
      </div>
      <label className="account-field">
        <span>邮箱</span>
        <input autoComplete="email" inputMode="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="account-field">
        <span>密码</span>
        <input autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {message && <p className={`account-message tone-${message.tone}`}>{message.text}</p>}
      <button className="account-primary" disabled={busy || !auth.ready} type="submit">
        {busy && <Loader2 className="spin" size={17} />}
        {mode === "signin" ? "登录" : "创建账户"}
      </button>
      {mode === "signin" && (
        <button className="account-link" disabled={busy || !auth.ready} type="button" onClick={sendLink}>
          <Mail size={16} />
          忘记密码？用邮件链接登录
        </button>
      )}
      <p className="account-note">登录时，这台设备上已有的进度会和账户里的进度合并，不会被覆盖。</p>
    </form>
  );
}

function SignedInPanel({ auth, status, summary, onSyncNow }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const changePassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await auth.updatePassword(password);
      setPassword("");
      setMessage({ tone: "ok", text: "密码已更新。" });
    } catch (error) {
      setMessage({ tone: "warn", text: describeCloudError(error) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await auth.signOut();
    } catch (error) {
      setMessage({ tone: "warn", text: describeCloudError(error) });
      setBusy(false);
    }
  };

  const badge = syncBadge(auth, status);
  const BadgeIcon = badge.icon;

  return (
    <div className="account-body">
      <div className="account-identity">
        <span>已登录</span>
        <strong>{auth.user.email}</strong>
      </div>
      <div className={`account-status tone-${badge.tone}`}>
        <BadgeIcon className={status.phase === "syncing" ? "spin" : ""} size={20} />
        <p>{statusLine(status)}</p>
        <button disabled={status.phase === "syncing"} type="button" onClick={onSyncNow}>立即同步</button>
      </div>
      <dl className="account-summary">
        <div><dt>已掌握单词</dt><dd>{summary.mastered}</dd></div>
        <div><dt>生词本</dt><dd>{summary.savedWords}</dd></div>
        <div><dt>已做题目</dt><dd>{summary.answered}</dd></div>
        <div><dt>错题本</dt><dd>{summary.wrong}</dd></div>
        <div><dt>标记题目</dt><dd>{summary.marked}</dd></div>
        <div><dt>作文草稿</dt><dd>{summary.drafts}</dd></div>
      </dl>
      <details className="account-password">
        <summary><KeyRound size={16} /> 修改密码</summary>
        <form onSubmit={changePassword}>
          <input autoComplete="new-password" minLength={6} placeholder="新密码（至少 6 位）" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button disabled={busy} type="submit">保存</button>
        </form>
      </details>
      {message && <p className={`account-message tone-${message.tone}`}>{message.text}</p>}
      <button className="account-secondary" disabled={busy} type="button" onClick={signOut}>
        <LogOut size={17} />
        退出登录
      </button>
      <p className="account-note">退出后，本机进度仍然保留；再次登录会继续同步。</p>
    </div>
  );
}

export function AccountSheet({ auth, status, summary, onSyncNow, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="account-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="account-title" aria-modal="true" className="account-sheet" role="dialog">
        <header>
          <h2 id="account-title">账户与云同步</h2>
          <button aria-label="关闭" className="icon-button" type="button" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        {!auth.configured && <SetupNotice />}
        {auth.configured && !auth.ready && (
          <div className="account-body account-loading">
            <Loader2 className="spin" size={24} />
            <p>正在连接云端…</p>
          </div>
        )}
        {auth.configured && auth.ready && !auth.user && <SignInForm auth={auth} />}
        {auth.configured && auth.ready && auth.user && <SignedInPanel auth={auth} status={status} summary={summary} onSyncNow={onSyncNow} />}
      </section>
    </div>
  );
}
