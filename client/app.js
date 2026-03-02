import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@18.2.0';
import { createRoot } from 'https://esm.sh/react-dom@18.2.0/client';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  decrypt,
  deriveAESKey,
  deriveSharedSecret,
  encrypt,
  exportPublicKey,
  exportSigningPublicKey,
  generateKeyPair,
  generateSigningKeyPair,
  getFingerprint,
  importPeerPublicKey,
  importPeerSigningPublicKey,
  signPayload,
  verifyPayloadSignature
} from './crypto.js';
import { createSocketClient } from './websocket.js';

const html = htm.bind(React.createElement);

function App() {
  const [serverStatus, setServerStatus] = useState('未连接');
  const [roomInput, setRoomInput] = useState('demo-room');
  const [joinedRoom, setJoinedRoom] = useState('');
  const [clientId, setClientId] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [cryptoStatus, setCryptoStatus] = useState('🔓 未建立加密通道');
  const [myFingerprint, setMyFingerprint] = useState('');
  const [peerFingerprint, setPeerFingerprint] = useState('');
  const [mySignFingerprint, setMySignFingerprint] = useState('');
  const [peerSignFingerprint, setPeerSignFingerprint] = useState('');
  const [debugPanel, setDebugPanel] = useState({
    plain: '-',
    cipher: '-',
    iv: '-',
    messageId: '-',
    signature: '-',
    signatureVerified: '-'
  });

  const socketRef = useRef(null);
  const keyPairRef = useRef(null);
  const signKeyPairRef = useRef(null);
  const peerSignPublicKeyRef = useRef(null);
  const seenMessageIdsRef = useRef(new Set());
  const aesKeyRef = useRef(null);

  const wsUrl = useMemo(() => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${location.host}`;
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  function addSystemMessage(text) {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'system', text }]);
  }

  async function prepareKeyPair() {
    if (!keyPairRef.current) {
      keyPairRef.current = await generateKeyPair();
      const fp = await getFingerprint(keyPairRef.current.publicKey);
      setMyFingerprint(fp);
    }

    if (!signKeyPairRef.current) {
      signKeyPairRef.current = await generateSigningKeyPair();
      const signFp = await getFingerprint(signKeyPairRef.current.publicKey);
      setMySignFingerprint(signFp);
    }
  }

  async function handleJoin() {
    const room = roomInput.trim();
    if (!room) {
      return;
    }

    await prepareKeyPair();
    aesKeyRef.current = null;
    peerSignPublicKeyRef.current = null;
    seenMessageIdsRef.current.clear();
    setPeerFingerprint('');
    setPeerSignFingerprint('');
    setCryptoStatus('🔓 未建立加密通道');
    setMessages([]);

    socketRef.current?.close();

    socketRef.current = createSocketClient(wsUrl, {
      onOpen: () => {
        setServerStatus('已连接');
        socketRef.current.send({ type: 'join', room });
      },
      onClose: () => {
        setServerStatus('已断开');
      },
      onError: () => {
        addSystemMessage('连接或消息处理出现错误');
      },
      onMessage: async (payload) => {
        if (payload.type === 'system') {
          if (payload.event === 'connected') {
            setClientId(payload.clientId || '');
            return;
          }

          if (payload.event === 'joined') {
            setJoinedRoom(payload.room);
            addSystemMessage(`已加入房间 ${payload.room}`);

            const publicKey = await exportPublicKey(keyPairRef.current.publicKey);
            const signPublicKey = await exportSigningPublicKey(signKeyPairRef.current.publicKey);
            const fingerprint = await getFingerprint(keyPairRef.current.publicKey);
            const signFingerprint = await getFingerprint(signKeyPairRef.current.publicKey);

            socketRef.current.send({
              type: 'key_exchange',
              room: payload.room,
              publicKey,
              fingerprint,
              signPublicKey,
              signFingerprint
            });
            return;
          }

          if (payload.event === 'user_joined') {
            addSystemMessage(`用户 ${payload.clientId} 加入了房间`);
            // 先进入房间的一方在对方加入后重发公钥，避免对方错过首次 key_exchange。
            const publicKey = await exportPublicKey(keyPairRef.current.publicKey);
            const signPublicKey = await exportSigningPublicKey(signKeyPairRef.current.publicKey);
            const fingerprint = await getFingerprint(keyPairRef.current.publicKey);
            const signFingerprint = await getFingerprint(signKeyPairRef.current.publicKey);
            socketRef.current.send({
              type: 'key_exchange',
              room: joinedRoom || room,
              publicKey,
              fingerprint,
              signPublicKey,
              signFingerprint
            });
            return;
          }

          if (payload.event === 'user_left') {
            addSystemMessage(`用户 ${payload.clientId} 离开了房间`);
            return;
          }

          if (payload.event === 'error') {
            addSystemMessage(`服务器错误: ${payload.message}`);
          }

          return;
        }

        if (payload.type === 'key_exchange') {
          const peerPublicKey = await importPeerPublicKey(payload.publicKey);
          const sharedSecret = await deriveSharedSecret(keyPairRef.current.privateKey, peerPublicKey);
          aesKeyRef.current = await deriveAESKey(sharedSecret);

          setPeerFingerprint(payload.fingerprint || '(未提供)');
          if (payload.signPublicKey) {
            peerSignPublicKeyRef.current = await importPeerSigningPublicKey(payload.signPublicKey);
          } else {
            peerSignPublicKeyRef.current = null;
          }
          setPeerSignFingerprint(payload.signFingerprint || '(未提供)');
          setCryptoStatus('🔒 已建立加密通道');
          addSystemMessage(`收到用户 ${payload.from} 公钥，已完成 ECDH + HKDF（含签名公钥交换）`);
          return;
        }

        if (payload.type === 'message') {
          if (!aesKeyRef.current) {
            addSystemMessage('收到密文但尚未建立共享密钥');
            return;
          }

          if (!payload.messageId || seenMessageIdsRef.current.has(payload.messageId)) {
            addSystemMessage('检测到重复消息，已拦截（防重放）');
            return;
          }

          if (typeof payload.timestamp === 'number') {
            const now = Date.now();
            if (payload.timestamp < now - 10 * 60 * 1000 || payload.timestamp > now + 2 * 60 * 1000) {
              addSystemMessage('消息时间戳异常，已拦截（防重放）');
              return;
            }
          }

          const signedPayload = {
            room: payload.room,
            ciphertext: payload.ciphertext,
            iv: payload.iv,
            messageId: payload.messageId,
            timestamp: payload.timestamp
          };

          if (peerSignPublicKeyRef.current) {
            if (!payload.signature) {
              addSystemMessage('对方消息缺少签名，已拒收');
              return;
            }
            try {
              const verified = await verifyPayloadSignature(
                signedPayload,
                payload.signature,
                peerSignPublicKeyRef.current
              );

              if (!verified) {
                addSystemMessage('消息签名校验失败，已拒收');
                return;
              }
            } catch {
              addSystemMessage('消息签名格式异常，已拒收');
              return;
            }
          }

          seenMessageIdsRef.current.add(payload.messageId);

          try {
            const plain = await decrypt(payload.ciphertext, payload.iv, aesKeyRef.current);

            setDebugPanel({
              plain,
              cipher: payload.ciphertext,
              iv: payload.iv,
              messageId: payload.messageId || '-',
              signature: payload.signature ? '有' : '无',
              signatureVerified: peerSignPublicKeyRef.current ? '通过' : '未启用'
            });

            setMessages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: 'peer', text: plain, ts: payload.timestamp }
            ]);
          } catch {
            addSystemMessage('密文解密失败（可能被篡改或密钥不一致）');
          }
        }
      }
    });
  }

  async function handleSend() {
    const text = messageInput.trim();
    if (!text || !joinedRoom || !aesKeyRef.current) {
      return;
    }

    const encrypted = await encrypt(text, aesKeyRef.current);
    const timestamp = Date.now();
    const messageId = crypto.randomUUID();
    const signedPayload = {
      room: joinedRoom,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      messageId,
      timestamp
    };
    const signature = await signPayload(signedPayload, signKeyPairRef.current.privateKey);

    socketRef.current.send({
      type: 'message',
      room: joinedRoom,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      messageId,
      timestamp,
      signature
    });

    setDebugPanel({
      plain: text,
      cipher: encrypted.ciphertext,
      iv: encrypted.iv,
      messageId,
      signature: '有',
      signatureVerified: '本端发送'
    });

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'self', text }]);
    setMessageInput('');
  }

  return html`
    <div className="app">
      <h1>端到端加密聊天系统（E2EE）</h1>
      <div className="status-row">
        <span>服务器: ${serverStatus}</span>
        <span>房间: ${joinedRoom || '未加入'}</span>
        <span>${cryptoStatus}</span>
      </div>

      <div className="join-row">
        <input
          value=${roomInput}
          onInput=${(e) => setRoomInput(e.target.value)}
          placeholder="输入房间号"
        />
        <button onClick=${handleJoin}>创建/加入房间</button>
      </div>

      <div className="fingerprint-box">
        <div><strong>我的 ID:</strong> ${clientId || '-'}</div>
        <div><strong>我的 ECDH 公钥指纹:</strong> ${myFingerprint || '-'}</div>
        <div><strong>对方 ECDH 公钥指纹:</strong> ${peerFingerprint || '-'}</div>
        <div><strong>我的签名公钥指纹:</strong> ${mySignFingerprint || '-'}</div>
        <div><strong>对方签名公钥指纹:</strong> ${peerSignFingerprint || '-'}</div>
      </div>

      <div className="chat-box">
        ${messages.map(
          (msg) => html`<div key=${msg.id} className=${`msg ${msg.role}`}>${msg.text}</div>`
        )}
      </div>

      <div className="send-row">
        <input
          value=${messageInput}
          onInput=${(e) => setMessageInput(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && handleSend()}
          placeholder="输入消息（将使用 AES-GCM 加密）"
        />
        <button onClick=${handleSend} disabled=${!joinedRoom}>发送</button>
      </div>

      <div className="debug-box">
        <h3>密码学可视化面板</h3>
        <div><strong>明文:</strong> ${debugPanel.plain}</div>
        <div><strong>密文(Base64):</strong> ${debugPanel.cipher}</div>
        <div><strong>IV(Base64):</strong> ${debugPanel.iv}</div>
        <div><strong>消息 ID:</strong> ${debugPanel.messageId}</div>
        <div><strong>签名:</strong> ${debugPanel.signature}</div>
        <div><strong>验签结果:</strong> ${debugPanel.signatureVerified}</div>
      </div>
    </div>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
