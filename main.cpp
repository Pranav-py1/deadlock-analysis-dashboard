#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>


#include <string>
#include <vector>

using Matrix = std::vector<std::vector<int>>;

struct SafetyResult {
    bool safe = false;
    Matrix need;
    std::vector<int> sequence;
    std::vector<std::vector<int>> workTrace;
    std::vector<std::string> trace;
};

struct RequestResult {
    std::string status;
    std::string message;
    bool safe = false;
    Matrix need;
    Matrix allocationAfter;
    std::vector<int> availableAfter;
    std::vector<int> sequence;
    std::vector<std::string> trace;
};

struct DetectionResult {
    std::vector<int> deadlocked;
    std::vector<std::string> trace;
};

bool validateState(const Matrix& allocation, const Matrix& maximum,
                   const std::vector<int>& available, std::string& error);
Matrix calculateNeed(const Matrix& allocation, const Matrix& maximum);
SafetyResult safetyCheck(const Matrix& allocation, const Matrix& maximum,
                         const std::vector<int>& available);
RequestResult resourceRequest(const Matrix& allocation, const Matrix& maximum,
                              const std::vector<int>& available, int pid,
                              const std::vector<int>& request);
DetectionResult detectDeadlock(const Matrix& allocation, const Matrix& request,
                               const std::vector<int>& available);
bool checkResourceOrder(const std::vector<int>& order, int& violationAt,
                        std::string& message);


#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "Ws2_32.lib")
using Socket = SOCKET;
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using Socket = int;
#endif

