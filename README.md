# Deadlock Analysis Dashboard

A local, dependency-free dashboard built with **HTML, CSS, JavaScript, and C++**. It does not use Streamlit, Python, Node.js, or third-party web libraries.

## Start the dashboard

### Windows
1. Install a C++17 compiler such as MinGW-w64/MSYS2 and make sure `g++` is available in Command Prompt.
2. Double-click `run_windows.bat`.
3. Open `http://127.0.0.1:8080` if the browser does not open automatically.
4. Keep the terminal running while using the dashboard. Press Ctrl+C to stop it.

### Linux / Ubuntu / WSL
1. Make sure `g++` is installed. On Ubuntu/WSL, install it with `sudo apt update && sudo apt install g++` if needed.
2. In this folder, run `./run_linux.sh`.
3. Open `http://127.0.0.1:8080`.
4. Keep the terminal open while using the dashboard. Press Ctrl+C to stop it.

The C++ server only listens on the local loopback address (`127.0.0.1`). It serves the HTML, CSS, and JavaScript files and provides local API endpoints for the algorithms.

## Dashboard features

- Overview and responsive light/dark interface.
- Editable Allocation, Maximum, and Available matrices.
- Banker’s Need matrix, safety algorithm, safe sequence, Work trace, and explanation.
- Resource request validation: Need check, Available check, temporary allocation, safety test, and rollback on unsafe result.
- Separate deadlock detection with Allocation, outstanding Request, and Available matrices.
- Recovery simulation: terminate a detected process and release its resources.
- Prevention check using a globally increasing resource-acquisition order.
- Analytical test table for TC1–TC6, with actual results from the C++ engine.
- AI usage record area that students should edit to accurately describe their own verification.

## Source files

- `index.html`: dashboard structure and content.
- `styles.css`: visual design, responsive layout, and light/dark themes.
- `app.js`: browser interactions and API calls.
- `main.cpp`: one C++ file containing the local HTTP server and all deadlock algorithms.
- `Deadlock_Analysis_Report.docx`: accompanying report draft; review and personalize it before submission.

## Important correctness notes

- The safe sequence depends on the chosen process-scanning order; other valid safe sequences may also exist.
- The Banker’s safety algorithm is an avoidance check. It does not detect a pre-existing deadlock by itself.
- An unsafe state is not the same as a confirmed deadlock.
- An unavailable request within Need should wait; it is not an invalid request.
- The dashboard is an educational simulator. Review results and your report before submitting.
