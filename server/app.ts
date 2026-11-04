import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
const scrypt = promisify(scryptCallback);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("hex");
type User = { id: string; email: string; password: string };
type FileRow = {
  id: string;
  owner: string;
  name: string;
  size: number;
  created: number;
};
export function createApp(dataDir: string, origin = "http://localhost:5173", memory = false) {
  if (!memory) mkdirSync(path.join(dataDir, "uploads"), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(memory ? ":memory:" : path.join(dataDir, "vault.db"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,owner TEXT REFERENCES users(id),name TEXT NOT NULL,size INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,file_id TEXT REFERENCES files(id) ON DELETE CASCADE,hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,revoked INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,action TEXT NOT NULL,name TEXT NOT NULL,created INTEGER NOT NULL);`);
  if (memory) db.exec("CREATE TABLE file_content(id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,body TEXT NOT NULL)");
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      strictTransportSecurity:
        process.env.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== origin
    )
      return res.status(403).json({ error: "Request origin is not allowed." });
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const event = (owner: string, action: string, name: string) =>
    db
      .prepare("INSERT INTO events(owner,action,name,created) VALUES(?,?,?,?)")
      .run(owner, action, name, Date.now());
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("vault_session="))
      ?.slice(14);
    const row =
      cookie &&
      db
        .prepare(
          "SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>?",
        )
        .get(digest(cookie), Date.now());
    if (!row) return res.status(401).json({ error: "Please sign in." });
    res.locals.user = row;
    next();
  };
  const owned = (id: string, owner: string) =>
    db.prepare("SELECT * FROM files WHERE id=? AND owner=?").get(id, owner) as
      FileRow | undefined;
  for (const mode of ["register", "login"])
    app.post(`/api/auth/${mode}`, authLimit, async (req, res) => {
      const email =
        typeof req.body.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";
      const password = req.body.password;
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 128
      )
        return res
          .status(400)
          .json({
            error: "Use a valid email and a password of 12–128 characters.",
          });
      let user = db.prepare("SELECT * FROM users WHERE email=?").get(email) as
        User | undefined;
      if (mode === "register") {
        if (memory && Number(db.prepare("SELECT count(*) AS n FROM users").get()?.n) >= 50) return res.status(429).json({error:"Demo account capacity reached. Try again after the demo resets."});
        if (user)
          return res
            .status(409)
            .json({ error: "Unable to create this account. Try signing in." });
        const salt = token();
        const hash = ((await scrypt(password, salt, 64)) as Buffer).toString(
          "hex",
        );
        user = { id: randomUUID(), email, password: `${salt}:${hash}` };
        try {
          db.prepare("INSERT INTO users VALUES(?,?,?)").run(
            user.id,
            email,
            user.password,
          );
        } catch {
          return res
            .status(409)
            .json({ error: "Unable to create this account." });
        }
      } else {
        const [salt, expected] = (
          user?.password ?? `${"0".repeat(64)}:${"0".repeat(128)}`
        ).split(":");
        const actual = (await scrypt(password, salt, 64)) as Buffer;
        if (!timingSafeEqual(actual, Buffer.from(expected, "hex")) || !user)
          return res
            .status(401)
            .json({ error: "Email or password is incorrect." });
      }
      const raw = token();
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        digest(raw),
        user!.id,
        Date.now() + 86400000,
      );
      res.cookie("vault_session", raw, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 86400000,
        path: "/",
      });
      res.json({ id: user!.id, email });
    });
  app.get("/api/me", auth, (_req, res) => res.json(res.locals.user));
  app.post("/api/logout", auth, (req, res) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("vault_session="))
      ?.slice(14);
    if (raw) db.prepare("DELETE FROM sessions WHERE hash=?").run(digest(raw));
    res.clearCookie("vault_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/files", auth, (_req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM files WHERE owner=? ORDER BY created DESC")
        .all(res.locals.user.id),
    ),
  );
  const upload = multer({
    storage: memory ? multer.memoryStorage() : multer.diskStorage({
      destination: path.join(dataDir, "uploads"),
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: memory ? 256 * 1024 : 20 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.post("/api/files", auth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a file." });
    const file = req.file;
    const name =
      path
        .basename(file.originalname)
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 200) || "download";
    const row = {
      id: memory ? randomUUID() : file.filename,
      owner: res.locals.user.id,
      name,
      size: file.size,
      created: Date.now(),
    };
    db.prepare("INSERT INTO files VALUES(?,?,?,?,?)").run(
      row.id,
      row.owner,
      row.name,
      row.size,
      row.created,
    );
    if (memory) {
      const ownedCount = Number(db.prepare("SELECT count(*) AS n FROM files WHERE owner=?").get(row.owner)?.n);
      const totalCount = Number(db.prepare("SELECT count(*) AS n FROM files").get()?.n);
      if (ownedCount > 5 || totalCount > 20) {
        db.prepare("DELETE FROM files WHERE id=?").run(row.id);
        return res.status(429).json({error:"Demo capacity: five files per account and twenty files total. Remove a sample file and try again."});
      }
      db.prepare("INSERT INTO file_content VALUES(?,?)").run(row.id,file.buffer.toString("base64"));
    }
    event(row.owner, "Uploaded", name);
    res.status(201).json(row);
  });
  app.get("/api/files/:id/download", auth, (req, res) => {
    const f = owned(String(req.params.id), res.locals.user.id);
    if (!f) return res.status(404).json({ error: "File not found." });
    if (memory) {
      const data = db.prepare("SELECT body FROM file_content WHERE id=?").get(f.id);
      if (!data) return res.status(404).json({error:"File not found."});
      return res.attachment(f.name).type("application/octet-stream").send(Buffer.from(String(data.body),"base64"));
    }
    res.download(path.join(dataDir, "uploads", f.id), f.name);
  });
  app.delete("/api/files/:id", auth, (req, res) => {
    const f = owned(String(req.params.id), res.locals.user.id);
    if (!f) return res.status(404).json({ error: "File not found." });
    if (!memory) unlinkSync(path.join(dataDir, "uploads", f.id));
    db.prepare("DELETE FROM files WHERE id=?").run(f.id);
    event(f.owner, "Deleted", f.name);
    res.json({ ok: true });
  });
  app.post("/api/files/:id/shares", auth, (req, res) => {
    const f = owned(String(req.params.id), res.locals.user.id);
    if (!f) return res.status(404).json({ error: "File not found." });
    const hours = Number(req.body.hours);
    if (![1, 24, 168].includes(hours))
      return res.status(400).json({ error: "Select a valid expiry." });
    const raw = token(),
      id = randomUUID(),
      expires = Date.now() + hours * 3600000;
    db.prepare(
      "INSERT INTO shares(id,file_id,hash,expires) VALUES(?,?,?,?)",
    ).run(id, f.id, digest(raw), expires);
    event(f.owner, "Link created", f.name);
    res.status(201).json({ id, url: `${origin}/s/${raw}`, expires });
  });
  app.get("/api/shares", auth, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT shares.id,shares.file_id,shares.expires,shares.revoked,files.name FROM shares JOIN files ON files.id=shares.file_id WHERE files.owner=? ORDER BY shares.expires DESC",
        )
        .all(res.locals.user.id),
    ),
  );
  app.delete("/api/shares/:id", auth, (req, res) => {
    const row = db
      .prepare(
        "SELECT shares.id,files.name FROM shares JOIN files ON files.id=shares.file_id WHERE shares.id=? AND files.owner=?",
      )
      .get(String(req.params.id), res.locals.user.id) as
      { id: string; name: string } | undefined;
    if (!row) return res.status(404).json({ error: "Link not found." });
    db.prepare("UPDATE shares SET revoked=1 WHERE id=?").run(row.id);
    event(res.locals.user.id, "Link revoked", row.name);
    res.json({ ok: true });
  });
  app.get("/api/public/:token", (req, res) => {
    const f = db
      .prepare(
        "SELECT files.* FROM shares JOIN files ON files.id=shares.file_id WHERE shares.hash=? AND shares.expires>? AND shares.revoked=0",
      )
      .get(digest(String(req.params.token)), Date.now()) as FileRow | undefined;
    if (!f)
      return res
        .status(404)
        .json({
          error: "This link has expired, was revoked, or does not exist.",
        });
    res.json({ name: f.name, size: f.size });
  });
  app.get("/api/public/:token/download", (req, res) => {
    const f = db
      .prepare(
        "SELECT files.* FROM shares JOIN files ON files.id=shares.file_id WHERE shares.hash=? AND shares.expires>? AND shares.revoked=0",
      )
      .get(digest(String(req.params.token)), Date.now()) as FileRow | undefined;
    if (!f)
      return res
        .status(404)
        .json({ error: "This link is no longer available." });
    event(f.owner, "Download requested", f.name);
    if (memory) {
      const data = db.prepare("SELECT body FROM file_content WHERE id=?").get(f.id);
      if (!data) return res.status(404).json({error:"File not found."});
      return res.attachment(f.name).type("application/octet-stream").send(Buffer.from(String(data.body),"base64"));
    }
    res.download(path.join(dataDir, "uploads", f.id), f.name);
  });
  app.get("/api/events", auth, (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM events WHERE owner=? ORDER BY id DESC LIMIT 100",
        )
        .all(res.locals.user.id),
    ),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/{*splat}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError)
      return res
        .status(400)
        .json({
          error:
            err.code === "LIMIT_FILE_SIZE"
              ? "Files must be 20 MB or smaller."
              : "Upload could not be accepted.",
        });
    console.error(err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
  return { app, db };
}