namespace {
#ifdef _WIN32
void closeSocket(Socket s) { closesocket(s); }
#else
void closeSocket(Socket s) { close(s); }
#endif

std::string urlDecode(const std::string& s) {
    std::string out;
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '+') out.push_back(' ');
        else if (s[i] == '%' && i + 2 < s.size()) {
            char hex[3] = {s[i + 1], s[i + 2], 0};
            char* end = nullptr;
            long value = std::strtol(hex, &end, 16);
            if (end && *end == '\0') { out.push_back(static_cast<char>(value)); i += 2; }
            else out.push_back(s[i]);
        } else out.push_back(s[i]);
    }
    return out;
}
std::map<std::string, std::string> parseQuery(const std::string& query) {
    std::map<std::string, std::string> values;
    std::size_t start = 0;
    while (start <= query.size()) {
        const auto end = query.find('&', start);
        const auto part = query.substr(start, end == std::string::npos ? std::string::npos : end - start);
        const auto eq = part.find('=');
        if (!part.empty()) values[urlDecode(part.substr(0, eq))] = eq == std::string::npos ? "" : urlDecode(part.substr(eq + 1));
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return values;
}
std::vector<int> parseVector(const std::string& text) {
    std::vector<int> values;
    std::stringstream ss(text);
    std::string part;
    while (std::getline(ss, part, ',')) {
        if (part.empty()) throw std::invalid_argument("Empty value in vector.");
        std::size_t used = 0;
        int value;
        try { value = std::stoi(part, &used); }
        catch (...) { throw std::invalid_argument("Every resource value must be an integer."); }
        if (used != part.size()) throw std::invalid_argument("Every resource value must be an integer.");
        values.push_back(value);
    }
    if (values.empty()) throw std::invalid_argument("Vector cannot be empty.");
    return values;
}
Matrix parseMatrix(const std::string& text) {
    Matrix matrix;
    std::stringstream rows(text);
    std::string row;
    while (std::getline(rows, row, ';')) {
        if (row.empty()) throw std::invalid_argument("Matrix contains an empty row.");
        matrix.push_back(parseVector(row));
    }
    if (matrix.empty()) throw std::invalid_argument("Matrix cannot be empty.");
    const auto width = matrix.front().size();
    for (const auto& values : matrix) if (values.size() != width) throw std::invalid_argument("Matrix rows must have equal length.");
    return matrix;
}
std::string jsonEscape(const std::string& s) {
    std::ostringstream out;
    for (unsigned char c : s) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: if (c < 32) { const char* h = "0123456789abcdef"; out << "\\u00" << h[c >> 4] << h[c & 15]; } else out << c;
        }
    }
    return out.str();
}
std::string jstr(const std::string& s) { return "\"" + jsonEscape(s) + "\""; }
std::string jvec(const std::vector<int>& v) {
    std::ostringstream out; out << '[';
    for (std::size_t i = 0; i < v.size(); ++i) { if (i) out << ','; out << v[i]; }
    out << ']'; return out.str();
}
std::string jmatrix(const Matrix& m) {
    std::ostringstream out; out << '[';
    for (std::size_t i = 0; i < m.size(); ++i) { if (i) out << ','; out << jvec(m[i]); }
    out << ']'; return out.str();
}
std::string jstrings(const std::vector<std::string>& items) {
    std::ostringstream out; out << '[';
    for (std::size_t i = 0; i < items.size(); ++i) { if (i) out << ','; out << jstr(items[i]); }
    out << ']'; return out.str();
}
std::string required(const std::map<std::string, std::string>& q, const std::string& key) {
    auto it = q.find(key);
    if (it == q.end() || it->second.empty()) throw std::invalid_argument("Missing required field: " + key + ".");
    return it->second;
}
int toInt(const std::string& s, const std::string& name) {
    std::size_t used = 0; int value;
    try { value = std::stoi(s, &used); } catch (...) { throw std::invalid_argument(name + " must be an integer."); }
    if (used != s.size()) throw std::invalid_argument(name + " must be an integer.");
    return value;
}
std::string serializeSafety(const SafetyResult& r) {
    return "{\"ok\":true,\"safe\":" + std::string(r.safe ? "true" : "false") +
        ",\"need\":" + jmatrix(r.need) + ",\"sequence\":" + jvec(r.sequence) +
        ",\"workTrace\":" + [&](){ std::ostringstream o; o << '['; for (std::size_t i=0;i<r.workTrace.size();++i) {if(i)o<<',';o<<jvec(r.workTrace[i]);}o<<']';return o.str();}() +
        ",\"trace\":" + jstrings(r.trace) + "}";
}
std::string mimeType(const std::string& path) {
    if (path.size() >= 5 && path.substr(path.size()-5) == ".html") return "text/html; charset=utf-8";
    if (path.size() >= 4 && path.substr(path.size()-4) == ".css") return "text/css; charset=utf-8";
    if (path.size() >= 3 && path.substr(path.size()-3) == ".js") return "application/javascript; charset=utf-8";
    if (path.size() >= 4 && path.substr(path.size()-4) == ".svg") return "image/svg+xml";
    return "text/plain; charset=utf-8";
}
void sendAll(Socket client, const std::string& data) {
    std::size_t sent = 0;
    while (sent < data.size()) {
        int n = send(client, data.data() + sent, static_cast<int>(data.size() - sent), 0);
        if (n <= 0) break;
        sent += static_cast<std::size_t>(n);
    }
}
void respond(Socket client, int status, const std::string& type, const std::string& body) {
    const char* reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 404 ? "Not Found" : "Internal Server Error";
    std::ostringstream header;
    header << "HTTP/1.1 " << status << ' ' << reason << "\r\n"
           << "Content-Type: " << type << "\r\n"
           << "Content-Length: " << body.size() << "\r\n"
           << "Cache-Control: no-store\r\n"
           << "Access-Control-Allow-Origin: *\r\n"
           << "Connection: close\r\n\r\n";
    sendAll(client, header.str() + body);
}
std::string getFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::ostringstream content; content << in.rdbuf(); return content.str();
}
void handle(Socket client) {
    char buffer[32768];
    int received = recv(client, buffer, static_cast<int>(sizeof(buffer) - 1), 0);
    if (received <= 0) { closeSocket(client); return; }
    buffer[received] = '\0';
    std::istringstream request(buffer);
    std::string method, target, version;
    request >> method >> target >> version;
    if (method != "GET") { respond(client, 400, "application/json; charset=utf-8", "{\"ok\":false,\"message\":\"Only GET requests are supported.\"}"); closeSocket(client); return; }
    auto question = target.find('?');
    std::string path = target.substr(0, question);
    auto q = parseQuery(question == std::string::npos ? "" : target.substr(question + 1));
    try {
        if (path == "/api/health") {
            respond(client, 200, "application/json; charset=utf-8", "{\"ok\":true,\"message\":\"C++ backend is ready.\"}");
        } else if (path == "/api/safety") {
            auto alloc = parseMatrix(required(q, "allocation"));
            auto maximum = parseMatrix(required(q, "maximum"));
            auto available = parseVector(required(q, "available"));
            respond(client, 200, "application/json; charset=utf-8", serializeSafety(safetyCheck(alloc, maximum, available)));
        } else if (path == "/api/request") {
            auto alloc = parseMatrix(required(q, "allocation"));
            auto maximum = parseMatrix(required(q, "maximum"));
            auto available = parseVector(required(q, "available"));
            int pid = toInt(required(q, "pid"), "Process ID");
            auto req = parseVector(required(q, "request"));
            auto r = resourceRequest(alloc, maximum, available, pid, req);
            std::string json = "{\"ok\":true,\"status\":" + jstr(r.status) + ",\"message\":" + jstr(r.message) +
                ",\"safe\":" + std::string(r.safe ? "true" : "false") + ",\"need\":" + jmatrix(r.need) +
                ",\"allocationAfter\":" + jmatrix(r.allocationAfter) + ",\"availableAfter\":" + jvec(r.availableAfter) +
                ",\"sequence\":" + jvec(r.sequence) + ",\"trace\":" + jstrings(r.trace) + "}";
            respond(client, 200, "application/json; charset=utf-8", json);
        } else if (path == "/api/detection") {
            auto alloc = parseMatrix(required(q, "allocation"));
            auto req = parseMatrix(required(q, "request"));
            auto available = parseVector(required(q, "available"));
            auto r = detectDeadlock(alloc, req, available);
            respond(client, 200, "application/json; charset=utf-8", "{\"ok\":true,\"deadlocked\":" + jvec(r.deadlocked) + ",\"trace\":" + jstrings(r.trace) + "}");
        } else if (path == "/api/prevention") {
            auto order = parseVector(required(q, "order"));
            int violationAt; std::string message;
            bool allowed = checkResourceOrder(order, violationAt, message);
            respond(client, 200, "application/json; charset=utf-8", "{\"ok\":true,\"allowed\":" + std::string(allowed ? "true" : "false") +
                ",\"violationAt\":" + std::to_string(violationAt) + ",\"message\":" + jstr(message) + ",\"order\":" + jvec(order) + "}");
        } else {
            if (path == "/") path = "/index.html";
            if (path.find("..") != std::string::npos || path.find('\\') != std::string::npos) { respond(client, 404, "text/plain", "Not found"); closeSocket(client); return; }
            std::string body = getFile("." + path);
            if (body.empty()) respond(client, 404, "text/plain; charset=utf-8", "File not found: " + path + "\nRun this server from the project folder.");
            else respond(client, 200, mimeType(path), body);
        }
    } catch (const std::exception& e) {
        respond(client, 400, "application/json; charset=utf-8", "{\"ok\":false,\"message\":" + jstr(e.what()) + "}");
    }
    closeSocket(client);
}
}

