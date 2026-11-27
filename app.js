const $ = (id) => document.getElementById(id);
const welcome = $('welcome');
const chat = $('chat');
const toast = $('toast');
const SUPABASE_URL = 'https://sbykgoqlbgtybhkmyzyy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VUjsLDuz8UQLSdLaxYtgVQ__HgAU-uj';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let authUser = null;
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

const PROFILE_KEY = 'stranger.profile.v1';
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: userName, age: userAge, userId: authUser?.id })); }
  catch (error) { console.warn('Profil konnte nicht gespeichert werden.', error); }
}
function loadProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (!profile || profile.userId !== authUser?.id || typeof profile.name !== 'string' || !Number.isInteger(profile.age) || profile.age < 18 || profile.age > 99) return null;
    const name = profile.name.trim().slice(0, 20);
    return name ? { name, age: profile.age } : null;
  } catch { return null; }
}
async function applyAuthSession(session) {
  authUser = session?.user || null;
  if (!authUser) {
    welcome.classList.remove('hidden');
    $('auth-panel').classList.remove('hidden');
    $('join-form').classList.add('hidden');
    chat.classList.add('hidden');
    return;
  }
  $('auth-panel').classList.add('hidden');
  $('join-form').classList.remove('hidden');
  const googleName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || '';
  if (!$('nickname').value) $('nickname').value = googleName.slice(0, 20);
  const profile = loadProfile();
  if (profile && profile.userId === authUser.id) {
    userName = profile.name; userAge = profile.age;
    $('nickname').value = userName; $('age').value = String(userAge); $('rules').checked = true;
    $('user-label').textContent = userName.toUpperCase();
    welcome.classList.add('hidden'); chat.classList.remove('hidden');
    $('messages').innerHTML = '<div class="empty-message">Sitzung wird wiederhergestellt …</div>';
    active = true;
    try { await connectSocket(); showToast('Willkommen zurück, ' + userName + '!'); }
    catch { active = false; showToast('Angemeldet, aber Chatserver nicht erreichbar.'); }
  }
}
supabaseClient.auth.getSession().then(({data}) => applyAuthSession(data.session));
supabaseClient.auth.onAuthStateChange((_event, session) => { applyAuthSession(session); });
$('google-login').addEventListener('click', async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin }
  });
  if (error) showToast('Google-Anmeldung fehlgeschlagen: ' + error.message);
});
$('signout-button').addEventListener('click', async () => {
  active = false;
  if (socket) { socket.close(); socket = null; }
  resetRemote();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  try { localStorage.removeItem(PROFILE_KEY); } catch {}
  await supabaseClient.auth.signOut();
  welcome.classList.remove('hidden'); chat.classList.add('hidden');
  $('auth-panel').classList.remove('hidden'); $('join-form').classList.add('hidden');
  showToast('Du wurdest abgemeldet.');
});
