
const q = new URLSearchParams(location.search);
const room = q.get("room");
const token = q.get("token");

let secrets = null;

try {
  secrets = JSON.parse(
    sessionStorage.getItem("jarvis-" + room) || "null"
  );
} catch {}

const camToken = secrets?.camera;

const link = room && camToken
  ? `${location.origin}/camera.html?room=${encodeURIComponent(room)}&token=${encodeURIComponent(camToken)}`
  : "";

const linkEl = document.querySelector("#link");

linkEl.textContent = link ||
  "Camera link unavailable. Create a new room.";

document.querySelector("#copy").onclick = async () => {
  if (!link) return;

  try {
    await navigator.clipboard.writeText(link);
  } catch (error) {
    console.error("Copy failed:", error);
    linkEl.textContent = link;
  }
};

const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d");
const bg = document.querySelector("#videoBg");
const mode = document.querySelector("#mode");
const scores = document.querySelector("#scores");
const status = document.querySelector("#connection");

const colors = [
  "#3ddcff",
  "#ffb648",
  "#a3ff73",
  "#ed8cff"
];

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let stopped = false;
let cameraConnected = false;

let poses = [];
let lastPose = 0;
let points = [0, 0, 0, 0];
let stars = [];
let lastHit = new Map();

function spawn() {
  return {
    x: 90 + Math.random() * 780,
    y: 90 + Math.random() * 330,
    r: 24 + Math.random() * 8
  };
}

function reset() {
  points = [0, 0, 0, 0];
  stars = Array.from({ length: 5 }, spawn);
  lastHit.clear();
}

reset();

document.querySelector("#reset").onclick = reset;

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function updateStatus() {
  if (ws?.readyState !== WebSocket.OPEN) {
    status.textContent = "Display disconnected";
  } else if (!cameraConnected) {
    status.textContent = "Display connected — waiting for camera";
  } else if (Date.now() - lastPose < 2000) {
    status.textContent = "Camera connected — tracking active";
  } else {
    status.textContent = "Camera connected — waiting for tracking";
  }
}

function setMode() {
  bg.style.display =
    mode.value === "ar" ? "block" : "none";

  send({
    type: "config",
    mode: mode.value
  });
}

mode.onchange = setMode;
setMode();

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;

  const delay = Math.min(
    15000,
    1500 * 2 ** Math.min(reconnectAttempt++, 4)
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (stopped) return;

  if (!room || !token) {
    status.textContent =
      "Invalid display link — missing room credentials";
    return;
  }

  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";

  const url = new URL(
    `${protocol}//${location.host}/api/room/${encodeURIComponent(room)}/ws`
  );

  url.searchParams.set("role", "host");
  url.searchParams.set("token", token);

  status.textContent = "Connecting display...";

  let socket;

  try {
    socket = new WebSocket(url);
  } catch (error) {
    status.textContent =
      "Connection failed: " + error.message;

    scheduleReconnect();
    return;
  }

  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;

    reconnectAttempt = 0;
    cameraConnected = false;
    poses = [];
    lastPose = 0;

    updateStatus();
    setMode();
  };

  socket.onmessage = event => {
    if (ws !== socket) return;

    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      console.warn("Invalid server message");
      return;
    }

    if (data.type === "connected") {
      updateStatus();
    }

    if (
      data.type === "peer-connected" &&
      data.role === "camera"
    ) {
      cameraConnected = true;
      updateStatus();

      console.log("[JARVIS] Camera joined room");
    }

    if (
      data.type === "peer-disconnected" &&
      data.role === "camera"
    ) {
      cameraConnected = false;
      poses = [];
      lastPose = 0;

      updateStatus();

      console.log("[JARVIS] Camera left room");
    }

    if (data.type === "pose") {
      cameraConnected = true;

      poses = Array.isArray(data.poses)
        ? data.poses
        : [];

      lastPose = Date.now();

      updateStatus();
    }

    if (
      data.type === "frame" &&
      mode.value === "ar" &&
      typeof data.image === "string"
    ) {
      cameraConnected = true;
      bg.src = data.image;

      updateStatus();
    }
  };

  socket.onerror = () => {
    if (ws === socket) {
      status.textContent =
        "WebSocket error — checking connection...";
    }
  };

  socket.onclose = event => {
    if (ws !== socket || stopped) return;

    ws = null;
    cameraConnected = false;
    poses = [];
    lastPose = 0;

    if ([1008, 4001, 4003].includes(event.code)) {
      status.textContent =
        `Room authorization failed (${event.code}). Create a new room.`;
      return;
    }

    status.textContent =
      `Display disconnected (${event.code}) — reconnecting...`;

    scheduleReconnect();
  };
}

