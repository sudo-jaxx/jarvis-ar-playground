
const q = new URLSearchParams(location.search);
const room = q.get("room");
const token = q.get("token");

const state = document.querySelector("#state");
const video = document.querySelector("#cameraPreview");
const canvas = document.querySelector("#process");
const metrics = document.querySelector("#metrics");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const ctx = canvas.getContext("2d");

let ws = null;
let stream = null;
let landmarker = null;

let active = false;
let mode = "avatars";
let processing = false;
let frames = 0;
let lastPose = 0;
let lastFrame = 0;
let reconnectTimer = null;
let runId = 0;

function status(message) {
  state.textContent = message;
  console.log("[JARVIS]", message);
}

function info(message) {
  metrics.textContent = message;
  console.log("[JARVIS]", message);
}

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function connect(id) {
  if (!active || id !== runId) return;

  if (!room || !token) {
    status("Camera active — missing room credentials");
    return;
  }

  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";

  const url = new URL(
    `${protocol}//${location.host}/api/room/${encodeURIComponent(room)}/ws`
  );

  url.searchParams.set("role", "camera");
  url.searchParams.set("token", token);

  status("Connecting to game display...");

  try {
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      if (!active || id !== runId || ws !== socket) return;

      status("Connected to game display");
      info("Connected — checking motion tracking...");
    };

    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "config") {
          mode = data.mode || "avatars";
          console.log("[JARVIS] Display mode:", mode);
        }
      } catch (error) {
        console.warn("[JARVIS] Invalid message:", error);
      }
    };

    socket.onerror = () => {
      if (active && id === runId && ws === socket) {
        status("WebSocket connection error");
      }
    };

    socket.onclose = event => {
      if (!active || id !== runId || ws !== socket) return;

      ws = null;

      if ([1008, 4001, 4003].includes(event.code)) {
        status("Room authorization failed — create a new room");
        return;
      }

      status("Display disconnected — reconnecting...");

      clearTimeout(reconnectTimer);

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(id);
      }, 2500);
    };
  } catch (error) {
    status("Connection error: " + error.message);
  }
}

async function setupTracker() {
  info("Step 1/4: Importing MediaPipe...");

  const { PoseLandmarker, FilesetResolver } =
    await import(
      "https://esm.sh/@mediapipe/tasks-vision@0.10.22"
    );

  info("Step 2/4: Loading MediaPipe WASM...");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );

  info("Step 3/4: Loading pose detection model...");

  const tracker = await PoseLandmarker.createFromOptions(
    vision,
    {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numPoses: 4,
      minPoseDetectionConfidence: 0.45,
      minTrackingConfidence: 0.4
    }
  );

  info("Step 4/4: MediaPipe initialized successfully");

  return tracker;
}

function loop(now, id) {
  if (!active || id !== runId) return;

  requestAnimationFrame(t => loop(t, id));

  if (
    processing ||
    !landmarker ||
    video.readyState < 2 ||
    now - lastPose < 85
  ) {
    return;
  }

  processing = true;
  lastPose = now;

  try {
    const result = landmarker.detectForVideo(
      video,
      performance.now()
    );

    const poses = (result.landmarks || [])
      .slice(0, 4)
      .map(points =>
        points.map(p => [
          +p.x.toFixed(3),
          +p.y.toFixed(3),
          +(p.visibility ?? 0).toFixed(2)
        ])
      );

    send({
      type: "pose",
      poses,
      time: Date.now()
    });

    frames++;

    if (mode === "ar" && now - lastFrame > 200) {
      lastFrame = now;

      canvas.width = 320;
      canvas.height = 180;

      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      send({
        type: "frame",
        image: canvas.toDataURL("image/jpeg", 0.38)
      });
    }

    info(
      `Players: ${poses.length} | ` +
      `Updates: ${frames} | ` +
      `Server: ${
        ws?.readyState === WebSocket.OPEN
          ? "Online"
          : "Offline"
      }`
    );

  } catch (error) {
    console.error("[JARVIS] Tracking error:", error);
    status("Tracking error: " + error.message);
    info("Detection failed: " + error.message);
  } finally {
    processing = false;
  }
}

start.onclick = async () => {
  if (active) return;

  const id = ++runId;
  start.disabled = true;

  status("Requesting camera...");
  info("Initializing camera...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera API unavailable. Open this site using HTTPS."
      );
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await video.play();

    if (id !== runId) return;

    active = true;
    stop.disabled = false;

    status("Camera preview working");
    info("Camera started successfully");

    connect(id);

    try {
      landmarker = await setupTracker();

      if (!active || id !== runId) {
        landmarker.close();
        landmarker = null;
        return;
      }

      console.log(
        "[JARVIS] MediaPipe initialized successfully"
      );

      info("Tracking model loaded — starting detection...");

      requestAnimationFrame(t => loop(t, id));

      info("Tracking loop starting...");

    } catch (error) {
      console.error("[JARVIS] MediaPipe failed:", error);

      status("Camera works — tracking failed");

      info(
        "Tracking failed: " +
        (error?.message || String(error))
      );
    }

  } catch (error) {
    console.error("[JARVIS] Camera error:", error);

    status("Camera error: " + error.message);
    info("Camera initialization failed");

    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    start.disabled = false;
  }
};

function shutdown() {
  runId++;
  active = false;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  ws?.close();
  ws = null;

  stream?.getTracks().forEach(track => track.stop());
  stream = null;

  video.srcObject = null;

  landmarker?.close();
  landmarker = null;

  processing = false;
  frames = 0;
  lastPose = 0;
  lastFrame = 0;

  start.disabled = false;
  stop.disabled = true;

  status("Camera stopped");
  info("Ready to restart");
}

stop.onclick = shutdown;

window.addEventListener("pagehide", shutdown);
