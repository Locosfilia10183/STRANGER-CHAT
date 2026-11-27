const $ = (id) => document.getElementById(id);
const welcome = $('welcome');
const chat = $('chat');
const toast = $('toast');
let toastTimer;
let socket = null;
let userName = '';
let userAge = 0;
let localStream = null;
let peer = null;
let matched = false;
let active = false;

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function setStatus(message) { $('connection-label').textContent = message; }
function addMessage(text, mine, name) {
  const empty = document.querySelector('.empty-message');
  if (empty) empty.remove();
  const bubble = document.createElement('div');
  bubble.className = 'message' + (mine ? ' mine' : '');
  if (!mine && name) {
    const sender = document.createElement('strong');
    sender.textContent = name + ': ';
    bubble.appendChild(sender);
  }
  bubble.appendChild(document.createTextNode(text));
  $('messages').appendChild(bubble);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function resetRemote() {
  if (peer) { peer.ontrack = null; peer.onicecandidate = null; peer.close(); peer = null; }
  $('remote-video').srcObject = null;
  $('remote-video').classList.add('hidden');
  $('remote-placeholder').classList.remove('hidden');
  matched = false;
}
function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
async function startMedia() {
  if (localStream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Kamera und Mikrofon benötigen eine sichere HTTPS-Verbindung.');
    return false;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    $('local-video').srcObject = localStream;
    $('local-video').classList.remove('hidden');
    $('camera-placeholder').classList.add('hidden');
    $('camera-button').innerHTML = '<span>◉</span> Kamera ausschalten';
    return true;
  } catch {
    showToast('Kamerazugriff verweigert. Du kannst zunächst den Textchat nutzen.');
    return false;
  }
}
async function createPeer(initiator) {
  resetRemote();
  peer = new RTCPeerConnection(rtcConfig);
  if (localStream) localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  peer.ontrack = event => {
    $('remote-video').srcObject = event.streams[0];
    $('remote-video').classList.remove('hidden');
    $('remote-placeholder').classList.add('hidden');
  };
  peer.onicecandidate = event => {
    if (event.candidate) send({ type: 'signal', data: { candidate: event.candidate } });
  };
  peer.onconnectionstatechange = () => {
    if (!peer) return;
    if (peer.connectionState === 'connected') setStatus('Du sprichst gerade mit ' + 'einer neuen Person.');
    if (['failed', 'disconnected'].includes(peer.connectionState)) setStatus('Verbindung unterbrochen. Du kannst weitersuchen.');
  };
  if (initiator) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: 'signal', data: { description: peer.localDescription } });
  }
}
async function handleSignal(data) {
  if (!peer) return;
  try {
    if (data.description) {
      await peer.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: 'signal', data: { description: peer.localDescription } });
      }
    } else if (data.candidate) {
      await peer.addIceCandidate(data.candidate);
    }
  } catch (error) {
    console.error('WebRTC signaling error', error);
    showToast('Videoverbindung konnte nicht aufgebaut werden. Bitte erneut versuchen.');
  }
}
function connectSocket() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(protocol + '//' + location.host);
    socket.addEventListener('open', () => {
      send({ type: 'join', name: userName, age: userAge, adultConfirmed: true });
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => reject(new Error('Server nicht erreichbar.')));
    socket.addEventListener('message', async event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'ready') return;
      if (msg.type === 'searching') {
        resetRemote();
        setStatus('Wir suchen jemanden für dich …');
        return;
      }
      if (msg.type === 'matched') {
        matched = true;
        setStatus('Person gefunden! Verbindung wird aufgebaut …');
        $('messages').innerHTML = '<div class="empty-message">Sag Hallo 👋<br /><span>Ihr könnt jetzt miteinander schreiben.</span></div>';
        try { await createPeer(msg.initiator); }
        catch (error) { console.error(error); showToast('Videoverbindung konnte nicht gestartet werden.'); }
        return;
      }
      if (msg.type === 'signal') return handleSignal(msg.data);
      if (msg.type === 'chat') { addMessage(msg.text, false, msg.from || 'Gast'); return; }
      if (msg.type === 'partner-left') {
        resetRemote();
        setStatus('Die andere Person hat den Chat verlassen.');
        showToast('Gespräch beendet. Tippe auf „Nächste Person“.');
        return;
      }
      if (msg.type === 'error') showToast(msg.message);
      if (msg.type === 'blocked') showToast('Person blockiert. Wir suchen weiter.');
      if (msg.type === 'reported') showToast('Meldung registriert. Danke für deinen Hinweis.');
    });
    socket.addEventListener('close', () => {
      if (active) showToast('Verbindung zum Server getrennt. Bitte neu starten.');
      resetRemote();
    });
  });
}

