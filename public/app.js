/* ─── State ─── */
const state = {
  conversations: [],
  currentId: null,
  isProcessing: false,
  settings: { theme: 'dark', fontSize: 'medium' },
};

const CONV_KEY = 'zeraea_conversations';
const SETTINGS_KEY = 'zeraea_settings';
const CURRENT_ID_KEY = 'zeraea_current_id';

/* ─── DOM Refs ─── */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const messagesEl = $('#messages');
const inputEl = $('#questionInput');
const sendBtn = $('#sendBtn');
const sidebarEl = $('#sidebar');
const sidebarOverlay = $('#sidebarOverlay');
const convListEl = $('#conversationList');
const settingsMenu = $('#settingsMenu');
const toastContainer = $('#toastContainer');
const statusBadge = $('#statusBadge');

/* ─── Storage ─── */
async function saveToServer() {
  const conv = getCurrentConv();
  if (!conv) return;
  try {
    await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conv),
    });
  } catch {}
}

async function deleteFromServer(id) {
  try {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  } catch {}
}

async function loadFromServer() {
  try {
    const res = await fetch('/api/conversations');
    const summaries = await res.json();
    const fullConvs = [];
    for (const s of summaries) {
      const r2 = await fetch(`/api/conversations/${s.id}`);
      const conv = await r2.json();
      if (conv && conv.messages) fullConvs.push(conv);
    }
    if (fullConvs.length > 0) {
      state.conversations = fullConvs;
      saveConversations();
      return true;
    }
  } catch {}
  return false;
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(CONV_KEY);
    state.conversations = raw ? JSON.parse(raw) : [];
  } catch { state.conversations = []; }
}

function saveConversations() {
  try { localStorage.setItem(CONV_KEY, JSON.stringify(state.conversations)); } catch {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) state.settings = { ...state.settings, ...JSON.parse(raw) };
  } catch {}
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch {}
}

/* ─── Conversations ─── */
function createConversation(title) {
  const conv = {
    id: crypto.randomUUID(),
    title: title || 'محادثة جديدة',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.conversations.unshift(conv);
  state.currentId = conv.id;
  localStorage.setItem(CURRENT_ID_KEY, conv.id);
  saveConversations();
  saveToServer();
  renderConversations();
  return conv;
}

function getCurrentConv() {
  return state.conversations.find((c) => c.id === state.currentId);
}

function switchConversation(id) {
  state.currentId = id;
  localStorage.setItem(CURRENT_ID_KEY, id);
  const conv = getCurrentConv();
  if (conv) {
    conv.updatedAt = Date.now();
    saveConversations();
  }
  renderConversations();
  renderMessages();
  inputEl.focus();
  closeSidebar();
}

function deleteConversation(id, e) {
  e.stopPropagation();
  const conv = state.conversations.find((c) => c.id === id);
  showConfirm({
    title: 'حذف المحادثة',
    message: `هل أنت متأكد من حذف "${conv?.title || 'المحادثة'}"؟`,
    confirmText: 'حذف',
    onConfirm: async () => {
      state.conversations = state.conversations.filter((c) => c.id !== id);
      if (state.currentId === id) {
        state.currentId = state.conversations.length > 0 ? state.conversations[0].id : null;
      }
      saveConversations();
      await deleteFromServer(id);
      renderConversations();
      renderMessages();
      toast('تم حذف المحادثة', 'success');
    },
  });
}

function newChat() {
  const conv = createConversation();
  renderConversations();
  renderMessages();
  inputEl.value = '';
  inputEl.focus();
  closeSidebar();
  saveConversations();
}

function addMessageToConv(role, content) {
  const conv = getCurrentConv();
  if (!conv) return;
  conv.messages.push({ role, content });
  conv.updatedAt = Date.now();
  if (role === 'user' && conv.messages.filter((m) => m.role === 'user').length === 1) {
    conv.title = content.slice(0, 40) + (content.length > 40 ? '...' : '');
  }
  saveConversations();
  saveToServer();
  renderConversations();
}

function updateLastAssistant(content, sources) {
  const conv = getCurrentConv();
  if (!conv) return;
  const last = conv.messages[conv.messages.length - 1];
  if (last && last.role === 'assistant') {
    last.content = content;
    if (sources) last.sources = sources;
  } else {
    conv.messages.push({ role: 'assistant', content, sources: sources || [] });
  }
  conv.updatedAt = Date.now();
  saveConversations();
  saveToServer();
}

/* ─── Render ─── */
function renderConversations() {
  if (!convListEl) return;
  if (state.conversations.length === 0) {
    convListEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-faint);font-size:13px;">لا توجد محادثات سابقة</div>`;
    return;
  }
  convListEl.innerHTML = state.conversations
    .map(
      (c) => `
      <div class="conv-item ${c.id === state.currentId ? 'active' : ''}" onclick="switchConversation('${c.id}')">
        <span class="conv-icon">💬</span>
        <div class="conv-info">
          <div class="conv-title">${escapeHtml(c.title)}</div>
          <div class="conv-preview">${escapeHtml(c.messages.filter(m => m.role === 'assistant').pop()?.content?.slice(0, 50) || '...')}</div>
        </div>
        <button class="conv-delete" onclick="deleteConversation('${c.id}', event)" title="حذف">✕</button>
      </div>`
    )
    .join('');
}

