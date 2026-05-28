const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const tile = 32;
const layout = [
  "###################",
  "#........#........#",
  "#.###.##.#.##.###.#",
  "#o# #.##.#.##.# #o#",
  "#.###.##.#.##.###.#",
  "#.................#",
  "#.###.#.#####.#.###",
  "#.....#...#...#...#",
  "#####.### # ###.###",
  "    #.#       #.#  ",
  "#####.# ## ## #.###",
  "     .  #   #  .   ",
  "#####.# ##### #.###",
  "    #.#       #.#  ",
  "#####.# ##### #.###",
  "#........#........#",
  "#.###.##.#.##.###.#",
  "#o..#....P....#..o#",
  "###.#.#.#####.#.###",
  "#.....#...#...#...#",
  "#.#######.#.#######",
  "#.................#",
  "###################"
];

const state = {
  score: 0,
  lives: 3,
  level: 1,
  paused: false,
  autoPlay: false,
  over: false,
  frightUntil: 0,
  pellets: new Map(),
  deleting: new Set(),
  player: null,
  ghosts: [],
  podNamespace: "default",
  activity: [],
  knownPods: null,
  pendingReplacements: 0
};

const dirs = {
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 }
};

const moveOptions = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];

const ghostSeeds = [
  { x: 8, y: 10, color: "#ff5d73", name: "pod-killer" },
  { x: 9, y: 10, color: "#35d0ff", name: "latency" },
  { x: 10, y: 10, color: "#ff9f43", name: "cpu-burn" },
  { x: 9, y: 13, color: "#c77dff", name: "node-drain" }
];

function key(x, y) {
  return `${x},${y}`;
}

function isWall(x, y) {
  return y < 0 || y >= layout.length || x < 0 || x >= layout[y].length || layout[y][x] === "#";
}

function center(entity) {
  return {
    x: entity.x * tile + tile / 2,
    y: entity.y * tile + tile / 2
  };
}

function resetLevel() {
  state.pellets.clear();

  layout.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === "P") {
        state.player = { x, y, dir: { x: 0, y: 0 }, next: { x: 0, y: 0 } };
      }
    });
  });

  state.ghosts = ghostSeeds.map((ghost, index) => ({
    ...ghost,
    home: { x: ghost.x, y: ghost.y },
    dir: index % 2 === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }
  }));
}

function resetGame() {
  state.score = 0;
  state.lives = 3;
  state.level = 1;
  state.paused = false;
  state.autoPlay = false;
  state.over = false;
  state.frightUntil = 0;
  state.activity = [];
  state.knownPods = null;
  state.pendingReplacements = 0;
  resetLevel();
  loadPods();
  updateHud();
  updateAutoPlayButton();
  renderActivity();
  setMessage("Use arrow keys or WASD.");
}

function updateHud() {
  document.querySelector("#score").textContent = state.score;
  document.querySelector("#lives").textContent = state.lives;
  document.querySelector("#level").textContent = state.pellets.size;
}

function setMessage(text) {
  document.querySelector("#message").textContent = text;
}

function updateAutoPlayButton() {
  const button = document.querySelector("#autoPlay");
  button.textContent = state.autoPlay ? "Manual Play" : "Auto Play";
  button.setAttribute("aria-pressed", String(state.autoPlay));
}

function addActivity(type, text) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    text,
    time: new Date()
  };

  state.activity.unshift(event);
  state.activity = state.activity.slice(0, 8);
  renderActivity();
}

function renderActivity() {
  const feed = document.querySelector("#activityFeed");
  feed.replaceChildren();

  if (state.activity.length === 0) {
    const item = document.createElement("li");
    item.className = "activity-empty";
    item.textContent = "Waiting for pod changes.";
    feed.append(item);
    return;
  }

  state.activity.forEach((event) => {
    const item = document.createElement("li");
    item.className = `activity-item activity-${event.type}`;

    const marker = document.createElement("span");
    marker.className = "activity-marker";
    marker.setAttribute("aria-hidden", "true");

    const detail = document.createElement("span");
    detail.className = "activity-detail";
    detail.textContent = event.text;

    const time = document.createElement("time");
    time.dateTime = event.time.toISOString();
    time.textContent = event.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    item.append(marker, detail, time);
    feed.append(item);
  });
}

