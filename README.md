# Kube Pac-Man

Inspired by kubeinvaders! https://github.com/lucky-sideburn/KubeInvaders

A small Pac-Man inspired game for Kubernetes chaos engineering demos. The game is served from a Node.js container and exposes pod metadata in the UI so players can see which pod, namespace, node, and pod IP are currently handling their session.

Dots on the board represent running pods in the `default` namespace. Eating a dot sends a Kubernetes API request to delete the corresponding pod.

## Run locally

```powershell
npm install
npm start
```

Open `http://localhost:8080`.

## Build the image

```powershell
docker build -t kube-pacman:latest .
```

For Kind:

```powershell
kind load docker-image kube-pacman:latest
```

## Deploy to Kubernetes

```powershell
kubectl apply -k k8s
kubectl -n kube-pacman get pods -o wide
kubectl -n kube-pacman port-forward svc/kube-pacman 8080:80
```

Open `http://localhost:8080`.

The app runs in the `kube-pacman` namespace, but its service account is granted `get`, `list`, `watch`, and `delete` permissions for pods in the `default` namespace only. Change `TARGET_NAMESPACE` in `k8s/deployment.yaml` and the namespace in `k8s/rbac.yaml` if you want the board to target a different namespace.

## Chaos engineering ideas

Start with a workload in the `default` namespace and watch the dots appear as running pods. When Pac-Man eats a dot, the app deletes that pod and Kubernetes should repair it if it is controlled by a Deployment, ReplicaSet, StatefulSet, DaemonSet, or similar controller.

```powershell
kubectl -n kube-pacman delete pod -l app.kubernetes.io/name=kube-pacman
kubectl -n kube-pacman scale deployment kube-pacman --replicas=1
kubectl -n kube-pacman scale deployment kube-pacman --replicas=5
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node-name>
```

The demo also includes opt-in chaos endpoints. The supplied Kubernetes manifest enables them with `CHAOS_ENABLED=true`.

```powershell
kubectl -n kube-pacman port-forward svc/kube-pacman 8080:80
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/latency?ms=1500"
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/readiness?ready=false"
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/health?healthy=false"
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/terminate?delayMs=1000"
```

Restore normal behavior:

```powershell
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/latency?ms=0"
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/readiness?ready=true"
Invoke-RestMethod -Method Post "http://localhost:8080/api/chaos/health?healthy=true"
```

Suggested observations:

- Pod deletion should briefly interrupt a connection, then the service should route to a replacement pod.
- Eating a dot should delete the mapped pod from the `default` namespace.
- Scaling down reduces redundancy and makes failures more visible.
- Draining a node tests rescheduling and the PodDisruptionBudget.
- CPU or network latency experiments should be visible as stutters, slow UI refreshes, or connection failures.

## Endpoints

- `/` serves the game.
- `/api/status` returns pod metadata and app uptime.
- `/api/pods` returns running pods from the target namespace.
- `DELETE /api/pods/:name` deletes one pod from the target namespace.
- `/api/chaos/latency?ms=1500` injects application latency.
- `/api/chaos/readiness?ready=false` fails readiness.
- `/api/chaos/health?healthy=false` fails liveness.
- `/api/chaos/terminate?delayMs=1000` exits the process.
- `/healthz` is the liveness probe.
- `/readyz` is the readiness probe.
