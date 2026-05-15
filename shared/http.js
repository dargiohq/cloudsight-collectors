import http from "node:http";

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

export function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

export function createJsonServer(handler) {
  return http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = Math.random().toString(36).slice(2, 10);
    try {
      if (request.method === "GET" && request.url === "/") {
        return writeJson(response, 200, {
          status: "ok",
          mode: "collector",
          method: "POST",
          health: "/health"
        });
      }
      if (request.method === "GET" && request.url === "/health") {
        return writeJson(response, 200, { status: "ok" });
      }
      if (request.method !== "POST") {
        return writeJson(response, 405, { error: "Method not allowed" });
      }
      const body = await readJsonBody(request);
      console.log(`[collector:${requestId}] ${request.method} ${request.url} accepted`);
      const result = await handler({ request, body });
      console.log(`[collector:${requestId}] completed in ${Date.now() - startedAt}ms with status=${result?.status || "UNKNOWN"}`);
      return writeJson(response, 200, result);
    } catch (error) {
      console.error(`[collector:${requestId}] failed in ${Date.now() - startedAt}ms`, error);
      return writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected collector failure"
      });
    }
  });
}
