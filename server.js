const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map<roomId, { peers: Map, musicUrl: string }>
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
  room.peers.forEach((_, ws) => {
    if (ws !== excludeWs) sendTo(ws, msg);
  });
}

function findWs(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const [ws, info] of room.peers.entries()) {
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
        if (!rooms.has(currentRoom)) rooms.set(currentRoom, { peers: new Map(), musicUrl: '', queue: [] });
        const room = rooms.get(currentRoom);
        const peers = [];
        room.peers.forEach((info) => peers.push({ id: info.id, name: info.name }));
        sendTo(ws, { type: 'joined', yourId: clientId, peers, room: currentRoom, musicUrl: room.musicUrl, queue: room.queue });
        broadcast(currentRoom, { type: 'peer-joined', id: clientId, name: clientName });
        room.peers.set(ws, { id: clientId, name: clientName });
        console.log(`[${currentRoom}] ${clientName} joined. Total: ${room.peers.size}`);
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'sync-response': {
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
      case 'music': {
        const room = rooms.get(currentRoom);
        if (room) {
          room.musicUrl = msg.url;
          broadcast(currentRoom, { type: 'music', url: msg.url }, ws);
        }
        break;
      }
      case 'request-sync': {
        broadcast(currentRoom, { type: 'request-sync', from: clientId }, ws);
        break;
      }
      case 'add-queue': {
        const room = rooms.get(currentRoom);
        if (room) {
          room.queue.push(msg.url);
          broadcast(currentRoom, { type: 'queue-update', queue: room.queue });
        }
        break;
      }
      case 'pop-queue': {
        const room = rooms.get(currentRoom);
        if (room && room.queue.length > 0) {
          // Debounce pop so multiple users ending video at same time don't pop multiple songs
          if (Date.now() - (room.lastPop || 0) < 3000) return;
          room.lastPop = Date.now();
          
          const nextUrl = room.queue.shift();
          room.musicUrl = nextUrl;
          broadcast(currentRoom, { type: 'music', url: nextUrl });
          broadcast(currentRoom, { type: 'queue-update', queue: room.queue });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.peers.delete(ws);
      broadcast(currentRoom, { type: 'peer-left', id: clientId, name: clientName });
      if (room.peers.size === 0) rooms.delete(currentRoom);
      console.log(`[${currentRoom}] ${clientName} left.`);
    }
  });

  ws.on('error', console.error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎵 Radio Room running → http://localhost:${PORT}`));