window.addEventListener("pagehide", () => {
  stopped = true;
  clearTimeout(reconnectTimer);
  ws?.close();
});

connect();

const bones = [
  [11,12], [11,13], [13,15],
  [12,14], [14,16], [11,23],
  [12,24], [23,24], [23,25],
  [25,27], [24,26], [26,28]
];

function drawPerson(p, i) {
  ctx.strokeStyle = colors[i];
  ctx.fillStyle = colors[i];
  ctx.lineWidth = 6;

  const xy = j => ({
    x: (1 - p[j][0]) * 960,
    y: p[j][1] * 540
  });

  for (const [a, b] of bones) {
    if (
      (p[a]?.[2] || 0) < 0.35 ||
      (p[b]?.[2] || 0) < 0.35
    ) {
      continue;
    }

    const A = xy(a);
    const B = xy(b);

    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }

  for (const j of [
    0, 11, 12, 15, 16, 23, 24, 27, 28
  ]) {
    if ((p[j]?.[2] || 0) < 0.35) continue;

    const A = xy(j);

    ctx.beginPath();
    ctx.arc(
      A.x,
      A.y,
      j === 0 ? 12 : 7,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  if (p[0]) {
    const a = xy(0);

    ctx.font = "bold 20px system-ui";
    ctx.fillText(
      "P" + (i + 1),
      a.x + 15,
      a.y - 15
    );
  }
}

function tick() {
  requestAnimationFrame(tick);

  ctx.clearRect(0, 0, 960, 540);

  if (mode.value === "avatars") {
    ctx.fillStyle = "#0d1930";
    ctx.fillRect(0, 0, 960, 540);

    ctx.strokeStyle = "#233a54";

    for (let x = 0; x < 960; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 540);
      ctx.stroke();
    }
  }

  ctx.font = "bold 28px system-ui";
  ctx.fillStyle = "#fff";
  ctx.fillText("STAR CATCH", 25, 45);

  for (const s of stars) {
    ctx.shadowBlur = 22;
    ctx.shadowColor = "#ffd348";
    ctx.fillStyle = "#ffe66a";

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  if (Date.now() - lastPose < 2000) {
    poses.forEach((p, i) => {
      if (
        i > 3 ||
        !Array.isArray(p) ||
        p.length < 29
      ) {
        return;
      }

      drawPerson(p, i);

      for (const j of [15, 16]) {
        if ((p[j]?.[2] || 0) < 0.55) continue;

        const x = (1 - p[j][0]) * 960;
        const y = p[j][1] * 540;

        for (let k = 0; k < stars.length; k++) {
          const s = stars[k];
          const key = i + "-" + j;

          if (
            Math.hypot(x - s.x, y - s.y) <
              s.r + 20 &&
            performance.now() -
              (lastHit.get(key) || 0) > 450
          ) {
            points[i]++;
            stars[k] = spawn();

            lastHit.set(
              key,
              performance.now()
            );
          }
        }
      }
    });

    scores.textContent =
      points
        .map((n, i) => `P${i + 1}: ${n}`)
        .join("  |  ") +
      ` · Tracking ${poses.length} player(s)`;
  } else {
    scores.textContent = cameraConnected
      ? "Camera connected — waiting for body tracking..."
      : "Waiting for camera...";

    ctx.fillStyle = "#d6e7ff";
    ctx.font = "24px system-ui";

    ctx.fillText(
      cameraConnected
        ? "Camera connected — initializing tracking"
        : "Open the private camera link on your iPhone",
      140,
      270
    );
  }
}

tick();

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    updateStatus();
  }
}, 1000);
