import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ShieldCheck,
  FolderLock,
  Link2,
  Activity,
  ArrowUpRight,
  Upload,
  FileText,
  Download,
  Trash2,
  LogOut,
  Check,
  Copy,
  X,
  Clock,
  ArrowRight,
  LockKeyhole,
} from "lucide-react";
import "./style.css";
type FileItem = { id: string; name: string; size: number; created: number };
type Share = { id: string; name: string; expires: number; revoked: number };
type Event = { id: number; name: string; action: string; created: number };
async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch("/api" + url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed.");
  return data;
}
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
const date = (n: number) =>
  new Date(n).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function App() {
  const [user, setUser] = useState<{ email: string } | null>(null),
    [loading, setLoading] = useState(true),
    [register, setRegister] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]),
    [shares, setShares] = useState<Share[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [view, setView] = useState("files"),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FileItem | null>(null),
    [hours, setHours] = useState(24),
    [link, setLink] = useState(""),
    [copied, setCopied] = useState(false),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const publicToken = location.pathname.startsWith("/s/")
    ? location.pathname.slice(3)
    : null;
  const [publicFile, setPublicFile] = useState<{
    name: string;
    size: number;
  } | null>(null);
  async function refresh() {
    const [f, s, e] = await Promise.all([
      api<FileItem[]>("/files"),
      api<Share[]>("/shares"),
      api<Event[]>("/events"),
    ]);
    setFiles(f);
    setShares(s);
    setEvents(e);
  }
  useEffect(() => {
    if (publicToken) {
      api("/public/" + encodeURIComponent(publicToken))
        .then(setPublicFile)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }
    api("/me")
      .then(async (u) => {
        setUser(u);
        await refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const u = await api("/auth/" + (register ? "register" : "login"), {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(data)),
      });
      setUser(u);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 256 * 1024) {
      setError("Hosted demo files must be 256 KB or smaller.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      await api("/files", { method: "POST", body });
      await refresh();
      setNotice("File uploaded to your vault.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const mark = (
    <div className="brand">
      <span className="brand-icon">
        <ShieldCheck size={23} />
      </span>
      VaultShare<span className="brand-dot">®</span>
    </div>
  );
  if (loading)
    return (
      <div className="loading">
        {mark}
        <p>Opening your vault…</p>
      </div>
    );
  if (publicToken)
    return (
      <div className="auth-page">
        <div className="auth-brand">{mark}</div>
        <main className="auth-card shared">
          <span className="eyebrow">A SAFER HANDOFF</span>
          <h1>A file, just for you.</h1>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : (
            publicFile && (
              <>
                <div className="public-file">
                  <FileText />
                  <div>
                    <strong>{publicFile.name}</strong>
                    <p>{size(publicFile.size)}</p>
                  </div>
                </div>
                <a
                  className="primary"
                  href={
                    "/api/public/" +
                    encodeURIComponent(publicToken) +
                    "/download"
                  }
                >
                  <Download size={18} /> Download file
                </a>
                <p className="muted">
                  Only download files from people you trust.
                </p>
              </>
            )
          )}
        </main>
      </div>
    );
  if (!user)
    return (
      <div className="auth-page">
        <div className="auth-brand">
          {mark}
          <span className="quiet">PRIVATE BY DESIGN</span>
        </div>
        <main className="auth-layout">
          <section className="auth-intro">
            <span className="eyebrow">LESS EXPOSURE. MORE CONTROL.</span>
            <h1>
              Good work deserves
              <br />a safer handoff<span>.</span>
            </h1>
            <p>
              A private home for your files. A clear expiry for every link. A
              record of every handoff.
            </p>
            <div className="intro-note">
              <ShieldCheck /> Built for intentional sharing.
            </div>
          </section>
          <form className="auth-card" onSubmit={authenticate}>
            <span className="eyebrow">YOUR PRIVATE WORKSPACE</span>
            <h2>{register ? "Create your vault" : "Welcome back"}</h2>
            <p className="muted">
              {register
                ? "A little more control starts here."
                : "Your files are right where you left them."}
            </p>
            <label>
              Email address
              <input
                type="email"
                name="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                placeholder="At least 12 characters"
                minLength={12}
                maxLength={128}
                required
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "One moment…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={18} />
            </button>
            <p className="switch">
              {register ? "Already have an account?" : "New to VaultShare?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setRegister(!register);
                  setError("");
                }}
              >
                {register ? "Sign in" : "Create account"}
              </button>
            </p>
          </form>
        </main>
        <footer>VaultShare / Your files. Your terms.</footer>
      </div>
    );
  const active = shares.filter(
    (s) => !s.revoked && s.expires > Date.now(),
  ).length;
  return (
    <div className="app">
      <aside>
        {mark}
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav>
          {[
            ["files", "My vault", FolderLock],
            ["links", "Shared links", Link2],
            ["activity", "Activity", Activity],
          ].map(([key, label, Icon]) => (
            <button
              key={String(key)}
              className={view === key ? "active" : ""}
              onClick={() => setView(String(key))}
            >
              {React.createElement(Icon, { size: 19 })}
              <span>{String(label)}</span>
              {key === "files" && <small>{files.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={21} />
            <strong>Private by default</strong>
            <p>
              You decide what leaves
              <br />
              your vault, and for how long.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">{user.email[0].toUpperCase()}</span>
            <div>
              <strong>Personal account</strong>
              <span title={user.email}>{user.email}</span>
            </div>
            <button
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api("/logout", { method: "POST" });
                  setUser(null);
                  setFiles([]);
                  setShares([]);
                  setEvents([]);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            Workspace <span className="slash">/</span>{" "}
            <strong>
              {view === "files"
                ? "My vault"
                : view === "links"
                  ? "Shared links"
                  : "Activity"}
            </strong>
          </span>
          <span className="header-status">
            <i /> LOCAL WORKSPACE
          </span>
        </header>
        <main>
          <p className="hosted-demo-notice">Portfolio demo · Use sample files and test credentials only. Up to 256 KB per file, five files per account. Data resets after 24 hours of inactivity across the demo. No malware scanning.</p>
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR FILES. YOUR TERMS.</span>
              <h1>
                {view === "files"
                  ? "My vault"
                  : view === "links"
                    ? "Shared links"
                    : "Activity log"}
                <span>.</span>
              </h1>
              <p>
                {view === "files"
                  ? "Keep it private. Share it on purpose."
                  : view === "links"
                    ? "A little visibility into what’s out there."
                    : "Every action leaves a useful trail."}
              </p>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={18} />
              {busy ? "Working…" : "Upload file"}
            </button>
          </div>
          <input
            ref={input}
            type="file"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          {error && (
            <div className="error banner" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="stats">
            <div>
              <span>
                FILES IN YOUR VAULT
                <FolderLock size={17} />
              </span>
              <strong>{String(files.length).padStart(2, "0")}</strong>
              <small>Only accessible to you</small>
            </div>
            <div>
              <span>
                ACTIVE SHARE LINKS
                <Link2 size={17} />
              </span>
              <strong>{String(active).padStart(2, "0")}</strong>
              <small>With an expiry you control</small>
            </div>
            <div>
              <span>
                STORAGE USED
                <ShieldCheck size={17} />
              </span>
              <strong>{size(files.reduce((s, f) => s + f.size, 0))}</strong>
              <small>Hosted demo: 256 KB maximum per file</small>
            </div>
          </div>
          {view === "files" && (
            <>
              <div
                className={"dropzone " + (drag ? "drag" : "")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  if (!busy) upload(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-icon">
                  <Upload size={23} />
                </div>
                <div>
                  <h3>A safe place to land.</h3>
                  <p>
                    Drag a file here, or{" "}
                    <button
                      disabled={busy}
                      onClick={() => input.current?.click()}
                    >
                      browse files <ArrowUpRight size={13} />
                    </button>
                  </p>
                </div>
                <span className="drop-limit">HOSTED DEMO: 256 KB / FILE</span>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    All files <span>{files.length}</span>
                  </h2>
                  <input
                    aria-label="Search files"
                    placeholder="Search your files…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>FILE NAME</th>
                        <th>SIZE</th>
                        <th>UPLOADED</th>
                        <th>ACCESS</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {files
                        .filter((f) =>
                          f.name.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((f) => (
                          <tr key={f.id}>
                            <td>
                              <div className="file-name">
                                <span className="file-icon">
                                  <FileText size={21} />
                                </span>
                                <strong>{f.name}</strong>
                              </div>
                            </td>
                            <td>{size(f.size)}</td>
                            <td>{date(f.created)}</td>
                            <td>
                              <span className="badge">
                                <LockKeyhole size={11} /> Private
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="share-btn"
                                  onClick={() => {
                                    setSelected(f);
                                    setLink("");
                                    setCopied(false);
                                  }}
                                >
                                  <Link2 size={14} /> Share
                                </button>
                                <a
                                  title="Download file"
                                  aria-label={"Download " + f.name}
                                  href={"/api/files/" + f.id + "/download"}
                                >
                                  <Download size={16} />
                                </a>
                                <button
                                  disabled={busy}
                                  title="Delete file"
                                  aria-label={"Delete " + f.name}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Delete “${f.name}” and all its share links?`,
                                      )
                                    )
                                      action(
                                        () =>
                                          api("/files/" + f.id, {
                                            method: "DELETE",
                                          }),
                                        "File deleted.",
                                      );
                                  }}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!files.length ? (
                  <div className="empty">
                    <FolderLock size={32} />
                    <h3>Your vault is ready.</h3>
                    <p>Upload your first file to make your first handoff.</p>
                    <button onClick={() => input.current?.click()}>
                      Choose a file <ArrowRight size={14} />
                    </button>
                  </div>
                ) : (
                  !files.some((f) =>
                    f.name.toLowerCase().includes(search.toLowerCase()),
                  ) && (
                    <div className="empty">
                      <p>No files match your search.</p>
                    </div>
                  )
                )}
                <div className="panel-footer">
                  <ShieldCheck size={14} /> Files stay private until you create
                  a share link.
                </div>
              </section>
            </>
          )}
          {view === "links" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  Your share links <span>{shares.length}</span>
                </h2>
              </div>
              {shares.length ? (
                shares.map((s) => (
                  <div className="list-row" key={s.id}>
                    <Link2 size={20} />
                    <div>
                      <strong>{s.name}</strong>
                      <p>Expires {new Date(s.expires).toLocaleString()}</p>
                    </div>
                    <span
                      className={
                        "badge " +
                        (s.revoked || s.expires <= Date.now() ? "inactive" : "")
                      }
                    >
                      {s.revoked
                        ? "Revoked"
                        : s.expires <= Date.now()
                          ? "Expired"
                          : "Active"}
                    </span>
                    {!s.revoked && s.expires > Date.now() && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          action(
                            () => api("/shares/" + s.id, { method: "DELETE" }),
                            "Link revoked.",
                          )
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Link2 size={32} />
                  <h3>Share with a little intention.</h3>
                  <p>Create an expiring link from any file in your vault.</p>
                </div>
              )}
            </section>
          )}
          {view === "activity" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Recent activity</h2>
                <span className="muted">Latest 100 events</span>
              </div>
              {events.length ? (
                events.map((e) => (
                  <div className="list-row" key={e.id}>
                    <Clock size={19} />
                    <div>
                      <strong>{e.action}</strong>
                      <p>{e.name}</p>
                    </div>
                    <time>{new Date(e.created).toLocaleString()}</time>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <Activity size={32} />
                  <h3>A clean slate.</h3>
                  <p>
                    Your uploads, share links, and download requests will appear
                    here.
                  </p>
                </div>
              )}
            </section>
          )}
          <footer>
            <span>Built for a more thoughtful handoff.</span>
            <span>
              <ShieldCheck size={14} /> VAULTSHARE
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close share dialog"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">A CONTROLLED HANDOFF</span>
            <h2 id="share-title">Share this file.</h2>
            <div className="public-file">
              <FileText />
              <strong>{selected.name}</strong>
            </div>
            <p className="muted">
              Anyone with the link can download this file until it expires or
              you revoke it.
            </p>
            {!link ? (
              <>
                <label>
                  Link expires in
                  <select
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                  >
                    <option value={1}>1 hour</option>
                    <option value={24}>24 hours</option>
                    <option value={168}>7 days</option>
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const result = await api(
                        "/files/" + selected.id + "/shares",
                        { method: "POST", body: JSON.stringify({ hours }) },
                      );
                      setLink(result.url);
                    }, "Share link created.")
                  }
                >
                  <Link2 size={17} /> Create share link
                </button>
              </>
            ) : (
              <>
                <label>
                  Your share link
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                    } catch {
                      setError("Select and copy the link manually.");
                    }
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <p className="muted">
                  Save this link now. For privacy, it cannot be retrieved later.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
