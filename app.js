const $ = (id) => document.getElementById(id);
const welcome = $('welcome');
const chat = $('chat');
const toast = $('toast');
let userName = '';
let localStream = null;
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('nickname').value.trim();
  const age = Number($('age').value);
  if (!name || name.length > 20) return showToast('Bitte gib einen Namen mit maximal 20 Zeichen ein.');
  if (!Number.isInteger(age) || age < 18 || age > 99) return showToast('STRANGER ist nur für Erwachsene ab 18 Jahren.');
  if (!$('rules').checked) return showToast('Bitte bestätige die Alters- und Verhaltensregeln.');
  userName = name;
  $('user-label').textContent = name.toUpperCase();
  welcome.classList.add('hidden');
  chat.classList.remove('hidden');
  showToast('Willkommen, ' + name + '! Die Kamera kannst du jetzt freigeben.');
});

$('camera-button').addEventListener('click', async () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    $('local-video').srcObject = null;
    $('local-video').classList.add('hidden');
    $('camera-placeholder').classList.remove('hidden');
    $('camera-button').innerHTML = '<span>◉</span> Kamera starten';
    return showToast('Kamera ausgeschaltet.');
  }
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Kamera benötigt eine sichere HTTPS-Verbindung.');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    $('local-video').srcObject = localStream;
    $('local-video').classList.remove('hidden');
    $('camera-placeholder').classList.add('hidden');
    $('camera-button').innerHTML = '<span>◉</span> Kamera ausschalten';
  } catch (error) {
    showToast('Kein Kamerazugriff. Bitte erlaube Kamera und Mikrofon in den iPhone-Einstellungen.');
  }
});

$('message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('message-input');
  const value = input.value.trim();
  if (!value) return;
  const empty = document.querySelector('.empty-message');
  if (empty) empty.remove();
  const bubble = document.createElement('div');
  bubble.className = 'message mine';
  bubble.textContent = value;
  $('messages').appendChild(bubble);
  $('messages').scrollTop = $('messages').scrollHeight;
  input.value = '';
  showToast('Nachricht lokal angezeigt – der Live-Chat wird im nächsten Schritt verbunden.');
});

$('next-button').addEventListener('click', () => {
  $('connection-label').textContent = 'Noch keine Live-Partnervermittlung eingerichtet.';
  $('messages').innerHTML = '<div class="empty-message">Neues Gespräch vorbereiten ✨<br /><span>Die Zufallsvermittlung folgt im nächsten Entwicklungsschritt.</span></div>';
  showToast('Die Live-Vermittlung wird als Nächstes eingerichtet.');
});

function leaveChat() {
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  $('local-video').srcObject = null;
  chat.classList.add('hidden');
  welcome.classList.remove('hidden');
  $('messages').innerHTML = '<div class="empty-message">Sag Hallo 👋<br /><span>Deine Nachrichten erscheinen hier.</span></div>';
}
$('leave-button').addEventListener('click', leaveChat);
