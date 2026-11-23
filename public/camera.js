
const params = new URLSearchParams(location.search);
const room = params.get("room");
const token = params.get("token");

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
let frames = 0;
let lastPose = 0;
let lastVideoTime = -1;
let runId = 0;
let reconnectTimer = null;
let arTimer = null;
let trackingTimer = null;
let trackingBusy = false;
let trackingReady = false;

function setStatus(message) {
  state.textContent = message;
  console.log("[JARVIS]", message);
}

function setMetrics(message) {
  metrics.textContent = message;
}

function send(data) {
  if (ws?.readyState !== WebSocket.OPEN) return false;

  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("[JARVIS] Send failed:", error);
    return false;
  }
}

function connect(id) {
  if (!active || id !== runId) return;

  if (!room || !token) {
    setStatus("Camera running — missing room link");
    return;
  }

  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";

  const url = new URL(
    `${protocol}//${location.host}/api/room/${encodeURIComponent(room)}/ws`
  );

  url.searchParams.set("role", "camera");
  url.searchParams.set("token", token);

  setStatus("Connecting to display...");

  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    if (!active || id !== runId || ws !== socket) return;

    setStatus("Camera connected to display");

    // Request the display's current mode.
    send({ type: "ping" });
  };

  socket.onmessage = event => {
    if (!active || id !== runId || ws !== socket) return;

    try {
      const data = JSON.parse(event.data);

      if (data.type === "config") {
        mode = data.mode === "ar" ? "ar" : "avatars";

        console.log("[JARVIS] Display mode:", mode);

        if (mode === "ar") {
          setStatus("Camera AR enabled");
        } else {
          setStatus(
            trackingReady
              ? "Body tracking active"
              : "Camera connected — loading tracking"
          );
        }
      }
    } catch (error) {
      console.warn("[JARVIS] Invalid server message:", error);
    }
  };

  socket.onerror = () => {
    if (ws === socket) {
      setStatus("Connection error");
    }
  };

  socket.onclose = event => {
    if (!active || id !== runId || ws !== socket) return;

    ws = null;

    if ([1008, 4001, 4003].includes(event.code)) {
      setStatus("Room authorization failed — create a new room");
      return;
    }

    setStatus("Disconnected — reconnecting...");

    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(id);
    }, 2500);
  };
}

// Camera AR runs separately from body tracking.
function sendARFrame() {
  if (
    !active ||
    mode !== "ar" ||
    video.readyState < 2 ||
    ws?.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  try {
    canvas.width = 320;
    canvas.height = 180;

    ctx.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const image = canvas.toDataURL("image/jpeg", 0.38);

    // Keep the frame below the Worker's message limit.
    if (image.length > 110000) {
      console.warn("[JARVIS] AR frame too large");
      return;
    }

    send({
      type: "frame",
      image
    });
  } catch (error) {
    console.error("[JARVIS] AR frame error:", error);
  }
}

async function setupTracker() {
  setMetrics("Step 1/4: Importing MediaPipe...");

  const { PoseLandmarker, FilesetResolver } =
    await import(
      "https://esm.sh/@mediapipe/tasks-vision@0.10.22"
    );

  setMetrics("Step 2/4: Loading MediaPipe WASM...");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );

  setMetrics("Step 3/4: Loading pose model...");

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

  setMetrics("Step 4/4: Tracking model ready");

  return tracker;
}

function track() {
  if (
    !active ||
    !trackingReady ||
    !landmarker ||
    trackingBusy ||
    video.readyState < 2
  ) {
    return;
  }

  // Avoid processing the same video frame twice.
  if (video.currentTime === lastVideoTime) return;

  trackingBusy = true;

  try {
    lastVideoTime = video.currentTime;

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
    lastPose = Date.now();

    setMetrics(
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
    setMetrics("Tracking error: " + error.message);
  } finally {
    trackingBusy = false;
  }
}

start.onclick = async () => {
  if (active) return;

  const id = ++runId;
  start.disabled = true;

  setStatus("Requesting camera...");
  setMetrics("Starting camera...");

  try {
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

    setStatus("Camera preview working");
    setMetrics("Camera ready — connecting...");

    connect(id);

    // Camera AR starts immediately, without MediaPipe.
    arTimer = setInterval(sendARFrame, 250);

    // Load tracking separately.
    try {
      const tracker = await setupTracker();

      if (!active || id !== runId) {
        tracker.close();
        return;
      }

      landmarker = tracker;
      trackingReady = true;

      setMetrics("Tracking model loaded — starting detection");

      trackingTimer = setInterval(track, 100);

      setStatus(
        mode === "ar"
          ? "Camera AR enabled"
          : "Body tracking ready"
      );
    } catch (error) {
      console.error("[JARVIS] MediaPipe failed:", error);

      trackingReady = false;

      setMetrics(
        "Tracking unavailable: " +
        (error?.message || String(error))
      );

      setStatus(
        "Camera connected — AR available, tracking unavailable"
      );
    }
  } catch (error) {
    console.error("[JARVIS] Camera error:", error);

    setStatus("Camera error: " + error.message);
    setMetrics("Camera failed to start");

    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    start.disabled = false;
  }
};

function shutdown() {
  runId++;
  active = false;

  clearTimeout(reconnectTimer);
  clearInterval(arTimer);
  clearInterval(trackingTimer);

  reconnectTimer = null;
  arTimer = null;
  trackingTimer = null;

  ws?.close();
  ws = null;

  stream?.getTracks().forEach(track => track.stop());
  stream = null;

  video.srcObject = null;

  landmarker?.close();
  landmarker = null;

  trackingReady = false;
  trackingBusy = false;
  frames = 0;
  lastPose = 0;
  lastVideoTime = -1;
  mode = "avatars";

  start.disabled = false;
  stop.disabled = true;

  setStatus("Camera stopped");
  setMetrics("Ready");
}

stop.onclick = shutdown;

window.addEventListener("pagehide", shutdown);