$('join-form').addEventListener('submit', async event => {
  event.preventDefault();
  userName = $('nickname').value.trim();
  userAge = Number($('age').value);
  if (!userName || userName.length > 20) return showToast('Bitte gib einen Namen mit maximal 20 Zeichen ein.');
  if (!Number.isInteger(userAge) || userAge < 18 || userAge > 99) return showToast('STRANGER ist ausschließlich für Erwachsene ab 18 Jahren.');
  if (!$('rules').checked) return showToast('Bitte bestätige die Alters- und Verhaltensregeln.');
  welcome.classList.add('hidden');
  chat.classList.remove('hidden');
  $('user-label').textContent = userName.toUpperCase();
  active = true;
  $('messages').innerHTML = '<div class="empty-message">Verbinde mit STRANGER …</div>';
  await startMedia();
  try {
    await connectSocket();
    showToast('Verbunden. Wir suchen eine Person für dich.');
  } catch {
    active = false;
    welcome.classList.remove('hidden');
    chat.classList.add('hidden');
    showToast('Der Chatserver ist noch nicht veröffentlicht oder erreichbar.');
  }
});

$('camera-button').addEventListener('click', async () => {
  if (!localStream) return startMedia();
  const enabled = localStream.getVideoTracks().some(track => track.enabled);
  localStream.getTracks().forEach(track => { track.enabled = !enabled; });
  $('camera-button').innerHTML = enabled ? '<span>◉</span> Kamera einschalten' : '<span>◉</span> Kamera ausschalten';
  $('camera-placeholder').classList.toggle('hidden', enabled);
  $('local-video').classList.toggle('hidden', enabled);
  showToast(enabled ? 'Kamera und Mikrofon pausiert.' : 'Kamera und Mikrofon aktiviert.');
});

$('message-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('message-input');
  const value = input.value.trim();
  if (!value) return;
  if (!matched) return showToast('Warte zuerst auf eine Verbindung.');
  send({ type: 'chat', text: value });
  addMessage(value, true);
  input.value = '';
});
$('next-button').addEventListener('click', () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return showToast('Keine Serververbindung.');
  resetRemote();
  $('messages').innerHTML = '<div class="empty-message">Suche läuft …</div>';
  setStatus('Wir suchen eine neue Person …');
  send({ type: 'next' });
});
$('report-button').addEventListener('click', () => {
  if (!matched) return showToast('Du bist aktuell mit niemandem verbunden.');
  if (confirm('Möchtest du diese Person melden und das Gespräch beenden?')) send({ type: 'report' });
});
$('block-button').addEventListener('click', () => {
  if (!matched) return showToast('Du bist aktuell mit niemandem verbunden.');
  if (confirm('Möchtest du diese Person blockieren und das Gespräch beenden?')) send({ type: 'block' });
});
function leaveChat() {
  active = false;
  send({ type: 'leave' });
  if (socket) { socket.close(); socket = null; }
  resetRemote();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  $('local-video').srcObject = null;
  $('local-video').classList.add('hidden');
  $('camera-placeholder').classList.remove('hidden');
  $('camera-button').innerHTML = '<span>◉</span> Kamera starten';
  chat.classList.add('hidden');
  welcome.classList.remove('hidden');
  $('messages').innerHTML = '<div class="empty-message">Sag Hallo 👋<br /><span>Deine Nachrichten erscheinen hier.</span></div>';
}
$('leave-button').addEventListener('click', leaveChat);
