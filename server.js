const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map<roomId, Map<ws, {id, name}>>
const rooms = new Map();

function genId() {
  return Math.random().toString(36).substr(2, 9);
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(roomId, msg, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.forEach((_, ws) => {
    if (ws !== excludeWs) sendTo(ws, msg);
  });
}

function findWs(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const [ws, info] of room.entries()) {
    if (info.id === peerId) return ws;
  }
  return null;
}

wss.on('connection', (ws) => {
  let clientId = genId();
  let clientName = 'User';
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        currentRoom = (msg.room || 'default').toLowerCase().trim();
        clientName = (msg.name || 'User').trim().substring(0, 20);
        if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Map());
        const room = rooms.get(currentRoom);
        const peers = [];
        room.forEach((info) => peers.push({ id: info.id, name: info.name }));
        sendTo(ws, { type: 'joined', yourId: clientId, peers, room: currentRoom });
        broadcast(currentRoom, { type: 'peer-joined', id: clientId, name: clientName });
        room.set(ws, { id: clientId, name: clientName });
        console.log(`[${currentRoom}] ${clientName} joined. Total: ${room.size}`);
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const target = findWs(currentRoom, msg.to);
        if (target) sendTo(target, { ...msg, from: clientId });
        break;
      }
      case 'talking': {
        broadcast(currentRoom, { type: 'talking', id: clientId, name: clientName, active: msg.active }, ws);
        break;
      }
      case 'chat': {
        const text = (msg.text || '').substring(0, 500);
        broadcast(currentRoom, {
          type: 'chat', id: clientId, name: clientName,
          text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      broadcast(currentRoom, { type: 'peer-left', id: clientId, name: clientName });
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
      console.log(`[${currentRoom}] ${clientName} left.`);
    }
  });

  ws.on('error', console.error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎵 Radio Room running → http://localhost:${PORT}`));
