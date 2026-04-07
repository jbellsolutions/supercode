/* SuperCode Dashboard — Frontend App */

const WS_URL = `ws://${location.host}`;
const API = '/api';

// ── State ─────────────────────────────────────────────────────────────────────
let ws = null;
let connected = false;
let sessionId = null;
let currentModel = 'gemini-2.5-flash';
let streamingBubble = null;
let streamingText = '';
let thinkingEl = null;
let toolMap = {}; // callId → DOM element

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const messages    = $('messages');
const chatInput   = $('chat-input');
const sendBtn     = $('send-btn');
const initBtn     = $('init-btn');
const modelSelect = $('model-select');
const modeSelect  = $('mode-select');
const dirInput    = $('dir-input');
const statusDot   = $('status-dot');
const costDisplay = $('cost-display');
const toolEntries = $('tool-entries');
const sessionList = $('session-list');
const approvalModal = $('approval-modal');
const approvalDesc  = $('approval-desc');
const approveBtn    = $('approve-btn');
const denyBtn       = $('deny-btn');
const clearBtn      = $('clear-btn');
const newSessionBtn = $('new-session-btn');
const providerStatus = $('provider-status');

// ── Model loader ──────────────────────────────────────────────────────────────
let allModels = [];

async function loadModels() {
  const sel = $('model-select');
  const search = $('model-search');
  if (!sel || !search) return;
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    allModels = data.models || [];
    renderModelOptions(allModels, sel);
  } catch {
    sel.innerHTML = '<option value="openrouter/deepseek/deepseek-r1">openrouter/deepseek-r1</option>';
  }
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    const filtered = q ? allModels.filter(m =>
      m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)
    ) : allModels;
    renderModelOptions(filtered, sel);
  });
}

function renderModelOptions(models, sel) {
  if (!models.length) {
    sel.innerHTML = '<option value="">No models found</option>';
    return;
  }
  const groups = {};
  models.forEach(m => {
    const provider = m.id.split('/')[0];
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  });
  sel.innerHTML = Object.entries(groups).map(([provider, list]) =>
    `<optgroup label="${provider}">${
      list.map(m => {
        const price = m.pricing?.prompt
          ? ` · $${(parseFloat(m.pricing.prompt) * 1e6).toFixed(3)}/M`
          : '';
        return `<option value="openrouter/${m.id}">${m.id}${price}</option>`;
      }).join('')
    }</optgroup>`
  ).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  await loadConfig();
  await loadModels();
  await loadSessions();
  connectWS();
});

async function loadConfig() {
  try {
    const res = await fetch(`${API}/config`);
    const cfg = await res.json();
    const providers = cfg.providers;
    const chips = [
      { label: 'Gemini', ok: providers.gemini.configured },
      { label: 'Codex/OpenAI', ok: providers.openai.configured },
      { label: 'OpenRouter', ok: providers.openrouter.configured },
    ];
    providerStatus.innerHTML = chips.map(c =>
      `<span class="chip ${c.ok ? 'ok' : 'missing'}">${c.ok ? '✓' : '○'} ${c.label}</span>`
    ).join('');
  } catch {}
}

async function loadSessions() {
  try {
    const res = await fetch(`${API}/sessions`);
    const sessions = await res.json();
    if (!sessions.length) return;
    sessionList.innerHTML = '';
    sessions.slice().reverse().forEach(s => {
      const el = document.createElement('div');
      el.className = 'session-item';
      const date = s.startTime ? new Date(s.startTime).toLocaleString() : 'Unknown';
      el.innerHTML = `<span class="s-id">${s.id.slice(0, 12)}…</span><span class="s-time">${date}</span>`;
      el.title = s.workingDirectory;
      el.addEventListener('click', () => resumeSession(s.id));
      sessionList.appendChild(el);
    });
  } catch {}
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected = true;
    setStatus('disconnected'); // waiting for init
  };

  ws.onclose = () => {
    connected = false;
    setStatus('disconnected');
    disableInput();
    setTimeout(connectWS, 3000); // auto-reconnect
  };

  ws.onerror = () => {};

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    handleServerMsg(msg);
  };
}

function handleServerMsg(msg) {
  switch (msg.type) {
    case 'connected':
      console.log('WS connected, client:', msg.clientId);
      break;

    case 'session_created':
      sessionId = msg.sessionId;
      currentModel = msg.model;
      setStatus('connected');
      enableInput();
      initBtn.textContent = 'Reconnect';
      clearMessages();
      appendSystemMsg(`Session started · Model: ${msg.model} · Mode: ${msg.mode} · Dir: ${msg.workingDir}`);
      loadSessions();
      break;

    case 'resumed':
      appendSystemMsg(`Resumed session (${msg.messageCount} messages restored)`);
      break;

    case 'thinking':
      removeThinking();
      thinkingEl = appendThinking();
      setStatus('thinking');
      streamingBubble = null;
      streamingText = '';
      break;

    case 'agent_event':
      handleAgentEvent(msg.event);
      break;

    case 'cost_update':
      costDisplay.textContent = msg.summary;
      break;

    case 'approval_request':
      showApproval(msg.call, msg.description);
      break;

    case 'model_changed':
      currentModel = msg.model;
      appendSystemMsg(`Model switched to: ${msg.model}`);
      break;

    case 'mode_changed':
      appendSystemMsg(`Mode set to: ${msg.mode}`);
      break;

    case 'history_cleared':
      clearMessages();
      appendSystemMsg('History cleared.');
      break;

    case 'error':
      removeThinking();
      setStatus('connected');
      appendErrorMsg(msg.message);
      break;
  }
}

