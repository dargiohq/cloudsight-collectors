import http from "node:http";
import { randomUUID } from "node:crypto";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_JOBS = 500;

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

function requestOrigin(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers.host || "localhost";
  return `${protocol}://${host}`;
}

function cleanupJobs(jobs, ttlMs, maxJobs) {
  const cutoff = Date.now() - ttlMs;
  for (const [jobId, job] of jobs.entries()) {
    if ((job.completedAtEpochMs || job.acceptedAtEpochMs || 0) < cutoff) {
      jobs.delete(jobId);
    }
  }
  while (jobs.size > maxJobs) {
    const oldest = jobs.keys().next().value;
    if (!oldest) {
      break;
    }
    jobs.delete(oldest);
  }
}

function jobPayload(job, origin) {
  const payload = {
    status: job.state,
    state: job.state,
    requestId: job.requestId,
    jobId: job.jobId,
    acceptedAt: job.acceptedAt,
    pollPath: `/status/${job.jobId}`,
    pollUrl: `${origin}/status/${job.jobId}`
  };

  if (job.startedAt) {
    payload.startedAt = job.startedAt;
  }
  if (job.completedAt) {
    payload.completedAt = job.completedAt;
    payload.durationMs = Math.max(0, (job.completedAtEpochMs || 0) - (job.startedAtEpochMs || job.acceptedAtEpochMs || 0));
  }
  if (job.state === "RUNNING" && typeof job.attempt === "number") {
    payload.attempt = job.attempt;
  }
  if (job.state === "COMPLETED") {
    payload.status = job.resultStatus || "SUCCESS";
    payload.result = job.result ?? {};
    if (job.error) {
      payload.error = job.error;
    }
  }
  return payload;
}

export function createJsonServer(handler, options = {}) {
  const jobs = new Map();
  const jobTtlMs = Number(options.jobTtlMs || DEFAULT_JOB_TTL_MS);
  const maxJobs = Number(options.maxJobs || DEFAULT_MAX_JOBS);

  return http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = Math.random().toString(36).slice(2, 10);
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const origin = requestOrigin(request);

    try {
      cleanupJobs(jobs, jobTtlMs, maxJobs);

      if (request.method === "GET" && url.pathname === "/") {
        return writeJson(response, 200, {
          status: "ok",
          mode: "collector",
          method: "POST",
          health: "/health",
          pollTemplate: "/status/{jobId}"
        });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return writeJson(response, 200, { status: "ok" });
      }
      if (request.method === "GET" && url.pathname.startsWith("/status/")) {
        const jobId = url.pathname.replace(/^\/status\//, "").trim();
        const job = jobs.get(jobId);
        if (!job) {
          return writeJson(response, 404, {
            status: "NOT_FOUND",
            state: "NOT_FOUND",
            jobId
          });
        }
        const payload = jobPayload(job, origin);
        const code = job.state === "COMPLETED" ? 200 : 202;
        return writeJson(response, code, payload);
      }
      if (request.method !== "POST") {
        return writeJson(response, 405, { error: "Method not allowed" });
      }

      const body = await readJsonBody(request);
      const jobId = randomUUID();
      const acceptedAt = new Date().toISOString();
      const job = {
        jobId,
        requestId,
        state: "ACCEPTED",
        acceptedAt,
        acceptedAtEpochMs: Date.now()
      };
      jobs.set(jobId, job);

      console.log(`[collector:${requestId}] ${request.method} ${url.pathname} accepted job=${jobId}`);

      void Promise.resolve().then(async () => {
        job.state = "RUNNING";
        job.startedAt = new Date().toISOString();
        job.startedAtEpochMs = Date.now();
        try {
          const result = await handler({ request, body, requestId, jobId });
          job.state = "COMPLETED";
          job.completedAt = new Date().toISOString();
          job.completedAtEpochMs = Date.now();
          job.result = result ?? {};
          job.resultStatus = result?.status || "SUCCESS";
          console.log(`[collector:${requestId}] completed job=${jobId} in ${job.completedAtEpochMs - startedAt}ms with status=${job.resultStatus}`);
        } catch (error) {
          job.state = "COMPLETED";
          job.completedAt = new Date().toISOString();
          job.completedAtEpochMs = Date.now();
          job.resultStatus = "ERROR";
          job.error = error instanceof Error ? error.message : "Unexpected collector failure";
          job.result = {
            status: "ERROR",
            error: job.error
          };
          console.error(`[collector:${requestId}] failed job=${jobId} in ${job.completedAtEpochMs - startedAt}ms`, error);
        }
      });

      return writeJson(response, 202, jobPayload(job, origin));
    } catch (error) {
      console.error(`[collector:${requestId}] failed in ${Date.now() - startedAt}ms`, error);
      return writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected collector failure"
      });
    }
  });
}
