import Fastify from "fastify";

type LoadTestRequest = {
  items: number[];
  iterations: number;
  multiplier: number;
};

const metrics = {
  requests: 0,
  errors: 0,
  startedAt: Date.now(),
};

function compute(items: number[], iterations: number, multiplier: number): bigint {
  let acc = 0n;
  const mod = 1000003n;

  for (let i = 0; i < iterations; i++) {
    for (const v of items) {
      let x = BigInt(v * multiplier + i + 1);
      x = (x * x + 31n) % mod;
      x = (x * x + 17n) % mod;
      acc = (acc + x) % mod;
    }
  }
  return acc;
}

const app = Fastify({ logger: false });

app.get("/health", async () => {
  return {
    ok: true,
    service: "ts-loadtest",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
  };
});

app.get("/metrics", async () => metrics);

app.post("/v1/auth/load-test", async (req, reply) => {
  metrics.requests++;

  try {
    const body = req.body as Partial<LoadTestRequest>;

    if (
      !body ||
      !Array.isArray(body.items) ||
      typeof body.iterations !== "number" ||
      typeof body.multiplier !== "number"
    ) {
      metrics.errors++;
      return reply.code(400).send({ ok: false, error: "invalid body" });
    }

    const items = body.items;
    const iterations = body.iterations;
    const multiplier = body.multiplier;

    if (iterations <= 0 || iterations > 100000) {
      metrics.errors++;
      return reply.code(400).send({ ok: false, error: "iterations must be in range 1..100000" });
    }
    if (multiplier <= 0 || multiplier > 100000) {
      metrics.errors++;
      return reply.code(400).send({ ok: false, error: "multiplier must be in range 1..100000" });
    }
    if (items.length === 0 || items.length > 100000 || !items.every((n) => Number.isInteger(n))) {
      metrics.errors++;
      return reply.code(400).send({ ok: false, error: "items must be int array length 1..100000" });
    }

    const result = compute(items, iterations, multiplier);

    return reply.send({
      ok: true,
      // keep as string to avoid JS integer precision issues
      result: result.toString(),
      count: items.length,
      iterations,
      multiplier,
    });
  } catch (e) {
    metrics.errors++;
    throw e;
  }
});

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

app.listen({ host, port }).then(() => {
  console.log(`TS load-test listening on :${port}`);
});
