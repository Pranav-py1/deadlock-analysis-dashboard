#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v g++ >/dev/null 2>&1; then
  echo "g++ was not found. Install a C++17 compiler first."
  exit 1
fi
echo "Building the C++ dashboard server..."
g++ -std=c++17 -O2 main.cpp -o deadlock_server
echo "Starting dashboard at http://127.0.0.1:8080"
echo "Keep this terminal open while using the dashboard. Press Ctrl+C to stop."
if command -v xdg-open >/dev/null 2>&1; then xdg-open http://127.0.0.1:8080 >/dev/null 2>&1 & fi
./deadlock_server