function renderMessages() {
  messagesEl.innerHTML = '';
  const conv = getCurrentConv();
  if (!conv || conv.messages.length === 0) {
    renderEmptyState();
    return;
  }
  conv.messages.forEach((msg) => {
    if (msg.role === 'user') appendMessage(msg.content, 'user');
    else appendMessage(msg.content, 'assistant', msg.sources);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderEmptyState() {
  messagesEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🌱</div>
      <h2>مرحباً بك في زراعة شات</h2>
      <p>اسأل عن الزراعة، المحاصيل، الري، التسميد، الآفات، والمزيد</p>
      <div class="tags">
        <button onclick="askQuick('ما هي أنواع التربة الزراعية؟')">أنواع التربة</button>
        <button onclick="askQuick('كيف يتم ري المحاصيل؟')">أنظمة الري</button>
        <button onclick="askQuick('ما هي طرق مكافحة الآفات؟')">مكافحة الآفات</button>
        <button onclick="askQuick('ما هي الزراعة العضوية؟')">الزراعة العضوية</button>
        <button onclick="askQuick('أفضل المحاصيل الصيفية')">المحاصيل الصيفية</button>
        <button onclick="askQuick('كيفية التسميد السليم')">التسميد السليم</button>
      </div>
    </div>`;
}

function appendMessage(text, role, sources) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'user') {
    div.textContent = text;
  } else {
    div.innerHTML = renderMarkdown(text);
    if (sources && sources.length) {
      const srcDiv = document.createElement('div');
      srcDiv.className = 'sources';
      srcDiv.innerHTML = `
        <button class="sources-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
          📚 المصادر (${sources.length}) <span class="arrow">◀</span>
        </button>
        <div class="sources-list">
          ${sources.map((s) => `<button class="source-chip">${escapeHtml(s.replace('.txt', ''))}</button>`).join('')}
        </div>`;
      div.appendChild(srcDiv);
    }
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

/* ─── Markdown ─── */
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Code blocks (must be before inline code)
  html = html.replace(/~~~(\w*)\n([\s\S]*?)~~~/g, (_, lang, code) => {
    const trimmed = code.replace(/&amp;/g, '&');
    return `<pre><button class="copy-btn" onclick="copyCode(this)">نسخ</button><code>${trimmed}</code></pre>`;
  });
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmed = code.replace(/&amp;/g, '&');
    return `<pre><button class="copy-btn" onclick="copyCode(this)">نسخ</button><code>${trimmed}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Lists: unordered (- or *)
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    if (!match.includes('<ul>')) return '<ol>' + match + '</ol>';
    return match;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');

  // Single newlines within paragraphs
  html = html.replace(/\n/g, '<br>');

  // Wrap in paragraphs if not already wrapped
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';

  // Clean empty paragraphs
  html = html.replace(/<p><\/p>/g, '');

  return html;
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}

function copyCode(btn) {
  const code = btn.nextElementSibling.textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'تم!';
    setTimeout(() => { btn.textContent = 'نسخ'; }, 1500);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = 'تم!';
    setTimeout(() => { btn.textContent = 'نسخ'; }, 1500);
  });
}

/* ─── Chat ─── */
async function sendQuestion() {
  const question = inputEl.value.trim();
  if (!question || state.isProcessing) return;

  state.isProcessing = true;
  inputEl.value = '';
  autoResize();
  sendBtn.disabled = true;

  let conv = getCurrentConv();
  if (!conv) {
    conv = createConversation(question);
    renderConversations();
  }

  // Remove empty state and add user message
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  addMessageToConv('user', question);
  appendMessage(question, 'user');

  // Show typing indicator
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message assistant';
  msgDiv.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(msgDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Global streaming state
  let answer = '';
  let sources = [];

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, conversationId: conv.id }),
    });

    if (!res.ok) {
      const err = await res.json();
      msgDiv.innerHTML = `<p>خطأ: ${escapeHtml(err.error)}</p>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            answer += parsed.content;
            msgDiv.innerHTML = renderMarkdown(answer) + '<span class="stream-cursor"></span>';
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          if (parsed.sources) {
            sources = parsed.sources;
          }
        } catch {}
      }
    }

    // Remove cursor and render final
    msgDiv.innerHTML = renderMarkdown(answer);

    if (sources.length) {
      const srcDiv = document.createElement('div');
      srcDiv.className = 'sources';
      srcDiv.innerHTML = `
        <button class="sources-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
          📚 المصادر (${sources.length}) <span class="arrow">◀</span>
        </button>
        <div class="sources-list">
          ${sources.map((s) => `<button class="source-chip">${escapeHtml(s.replace('.txt', ''))}</button>`).join('')}
        </div>`;
      msgDiv.appendChild(srcDiv);
    }

    updateLastAssistant(answer, sources);
  } catch (err) {
    msgDiv.innerHTML = `<p>خطأ: ${escapeHtml(err.message)}</p>`;
  }

  state.isProcessing = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

window.askQuick = function (q) {
  inputEl.value = q;
  sendQuestion();
};

/* ─── Settings ─── */
function toggleSettingsMenu(e) {
  if (e) e.stopPropagation();
  settingsMenu.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  if (settingsMenu.classList.contains('open') && !settingsMenu.parentElement.contains(e.target)) {
    settingsMenu.classList.remove('open');
  }
});

function toggleTheme() {
  setTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
}

function setTheme(theme) {
  state.settings.theme = theme;
  applyTheme();
  saveSettings();
  updateThemeUI();
}

function applyTheme() {
  const theme = state.settings.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : state.settings.theme;
  document.documentElement.setAttribute('data-theme', theme);
}

function updateThemeUI() {
  $$('.toggle-group button[data-theme]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === state.settings.theme);
  });
}

function setFontSize(size) {
  state.settings.fontSize = size;
  saveSettings();
  const sizes = { small: '14px', medium: '16px', large: '18px' };
  document.documentElement.style.fontSize = sizes[size] || '16px';
  $$('.toggle-group button[data-size]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.size === size);
  });
}

function clearAllData() {
  showConfirm({
    title: 'حذف المحادثات',
    message: 'هل أنت متأكد من حذف جميع المحادثات؟ لا يمكن التراجع عن هذا الإجراء.',
    confirmText: 'حذف الكل',
    onConfirm: async () => {
      const ids = state.conversations.map((c) => c.id);
      state.conversations = [];
      state.currentId = null;
      localStorage.removeItem(CURRENT_ID_KEY);
      saveConversations();
      await Promise.all(ids.map((id) => deleteFromServer(id)));
      renderConversations();
      renderMessages();
      toast('تم حذف جميع المحادثات', 'success');
      closeSettingsMenu();
    },
  });
}

function closeSettingsMenu() {
  settingsMenu.classList.remove('open');
}

/* ─── Confirm Modal ─── */
const confirmOverlay = $('#confirmOverlay');
const confirmModal = $('#confirmModal');
const confirmTitle = $('#confirmTitle');
const confirmMessage = $('#confirmMessage');
const confirmBtn = $('#confirmBtn');

let confirmCallback = null;

function showConfirm({ title, message, confirmText, onConfirm }) {
  confirmTitle.textContent = title || 'تأكيد';
  confirmMessage.textContent = message || 'هل أنت متأكد؟';
  confirmBtn.textContent = confirmText || 'تأكيد';
  confirmCallback = onConfirm || null;
  confirmOverlay.classList.add('open');
  confirmModal.classList.add('open');
}

function closeConfirm() {
  confirmOverlay.classList.remove('open');
  confirmModal.classList.remove('open');
  confirmCallback = null;
}

confirmBtn.addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeConfirm();
});

/* ─── Toast ─── */
function toast(message, type = '') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = message;
  toastContainer.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(12px)';
    div.style.transition = '0.3s ease-out';
    setTimeout(() => div.remove(), 300);
  }, 3000);
}

/* ─── Sidebar ─── */
function toggleSidebar() {
  sidebarEl.classList.toggle('open');
  sidebarOverlay.classList.toggle('open');
}

function closeSidebar() {
  if (window.innerWidth <= 768) {
    sidebarEl.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  }
}

/* ─── Input ─── */
function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
}

/* ─── Init ─── */
async function init() {
  loadSettings();

  // Try server first, fallback to localStorage
  const loaded = await loadFromServer();
  if (!loaded) loadConversations();

  // Restore currentId
  try {
    const savedId = localStorage.getItem(CURRENT_ID_KEY);
    if (savedId && state.conversations.find((c) => c.id === savedId)) {
      state.currentId = savedId;
    }
  } catch {}
  if (state.conversations.length > 0 && !state.currentId) {
    state.currentId = state.conversations[0].id;
  }

  applyTheme();
  updateThemeUI();
  setFontSize(state.settings.fontSize);

  renderConversations();
  renderMessages();

  // Events
  sendBtn.addEventListener('click', sendQuestion);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });
  inputEl.addEventListener('input', autoResize);

  // System theme change listener
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.theme === 'system') applyTheme();
  });
}

document.addEventListener('DOMContentLoaded', init);
