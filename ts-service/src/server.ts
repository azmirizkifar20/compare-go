import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Fastify from "fastify";
import knex, { Knex } from "knex";

type LoadTestRequest = {
  items: number[];
  iterations: number;
  multiplier: number;
};

type UserRow = {
  id: number;
  email: string;
  full_name: string;
  phone: string | null;
  password_hash: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  is_active: number;
  created_at: Date;
  updated_at: Date;
};

type TransactionRow = {
  id: number;
  user_id: number;
  order_no: string;
  status: string;
  currency: string;
  total_cents: number;
  item_count: number;
  payment_method: string;
  created_at: Date;
  updated_at: Date;
};

type TransactionItemRow = {
  id: number;
  transaction_id: number;
  product_id: number;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  created_at: Date;
};

type UserRecord = {
  id: number;
  email: string;
  full_name: string;
  phone?: string;
  password_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type ProductRecord = {
  id: number;
  sku: string;
  name: string;
  description?: string;
  price_cents: number;
  stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TransactionRecord = {
  id: number;
  user_id: number;
  order_no: string;
  status: string;
  currency: string;
  total_cents: number;
  item_count: number;
  payment_method: string;
  created_at: string;
  updated_at: string;
};

type TransactionItemRecord = {
  id: number;
  transaction_id: number;
  product_id: number;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  created_at: string;
};

type DBPayload = {
  users: UserRecord[];
  products: ProductRecord[];
  transactions: TransactionRecord[];
  transaction_items: TransactionItemRecord[];
};

const envConfigPath = findEnvPath();
if (envConfigPath) {
  dotenv.config({ path: envConfigPath });
} else {
  console.warn("ts-service: .env not found near workspace or service directory");
  dotenv.config();
}

function findEnvPath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "ts-service/.env"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const metrics = {
  requests: 0,
  errors: 0,
  startedAt: Date.now(),
};

const dbClient = buildDatabaseClient();

if (!dbClient) {
  console.warn("DB_DSN or database config not set; GET /api/v1/data/all will return 503");
} else {
  void ensureDbConnection();
}

function buildDatabaseClient(): Knex | null {
  const config = buildDatabaseConfig();
  if (!config) {
    return null;
  }
  return knex({
    client: "mysql2",
    connection: config,
    pool: { min: 0, max: 5 },
  });
}

function buildDatabaseConfig():
  | string
  | Knex.MySql2ConnectionConfig
  | undefined {
  if (process.env.DB_DSN) {
    const parsed = parseMysqlDsn(process.env.DB_DSN);
    if (parsed) {
      return parsed;
    }
    return stripParseTime(process.env.DB_DSN);
  }

  const { DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME } = process.env;
  if (!DB_USER || !DB_HOST || !DB_NAME) {
    return undefined;
  }

  return {
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
  };
}

function stripParseTime(raw: string): string {
  const [base, search] = raw.split("?", 2);
  if (!search) {
    return raw;
  }
  const params = new URLSearchParams(search);
  params.delete("parseTime");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function parseMysqlDsn(raw: string): Knex.MySql2ConnectionConfig | null {
  const normalized = stripParseTime(raw);

  const tcpRegex =
    /^(?<user>[^:]+):(?<pass>[^@]*)@tcp\((?<host>[^:()]+)(?::(?<port>\d+))?\)\/(?<db>[^?]+)(?:\?(?<query>.*))?$/;
  const mysqlUrlRegex =
    /^mysql:\/\/(?<user>[^:]+):(?<pass>[^@]*)@(?<host>[^:/]+)(?::(?<port>\d+))?\/(?<db>[^?]+)(?:\?(?<query>.*))?$/;

  const match = normalized.match(tcpRegex) ?? normalized.match(mysqlUrlRegex);
  if (!match || !match.groups) {
    return null;
  }

  const { user, pass, host, port, db } = match.groups;
  if (!user || !host || !db) {
    return null;
  }

  return {
    user,
    password: pass ? pass : undefined,
    host,
    port: port ? Number(port) : undefined,
    database: db,
  };
}

function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function ensureDbConnection(): Promise<void> {
  if (!dbClient) {
    return;
  }

  try {
    const [rows] = await dbClient.raw("SELECT 1+0 AS ok");
    const status = Array.isArray(rows) && rows[0] ? rows[0].ok ?? rows[0]["1+0"] ?? rows[0] : rows;
    console.log("db connection check", status);
  } catch (error) {
    console.error("db connection check failed:", error);
    throw error;
  }
}

function nullableString(value: string | null): string | undefined {
  return value ?? undefined;
}

async function fetchUsers(): Promise<UserRecord[]> {
  if (!dbClient) {
    return [];
  }

  const rows = await dbClient<UserRow>("users").select(
    "id",
    "email",
    "full_name",
    "phone",
    "password_hash",
    "status",
    "created_at",
    "updated_at",
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    phone: nullableString(row.phone),
    password_hash: row.password_hash,
    status: row.status,
    created_at: formatTimestamp(row.created_at),
    updated_at: formatTimestamp(row.updated_at),
  }));
}

async function fetchProducts(): Promise<ProductRecord[]> {
  if (!dbClient) {
    return [];
  }

  const rows = await dbClient<ProductRow>("products").select(
    "id",
    "sku",
    "name",
    "description",
    "price_cents",
    "stock",
    "is_active",
    "created_at",
    "updated_at",
  );
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: nullableString(row.description),
    price_cents: row.price_cents,
    stock: row.stock,
    is_active: Boolean(row.is_active),
    created_at: formatTimestamp(row.created_at),
    updated_at: formatTimestamp(row.updated_at),
  }));
}

