
🌟 현재 상태(Completed so far)
Node.js 서버 초기화 및 실행 환경 구성
express + ws 로 HTTP + WebSocket 서버 구현
.gitignore/.env 로 보안/버전관리 체계 구축
GitHub Personal Access Token 발급 & Octokit 연동 코드
정적 테스트 페이지 public/test.html로 WS 브로드캐스트 확인
개발용 실행(nodemon) 세팅 완료

🧰 기술 스택
Runtime: Node.js (v22.x)
Server: Express, ws (WebSocket)
Dev: nodemon, dotenv, morgan, cors
GitHub API: Octokit (REST)
Client(Test): Static HTML + JS (WebSocket)

✅ 선행 조건(Prerequisites)

Node.js LTS 이상 설치 (node -v, npm -v)
Git 설치 및 GitHub 계정 보유
GitHub 저장소: taskverse 생성 완료

🧭 상세 과정 (Step-by-step Log)
아래는 실제로 수행한 명령/파일/검증 흐름을 순서대로 기록한 작업 로그입니다.

1) 프로젝트 폴더 생성 & 이동
mkdir metaverse-server && cd metaverse-server

2) npm 초기화 & 패키지 설치
npm init -y
npm i express ws cors morgan dotenv octokit
npm i -D nodemon

3) Git 초기화 & .gitignore 작성
git init

.gitignore (중요: 비밀/대용량 파일 커밋 방지)

node_modules/
.env
dist/
build/
logs/
npm-debug.log*
yarn-debug.log*
.DS_Store

4) 환경변수 파일 .env 생성

PORT=4000
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GH_OWNER=<your-github-username-or-org>
GH_REPO=taskverse
GH_BRANCH=main

5) package.json 스크립트 정리
{
  "name": "metaverse-server",
  "version": "1.0.0",
  "type": "module",  // 이거 추가
  "main": "server.js",
  "scripts": {
    "start": "node server.js",  // 이 스크립트 부분 확인하기
    "dev": "nodemon --quiet server.js"
  }
}

6) 서버 코드 작성 server.js

HTTP: /health, /upload

WS: chat, whiteboard:op, slide:goto 브로드캐스트

ping/pong 으로 유휴 연결 정리

import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import morgan from "morgan";
import { WebSocketServer, WebSocket } from "ws";
import { Octokit } from "octokit";

const { PORT=4000, GH_TOKEN, GH_OWNER, GH_REPO, GH_BRANCH="main" } = process.env;

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const octokit = GH_TOKEN ? new Octokit({ auth: GH_TOKEN }) : null;
app.post("/upload", async (req, res) => {
  try {
    if (!octokit) return res.status(500).json({ error: "No GH_TOKEN set" });
    const { path, contentBase64, message, authorName, authorEmail } = req.body;
    if (!path || !contentBase64) return res.status(400).json({ error: "path and contentBase64 required" });

    let sha;
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: GH_OWNER, repo: GH_REPO, path
      });
      sha = data.sha;
    } catch (_) {}

    const resp = await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
      owner: GH_OWNER, repo: GH_REPO, path,
      message: message || `upload ${path}`,
      content: contentBase64, branch: GH_BRANCH, sha,
      committer: (authorName && authorEmail) ? { name: authorName, email: authorEmail } : undefined,
    });

    res.json({ ok: true, commit: resp.data.commit?.sha, url: resp.data.content?.html_url });
  } catch (e) {
    console.error(e); res.status(500).json({ error: e.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1 * 1024 * 1024 });

const genId = () => "R-" + Math.random().toString(36).slice(2, 10);
const broadcast = (obj, except=null) => {
  const data = JSON.stringify(obj);
  for (const c of wss.clients)
    if (c.readyState === WebSocket.OPEN && c !== except) c.send(data);
};

wss.on("connection", (ws, req) => {
  ws.id = genId(); ws.isAlive = true;
  console.log(`User connected: ${ws.id} (${req.socket.remoteAddress})`);

  ws.send(JSON.stringify({ type: "welcome", id: ws.id, msg: "Connected" }));
  broadcast({ type: "presence:join", id: ws.id }, ws);

  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { msg = { type: "chat", text: buf.toString() }; }
    switch (msg.type) {
      case "chat":         broadcast({ type: "chat", from: ws.id, text: msg.text }); break;
      case "whiteboard:op":broadcast({ type: "whiteboard:op", from: ws.id, op: msg.op }, ws); break;
      case "slide:goto":   broadcast({ type: "slide:goto", page: msg.page, from: ws.id }); break;
      default:             ws.send(JSON.stringify({ type: "echo", payload: msg }));
    }
  });

  ws.on("close", () => { console.log(`User disconnected: ${ws.id}`); broadcast({ type: "presence:leave", id: ws.id }, ws); });
  ws.on("error", (err) => console.error(`WS error from ${ws.id}:`, err.message));
  ws.on("pong", () => { ws.isAlive = true; });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 30_000);
wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`HTTP  : http://localhost:${PORT}`);
  console.log(`WS    : ws://localhost:${PORT}`);
});

7) 개발 실행 (nodemon) 및 정상 기동 확인
npm run dev

콘솔 출력:
HTTP  : http://localhost:4000
WS    : ws://localhost:4000

8) 헬스 체크
브라우저에서:
http://localhost:4000/health


→ { "ok": true, "uptime": ... } 확인

9) 테스트 페이지 작성 public/test.html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WebSocket Test</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; }
    #log { border: 1px solid #ccc; padding: 12px; height: 320px; overflow: auto; margin-bottom: 12px; }
    input, button { font-size: 16px; padding: 8px; }
    form { display: flex; gap: 8px; }
    input { flex: 1; }
  </style>
</head>
<body>
  <h1>WebSocket Test</h1>
  <p>Status: <span id="status">connecting...</span></p>
  <div id="log"></div>
  <form id="form">
    <input id="msg" placeholder="Type message..." autofocus />
    <button>Send</button>
  </form>

  <script>
    const status = document.getElementById("status");
    const log = document.getElementById("log");
    const form = document.getElementById("form");
    const input = document.getElementById("msg");
    const ws = new WebSocket(`ws://${location.host}`);

    const add = (line) => { const p = document.createElement("div"); p.textContent = line; log.appendChild(p); log.scrollTop = log.scrollHeight; };

    ws.addEventListener("open", () => { status.textContent = "connected"; add("✅ Connected"); });
    ws.addEventListener("message", (ev) => { try { add("⬇ " + JSON.stringify(JSON.parse(ev.data))); } catch { add("⬇ " + ev.data); } });
    ws.addEventListener("close", () => { status.textContent = "closed"; add("❌ Disconnected"); });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim(); if (!text) return;
      const payload = { type: "chat", text };
      ws.send(JSON.stringify(payload));
      add("⬆ " + JSON.stringify(payload));
      input.value = "";
    });
  </script>
</body>
</html>


브라우저에서:

http://localhost:4000/test.html


→ 탭 2개 열고 서로 메시지 입력 → 브로드캐스트 정상 동작 확인

10) GitHub 업로드 API 동작 테스트(옵션)

PowerShell
$BODY = @{
  path = "notes/hello.txt"
  contentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("hello from server"))
  message = "upload hello.txt from API"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:4000/upload" -ContentType "application/json" -Body $BODY


curl (mac/Linux/WSL)
curl -X POST http://localhost:4000/upload \
  -H "Content-Type: application/json" \
  -d '{"path":"notes/hello.txt","contentBase64":"aGVsbG8gZnJvbSBzZXJ2ZXI=","message":"upload hello.txt from API"}'


성공하면 응답에 url이 포함되고, GitHub taskverse 레포에 notes/hello.txt가 생성됩니다.

📁 디렉터리 구조
metaverse-server/
├── node_modules/
├── public/
│   └── test.html
├── .env
├── .gitignore
├── package.json
└── server.js

🔌 WebSocket 메시지 타입 (현재)

welcome : 최초 접속 환영 { type, id, msg }
presence:join / presence:leave : 참가자 입퇴장 { type, id }
chat : 채팅 브로드캐스트 { type:"chat", from, text }
whiteboard:op : 화이트보드 스트로크 공유 { type:"whiteboard:op", from, op }
slide:goto : 발표 슬라이드 인덱스 동기화 { type:"slide:goto", page, from }
echo : 정의되지 않은 타입 에코

🔐 보안/비밀 관리

.env는 절대 커밋 금지 (토큰 노출 방지)

GH_TOKEN은 Fine-grained 토큰 권장
Repository access: 특정 레포 선택
Permissions → Contents: Read & Write
토큰 노출 시 즉시 Revoke 후 재발급

.env.example 보고 .env 파일 만들기
-> 토큰, 오너 수정 본인에 맞게
