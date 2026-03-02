# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an end-to-end encrypted (E2EE) chat application built as a cryptography course project. The system demonstrates Web Crypto API usage with ECDH key exchange, AES-GCM encryption, ECDSA signatures, and replay attack prevention.

**Language**: The project documentation and UI are in Chinese (Simplified). Code comments are in Chinese.

## Commands

### Start the server
```bash
npm start
```
Server runs on `http://localhost:3000` by default.

### Change port (Windows PowerShell)
```powershell
$env:PORT=38123; npm start
```

### Install dependencies
```bash
npm install
```

## Architecture

### Server (server/index.js)
- **Role**: WebSocket relay server that forwards encrypted messages between clients
- **Key principle**: Server is untrusted and never sees plaintext. It only relays ciphertext, IVs, and signatures
- **Room management**: Clients join rooms by room ID. Server maintains `Map<roomId, Set<WebSocket>>`
- **Message types**: `join`, `key_exchange`, `message` (encrypted)
- **Logging**: Server logs encrypted payload metadata (ciphertext length, IV length, signature presence) but never decrypts

### Client Architecture

#### crypto.js - Cryptographic primitives
Core Web Crypto API wrapper implementing:
- **ECDH (P-256)**: `generateKeyPair()`, `deriveSharedSecret()` for key exchange
- **HKDF-SHA256**: `deriveAESKey()` derives AES-256-GCM session key from ECDH shared secret
- **AES-256-GCM**: `encrypt()`, `decrypt()` for authenticated encryption
- **ECDSA (P-256)**: `generateSigningKeyPair()`, `signPayload()`, `verifyPayloadSignature()` for message authentication
- **Fingerprints**: `getFingerprint()` computes SHA-256 hash of public keys for out-of-band verification
- **Canonicalization**: `canonicalize()` ensures consistent JSON serialization for signatures (keys sorted alphabetically)

#### websocket.js - WebSocket client wrapper
Thin abstraction over WebSocket API with JSON message handling and error recovery.

#### app.js - React UI and E2EE protocol
Main application logic implementing the E2EE protocol flow:

1. **Key generation**: On room join, generate ECDH keypair and ECDSA signing keypair
2. **Key exchange**: Broadcast public keys (ECDH + ECDSA) to room peers via `key_exchange` message
3. **Shared secret derivation**: Use peer's ECDH public key + own private key → ECDH shared secret → HKDF → AES-256-GCM key
4. **Message encryption**: Encrypt plaintext with AES-GCM, sign `{room, ciphertext, iv, messageId, timestamp}` with ECDSA private key
5. **Message decryption**: Verify ECDSA signature, check replay protection (messageId + timestamp), decrypt with AES-GCM
6. **Replay protection**: Track seen `messageId`s in `seenMessageIdsRef`. Reject messages with duplicate IDs or timestamps outside ±10 minute window

**State management**:
- `keyPairRef`: ECDH keypair (persistent across messages in same room)
- `signKeyPairRef`: ECDSA signing keypair
- `aesKeyRef`: Derived AES-256-GCM session key
- `peerSignPublicKeyRef`: Peer's ECDSA public key for signature verification
- `seenMessageIdsRef`: Set of seen message IDs for replay protection

#### index.html
Single-page app with inline CSS. Loads `app.js` as ES module. Uses React via CDN (esm.sh).

## Security Features

- **E2EE**: Server never sees plaintext. All encryption/decryption happens client-side
- **Forward secrecy**: Each room join generates new ephemeral ECDH keypairs
- **Authenticated encryption**: AES-GCM provides both confidentiality and integrity
- **Message authentication**: ECDSA signatures prevent message forgery
- **Replay protection**: messageId + timestamp validation prevents replay attacks
- **Public key verification**: Fingerprints allow out-of-band verification to detect MITM attacks

## Development Notes

- **No build step**: Uses native ES modules and CDN imports (React, htm)
- **Browser-only crypto**: All cryptography uses Web Crypto API (no Node.js crypto)
- **Two-party only**: Protocol designed for 1:1 chat (room with 2 clients)
- **No persistence**: Messages and keys are ephemeral (lost on page refresh)
- **Chinese UI**: All user-facing text is in Chinese. Maintain this convention when modifying UI strings

## Testing

Open two browser tabs to `http://localhost:3000`, enter the same room name in both tabs, and send messages. The debug panel shows plaintext/ciphertext/IV/signature status for verification.
