import { useEffect, useMemo, useRef, useState } from "react";
import { applySyncChanges, collectSyncItems } from "../studyState.js";
import { authRedirectUrl, cloudConfigured, getSupabaseClient } from "./client.js";
import { SYNC_TABLE, createSupabaseRemote, createSyncEngine } from "./syncEngine.js";

const LOCAL_EDIT_DEBOUNCE_MS = 800;
const PUSH_DEBOUNCE_MS = 1500;
const POLL_INTERVAL_MS = 60 * 1000;

export function describeCloudError(error) {
  const code = error?.code || "";
  const message = String(error?.message || error || "");
  if (["42P01", "PGRST205", "PGRST202", "42883"].includes(code) || /study_items|push_study_items/.test(message)) {
    return "云端数据表未就绪：请在 Supabase SQL Editor 运行 supabase/migrations 里的建表脚本。";
  }
  if (/Invalid login credentials/i.test(message)) return "邮箱或密码不正确。";
  if (/Email not confirmed/i.test(message)) return "邮箱尚未验证：请先点击注册邮件里的确认链接。";
  if (/User already registered/i.test(message)) return "该邮箱已注册，请直接登录。";
  if (/Signups not allowed|signup.*disabled/i.test(message)) return "此站点已关闭新用户注册。";
  if (/Password should be at least/i.test(message)) return "密码至少需要 6 位。";
  if (/rate limit|too many/i.test(message)) return "请求过于频繁，请稍后再试。";
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return "网络连接失败，改动已保存在本机，联网后会自动同步。";
  return message || "未知错误";
}

export function useCloudAuth() {
  const [client, setClient] = useState(null);
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!cloudConfigured);

  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let active = true;
    let subscription = null;
    getSupabaseClient()
      .then(async (supabase) => {
        if (!active) return;
        setClient(supabase);
        subscription = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (active) setSession(nextSession);
        }).data.subscription;
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const actions = useMemo(() => {
    const call = async (operation) => {
      if (!client) throw new Error("云同步尚未加载完成，请稍后再试。");
      const { data, error } = await operation(client.auth);
      if (error) throw error;
      return data;
    };
    return {
      signIn: (email, password) => call((auth) => auth.signInWithPassword({ email, password })),
      signUp: (email, password) => call((auth) => auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl() } })),
      // Magic links only sign in existing accounts; new accounts always choose a password.
      sendMagicLink: (email) => call((auth) => auth.signInWithOtp({ email, options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: false } })),
      updatePassword: (password) => call((auth) => auth.updateUser({ password })),
      signOut: () => call((auth) => auth.signOut({ scope: "local" })),
    };
  }, [client]);

  return { configured: cloudConfigured, ready, client, session, user: session?.user || null, ...actions };
}

// Keeps local study state and the account's study_items rows converged.
// `snapshot` must be memoized: { progress, responses, marks, drafts, settings }.
export function useCloudSync({ client, user, snapshot, onRemoteChanges }) {
  const [status, setStatus] = useState({ phase: "idle", pending: 0, lastSyncedAt: null, error: "" });
  const latestRef = useRef(snapshot);
  const onRemoteChangesRef = useRef(onRemoteChanges);
  const engineRef = useRef(null);
  const scheduleRef = useRef(null);
  latestRef.current = snapshot;
  onRemoteChangesRef.current = onRemoteChanges;
  const userId = user?.id || null;

  useEffect(() => {
    if (!client || !userId) {
      engineRef.current = null;
      scheduleRef.current = null;
      setStatus({ phase: "idle", pending: 0, lastSyncedAt: null, error: "" });
      return undefined;
    }

    const engine = createSyncEngine({
      userId,
      remote: createSupabaseRemote(client, userId),
      adapter: {
        collect: () => collectSyncItems(latestRef.current),
        apply: (changes) => {
          // Update the ref synchronously so a sync pass that runs before React re-renders
          // never mistakes the pre-change state for a fresh local edit.
          latestRef.current = applySyncChanges(latestRef.current, changes);
          onRemoteChangesRef.current(changes);
        },
      },
    });
    engineRef.current = engine;
    let disposed = false;
    let timer = null;

    const run = async () => {
      if (disposed) return;
      if (!navigator.onLine) {
        setStatus((current) => ({ ...current, phase: "offline", pending: engine.pendingCount }));
        return;
      }
      setStatus((current) => ({ ...current, phase: "syncing", pending: engine.pendingCount }));
      try {
        await engine.sync();
        if (!disposed) setStatus({ phase: "synced", pending: engine.pendingCount, lastSyncedAt: engine.lastSyncedAt, error: "" });
      } catch (error) {
        if (!disposed) setStatus({ phase: "error", pending: engine.pendingCount, lastSyncedAt: engine.lastSyncedAt, error: describeCloudError(error) });
      }
    };
    const schedule = (delay = 0) => {
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    };
    scheduleRef.current = schedule;

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        schedule(300);
      } else if (engine.initialized) {
        // Leaving the tab (common on phones) is the last reliable moment to upload.
        engine.noteLocalChanges();
        if (engine.pendingCount) run();
      }
    };
    const onOnline = () => schedule(300);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") schedule(0);
    }, POLL_INTERVAL_MS);
    const channel = client
      .channel(`study-items-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: SYNC_TABLE, filter: `user_id=eq.${userId}` }, () => schedule(700))
      .subscribe();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    run();

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      client.removeChannel(channel);
      if (engineRef.current === engine) {
        engineRef.current = null;
        scheduleRef.current = null;
      }
    };
  }, [client, userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const engine = engineRef.current;
      if (!engine?.initialized || !engine.noteLocalChanges()) return;
      setStatus((current) => ({ ...current, pending: engine.pendingCount }));
      scheduleRef.current?.(PUSH_DEBOUNCE_MS);
    }, LOCAL_EDIT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snapshot]);

  return { status, syncNow: () => scheduleRef.current?.(0) };
}
