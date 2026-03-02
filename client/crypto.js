// client/crypto.js
// 浏览器原生 Web Crypto API 工具集（E2EE 聊天核心）

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  const keys = Object.keys(value).sort();
  const result = {};
  for (const key of keys) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

/**
 * 1) generateKeyPair()
 * 生成 ECDH P-256 密钥对。
 * 原理：ECDH 双方各自生成私钥和对应公钥，公钥可公开传输，私钥只保留在本地。
 */
export async function generateKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  );
}

/**
 * 2) deriveSharedSecret(myPrivateKey, peerPublicKey)
 * 根据“我的私钥 + 对方公钥”计算共享秘密。
 * 原理：ECDH 的数学性质保证双方最终得到相同共享秘密，而窃听者无法从公钥反推私钥。
 */
export async function deriveSharedSecret(myPrivateKey, peerPublicKey) {
  return crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey
    },
    myPrivateKey,
    256
  );
}

/**
 * 3) deriveAESKey(sharedSecret)
 * 通过 HKDF-SHA256 从共享秘密派生 AES-256-GCM 密钥。
 * 原理：HKDF 可以将原始密钥材料（IKM）扩展为结构化且用途隔离的会话密钥。
 */
export async function deriveAESKey(sharedSecret) {
  const hkdfBaseKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);

  const salt = encoder.encode('crypto-chat-demo-salt-v1');
  const info = encoder.encode('crypto-chat-aes-key');

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info
    },
    hkdfBaseKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 4) encrypt(plaintext, aesKey)
 * 使用 AES-256-GCM 加密消息。
 * 原理：GCM 是认证加密模式，既保证机密性，也提供完整性校验。
 */
export async function encrypt(plaintext, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    aesKey,
    plaintextBytes
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer)
  };
}

/**
 * 5) decrypt(ciphertext, iv, aesKey)
 * 对 AES-GCM 密文进行解密。
 * 原理：若密文/IV 被篡改，GCM 认证标签校验失败，解密会抛错。
 */
export async function decrypt(ciphertext, iv, aesKey) {
  const ciphertextBuffer = base64ToArrayBuffer(ciphertext);
  const ivBuffer = base64ToArrayBuffer(iv);

  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(ivBuffer)
    },
    aesKey,
    ciphertextBuffer
  );

  return decoder.decode(plaintextBuffer);
}

/**
 * 6) getFingerprint(publicKey)
 * 计算公钥指纹（SHA-256）。
 * 原理：对导出的公钥做哈希，得到可人工比对的短标识，用于带外验证防中间人攻击。
 */
export async function getFingerprint(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{1,4}/g).join(':');
}

export async function exportPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return arrayBufferToBase64(raw);
}

export async function importPeerPublicKey(base64) {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

/**
 * 7) generateSigningKeyPair()
 * 生成 ECDSA P-256 签名密钥对。
 * 原理：私钥用于签名，公钥用于验证消息来源与完整性。
 */
export async function generateSigningKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true,
    ['sign', 'verify']
  );
}

export async function exportSigningPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return arrayBufferToBase64(raw);
}

export async function importPeerSigningPublicKey(base64) {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true,
    ['verify']
  );
}

/**
 * 8) signPayload(payload, privateKey)
 * 对消息元数据做 ECDSA-SHA256 签名（签名对象按 key 排序，保证两端一致）。
 */
export async function signPayload(payload, privateKey) {
  const normalized = canonicalize(payload);
  const data = encoder.encode(JSON.stringify(normalized));
  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256'
    },
    privateKey,
    data
  );
  return arrayBufferToBase64(signature);
}

/**
 * 9) verifyPayloadSignature(payload, signatureBase64, publicKey)
 * 使用发送方签名公钥验签，防止传输途中篡改与伪造。
 */
export async function verifyPayloadSignature(payload, signatureBase64, publicKey) {
  const normalized = canonicalize(payload);
  const data = encoder.encode(JSON.stringify(normalized));
  const signature = base64ToArrayBuffer(signatureBase64);
  return crypto.subtle.verify(
    {
      name: 'ECDSA',
      hash: 'SHA-256'
    },
    publicKey,
    signature,
    data
  );
}