function movePlayer() {
  if (state.autoPlay) {
    state.player.next = chooseAutoDirection();
  }

  const nextX = state.player.x + state.player.next.x;
  const nextY = state.player.y + state.player.next.y;
  if (!isWall(nextX, nextY)) state.player.dir = state.player.next;

  const x = state.player.x + state.player.dir.x;
  const y = state.player.y + state.player.dir.y;
  if (!isWall(x, y)) {
    state.player.x = x;
    state.player.y = y;
  }

  const id = key(state.player.x, state.player.y);
  const pod = state.pellets.get(id);
  if (pod && !state.deleting.has(pod.name)) {
    eatPod(id, pod);
  }
}

async function eatPod(id, pod) {
  state.deleting.add(pod.name);
  state.pellets.delete(id);
  state.score += 100;
  updateHud();
  setMessage(`Deleting pod ${pod.name}...`);
  addActivity("deleting", `Deleting ${pod.name}`);

  try {
    const response = await fetch(`/api/pods/${encodeURIComponent(pod.name)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || body.error || `HTTP ${response.status}`);
    }
    setMessage(`Deleted ${pod.name}.`);
    state.pendingReplacements += 1;
    addActivity("deleted", `Deleted ${pod.name}`);
    setTimeout(loadPods, 2500);
  } catch (error) {
    state.pellets.set(id, pod);
    setMessage(`Could not delete ${pod.name}: ${error.message}`);
    addActivity("error", `Delete failed for ${pod.name}`);
  } finally {
    state.deleting.delete(pod.name);
    updateHud();
  }
}

function moveGhost(ghost) {
  const frightened = performance.now() < state.frightUntil;
  const options = moveOptions.filter((dir) => !isWall(ghost.x + dir.x, ghost.y + dir.y));

  const opposite = { x: -ghost.dir.x, y: -ghost.dir.y };
  const usable = options.length > 1
    ? options.filter((dir) => dir.x !== opposite.x || dir.y !== opposite.y)
    : options;

  usable.sort((a, b) => {
    const da = distance(ghost.x + a.x, ghost.y + a.y, state.player.x, state.player.y);
    const db = distance(ghost.x + b.x, ghost.y + b.y, state.player.x, state.player.y);
    return frightened ? db - da : da - db;
  });

  const chaos = Math.random() < (frightened ? 0.45 : 0.18);
  ghost.dir = chaos ? usable[Math.floor(Math.random() * usable.length)] : usable[0];
  ghost.x += ghost.dir.x;
  ghost.y += ghost.dir.y;
}

function distance(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function chooseAutoDirection() {
  if (state.pellets.size === 0) {
    return state.player.dir;
  }

  return findPathToPod(true) || findPathToPod(false) || safestDirection() || state.player.dir;
}

function findPathToPod(avoidGhosts) {
  const startId = key(state.player.x, state.player.y);
  const targets = new Set(state.pellets.keys());
  const danger = ghostDangerCells();
  const queue = [{ x: state.player.x, y: state.player.y, first: null }];
  const visited = new Set([startId]);

  while (queue.length > 0) {
    const current = queue.shift();
    const currentId = key(current.x, current.y);

    if (targets.has(currentId) && currentId !== startId) {
      return current.first || { x: 0, y: 0 };
    }

    const options = moveOptions
      .filter((dir) => !isWall(current.x + dir.x, current.y + dir.y))
      .sort((a, b) => scoreAutoStep(current.x, current.y, b) - scoreAutoStep(current.x, current.y, a));

    options.forEach((dir) => {
      const x = current.x + dir.x;
      const y = current.y + dir.y;
      const id = key(x, y);

      if (visited.has(id) || (avoidGhosts && danger.has(id))) {
        return;
      }

      visited.add(id);
      queue.push({
        x,
        y,
        first: current.first || dir
      });
    });
  }

  return null;
}

function ghostDangerCells() {
  const danger = new Set();

  state.ghosts.forEach((ghost) => {
    danger.add(key(ghost.x, ghost.y));
    moveOptions.forEach((dir) => {
      const x = ghost.x + dir.x;
      const y = ghost.y + dir.y;
      if (!isWall(x, y)) {
        danger.add(key(x, y));
      }
    });
  });

  return danger;
}

function scoreAutoStep(x, y, dir) {
  const nextX = x + dir.x;
  const nextY = y + dir.y;
  const nearestGhost = state.ghosts.reduce(
    (nearest, ghost) => Math.min(nearest, distance(nextX, nextY, ghost.x, ghost.y)),
    Infinity
  );
  const nearestPod = [...state.pellets.keys()].reduce((nearest, id) => {
    const [podX, podY] = id.split(",").map(Number);
    return Math.min(nearest, distance(nextX, nextY, podX, podY));
  }, Infinity);

  return nearestGhost * 4 - nearestPod;
}

function safestDirection() {
  return moveOptions
    .filter((dir) => !isWall(state.player.x + dir.x, state.player.y + dir.y))
    .sort((a, b) => scoreAutoStep(state.player.x, state.player.y, b) - scoreAutoStep(state.player.x, state.player.y, a))[0];
}

function collisions() {
  for (const ghost of state.ghosts) {
    if (ghost.x !== state.player.x || ghost.y !== state.player.y) continue;

    if (performance.now() < state.frightUntil) {
      state.score += 200;
      ghost.x = ghost.home.x;
      ghost.y = ghost.home.y;
      setMessage(`${ghost.name} recovered.`);
      continue;
    }

    state.lives -= 1;
    if (state.lives <= 0) {
      state.over = true;
      setMessage("Workload failed. Restart the deployment.");
    } else {
      const start = findPlayerStart();
      state.player.x = start.x;
      state.player.y = start.y;
      state.player.dir = { x: 0, y: 0 };
      state.ghosts.forEach((item) => {
        item.x = item.home.x;
        item.y = item.home.y;
      });
      setMessage("Pac-Man rescheduled. Keep going.");
    }
  }
}

function findPlayerStart() {
  for (let y = 0; y < layout.length; y += 1) {
    const x = layout[y].indexOf("P");
    if (x >= 0) return { x, y };
  }
  return { x: 9, y: 17 };
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#02040a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layout.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === "#") {
        ctx.fillStyle = "#1a4fff";
        ctx.fillRect(x * tile + 3, y * tile + 3, tile - 6, tile - 6);
        ctx.strokeStyle = "#63ddff";
        ctx.strokeRect(x * tile + 5, y * tile + 5, tile - 10, tile - 10);
      }
    });
  });

  state.pellets.forEach((pod, id) => {
    const [x, y] = id.split(",").map(Number);
    ctx.fillStyle = state.deleting.has(pod.name) ? "#ff9f43" : "#e6edf7";
    ctx.beginPath();
    ctx.arc(x * tile + tile / 2, y * tile + tile / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    if (pod.name.length > 0) {
      ctx.fillStyle = "#9aa7bd";
      ctx.font = "8px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(pod.name.slice(0, 7), x * tile + tile / 2, y * tile + tile - 5);
    }
  });
}

function drawPlayer() {
  const pos = center(state.player);
  const angle = Math.atan2(state.player.dir.y, state.player.dir.x || 1);
  const mouth = 0.18 + Math.abs(Math.sin(performance.now() / 120)) * 0.25;

  ctx.fillStyle = "#ffd43b";
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.arc(pos.x, pos.y, 13, angle + mouth, angle + Math.PI * 2 - mouth);
  ctx.closePath();
  ctx.fill();
}

function drawGhost(ghost) {
  const pos = center(ghost);
  const frightened = performance.now() < state.frightUntil;
  ctx.fillStyle = frightened ? "#2547d8" : ghost.color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y - 2, 13, Math.PI, 0);
  ctx.lineTo(pos.x + 13, pos.y + 12);
  ctx.lineTo(pos.x + 6, pos.y + 7);
  ctx.lineTo(pos.x, pos.y + 12);
  ctx.lineTo(pos.x - 6, pos.y + 7);
  ctx.lineTo(pos.x - 13, pos.y + 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(pos.x - 5, pos.y - 3, 3, 0, Math.PI * 2);
  ctx.arc(pos.x + 5, pos.y - 3, 3, 0, Math.PI * 2);
  ctx.fill();
}

let lastTick = 0;
let ghostTick = 0;
function loop(now) {
  if (!state.paused && !state.over && now - lastTick > Math.max(85, 175 - state.level * 10)) {
    movePlayer();
    ghostTick += 1;
    if (ghostTick % 2 === 0) {
      state.ghosts.forEach(moveGhost);
    }
    collisions();
    updateHud();
    lastTick = now;
  }

  drawBoard();
  drawPlayer();
  state.ghosts.forEach(drawGhost);

  if (state.paused || state.over) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    ctx.fillStyle = "#f3f6ff";
    ctx.font = "bold 28px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(state.over ? "GAME OVER" : "PAUSED", canvas.width / 2, canvas.height / 2 + 10);
  }

  requestAnimationFrame(loop);
}

document.addEventListener("keydown", (event) => {
  if (dirs[event.code]) {
    state.autoPlay = false;
    updateAutoPlayButton();
    state.player.next = dirs[event.code];
    event.preventDefault();
  }
  if (event.code === "Space") state.paused = !state.paused;
});

document.querySelector("#restart").addEventListener("click", resetGame);
document.querySelector("#pause").addEventListener("click", () => {
  state.paused = !state.paused;
  document.querySelector("#pause").textContent = state.paused ? "Resume" : "Pause";
});
document.querySelector("#autoPlay").addEventListener("click", () => {
  state.autoPlay = !state.autoPlay;
  updateAutoPlayButton();
  setMessage(state.autoPlay ? "Auto play is steering toward pods." : "Manual play enabled.");
});
document.querySelector("#clearActivity").addEventListener("click", () => {
  state.activity = [];
  renderActivity();
});

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    document.querySelector("#podLine").textContent = `${status.podName} in ${status.namespace}`;
    document.querySelector("#podName").textContent = status.podName;
    document.querySelector("#namespace").textContent = status.namespace;
    document.querySelector("#nodeName").textContent = status.nodeName;
    document.querySelector("#podIp").textContent = status.podIp;
    document.querySelector("#uptime").textContent = `${status.uptimeSeconds}s`;
    state.podNamespace = status.targetNamespace || "default";
    document.querySelector("#targetNamespace").textContent = state.podNamespace;
    if (status.chaos?.latencyMs > 0) {
      setMessage(`Injected latency: ${status.chaos.latencyMs}ms.`);
    }
  } catch {
    document.querySelector("#podLine").textContent = "Running locally";
  }
}

function podCells() {
  const cells = [];
  layout.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === "." || cell === "o") {
        cells.push({ x, y });
      }
    });
  });
  return cells;
}

function podCellIndex(podName, max) {
  let hash = 0;
  for (let i = 0; i < podName.length; i += 1) {
    hash = (hash * 31 + podName.charCodeAt(i)) >>> 0;
  }
  return max === 0 ? 0 : hash % max;
}

async function loadPods() {
  try {
    const response = await fetch("/api/pods");
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message || body.error || `HTTP ${response.status}`);
    }

    const currentPods = new Set(body.pods.map((pod) => pod.name));
    if (state.knownPods) {
      currentPods.forEach((podName) => {
        if (!state.knownPods.has(podName)) {
          const isReplacement = state.pendingReplacements > 0;
          addActivity("created", `${isReplacement ? "Replacement running" : "Running pod appeared"}: ${podName}`);
          state.pendingReplacements = Math.max(0, state.pendingReplacements - 1);
        }
      });
    }
    state.knownPods = currentPods;

    const cells = podCells();
    const used = new Set();
    state.pellets.clear();

    body.pods.forEach((pod) => {
      if (used.size >= cells.length) return;
      let index = podCellIndex(pod.name, cells.length);
      while (used.has(index)) {
        index = (index + 1) % cells.length;
      }
      used.add(index);
      const cell = cells[index];
      state.pellets.set(key(cell.x, cell.y), pod);
    });

    state.podNamespace = body.namespace || state.podNamespace;
    updateHud();
    setMessage(`${state.pellets.size} running pods mapped from ${state.podNamespace}.`);
  } catch (error) {
    setMessage(`Pod map unavailable: ${error.message}`);
  }
}

resetGame();
loadStatus();
setInterval(loadStatus, 5000);
setInterval(loadPods, 10000);
requestAnimationFrame(loop);
