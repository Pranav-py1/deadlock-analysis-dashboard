const DEFAULT_STATE = {
  allocation: [[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]],
  maximum: [[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]],
  available: [3,3,2]
};
const DEFAULT_DETECTION = {
  allocation: [[1,0],[0,1]],
  request: [[0,1],[1,0]],
  available: [0,0]
};
let detectionState = clone(DEFAULT_DETECTION);
let lastDetection = null;
let toastTimer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function el(id) { return document.getElementById(id); }
function esc(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function showToast(message) {
  const toast = el('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function csv(vector) { return vector.join(','); }
function matrixParam(matrix) { return matrix.map(row => row.join(',')).join(';'); }
function prettySequence(seq) { return seq && seq.length ? seq.map(i => `P${i}`).join(' → ') : 'No complete safe sequence'; }
function fmtVector(vector) { return `[${vector.join(', ')}]`; }

async function apiGet(endpoint, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, typeof value === 'string' ? value : String(value)));
  const response = await fetch(`${endpoint}?${query.toString()}`, { method: 'GET', cache: 'no-store' });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`The C++ engine returned an unreadable response (HTTP ${response.status}).`); }
  if (!result.ok) throw new Error(result.message || `Request failed (HTTP ${response.status}).`);
  return result;
}

function renderMatrix(containerId, matrix, key) {
  const container = el(containerId);
  const resourceCount = matrix[0].length;
  let html = '<table class="matrix-table"><thead><tr><th>Process</th>';
  for (let j = 0; j < resourceCount; j++) html += `<th>R${j}</th>`;
  html += '</tr></thead><tbody>';
  matrix.forEach((row, i) => {
    html += `<tr><td>P${i}</td>`;
    row.forEach((value, j) => {
      html += `<td><input class="matrix-input" type="number" step="1" value="${esc(value)}" aria-label="${key} P${i} R${j}" data-matrix="${key}" data-row="${i}" data-col="${j}"></td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}
function renderVector(containerId, vector, key) {
  el(containerId).innerHTML = vector.map((value, i) => `<label class="vector-field"><span>R${i}</span><input class="vector-input" type="number" step="1" value="${esc(value)}" aria-label="${key} R${i}" data-vector="${key}" data-index="${i}"></label>`).join('');
}
function renderMainInputs(state = DEFAULT_STATE) {
  renderMatrix('allocation-table', state.allocation, 'allocation');
  renderMatrix('maximum-table', state.maximum, 'maximum');
  renderVector('available-table', state.available, 'main-available');
  renderVector('request-vector', [0,4,0], 'request-vector');
  updatePidOptions(state.allocation.length);
}
function updatePidOptions(count) {
  const select = el('request-pid');
  const old = Number(select.value || 0);
  select.innerHTML = Array.from({length: count}, (_, i) => `<option value="${i}">P${i}</option>`).join('');
  select.value = String(Math.min(old, count - 1));
}
function readMatrix(containerId) {
  const rows = [...el(containerId).querySelectorAll('input.matrix-input')];
  const maxRow = Math.max(...rows.map(n => Number(n.dataset.row)));
  const maxCol = Math.max(...rows.map(n => Number(n.dataset.col)));
  const result = Array.from({length: maxRow + 1}, () => Array(maxCol + 1).fill(0));
  for (const input of rows) {
    if (input.value.trim() === '' || !Number.isInteger(Number(input.value))) throw new Error(`Enter an integer for ${input.getAttribute('aria-label')}.`);
    result[Number(input.dataset.row)][Number(input.dataset.col)] = Number(input.value);
  }
  return result;
}
function readVector(containerId) {
  const inputs = [...el(containerId).querySelectorAll('input.vector-input')];
  if (!inputs.length) throw new Error('Enter at least one resource value.');
  return inputs.map(input => {
    if (input.value.trim() === '' || !Number.isInteger(Number(input.value))) throw new Error(`Enter an integer for ${input.getAttribute('aria-label')}.`);
    return Number(input.value);
  });
}
function captureMainState() {
  const allocation = readMatrix('allocation-table');
  const maximum = readMatrix('maximum-table');
  const available = readVector('available-table');
  if (allocation.length !== maximum.length || allocation.some((r,i) => !maximum[i] || r.length !== maximum[i].length) || available.length !== allocation[0].length) {
    throw new Error('Allocation, Maximum, and Available dimensions must match.');
  }
  updatePidOptions(allocation.length);
  return { allocation, maximum, available };
}
function captureDetectionState() {
  const allocation = readMatrix('detect-allocation-table');
  const request = readMatrix('detect-request-table');
  const available = readVector('detect-available-table');
  if (allocation.length !== request.length || allocation.some((r,i) => !request[i] || r.length !== request[i].length) || available.length !== allocation[0].length) {
    throw new Error('Detection matrices and Available dimensions must match.');
  }
  return { allocation, request, available };
}
function resultBox(title, content) {
  return `<div class="result-box"><h4>${esc(title)}</h4>${content}</div>`;
}
function matrixMarkup(matrix, label = 'P') {
  return `<div class="mini-matrix">${matrix.map((row,i) => `<div class="mini-row"><span class="mini-row-label">${label}${i}</span>${row.map(n => `<span class="num-pill">${esc(n)}</span>`).join('')}</div>`).join('')}</div>`;
}
function vectorMarkup(vector) { return `<div class="mini-row">${vector.map((n,i) => `<span class="mini-row-label">R${i}</span><span class="num-pill">${esc(n)}</span>`).join('')}</div>`; }
function traceMarkup(trace) { return `<ol class="trace-list">${trace.map(item => `<li>${esc(item)}</li>`).join('')}</ol>`; }
function sequenceMarkup(sequence) {
  if (!sequence || !sequence.length) return '<span class="muted-result">No complete safe sequence exists.</span>';
  return `<div class="sequence-track">${sequence.map((pid,i) => `<span class="sequence-item"><span class="sequence-node">P${pid}</span>${i < sequence.length - 1 ? '<span class="sequence-arrow">→</span>' : ''}</span>`).join('')}</div>`;
}
function renderSafetyOutput(result) {
  const safe = result.safe;
  el('safety-output').className = 'output-area';
  el('safety-output').innerHTML = `<div class="result-header"><div><h3>Safety algorithm result</h3><p class="muted-result">Need = Maximum − Allocation</p></div><span class="result-badge ${safe ? 'safe' : 'unsafe'}">${safe ? '● Safe state' : '● Unsafe state'}</span></div>
    <div class="result-grid">${resultBox('Need matrix', matrixMarkup(result.need))}${resultBox('Safe sequence', sequenceMarkup(result.sequence))}${resultBox('Work vector after each step', `<div class="mini-matrix">${result.workTrace.map((v,i) => `<div class="mini-row"><span class="mini-row-label">${i === 0 ? 'Start' : `Step ${i}`}</span>${v.map(n => `<span class="num-pill">${esc(n)}</span>`).join('')}</div>`).join('')}</div>`)}${resultBox('Step-by-step trace', traceMarkup(result.trace))}</div>`;
}
function renderRequestOutput(result) {
  const statusText = {granted:'Request granted', waiting:'Waiting for resources', denied_unsafe:'Denied: unsafe state', invalid:'Invalid request'}[result.status] || 'Request result';
  el('request-output').className = 'output-area';
  let seq = result.status === 'granted' ? sequenceMarkup(result.sequence) : `<span class="muted-result">${result.status === 'waiting' ? 'No tentative allocation was made.' : 'No allocation was committed.'}</span>`;
  el('request-output').innerHTML = `<div class="result-header"><div><h3>Request decision</h3><p class="muted-result">${esc(result.message)}</p></div><span class="result-badge ${esc(result.status)}">${esc(statusText)}</span></div>
    <div class="result-grid">${resultBox('Need matrix', matrixMarkup(result.need || []))}${resultBox('Safe sequence if granted', seq)}${resultBox('Allocation after decision', matrixMarkup(result.allocationAfter || []))}${resultBox('Available after decision', vectorMarkup(result.availableAfter || []))}${resultBox('Decision trace', traceMarkup(result.trace || []))}</div>`;
}
function renderDetectionOutput(result) {
  lastDetection = result;
  el('detection-output').className = 'output-area';
  const hasDeadlock = result.deadlocked.length > 0;
  const deadlocked = hasDeadlock ? result.deadlocked.map(i => `P${i}`).join(', ') : 'None detected';
  el('detection-output').innerHTML = `<div class="result-header"><div><h3>Detection result</h3><p class="muted-result">${hasDeadlock ? `Unfinished processes: ${deadlocked}.` : 'Every process could complete with the supplied data.'}</p></div><span class="result-badge ${hasDeadlock ? 'unsafe' : 'safe'}">${hasDeadlock ? '● Deadlock detected' : '● No deadlock detected'}</span></div><div class="result-grid">${resultBox('Detected processes', `<strong>${esc(deadlocked)}</strong><p class="muted-result">This conclusion comes from the separate detection algorithm, not the Banker’s safety check.</p>`)}${resultBox('Detection trace', traceMarkup(result.trace))}</div>`;
  const recoverySelect = el('recover-pid');
  recoverySelect.innerHTML = Array.from({length: detectionState.allocation.length}, (_,i) => `<option value="${i}">P${i}</option>`).join('');
  if (hasDeadlock) recoverySelect.value = String(result.deadlocked[0]);
  el('recovery-output').className = 'inline-result muted-result';
  el('recovery-output').textContent = hasDeadlock ? `Detected processes: ${deadlocked}. Select one above to simulate termination and resource release.` : 'No deadlocked process is currently marked. Edit the detection scenario or reset it before testing recovery.';
}
function setInlineResult(id, message, kind) {
  el(id).className = `inline-result ${kind || 'muted-result'}`;
  el(id).textContent = message;
}
function setTheme(dark) {
  document.body.classList.toggle('dark', dark);
  el('theme-icon').textContent = dark ? '☀' : '☾';
  el('theme-label').textContent = dark ? 'Light mode' : 'Dark mode';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  try { localStorage.setItem('deadlock-theme', dark ? 'dark' : 'light'); } catch (_) {}
}
function activateTab(name) {
  document.querySelectorAll('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
}
async function runSafety(showMessage = true) {
  try {
    const state = captureMainState();
    const result = await apiGet('/api/safety', { allocation: matrixParam(state.allocation), maximum: matrixParam(state.maximum), available: csv(state.available) });
    renderSafetyOutput(result);
    if (showMessage) showToast(result.safe ? 'Safe state found.' : 'The system state is unsafe.');
    return result;
  } catch (error) {
    showError('safety-output', error.message);
    throw error;
  }
}
async function runRequest(overrides = null, showMessage = true) {
  try {
    const state = captureMainState();
    const pid = overrides ? overrides.pid : Number(el('request-pid').value);
    const request = overrides ? overrides.request : readVector('request-vector');
    const result = await apiGet('/api/request', { allocation: matrixParam(state.allocation), maximum: matrixParam(state.maximum), available: csv(state.available), pid, request: csv(request) });
    renderRequestOutput(result);
    if (showMessage) showToast(result.message);
    return result;
  } catch (error) {
    showError('request-output', error.message);
    throw error;
  }
}
async function runDetection(showMessage = true) {
  try {
    detectionState = captureDetectionState();
    const result = await apiGet('/api/detection', { allocation: matrixParam(detectionState.allocation), request: matrixParam(detectionState.request), available: csv(detectionState.available) });
    renderDetectionOutput(result);
    if (showMessage) showToast(result.deadlocked.length ? 'Deadlocked process detected.' : 'No deadlock detected.');
    return result;
  } catch (error) {
    showError('detection-output', error.message);
    throw error;
  }
}
async function runPrevention(orderText = null, showMessage = true) {
  try {
    const raw = (orderText == null ? el('resource-order').value : orderText).trim();
    if (!raw) throw new Error('Enter a resource sequence, such as 0, 1, 2.');
    const pieces = raw.split(',').map(x => x.trim());
    if (pieces.some(x => !/^-?\d+$/.test(x))) throw new Error('Resource IDs must be comma-separated integers.');
    const order = pieces.map(Number);
    const result = await apiGet('/api/prevention', { order: csv(order) });
    const kind = result.allowed ? 'success' : 'error';
    setInlineResult('prevention-output', result.message, kind);
    if (showMessage) showToast(result.allowed ? 'Resource order follows the policy.' : 'Resource order violates the policy.');
    return result;
  } catch (error) {
    setInlineResult('prevention-output', error.message, 'error');
    throw error;
  }
}
function showError(id, message) {
  const target = el(id);
  target.className = 'output-area';
  target.innerHTML = `<div class="result-header"><div><h3>Could not complete the analysis</h3><p class="muted-result">${esc(message)}</p></div><span class="result-badge invalid">Validation error</span></div>`;
}
function resetOutputs() {
  el('safety-output').className = 'output-area empty-output';
  el('safety-output').innerHTML = '<div class="empty-icon">✓</div><h3>Ready to analyse</h3><p>Run the safety check to calculate Need, the safe sequence, and Work after each process finishes.</p>';
  el('request-output').className = 'output-area empty-output';
  el('request-output').innerHTML = '<div class="empty-icon">⇄</div><h3>No request submitted</h3><p>Choose a request or load one of the required scenarios.</p>';
  el('detection-output').className = 'output-area empty-output';
  el('detection-output').innerHTML = '<div class="empty-icon">⌁</div><h3>Detection not run</h3><p>Run detection to inspect the outstanding requests and unfinished processes.</p>';
  el('recovery-output').className = 'inline-result muted-result';
  el('recovery-output').textContent = 'Run detection first, then choose a process to terminate.';
  setInlineResult('prevention-output', 'The policy check has not been run.', 'muted-result');
  el('test-summary').className = 'test-summary';
  el('test-summary').innerHTML = '<span class="summary-icon">▤</span><span>Tests have not been run yet. Run all checks to populate the analytical results table.</span>';
  el('test-results-body').innerHTML = '<tr><td colspan="5" class="table-empty">Run all checks to populate this table.</td></tr>';
  lastDetection = null;
}
function resetAll() {
  renderMainInputs(clone(DEFAULT_STATE));
  detectionState = clone(DEFAULT_DETECTION);
  renderMatrix('detect-allocation-table', detectionState.allocation, 'detect-allocation');
  renderMatrix('detect-request-table', detectionState.request, 'detect-request');
  renderVector('detect-available-table', detectionState.available, 'detect-available');
  el('request-pid').value = '0';
  el('resource-order').value = '0, 1, 2';
  el('ai-verification').value = 'Run the test suite, compare outputs with expected cases, and verify the algorithms before submission.';
  resetOutputs();
  showToast('All teaching matrices were reset.');
}
function resultRow(test, condition, actual, expected, analysis, pass) {
  return `<tr><td>${esc(test)}</td><td>${esc(condition)}</td><td>${esc(actual)}</td><td>${esc(expected)}</td><td><span class="${pass ? 'pass-label' : 'fail-label'}">${pass ? 'PASS' : 'CHECK'}</span><br>${esc(analysis)}</td></tr>`;
}
async function runAllTests() {
  const button = el('run-all-tests');
  button.disabled = true;
  button.textContent = 'Running checks…';
  const rows = [];
  let passed = 0;
  try {
    const safe = await apiGet('/api/safety', { allocation: matrixParam(DEFAULT_STATE.allocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: csv(DEFAULT_STATE.available) });
    const safeExpected = [1,3,4,0,2].join(',') === safe.sequence.join(',');
    rows.push(resultRow('TC1', 'Safe state', safe.safe ? `Safe sequence: ${prettySequence(safe.sequence)}` : 'Unsafe state returned', 'Safe sequence found', safe.safe ? 'Need and Work trace show each process can finish.' : 'The default teaching example should be safe.', safe.safe && safeExpected));
    if (safe.safe && safeExpected) passed++;

    const wait = await apiGet('/api/request', { allocation: matrixParam(DEFAULT_STATE.allocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: csv(DEFAULT_STATE.available), pid: 0, request: '0,4,0' });
    const waitPass = wait.status === 'waiting';
    rows.push(resultRow('TC2', 'Request exceeds Available', wait.message, 'Waiting; state unchanged', 'Request is within P0 Need but resource R1 is not currently available in sufficient quantity.', waitPass));
    if (waitPass) passed++;

    const unsafe = await apiGet('/api/request', { allocation: matrixParam(DEFAULT_STATE.allocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: csv(DEFAULT_STATE.available), pid: 4, request: '3,3,0' });
    const unsafePass = unsafe.status === 'denied_unsafe' && JSON.stringify(unsafe.allocationAfter) === JSON.stringify(DEFAULT_STATE.allocation) && JSON.stringify(unsafe.availableAfter) === JSON.stringify(DEFAULT_STATE.available);
    rows.push(resultRow('TC3', 'Request produces unsafe state', unsafe.message, 'Deny request and preserve original state', 'The tentative grant has no complete safe sequence and is rolled back.', unsafePass));
    if (unsafePass) passed++;

    const detection = await apiGet('/api/detection', { allocation: matrixParam(DEFAULT_DETECTION.allocation), request: matrixParam(DEFAULT_DETECTION.request), available: csv(DEFAULT_DETECTION.available) });
    const detectionPass = detection.deadlocked.join(',') === '0,1';
    rows.push(resultRow('TC4', 'Circular-wait detection case', detection.deadlocked.length ? `Deadlocked processes: ${detection.deadlocked.map(i => `P${i}`).join(', ')}` : 'No deadlock detected', 'Detect P0 and P1', 'Both processes hold a resource and wait for the other under this scenario.', detectionPass));
    if (detectionPass) passed++;

    const order = await apiGet('/api/prevention', { order: '2,1,0' });
    const orderPass = !order.allowed && order.violationAt === 1;
    rows.push(resultRow('TC5', 'Fixed resource-order policy', order.message, 'Reject decreasing resource order', 'Blocking the order reversal prevents this sequence from introducing circular wait.', orderPass));
    if (orderPass) passed++;

    let negativeRejected = false;
    let invalidPidRejected = false;
    let allocationRejected = false;
    let zeroAvailableValid = false;
    let zeroNeedValid = false;
    try {
      await apiGet('/api/request', { allocation: matrixParam(DEFAULT_STATE.allocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: csv(DEFAULT_STATE.available), pid: 0, request: '-1,0,0' });
    } catch (err) { negativeRejected = /negative/i.test(err.message); }
    try {
      await apiGet('/api/request', { allocation: matrixParam(DEFAULT_STATE.allocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: csv(DEFAULT_STATE.available), pid: 99, request: '0,0,0' });
    } catch (err) { invalidPidRejected = /Invalid process ID/i.test(err.message); }
    try {
      const badAllocation = clone(DEFAULT_STATE.allocation); badAllocation[0][0] = 8;
      await apiGet('/api/safety', { allocation: matrixParam(badAllocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: csv(DEFAULT_STATE.available) });
    } catch (err) { allocationRejected = /cannot exceed Maximum/i.test(err.message); }
    const zeroAvail = await apiGet('/api/safety', { allocation: matrixParam(DEFAULT_STATE.allocation), maximum: matrixParam(DEFAULT_STATE.maximum), available: '0,0,0' });
    zeroAvailableValid = !zeroAvail.safe;
    const zeroNeed = await apiGet('/api/safety', { allocation: '1,0', maximum: '1,0', available: '0,0' });
    zeroNeedValid = zeroNeed.safe && zeroNeed.sequence.join(',') === '0';
    const invalidPass = negativeRejected && invalidPidRejected && allocationRejected && zeroAvailableValid && zeroNeedValid;
    const invalidMessage = `Zero Available: ${zeroAvailableValid ? 'valid boundary handled' : 'unexpected result'}; zero Need: ${zeroNeedValid ? 'process completes' : 'unexpected result'}; invalid PID: ${invalidPidRejected ? 'rejected' : 'not rejected'}; negative request: ${negativeRejected ? 'rejected' : 'not rejected'}; Allocation > Maximum: ${allocationRejected ? 'rejected' : 'not rejected'}.`;
    rows.push(resultRow('TC6', 'Boundary and invalid input', invalidMessage, 'Handle zero-resource boundaries and reject invalid inputs', 'Zero Available is valid but may be unsafe; zero Need can finish. Invalid IDs, negative requests, and Allocation greater than Maximum must be rejected.', invalidPass));
    if (invalidPass) passed++;

    el('test-results-body').innerHTML = rows.join('');
    const allPassed = passed === rows.length;
    el('test-summary').className = `test-summary ${allPassed ? 'all-passed' : 'has-failures'}`;
    el('test-summary').innerHTML = `<span class="summary-icon">${allPassed ? '✓' : '!'}</span><span><b>${passed} of ${rows.length} checks passed.</b> Results came from the C++ engine using the preset analytical cases. Review each conclusion before submitting.</span>`;
    showToast(`${passed} of ${rows.length} checks passed.`);
  } catch (error) {
    el('test-summary').className = 'test-summary has-failures';
    el('test-summary').textContent = `Could not complete all checks: ${error.message}`;
    showToast('Test run stopped. Check the C++ engine and input data.');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Run all checks <span>→</span>';
  }
}

function terminateProcess() {
  try {
    if (!lastDetection) throw new Error('Run deadlock detection before attempting recovery.');
    const pid = Number(el('recover-pid').value);
    if (!lastDetection.deadlocked.includes(pid)) throw new Error(`P${pid} is not listed as deadlocked in the latest detection result.`);
    const released = detectionState.allocation[pid].slice();
    detectionState.available = detectionState.available.map((value, j) => value + released[j]);
    detectionState.allocation[pid] = detectionState.allocation[pid].map(() => 0);
    detectionState.request[pid] = detectionState.request[pid].map(() => 0);
    renderMatrix('detect-allocation-table', detectionState.allocation, 'detect-allocation');
    renderMatrix('detect-request-table', detectionState.request, 'detect-request');
    renderVector('detect-available-table', detectionState.available, 'detect-available');
    setInlineResult('recovery-output', `Terminated P${pid}. Released ${fmtVector(released)}; Available is now ${fmtVector(detectionState.available)}. Re-run detection to verify recovery.`, 'success');
    lastDetection = null;
    showToast(`P${pid} terminated and resources released.`);
  } catch (error) {
    setInlineResult('recovery-output', error.message, 'error');
  }
}

function init() {
  try {
    const saved = localStorage.getItem('deadlock-theme');
    setTheme(saved === 'dark');
  } catch (_) { setTheme(false); }
  renderMainInputs(clone(DEFAULT_STATE));
  renderMatrix('detect-allocation-table', detectionState.allocation, 'detect-allocation');
  renderMatrix('detect-request-table', detectionState.request, 'detect-request');
  renderVector('detect-available-table', detectionState.available, 'detect-available');

  document.querySelectorAll('.tab-button').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  el('theme-toggle').addEventListener('click', () => setTheme(!document.body.classList.contains('dark')));
  el('reset-all').addEventListener('click', resetAll);
  el('run-safety').addEventListener('click', () => runSafety().catch(() => {}));
  el('run-request').addEventListener('click', () => runRequest().catch(() => {}));
  el('preset-wait').addEventListener('click', () => { el('request-pid').value = '0'; renderVector('request-vector', [0,4,0], 'request-vector'); activateTab('request'); showToast('Scenario B loaded.'); });
  el('preset-unsafe').addEventListener('click', () => { el('request-pid').value = '4'; renderVector('request-vector', [3,3,0], 'request-vector'); activateTab('request'); showToast('Scenario C loaded.'); });
  el('run-detection').addEventListener('click', () => runDetection().catch(() => {}));
  el('run-recovery').addEventListener('click', terminateProcess);
  el('run-prevention').addEventListener('click', () => runPrevention().catch(() => {}));
  el('order-safe').addEventListener('click', () => { el('resource-order').value = '0, 1, 2'; runPrevention().catch(() => {}); });
  el('order-invalid').addEventListener('click', () => { el('resource-order').value = '2, 1, 0'; runPrevention().catch(() => {}); });
  el('run-all-tests').addEventListener('click', runAllTests);
  apiGet('/api/health').then(() => {
    el('backend-status').textContent = 'C++ engine connected';
    document.querySelector('.status-dot').classList.add('connected');
  }).catch(() => {
    el('backend-status').textContent = 'C++ engine unavailable';
    document.querySelector('.status-dot').classList.add('disconnected');
    showToast('Start the dashboard with run_windows.bat or run_linux.sh.');
  });
}
document.addEventListener('DOMContentLoaded', init);