async function fetchTransactions(): Promise<TransactionRecord[]> {
  if (!dbClient) {
    return [];
  }

  const rows = await dbClient<TransactionRow>("transactions").select(
    "id",
    "user_id",
    "order_no",
    "status",
    "currency",
    "total_cents",
    "item_count",
    "payment_method",
    "created_at",
    "updated_at",
  );
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    order_no: row.order_no,
    status: row.status,
    currency: row.currency,
    total_cents: row.total_cents,
    item_count: row.item_count,
    payment_method: row.payment_method,
    created_at: formatTimestamp(row.created_at),
    updated_at: formatTimestamp(row.updated_at),
  }));
}

async function fetchTransactionItems(): Promise<TransactionItemRecord[]> {
  if (!dbClient) {
    return [];
  }

  const rows = await dbClient<TransactionItemRow>("transaction_items").select(
    "id",
    "transaction_id",
    "product_id",
    "qty",
    "unit_price_cents",
    "line_total_cents",
    "created_at",
  );
  return rows.map((row) => ({
    id: row.id,
    transaction_id: row.transaction_id,
    product_id: row.product_id,
    qty: row.qty,
    unit_price_cents: row.unit_price_cents,
    line_total_cents: row.line_total_cents,
    created_at: formatTimestamp(row.created_at),
  }));
}

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

app.addHook("onRequest", (req, _reply, done) => {
  (req as any).__start = process.hrtime.bigint();
  done();
});

app.addHook("onResponse", (req, reply, done) => {
  const start = (req as any).__start as bigint | undefined;
  const durationMs =
    start !== undefined ? Number(process.hrtime.bigint() - start) / 1_000_000 : undefined;
  const msg = `${req.method} ${req.url} -> ${reply.statusCode}` + (durationMs ? ` in ${durationMs.toFixed(2)}ms` : "");
  console.log(msg);
  done();
});

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

app.get("/api/v1/data/all", async (req, reply) => {
  if (!dbClient) {
    return reply.status(503).send({ ok: false, error: "database not configured" });
  }

  try {
    const [users, products, transactions, transactionItems] = await Promise.all([
      fetchUsers(),
      fetchProducts(),
      fetchTransactions(),
      fetchTransactionItems(),
    ]);

    const payload: DBPayload = {
      users,
      products,
      transactions,
      transaction_items: transactionItems,
    };

    return reply.send(payload);
  } catch (error) {
    app.log.error(error);
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unknown database error";
    return reply.status(500).send({ ok: false, error: `failed to read database: ${message}` });
  }
});

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

app.listen({ host, port }).then(() => {
  console.log(`TS load-test listening on :${port}`);
});