function handleAgentEvent(event) {
  switch (event.type) {
    case 'assistant_text':
      removeThinking();
      setStatus('connected');
      if (!streamingBubble) {
        streamingBubble = appendAssistantBubble('');
      }
      streamingText += event.text;
      updateBubble(streamingBubble, streamingText, true);
      break;

    case 'tool_call': {
      const call = event.toolCall;
      const entry = appendToolEntry(call, 'pending');
      toolMap[call.id] = entry;
      break;
    }

    case 'tool_result': {
      const { call, result } = event.toolResult;
      const entry = toolMap[call.id];
      if (entry) updateToolEntry(entry, result);
      break;
    }

    case 'done':
      removeThinking();
      setStatus('connected');
      if (streamingBubble) {
        // Finalize — remove cursor
        updateBubble(streamingBubble, streamingText, false);
        streamingBubble = null;
        streamingText = '';
      }
      break;

    case 'error':
      removeThinking();
      setStatus('connected');
      appendErrorMsg(event.error);
      break;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────
initBtn.addEventListener('click', () => {
  send({
    type: 'init',
    workingDir: dirInput.value || '.',
    model: modelSelect.value,
    mode: modeSelect.value,
    maxTurns: 100,
  });
});

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
});

clearBtn.addEventListener('click', () => {
  send({ type: 'command', command: 'clear_history' });
});

newSessionBtn.addEventListener('click', () => {
  send({
    type: 'init',
    workingDir: dirInput.value || '.',
    model: modelSelect.value,
    mode: modeSelect.value,
  });
});

modelSelect.addEventListener('change', () => {
  if (sessionId) {
    send({ type: 'command', command: 'set_model', model: modelSelect.value });
  }
});

modeSelect.addEventListener('change', () => {
  if (sessionId) {
    send({ type: 'command', command: 'set_mode', mode: modeSelect.value });
  }
});

approveBtn.addEventListener('click', () => {
  send({ type: 'approval', approved: true });
  approvalModal.classList.add('hidden');
});
denyBtn.addEventListener('click', () => {
  send({ type: 'approval', approved: false });
  approvalModal.classList.add('hidden');
});

function sendMessage() {
  const prompt = chatInput.value.trim();
  if (!prompt || !sessionId) return;
  appendUserMsg(prompt);
  send({ type: 'chat', prompt });
  chatInput.value = '';
  chatInput.style.height = 'auto';
}

function resumeSession(id) {
  send({ type: 'resume', sessionId: id });
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function appendUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = `<div class="msg-role">You</div><div class="msg-bubble">${esc(text)}</div>`;
  messages.appendChild(el);
  scrollBottom();
  return el;
}

function appendAssistantBubble(text) {
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = `<div class="msg-role">SuperCode · ${currentModel}</div><div class="msg-bubble"><span class="cursor"></span></div>`;
  messages.appendChild(el);
  scrollBottom();
  return el;
}

function updateBubble(el, text, streaming) {
  const bubble = el.querySelector('.msg-bubble');
  const rendered = renderMarkdown(text);
  bubble.innerHTML = rendered + (streaming ? '<span class="cursor"></span>' : '');
  scrollBottom();
}

function appendSystemMsg(text) {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:11px;color:var(--muted);text-align:center;font-family:var(--font-mono);';
  el.textContent = `— ${text} —`;
  messages.appendChild(el);
  scrollBottom();
}

function appendErrorMsg(text) {
  const el = document.createElement('div');
  el.style.cssText = 'background:#1c0a0a;border:1px solid var(--red);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--red);font-family:var(--font-mono);';
  el.textContent = `✗ ${text}`;
  messages.appendChild(el);
  scrollBottom();
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'thinking-msg';
  el.innerHTML = `<span class="dots"><span>•</span><span>•</span><span>•</span></span> Thinking…`;
  messages.appendChild(el);
  scrollBottom();
  return el;
}

function removeThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

function clearMessages() {
  messages.innerHTML = '';
  toolEntries.innerHTML = '<div class="tool-empty">Tool calls will appear here</div>';
  toolMap = {};
}

function appendToolEntry(call, status) {
  const first = toolEntries.querySelector('.tool-empty');
  if (first) first.remove();

  const el = document.createElement('div');
  el.className = `tool-entry ${status}`;
  const inputPreview = JSON.stringify(call.input, null, 2).slice(0, 120);
  el.innerHTML = `
    <span class="tool-name">⚙ ${esc(call.name)}</span>
    <span class="tool-input">${esc(inputPreview)}</span>
    <span class="tool-result-text">Running…</span>
  `;
  toolEntries.prepend(el);
  return el;
}

function updateToolEntry(el, result) {
  el.className = `tool-entry ${result.success ? 'success' : 'error'}`;
  const resultEl = el.querySelector('.tool-result-text');
  const preview = (result.success ? result.output : result.error ?? 'Error').split('\n')[0].slice(0, 80);
  resultEl.textContent = preview || '(done)';
}

function showApproval(call, desc) {
  approvalDesc.textContent = desc;
  approvalModal.classList.remove('hidden');
}

function scrollBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function setStatus(s) {
  statusDot.className = `status-dot ${s}`;
  statusDot.title = s.charAt(0).toUpperCase() + s.slice(1);
}

function enableInput() {
  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.focus();
}

function disableInput() {
  chatInput.disabled = true;
  sendBtn.disabled = true;
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Markdown renderer (minimal) ───────────────────────────────────────────────
function renderMarkdown(text) {
  let html = esc(text);
  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<strong style="color:var(--accent)">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:15px;color:var(--accent)">$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong style="font-size:16px;color:var(--accent)">$1</strong>');
  return html;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
