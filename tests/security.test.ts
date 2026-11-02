import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
test("account isolation, sharing, expiry, revocation, logout, and persistent storage", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vaultshare-"));
  const origin = "http://localhost:5173";
  let { app, db } = createApp(dir, origin);
  try {
    const alice = request.agent(app),
      bob = request.agent(app),
      guest = request(app);
    await guest.get("/api/files").expect(401);
    await alice
      .post("/api/auth/register")
      .set("Origin", "https://evil.example")
      .send({ email: "alice@example.com", password: "a-secure-password" })
      .expect(403);
    await alice
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ email: "alice@example.com", password: "short" })
      .expect(400);
    const registered = await alice
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ email: "alice@example.com", password: "a-secure-password" })
      .expect(200);
    assert.match(registered.headers["set-cookie"][0], /HttpOnly/);
    assert.match(registered.headers["set-cookie"][0], /SameSite=Strict/);
    await bob
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({ email: "bob@example.com", password: "another-secure-password" })
      .expect(200);
    const uploaded = await alice
      .post("/api/files")
      .set("Origin", origin)
      .attach("file", Buffer.from("private contents"), "notes.txt")
      .expect(201);
    const id = uploaded.body.id;
    await bob.get(`/api/files/${id}/download`).expect(404);
    await bob.delete(`/api/files/${id}`).set("Origin", origin).expect(404);
    await bob
      .post(`/api/files/${id}/shares`)
      .set("Origin", origin)
      .send({ hours: 24 })
      .expect(404);
    assert.equal((await bob.get("/api/files")).body.length, 0);
    await alice
      .post(`/api/files/${id}/shares`)
      .set("Origin", origin)
      .send({ hours: -1 })
      .expect(400);
    const shared = await alice
      .post(`/api/files/${id}/shares`)
      .set("Origin", origin)
      .send({ hours: 1 })
      .expect(201);
    const token = shared.body.url.split("/").pop();
    assert.equal(
      (await guest.get(`/api/public/${token}`)).body.name,
      "notes.txt",
    );
    const downloaded = await guest
      .get(`/api/public/${token}/download`)
      .expect(200);
    assert.equal(
      Buffer.isBuffer(downloaded.body)
        ? downloaded.body.toString()
        : downloaded.text,
      "private contents",
    );
    assert.match(downloaded.headers["content-disposition"], /^attachment/);
    await bob
      .delete(`/api/shares/${shared.body.id}`)
      .set("Origin", origin)
      .expect(404);
    await alice
      .delete(`/api/shares/${shared.body.id}`)
      .set("Origin", origin)
      .expect(200);
    await guest.get(`/api/public/${token}/download`).expect(404);
    const expired = await alice
      .post(`/api/files/${id}/shares`)
      .set("Origin", origin)
      .send({ hours: 1 })
      .expect(201);
    db.prepare("UPDATE shares SET expires=0 WHERE id=?").run(expired.body.id);
    await guest
      .get("/api/public/" + expired.body.url.split("/").pop() + "/download")
      .expect(404);
    const stored = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get("alice@example.com");
    assert.notEqual(stored?.password, "a-secure-password");
    assert.equal(
      (await alice.get("/api/events")).body.some(
        (e: any) => e.action === "Download requested",
      ),
      true,
    );
    await alice.post("/api/logout").set("Origin", origin).expect(200);
    await alice.get("/api/me").expect(401);
    await alice
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "alice@example.com", password: "incorrect-password" })
      .expect(401);
    await alice
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "alice@example.com", password: "a-secure-password" })
      .expect(200);
    db.close();
    ({ app, db } = createApp(dir, origin));
    const returning = request.agent(app);
    await returning
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "alice@example.com", password: "a-secure-password" })
      .expect(200);
    assert.equal((await returning.get("/api/files")).body.length, 1);
    await returning
      .delete(`/api/files/${id}`)
      .set("Origin", origin)
      .expect(200);
    assert.equal(db.prepare("SELECT count(*) AS n FROM shares").get()?.n, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
