
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });

const roomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(x => x.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create" && request.method === "POST") {
      const room = roomId();
      const host = crypto.randomUUID();
      const camera = crypto.randomUUID();

      const id = env.ROOMS.idFromName(room);
      const stub = env.ROOMS.get(id);

      const response = await stub.fetch("https://room/init", {
        method: "POST",
        body: JSON.stringify({ host, camera })
      });

      if (!response.ok) {
        return json({ error: "Room initialization failed" }, 500);
      }

      return json({ room, host, camera });
    }

    const match = url.pathname.match(
      /^\/api\/room\/([A-F0-9]{8})\/ws$/
    );

    if (match) {
      const stub = env.ROOMS.get(
        env.ROOMS.idFromName(match[1])
      );

      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class PlaygroundRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (await this.state.storage.get("auth")) {
        return json({ error: "Already initialized" }, 409);
      }

      await this.state.storage.put(
        "auth",
        await request.json()
      );

      return json({ ok: true });
    }

    if (!url.pathname.endsWith("/ws")) {
      return json({ error: "Not found" }, 404);
    }

    if (
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return json({ error: "WebSocket required" }, 426);
    }

    const auth = await this.state.storage.get("auth");
    const token = url.searchParams.get("token");
    const role = url.searchParams.get("role");

    if (
      !auth ||
      !["host", "camera"].includes(role) ||
      token !== auth[role]
    ) {
      return json({ error: "Invalid room credentials" }, 403);
    }

    const pair = new WebSocketPair();
    const client = pair[1];

    client.accept();

    const previous = this.clients.get(role);

    if (previous) {
      try {
        previous.close(4000, "Replaced by new connection");
      } catch {}
    }

    this.clients.set(role, client);

    const otherRole = role === "camera" ? "host" : "camera";
    const otherClient = this.clients.get(otherRole);

    function sendTo(socket, message) {
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          console.error("WebSocket send failed:", error);
        }
      }
    }

    client.addEventListener("message", event => {
      if (this.clients.get(role) !== client) return;

      if (
        typeof event.data !== "string" ||
        event.data.length > 120000
      ) {
        return;
      }

      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (
        !data ||
        !["pose", "frame", "config", "ping"].includes(data.type)
      ) {
        return;
      }

      if (
        role === "camera" &&
        !["pose", "frame", "ping"].includes(data.type)
      ) {
        return;
      }

      if (
        role === "host" &&
        !["config", "ping"].includes(data.type)
      ) {
        return;
      }

      if (
        data.type === "frame" &&
        (
          typeof data.image !== "string" ||
          !data.image.startsWith("data:image/jpeg;base64,") ||
          data.image.length > 110000
        )
      ) {
        return;
      }

      const targetRole =
        role === "host" ? "camera" : "host";

      const target = this.clients.get(targetRole);

      if (target?.readyState === WebSocket.OPEN) {
        try {
          target.send(event.data);
        } catch (error) {
          console.error("Relay failed:", error);
        }
      }
    });

    client.addEventListener("close", () => {
      if (this.clients.get(role) !== client) return;

      this.clients.delete(role);

      sendTo(this.clients.get(otherRole), {
        type: "peer-disconnected",
        role
      });
    });

    client.addEventListener("error", () => {
      console.error("WebSocket client error:", role);
    });

    sendTo(client, {
      type: "connected",
      role
    });

    if (otherClient?.readyState === WebSocket.OPEN) {
      sendTo(otherClient, {
        type: "peer-connected",
        role
      });

      sendTo(client, {
        type: "peer-connected",
        role: otherRole
      });
    }

    return new Response(null, {
      status: 101,
      webSocket: pair[0]
    });
  }
}
