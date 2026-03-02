const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// roomId -> Set<ws>
const rooms = new Map();

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function logEncryptedPayload(clientId, message) {
  if (message.type !== 'message') {
    return;
  }

  const summary = {
    from: clientId,
    room: message.room,
    type: message.type,
    ciphertextLength: (message.ciphertext || '').length,
    ivLength: (message.iv || '').length,
    hasSignature: Boolean(message.signature)
  };

  console.log('[relay ciphertext]', summary);
}

function joinRoom(ws, roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  if (ws.roomId && rooms.has(ws.roomId)) {
    rooms.get(ws.roomId).delete(ws);
  }

  ws.roomId = roomId;
  rooms.get(roomId).add(ws);
}

function leaveRoom(ws) {
  if (!ws.roomId || !rooms.has(ws.roomId)) {
    return;
  }

  const room = rooms.get(ws.roomId);
  room.delete(ws);

  const roomId = ws.roomId;
  ws.roomId = null;

  if (room.size === 0) {
    rooms.delete(roomId);
  }
}

function broadcast(roomId, payload, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  for (const client of room) {
    if (client !== exceptWs && client.readyState === client.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }
}

wss.on('connection', (ws) => {
  ws.clientId = uuidv4();
  ws.roomId = null;

  ws.send(
    JSON.stringify({
      type: 'system',
      event: 'connected',
      clientId: ws.clientId,
      message: 'Connected to relay server'
    })
  );

  ws.on('message', (rawMessage) => {
    const message = safeJsonParse(rawMessage);
    if (!message || !message.type) {
      ws.send(JSON.stringify({ type: 'system', event: 'error', message: 'Invalid JSON message' }));
      return;
    }

    if (message.type === 'join') {
      const roomId = String(message.room || '').trim();
      if (!roomId) {
        ws.send(JSON.stringify({ type: 'system', event: 'error', message: 'Room ID is required' }));
        return;
      }

      joinRoom(ws, roomId);

      ws.send(JSON.stringify({ type: 'system', event: 'joined', room: roomId, clientId: ws.clientId }));

      broadcast(
        roomId,
        {
          type: 'system',
          event: 'user_joined',
          room: roomId,
          clientId: ws.clientId
        },
        ws
      );

      return;
    }

    if (!ws.roomId) {
      ws.send(JSON.stringify({ type: 'system', event: 'error', message: 'Join a room first' }));
      return;
    }

    if (message.type === 'key_exchange') {
      broadcast(
        ws.roomId,
        {
          type: 'key_exchange',
          room: ws.roomId,
          publicKey: message.publicKey,
          signPublicKey: message.signPublicKey || null,
          signFingerprint: message.signFingerprint || null,
          fingerprint: message.fingerprint || null,
          from: ws.clientId
        },
        ws
      );
      return;
    }

    if (message.type === 'message') {
      logEncryptedPayload(ws.clientId, message);

      const senderTimestamp =
        typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
          ? message.timestamp
          : Date.now();

      broadcast(
        ws.roomId,
        {
          type: 'message',
          room: ws.roomId,
          ciphertext: message.ciphertext,
          iv: message.iv,
          messageId: message.messageId || uuidv4(),
          timestamp: senderTimestamp,
          relayTimestamp: Date.now(),
          signature: message.signature || null,
          from: ws.clientId,
          serverSequence: uuidv4()
        },
        ws
      );
      return;
    }

    ws.send(JSON.stringify({ type: 'system', event: 'error', message: `Unsupported type: ${message.type}` }));
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    leaveRoom(ws);

    if (roomId) {
      broadcast(roomId, {
        type: 'system',
        event: 'user_left',
        room: roomId,
        clientId: ws.clientId
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Crypto chat relay server running on http://localhost:${PORT}`);
});
