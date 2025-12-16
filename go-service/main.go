package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

type LoadTestRequest struct {
	Items      []int `json:"items"`
	Iterations int   `json:"iterations"`
	Multiplier int   `json:"multiplier"`
}

type LoadTestResponse struct {
	Ok         bool  `json:"ok"`
	Result     int64 `json:"result"`
	Count      int   `json:"count"`
	Iterations int   `json:"iterations"`
	Multiplier int   `json:"multiplier"`
}

type Metrics struct {
	Requests uint64 `json:"requests"`
	Errors   uint64 `json:"errors"`
}

type User struct {
	ID           uint64    `json:"id"`
	Email        string    `json:"email"`
	FullName     string    `json:"full_name"`
	Phone        *string   `json:"phone,omitempty"`
	PasswordHash string    `json:"password_hash"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Product struct {
	ID          uint64    `json:"id"`
	SKU         string    `json:"sku"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	PriceCents  uint64    `json:"price_cents"`
	Stock       uint32    `json:"stock"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Transaction struct {
	ID            uint64    `json:"id"`
	UserID        uint64    `json:"user_id"`
	OrderNo       string    `json:"order_no"`
	Status        string    `json:"status"`
	Currency      string    `json:"currency"`
	TotalCents    uint64    `json:"total_cents"`
	ItemCount     uint32    `json:"item_count"`
	PaymentMethod string    `json:"payment_method"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type TransactionItem struct {
	ID             uint64    `json:"id"`
	TransactionID  uint64    `json:"transaction_id"`
	ProductID      uint64    `json:"product_id"`
	Qty            uint32    `json:"qty"`
	UnitPriceCents uint64    `json:"unit_price_cents"`
	LineTotalCents uint64    `json:"line_total_cents"`
	CreatedAt      time.Time `json:"created_at"`
}

type DBPayload struct {
	Users            []User            `json:"users"`
	Products         []Product         `json:"products"`
	Transactions     []Transaction     `json:"transactions"`
	TransactionItems []TransactionItem `json:"transaction_items"`
}

var (
	reqCount atomic.Uint64
	errCount atomic.Uint64
	db       *sql.DB
)

func loadEnv() {
	if err := godotenv.Load(); err != nil {
		log.Printf("could not load .env (set DB_DSN manually or ensure .env exists): %v", err)
	}
}

func compute(items []int, iterations, multiplier int) int64 {
	var acc int64 = 0
	const mod int64 = 1000003

	for i := 0; i < iterations; i++ {
		for _, v := range items {
			x := int64(v*multiplier + i + 1)
			x = (x*x + 31) % mod
			x = (x*x + 17) % mod
			acc = (acc + x) % mod
		}
	}
	return acc
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":        true,
		"service":   "go-loadtest",
		"timestamp": time.Now().Format(time.RFC3339Nano),
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(Metrics{
		Requests: reqCount.Load(),
		Errors:   errCount.Load(),
	})
}

func loadTestHandler(w http.ResponseWriter, r *http.Request) {
	reqCount.Add(1)

	if r.Method != http.MethodPost {
		errCount.Add(1)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var req LoadTestRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		errCount.Add(1)
		http.Error(w, "invalid json body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Iterations <= 0 || req.Iterations > 100000 {
		errCount.Add(1)
		http.Error(w, "iterations must be in range 1..100000", http.StatusBadRequest)
		return
	}
	if req.Multiplier <= 0 || req.Multiplier > 100000 {
		errCount.Add(1)
		http.Error(w, "multiplier must be in range 1..100000", http.StatusBadRequest)
		return
	}
	if len(req.Items) == 0 || len(req.Items) > 100000 {
		errCount.Add(1)
		http.Error(w, "items length must be in range 1..100000", http.StatusBadRequest)
		return
	}

	result := compute(req.Items, req.Iterations, req.Multiplier)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(LoadTestResponse{
		Ok:         true,
		Result:     result,
		Count:      len(req.Items),
		Iterations: req.Iterations,
		Multiplier: req.Multiplier,
	})
}

func dbDataHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if db == nil {
		http.Error(w, "database not configured", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	users, err := fetchUsers(ctx)
	if err != nil {
		http.Error(w, "failed to load users: "+err.Error(), http.StatusInternalServerError)
		return
	}
	products, err := fetchProducts(ctx)
	if err != nil {
		http.Error(w, "failed to load products: "+err.Error(), http.StatusInternalServerError)
		return
	}
	transactions, err := fetchTransactions(ctx)
	if err != nil {
		http.Error(w, "failed to load transactions: "+err.Error(), http.StatusInternalServerError)
		return
	}
	transactionItems, err := fetchTransactionItems(ctx)
	if err != nil {
		http.Error(w, "failed to load transaction items: "+err.Error(), http.StatusInternalServerError)
		return
	}

	payload := DBPayload{
		Users:            users,
		Products:         products,
		Transactions:     transactions,
		TransactionItems: transactionItems,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func fetchUsers(ctx context.Context) ([]User, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, email, full_name, phone, password_hash, status, created_at, updated_at
		FROM users
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var user User
		var phone sql.NullString
		if err := rows.Scan(
			&user.ID,
			&user.Email,
			&user.FullName,
			&phone,
			&user.PasswordHash,
			&user.Status,
			&user.CreatedAt,
			&user.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if phone.Valid {
			val := phone.String
			user.Phone = &val
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func fetchProducts(ctx context.Context) ([]Product, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, sku, name, description, price_cents, stock, is_active, created_at, updated_at
		FROM products
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var prod Product
		var description sql.NullString
		if err := rows.Scan(
			&prod.ID,
			&prod.SKU,
			&prod.Name,
			&description,
			&prod.PriceCents,
			&prod.Stock,
			&prod.IsActive,
			&prod.CreatedAt,
			&prod.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if description.Valid {
			val := description.String
			prod.Description = &val
		}
		products = append(products, prod)
	}
	return products, rows.Err()
}

func fetchTransactions(ctx context.Context) ([]Transaction, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, user_id, order_no, status, currency, total_cents, item_count, payment_method, created_at, updated_at
		FROM transactions
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		var txn Transaction
		if err := rows.Scan(
			&txn.ID,
			&txn.UserID,
			&txn.OrderNo,
			&txn.Status,
			&txn.Currency,
			&txn.TotalCents,
			&txn.ItemCount,
			&txn.PaymentMethod,
			&txn.CreatedAt,
			&txn.UpdatedAt,
		); err != nil {
			return nil, err
		}
		txns = append(txns, txn)
	}
	return txns, rows.Err()
}

func fetchTransactionItems(ctx context.Context) ([]TransactionItem, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, transaction_id, product_id, qty, unit_price_cents, line_total_cents, created_at
		FROM transaction_items
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []TransactionItem
	for rows.Next() {
		var item TransactionItem
		if err := rows.Scan(
			&item.ID,
			&item.TransactionID,
			&item.ProductID,
			&item.Qty,
			&item.UnitPriceCents,
			&item.LineTotalCents,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func main() {
	loadEnv()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/load-test", loadTestHandler)
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/api/v1/data/all", dbDataHandler)

	addr := ":31143"
	log.Printf("Go load-test listening on %s", addr)

	dsn := os.Getenv("DB_DSN")
	if dsn != "" {
		var err error
		db, err = sql.Open("mysql", dsn)
		if err != nil {
			log.Fatalf("unable to open database: %v", err)
		}
		defer db.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			log.Fatalf("database ping failed: %v", err)
		}
	} else {
		log.Println("DB_DSN not set; /api/v1/data/all will return 503")
	}

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Fatal(server.ListenAndServe())
}
