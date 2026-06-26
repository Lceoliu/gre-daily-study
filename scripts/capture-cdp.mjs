import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const [, , url, outFile, waitMsArg = "12000"] = process.argv;
const waitMs = Number(waitMsArg);
const projectRoot = path.resolve(import.meta.dirname, "..");
const profileDir = path.resolve(projectRoot, "..", "edge-profile-cdp");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9333;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(targetUrl) {
  return new Promise((resolve, reject) => {
    http
      .get(targetUrl, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await getJson(`http://127.0.0.1:${port}/json`);
      const page = pages.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Keep waiting for Edge to open the debugging endpoint.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for CDP target");
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  async function send(method, params = {}) {
    await opened;
    const id = nextId;
    nextId += 1;
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  return { send, close: () => socket.close() };
}

mkdirSync(path.dirname(outFile), { recursive: true });
rmSync(profileDir, { recursive: true, force: true });
mkdirSync(profileDir, { recursive: true });

const edge = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=500,844",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  url,
], {
  stdio: "ignore",
  windowsHide: true,
});

try {
  const wsUrl = await waitForTarget();
  const cdp = createCdpClient(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await sleep(waitMs);

  const status = await cdp.send("Runtime.evaluate", {
    expression: `({
      status: document.querySelector(".pdf-status")?.textContent?.trim() || "",
      canvasClass: document.querySelector(".pdf-preview canvas")?.className || "",
      canvasWidth: document.querySelector(".pdf-preview canvas")?.width || 0,
      canvasHeight: document.querySelector(".pdf-preview canvas")?.height || 0
    })`,
    returnByValue: true,
  });

  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(outFile, Buffer.from(screenshot.data, "base64"));
  cdp.close();
  console.log(JSON.stringify(status.result.value));
} finally {
  edge.kill();
}
