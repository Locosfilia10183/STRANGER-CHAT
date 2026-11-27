# STRANGER

Mobile-first random video chat concept. Dark iPhone-friendly interface.

## Current stage
- Adult-only (18+) name-and-age entry screen; no account or email form.
- Responsive chat-room UI.
- Local camera/microphone preview using browser permission.
- Local message bubble interaction (not yet transmitted).
- Installable web-app manifest.

## Important
This repository currently contains the front-end prototype. Random matchmaking, remote WebRTC video/audio, and real-time messaging are **not connected yet**. Those require a deployed signaling/matchmaking service and a secure HTTPS origin. Do not present the prototype as a working public chat service until those systems and safety controls are implemented and tested.

## Run
Serve this folder from an HTTPS-capable static host. Camera access is generally restricted to secure contexts such as HTTPS or localhost.

## Next implementation steps
1. Add a server-side waiting queue and random adult-only matching.
2. Add WebSocket signaling and WebRTC peer connections.
3. Add room-scoped real-time text messaging.
4. Add report/block, disconnect handling, rate limits, and abuse prevention.
5. Test on iOS Safari and Android browsers.
