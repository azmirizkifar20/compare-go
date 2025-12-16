package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync/atomic"
	"time"
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

var reqCount atomic.Uint64
var errCount atomic.Uint64

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

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/load-test", loadTestHandler)
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/metrics", metricsHandler)

	addr := ":31143"
	log.Printf("Go load-test listening on %s", addr)

	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Fatal(server.ListenAndServe())
}
