// server.js
import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import morgan from "morgan";
import { WebSocketServer, WebSocket } from "ws";
import { Octokit } from "octokit";

const {
  PORT = 4000,
  GH_TOKEN,
  GH_OWNER,
  GH_REPO,
  GH_BRANCH = "main",
} = process.env;

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" })); // 업로드 대비
app.use(express.static("public"));        // 테스트 페이지 서빙

// ────────────────────────────────────────────────
// 헬스체크
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime:
    process.uptime() });
});

// ────────────────────────────────────────────────
// GitHub 업로드 API
const octokit = GH_TOKEN ? new Octokit({ auth: GH_TOKEN }) : null;

app.post("/upload", async (req, res) => {
  try {
    if (!octokit) return res.status(500).json({ error: "No GH_TOKEN set" });
    const { path, contentBase64, message, authorName, authorEmail } = req.body;
    if (!path || !contentBase64) {
      return res.status(400).json({ error: "path and contentBase64 required" });
    }

    let sha;
    try {
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner: GH_OWNER, repo: GH_REPO, path }
      );
      sha = data.sha;
    } catch (_) { /* not found */ }

    const resp = await octokit.request(
      "PUT /repos/{owner}/{repo}/contents/{path}",
      {
        owner: GH_OWNER,
        repo: GH_REPO,
        path,
        message: message || `upload ${path}`,
        content: contentBase64,
        branch: GH_BRANCH,
        sha,
        committer: (authorName && authorEmail)
          ? { name: authorName, email: authorEmail }
          : undefined,
      }
    );

    res.json({
      ok: true,
      commit: resp.data.commit?.sha,
      url: resp.data.content?.html_url,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────
// WebSocket 서버
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1 * 1024 * 1024 });

function genId() {
  return "R-" + Math.random().toString(36).slice(2, 10);
}

function broadcast(obj, except = null) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(data);
    }
  }
}

wss.on("connection", (ws, req) => {
  ws.id = genId();
  ws.isAlive = true;

  console.log(`User connected: ${ws.id} (${req.socket.remoteAddress})`);
  ws.send(JSON.stringify({ type: "welcome", id: ws.id, msg: "Connected" }));
  broadcast({ type: "presence:join", id: ws.id }, ws);

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); }
    catch { msg = { type: "chat", text: buf.toString() }; }

    switch (msg.type) {
      case "chat":
        broadcast({ type: "chat", from: ws.id, text: msg.text });
        break;

      case "whiteboard:op":
        broadcast({ type: "whiteboard:op", from: ws.id, op: msg.op }, ws);
        break;

      case "slide:goto":
        broadcast({ type: "slide:goto", page: msg.page, from: ws.id });
        break;

      default:
        ws.send(JSON.stringify({ type: "echo", payload: msg }));
    }
  });

  ws.on("close", () => {
    console.log(`User disconnected: ${ws.id}`);
    broadcast({ type: "presence:leave", id: ws.id }, ws);
  });

  ws.on("error", (err) => {
    console.error(`WS error from ${ws.id}:`, err.message);
  });

  ws.on("pong", () => {
    ws.isAlive = true;
  });
});

// ping/pong으로 죽은 연결 정리
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`HTTP  : http://localhost:${PORT}`);
  console.log(`WS    : ws://localhost:${PORT}`);
});
