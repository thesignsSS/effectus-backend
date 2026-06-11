const qrCode = document.querySelector('#qr-code');
const emptyState = document.querySelector('#empty-state');
const successState = document.querySelector('#success-state');
const statusDot = document.querySelector('#status-dot');
const statusText = document.querySelector('#status-text');
const tabs = document.querySelectorAll('[data-tab-target]');
const connectionTab = document.querySelector('#connection-tab');
const documentsTab = document.querySelector('#documents-tab');
const documentsList = document.querySelector('#documents-list');
const documentsCount = document.querySelector('#documents-count');

const documents = new Map();
let currentConnectionStatus = 'disconnected';

function setStatus(text, mode = 'waiting') {
  statusText.textContent = text;
  statusDot.dataset.mode = mode;
}

function renderConnection(status) {
  currentConnectionStatus = status;

  if (status === 'connected') {
    qrCode.hidden = true;
    successState.hidden = false;
    emptyState.hidden = true;
    setStatus('Dispositivo conectado e pronto para enviar avisos ao grupo', 'ready');
    return;
  }

  successState.hidden = true;

  if (status === 'disconnected') {
    setStatus('WhatsApp desconectado', 'error');
    return;
  }

  setStatus('Aguardando leitura do QR Code');
}

function renderQr(payload) {
  if (currentConnectionStatus === 'connected') {
    return;
  }

  if (!payload?.dataUrl) {
    qrCode.hidden = true;
    successState.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = 'Aguardando QR Code';
    return;
  }

  successState.hidden = true;
  qrCode.src = payload.dataUrl;
  qrCode.hidden = false;
  emptyState.hidden = true;
  setStatus(`QR Code atualizado em ${new Date(payload.updatedAt).toLocaleTimeString()}`);
}

function upsertDocument(document) {
  documents.set(document.id, document);
  renderDocuments();
}

function renderDocuments() {
  const values = [...documents.values()];
  documentsCount.textContent = String(values.length);

  if (values.length === 0) {
    documentsList.innerHTML =
      '<div class="empty-documents">Nenhum documento recebido nesta sessão</div>';
    return;
  }

  documentsList.innerHTML = values.map(renderDocumentItem).join('');
}

function renderDocumentItem(document) {
  const receivedAt = new Date(document.receivedAt).toLocaleString();
  const sender = normalizeSender(document.sender);

  return `
    <article class="document-item">
      <div class="document-icon">${document.extension.toUpperCase()}</div>
      <div class="document-body">
        <h3>${escapeHtml(document.originalName)}</h3>
        <p>${escapeHtml(sender)}</p>
        <p>${receivedAt}</p>
      </div>
      <div class="document-location" title="${escapeHtml(document.location)}">
        Salvo
      </div>
    </article>
  `;
}

function normalizeSender(sender) {
  return sender.replace('@s.whatsapp.net', '').replace('@lid', '');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setupTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tabTarget;
      tabs.forEach((item) => item.classList.toggle('is-active', item === tab));
      connectionTab.classList.toggle('is-active', target === 'connection');
      documentsTab.classList.toggle('is-active', target === 'documents');

      if (target === 'documents') {
        void loadDocumentsFromApi();
      }
    });
  });
}

async function loadDocumentsFromApi() {
  const response = await fetch('/documents');
  const data = await response.json();
  data.documents.forEach(upsertDocument);
}

async function loadCurrentState() {
  const response = await fetch('/state');
  const data = await response.json();
  renderConnection(data.connectionStatus);
  renderQr(data.qrCode);
  data.documents.forEach(upsertDocument);
}

setupTabs();
loadCurrentState().catch(() => {
  setStatus('Não foi possível carregar o QR Code', 'error');
});

const events = new EventSource('/events');

events.addEventListener('qr', (event) => {
  renderQr(JSON.parse(event.data));
});

events.addEventListener('connection', (event) => {
  renderConnection(JSON.parse(event.data).status);
});

events.addEventListener('document', (event) => {
  upsertDocument(JSON.parse(event.data));
});

events.addEventListener('error', () => {
  setStatus('Conexão com o backend perdida', 'error');
});
