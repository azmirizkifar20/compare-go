# loadtest-suite

Monorepo mini untuk benchmark **Go vs TypeScript (Node.js)** dengan endpoint yang setara + k6 script yang bisa switch target via env var.

## Struktur
- `go-service/`  -> Go net/http (port 31143)
- `ts-service/`  -> TS Fastify (port 3000)
- `k6/`          -> k6 script single-file (switch target via env)

## Run Go service
```bash
cd go-service
go run .
```

Endpoints:
- POST `http://localhost:31143/api/v1/auth/load-test`
- GET  `http://localhost:31143/health`
- GET  `http://localhost:31143/metrics`
- GET  `http://localhost:31143/api/v1/data/all` *(reads users/products/transactions/transaction_items)*

## Run TS service
```bash
cd ts-service
npm i
npm run dev
```

Endpoints:
- POST `http://localhost:3000/v1/auth/load-test`
- GET  `http://localhost:3000/health`
- GET  `http://localhost:3000/metrics`
- GET  `http://localhost:3000/api/v1/data/all` *(reads users/products/transactions/transaction_items)*

## Run k6 (single script)
```bash
cd k6

# test Go
TARGET=go k6 run loadtest.js

# test TS
TARGET=ts k6 run loadtest.js

# export summaries
TARGET=go k6 run --summary-export=go.json loadtest.js
TARGET=ts k6 run --summary-export=ts.json loadtest.js
```

## Notes
- Jalankan test **satu-per-satu** untuk perbandingan yang paling fair (hindari contention di server yang sama).
- TS mengembalikan `result` sebagai string untuk menghindari overflow integer JS.
