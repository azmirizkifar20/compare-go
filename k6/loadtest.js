import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

// Custom metrics
const apiDuration = new Trend("api_duration_ms");
const apiTTFB = new Trend("api_ttfb_ms");
const apiOK = new Rate("api_ok");
const apiErr = new Counter("api_errors");

// Env vars (defaults match included services)
const TARGET = __ENV.TARGET || "go"; // go | ts | custom
// const GO_BASE = __ENV.GO_BASE || "http://localhost:31143";
const GO_BASE = __ENV.GO_BASE || "https://gosample.azmirf.my.id";
const TS_BASE = __ENV.TS_BASE || "https://tssample.azmirf.my.id";
// const TS_BASE = __ENV.TS_BASE || "http://localhost:3000";
// const PATH =
//   __ENV.PATH ||
//   (TARGET === "go" ? "/api/v1/data/all" : "/api/v1/data/all");
const PATH = "/api/v1/data/all"

const BASE_URL =
  TARGET === "go"
    ? GO_BASE
    : TARGET === "ts"
    ? TS_BASE
    : __ENV.BASE_URL || GO_BASE;

export const options = {
  // Default: VU-based (same shape as your previous scripts)
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "30s", target: 50 },
    { duration: "1m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    api_duration_ms: ["p(95)<500"],
    api_ttfb_ms: ["p(95)<500"],
    api_ok: ["rate>0.99"],
  },
};

function makePayload() {
  const items = __ENV.ITEMS
    ? __ENV.ITEMS.split(",").map((x) => parseInt(x, 10))
    : [12, 5, 8, 20, 3, 15];

  const iterations = __ENV.ITERATIONS ? parseInt(__ENV.ITERATIONS, 10) : 4;
  const multiplier = __ENV.MULTIPLIER ? parseInt(__ENV.MULTIPLIER, 10) : 3;

  return JSON.stringify({ items, iterations, multiplier });
}

export default function () {
  const url = `${BASE_URL}${PATH}`;
  const payload = makePayload();

  const res = http.get(url, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: __ENV.TIMEOUT || "30s",
    tags: { name: `GET ${PATH}`, target: TARGET },
  });

  apiDuration.add(res.timings.duration);
  apiTTFB.add(res.timings.waiting);

  const ok = check(res, {
    "status is 200/201": (r) => r.status === 200 || r.status === 201,
    "content-type json": (r) =>
      (r.headers["Content-Type"] || "").toLowerCase().includes("application/json"),
    "has body": (r) => !!r.body && r.body.length > 0,
    "ok field true (if exists)": (r) => {
      try {
        const j = r.json();
        return j.ok === undefined ? true : j.ok === true;
      } catch (_) {
        return false;
      }
    },
  });

  apiOK.add(ok);
  if (!ok) apiErr.add(1);

  sleep(__ENV.SLEEP ? parseFloat(__ENV.SLEEP) : 1);
}