int main(int argc, char** argv) {
    int port = 8080;
    if (const char* envPort = std::getenv("PORT")) {
    try {
        port = std::stoi(envPort);
    } catch (...) {
        std::cerr << "Invalid PORT environment variable.\n";
        return 1;
    }
}
    if (argc > 1) {
        try { port = std::stoi(argv[1]); } catch (...) { std::cerr << "Invalid port.\n"; return 1; }
    }
#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) { std::cerr << "Could not initialise Winsock.\n"; return 1; }
#endif
    Socket server = socket(AF_INET, SOCK_STREAM, 0);
#ifdef _WIN32
    if (server == INVALID_SOCKET) { std::cerr << "Could not create server socket.\n"; WSACleanup(); return 1; }
#else
    if (server < 0) { std::cerr << "Could not create server socket.\n"; return 1; }
    int reuse = 1; setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
#endif
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(static_cast<unsigned short>(port));
    if (bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        std::cerr << "Could not bind to port " << port << ". Is another server using it?\n";
        closeSocket(server);
#ifdef _WIN32
        WSACleanup();
#endif
        return 1;
    }
    if (listen(server, 16) < 0) { std::cerr << "Could not listen on port.\n"; closeSocket(server); return 1; }
    std::cout << "Deadlock Analysis Dashboard is running at http://127.0.0.1:" << port << "\n";
    std::cout << "Keep this terminal open while using the dashboard. Press Ctrl+C to stop.\n";
    while (true) {
        sockaddr_in clientAddress{};
#ifdef _WIN32
        int addressLength = sizeof(clientAddress);
#else
        socklen_t addressLength = sizeof(clientAddress);
#endif
        Socket client = accept(server, reinterpret_cast<sockaddr*>(&clientAddress), &addressLength);
#ifdef _WIN32
        if (client == INVALID_SOCKET) continue;
#else
        if (client < 0) continue;
#endif
        handle(client);
    }
    closeSocket(server);
#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}

// Deadlock algorithms

namespace {
bool sameWidth(const Matrix& m, std::size_t width) {
    return !m.empty() && std::all_of(m.begin(), m.end(), [width](const auto& row) {
        return row.size() == width;
    });
}
bool allZero(const std::vector<int>& row) {
    return std::all_of(row.begin(), row.end(), [](int x) { return x == 0; });
}
bool leq(const std::vector<int>& a, const std::vector<int>& b) {
    if (a.size() != b.size()) return false;
    for (std::size_t j = 0; j < a.size(); ++j) if (a[j] > b[j]) return false;
    return true;
}
void addTo(std::vector<int>& a, const std::vector<int>& b) {
    for (std::size_t j = 0; j < a.size(); ++j) a[j] += b[j];
}
std::string vecText(const std::vector<int>& v) {
    std::ostringstream out;
    out << '[';
    for (std::size_t i = 0; i < v.size(); ++i) {
        if (i) out << ", ";
        out << v[i];
    }
    out << ']';
    return out.str();
}
}

bool validateState(const Matrix& allocation, const Matrix& maximum,
                   const std::vector<int>& available, std::string& error) {
    if (allocation.empty() || maximum.empty()) {
        error = "Allocation and Maximum must each contain at least one process.";
        return false;
    }
    if (allocation.size() != maximum.size()) {
        error = "Allocation and Maximum must have the same number of processes.";
        return false;
    }
    const std::size_t resources = allocation.front().size();
    if (resources == 0 || !sameWidth(allocation, resources) || !sameWidth(maximum, resources)) {
        error = "Every Allocation and Maximum row must have the same non-zero number of resources.";
        return false;
    }
    if (available.size() != resources) {
        error = "Available must contain one value per resource type.";
        return false;
    }
    for (std::size_t i = 0; i < allocation.size(); ++i) {
        for (std::size_t j = 0; j < resources; ++j) {
            if (allocation[i][j] < 0 || maximum[i][j] < 0) {
                error = "Allocation and Maximum cannot contain negative values.";
                return false;
            }
            if (allocation[i][j] > maximum[i][j]) {
                error = "Allocation cannot exceed Maximum for P" + std::to_string(i) + ", resource R" + std::to_string(j) + ".";
                return false;
            }
        }
    }
    if (std::any_of(available.begin(), available.end(), [](int x) { return x < 0; })) {
        error = "Available cannot contain negative values.";
        return false;
    }
    error.clear();
    return true;
}

Matrix calculateNeed(const Matrix& allocation, const Matrix& maximum) {
    if (allocation.empty() || allocation.size() != maximum.size() ||
        allocation.front().empty() || !sameWidth(allocation, allocation.front().size()) ||
        !sameWidth(maximum, allocation.front().size())) {
        throw std::invalid_argument("Allocation and Maximum matrices have incompatible dimensions.");
    }
    Matrix need = maximum;
    for (std::size_t i = 0; i < allocation.size(); ++i) {
        for (std::size_t j = 0; j < allocation[i].size(); ++j) {
            if (allocation[i][j] < 0 || maximum[i][j] < allocation[i][j]) {
                throw std::invalid_argument("Allocation values must be non-negative and cannot exceed Maximum.");
            }
            need[i][j] -= allocation[i][j];
        }
    }
    return need;
}

SafetyResult safetyCheck(const Matrix& allocation, const Matrix& maximum,
                         const std::vector<int>& available) {
    std::string error;
    if (!validateState(allocation, maximum, available, error)) throw std::invalid_argument(error);

    SafetyResult result;
    result.need = calculateNeed(allocation, maximum);
    std::vector<int> work = available;
    std::vector<bool> finish(allocation.size(), false);
    result.workTrace.push_back(work);
    result.trace.push_back("Start with Work = " + vecText(work) + ".");

    bool progressed = true;
    while (progressed) {
        progressed = false;
        for (std::size_t i = 0; i < allocation.size(); ++i) {
            if (finish[i] || !leq(result.need[i], work)) continue;
            result.trace.push_back("P" + std::to_string(i) + " can finish because Need " + vecText(result.need[i]) + " <= Work " + vecText(work) + ".");
            addTo(work, allocation[i]);
            finish[i] = true;
            result.sequence.push_back(static_cast<int>(i));
            result.workTrace.push_back(work);
            result.trace.push_back("P" + std::to_string(i) + " releases its allocation. Work becomes " + vecText(work) + ".");
            progressed = true;
        }
    }
    result.safe = std::all_of(finish.begin(), finish.end(), [](bool x) { return x; });
    if (result.safe) result.trace.push_back("All processes can finish. The state is SAFE.");
    else {
        std::vector<int> blocked;
        for (std::size_t i = 0; i < finish.size(); ++i) if (!finish[i]) blocked.push_back(static_cast<int>(i));
        result.trace.push_back("No remaining process can finish with Work " + vecText(work) + ". Unfinished: " + vecText(blocked) + ". The state is UNSAFE; this alone does not prove deadlock.");
    }
    return result;
}

RequestResult resourceRequest(const Matrix& allocation, const Matrix& maximum,
                              const std::vector<int>& available, int pid,
                              const std::vector<int>& request) {
    std::string error;
    if (!validateState(allocation, maximum, available, error)) throw std::invalid_argument(error);
    if (pid < 0 || static_cast<std::size_t>(pid) >= allocation.size()) throw std::invalid_argument("Invalid process ID. Select an existing process.");
    if (request.size() != available.size()) throw std::invalid_argument("Request must contain one value per resource type.");
    if (std::any_of(request.begin(), request.end(), [](int x) { return x < 0; })) throw std::invalid_argument("Request values cannot be negative.");

    RequestResult result;
    result.allocationAfter = allocation;
    result.availableAfter = available;
    result.need = calculateNeed(allocation, maximum);
    result.trace.push_back("P" + std::to_string(pid) + " requests " + vecText(request) + ".");

    if (!leq(request, result.need[pid])) {
        result.status = "invalid";
        result.message = "Request exceeds P" + std::to_string(pid) + "'s remaining Need. The request is invalid.";
        result.trace.push_back(result.message);
        return result;
    }
    if (!leq(request, available)) {
        result.status = "waiting";
        result.message = "The request is within Need but exceeds Available. It must wait; the state is unchanged.";
        result.trace.push_back("Request <= Need, but Request is not <= Available.");
        result.trace.push_back("No allocation was changed.");
        result.safe = safetyCheck(allocation, maximum, available).safe;
        return result;
    }

    Matrix temporaryAllocation = allocation;
    std::vector<int> temporaryAvailable = available;
    for (std::size_t j = 0; j < request.size(); ++j) {
        temporaryAllocation[pid][j] += request[j];
        temporaryAvailable[j] -= request[j];
    }
    result.trace.push_back("Tentatively allocate the request; Available becomes " + vecText(temporaryAvailable) + ".");
    SafetyResult safety = safetyCheck(temporaryAllocation, maximum, temporaryAvailable);
    result.trace.insert(result.trace.end(), safety.trace.begin(), safety.trace.end());
    result.safe = safety.safe;
    if (safety.safe) {
        result.status = "granted";
        result.message = "Request granted. The resulting state remains SAFE.";
        result.allocationAfter = temporaryAllocation;
        result.availableAfter = temporaryAvailable;
        result.sequence = safety.sequence;
        result.need = safety.need;
        result.trace.push_back("Commit the tentative allocation.");
    } else {
        result.status = "denied_unsafe";
        result.message = "Request denied because it would leave the system UNSAFE. The original state is restored.";
        result.trace.push_back("Rollback the tentative allocation. Original Allocation and Available are unchanged.");
    }
    return result;
}

DetectionResult detectDeadlock(const Matrix& allocation, const Matrix& request,
                               const std::vector<int>& available) {
    if (allocation.empty() || allocation.size() != request.size()) throw std::invalid_argument("Allocation and Request must have the same non-zero process count.");
    const std::size_t resources = allocation.front().size();
    if (resources == 0 || !sameWidth(allocation, resources) || !sameWidth(request, resources) || available.size() != resources) throw std::invalid_argument("Allocation, Request, and Available dimensions do not match.");
    for (std::size_t i = 0; i < allocation.size(); ++i) {
        for (std::size_t j = 0; j < resources; ++j) if (allocation[i][j] < 0 || request[i][j] < 0) throw std::invalid_argument("Allocation and Request values cannot be negative.");
    }
    if (std::any_of(available.begin(), available.end(), [](int x) { return x < 0; })) throw std::invalid_argument("Available values cannot be negative.");

    DetectionResult result;
    std::vector<int> work = available;
    std::vector<bool> finish(allocation.size(), false);
    for (std::size_t i = 0; i < allocation.size(); ++i) finish[i] = allZero(allocation[i]);
    result.trace.push_back("Detection starts with Work = " + vecText(work) + ". Processes with no allocated resources are initially marked finishable.");
    bool progressed = true;
    while (progressed) {
        progressed = false;
        for (std::size_t i = 0; i < allocation.size(); ++i) {
            if (finish[i] || !leq(request[i], work)) continue;
            result.trace.push_back("P" + std::to_string(i) + " can be satisfied: Request " + vecText(request[i]) + " <= Work " + vecText(work) + ".");
            addTo(work, allocation[i]);
            finish[i] = true;
            result.trace.push_back("P" + std::to_string(i) + " completes and releases " + vecText(allocation[i]) + "; Work becomes " + vecText(work) + ".");
            progressed = true;
        }
    }
    for (std::size_t i = 0; i < finish.size(); ++i) if (!finish[i]) result.deadlocked.push_back(static_cast<int>(i));
    if (result.deadlocked.empty()) result.trace.push_back("Every process can complete. No deadlocked process was detected under this request matrix.");
    else result.trace.push_back("Processes remaining unfinished: " + vecText(result.deadlocked) + ". A deadlock is detected under the supplied allocation/request assumptions.");
    return result;
}

bool checkResourceOrder(const std::vector<int>& order, int& violationAt, std::string& message) {
    violationAt = -1;
    if (order.empty()) {
        message = "Enter at least one resource ID.";
        return false;
    }
    for (std::size_t i = 0; i < order.size(); ++i) {
        if (order[i] < 0) {
            violationAt = static_cast<int>(i);
            message = "Resource IDs must be non-negative integers.";
            return false;
        }
        if (i > 0 && order[i] < order[i - 1]) {
            violationAt = static_cast<int>(i);
            message = "Blocked: the order decreases from R" + std::to_string(order[i - 1]) + " to R" + std::to_string(order[i]) + ". Enforce a globally increasing resource order to prevent circular wait.";
            return false;
        }
    }
    message = "Allowed: resource IDs follow a non-decreasing global order, so this sequence does not introduce circular wait under the policy.";
    return true;
}
