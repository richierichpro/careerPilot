const SERVER_URL = "http://localhost:8787";

async function checkBackend(): Promise<void> {
  const statusEl = document.getElementById("status");
  if (!statusEl) return;

  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    statusEl.textContent = "Backend connected.";
  } catch {
    statusEl.textContent = "Backend not reachable. Is the server running?";
  }
}

checkBackend();
