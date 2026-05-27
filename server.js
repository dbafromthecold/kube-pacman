const express = require("express");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const app = express();
const port = process.env.PORT || 8080;
const targetNamespace = process.env.TARGET_NAMESPACE || "default";
const serviceAccountPath = "/var/run/secrets/kubernetes.io/serviceaccount";
const startedAt = new Date();
const chaos = {
  enabled: process.env.CHAOS_ENABLED === "true",
  healthy: true,
  ready: true,
  latencyMs: 0
};

app.use(express.json());

app.use((req, res, next) => {
  const latency = chaos.enabled ? chaos.latencyMs : 0;
  if (latency > 0 && !req.path.startsWith("/api/chaos")) {
    setTimeout(next, latency);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

function getKubernetesClient() {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const kubePort = process.env.KUBERNETES_SERVICE_PORT || "443";

  if (!host) {
    return null;
  }

  return {
    host,
    port: kubePort,
    token: fs.readFileSync(path.join(serviceAccountPath, "token"), "utf8"),
    ca: fs.readFileSync(path.join(serviceAccountPath, "ca.crt"))
  };
}

function kubernetesRequest(method, requestPath) {
  const client = getKubernetesClient();

  if (!client) {
    return Promise.resolve({
      statusCode: 503,
      body: {
        error: "Kubernetes service environment variables are not present. Run inside a cluster to manage pods."
      }
    });
  }

  const options = {
    method,
    hostname: client.host,
    port: client.port,
    path: requestPath,
    ca: client.ca,
    headers: {
      Authorization: `Bearer ${client.token}`,
      Accept: "application/json"
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (response) => {
      let raw = "";
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        let body = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = { raw };
          }
        }
        resolve({ statusCode: response.statusCode || 500, body });
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function podSummary(pod) {
  return {
    name: pod.metadata?.name,
    namespace: pod.metadata?.namespace,
    nodeName: pod.spec?.nodeName || "pending",
    podIp: pod.status?.podIP || "pending",
    phase: pod.status?.phase || "Unknown",
    owner: pod.metadata?.ownerReferences?.[0]?.kind || "Pod",
    createdAt: pod.metadata?.creationTimestamp
  };
}

app.get("/api/status", (_req, res) => {
  res.json({
    app: "kube-pacman",
    status: "ok",
    podName: process.env.POD_NAME || os.hostname(),
    namespace: process.env.POD_NAMESPACE || "local",
    nodeName: process.env.NODE_NAME || "local",
    podIp: process.env.POD_IP || "127.0.0.1",
    targetNamespace,
    version: process.env.APP_VERSION || "dev",
    uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    startedAt: startedAt.toISOString(),
    chaos: {
      enabled: chaos.enabled,
      healthy: chaos.healthy,
      ready: chaos.ready,
      latencyMs: chaos.latencyMs
    }
  });
});

app.get("/api/pods", async (_req, res) => {
  try {
    const path = `/api/v1/namespaces/${encodeURIComponent(targetNamespace)}/pods`;
    const result = await kubernetesRequest("GET", path);

    if (result.statusCode >= 400) {
      res.status(result.statusCode).json(result.body);
      return;
    }

    const pods = (result.body.items || [])
      .filter((pod) => pod.status?.phase === "Running" && !pod.metadata?.deletionTimestamp)
      .map(podSummary)
      .filter((pod) => pod.name);

    res.json({ namespace: targetNamespace, pods });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/pods/:name", async (req, res) => {
  try {
    const podName = req.params.name;
    const path = `/api/v1/namespaces/${encodeURIComponent(targetNamespace)}/pods/${encodeURIComponent(podName)}`;
    const result = await kubernetesRequest("DELETE", path);

    if (result.statusCode >= 400) {
      res.status(result.statusCode).json(result.body);
      return;
    }

    res.json({ deleted: podName, namespace: targetNamespace });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use("/api/chaos", (req, res, next) => {
  if (!chaos.enabled) {
    res.status(403).json({ error: "Chaos endpoints are disabled. Set CHAOS_ENABLED=true to enable them." });
    return;
  }
  next();
});

app.post("/api/chaos/latency", (req, res) => {
  const ms = Number(req.query.ms ?? req.body.ms ?? 0);
  chaos.latencyMs = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 10000)) : 0;
  res.json({ latencyMs: chaos.latencyMs });
});

app.post("/api/chaos/health", (req, res) => {
  chaos.healthy = String(req.query.healthy ?? req.body.healthy ?? "true") === "true";
  res.json({ healthy: chaos.healthy });
});

app.post("/api/chaos/readiness", (req, res) => {
  chaos.ready = String(req.query.ready ?? req.body.ready ?? "true") === "true";
  res.json({ ready: chaos.ready });
});

app.post("/api/chaos/terminate", (req, res) => {
  const delayMs = Number(req.query.delayMs ?? req.body.delayMs ?? 1000);
  res.json({ terminatingInMs: delayMs });
  setTimeout(() => process.exit(42), Math.max(0, Math.min(delayMs, 10000)));
});

app.get("/healthz", (_req, res) => {
  if (!chaos.healthy) {
    res.status(500).send("unhealthy by chaos endpoint");
    return;
  }
  res.status(200).send("ok");
});

app.get("/readyz", (_req, res) => {
  if (!chaos.ready) {
    res.status(503).send("not ready by chaos endpoint");
    return;
  }
  res.status(200).send("ready");
});

app.listen(port, () => {
  console.log(`kube-pacman listening on ${port}`);
});
