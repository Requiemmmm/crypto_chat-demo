# Crypto Chat - End-to-End Encrypted Chat Application

A secure, browser-based end-to-end encrypted (E2EE) chat application built with Web Crypto API. This project demonstrates modern cryptographic protocols including ECDH key exchange, AES-GCM encryption, ECDSA signatures, and replay attack prevention.

## Features

### Core Cryptography
- **ECDH (P-256) Key Exchange**: Ephemeral key pairs generated per session for forward secrecy
- **HKDF-SHA256 Key Derivation**: Derives AES-256-GCM session keys from ECDH shared secrets
- **AES-256-GCM Encryption**: Authenticated encryption providing both confidentiality and integrity
- **ECDSA (P-256) Signatures**: Message authentication to prevent forgery and tampering

### Security Features
- **Zero-Knowledge Server**: Server only relays encrypted payloads and never sees plaintext
- **Replay Attack Prevention**: Message ID and timestamp validation with ±10 minute window
- **Public Key Fingerprints**: SHA-256 fingerprints for out-of-band verification to detect MITM attacks
- **Forward Secrecy**: New ephemeral keys generated for each room session

### User Interface
- Real-time encrypted messaging via WebSocket
- Debug panel showing plaintext/ciphertext/IV/signature status
- Public key fingerprint display for manual verification
- Clean, responsive interface (Chinese UI)

## Quick Start

### Installation
```bash
npm install
```

### Run Server
```bash
npm start
```

Server runs on `http://localhost:3000` by default.

### Change Port (Windows PowerShell)
```powershell
$env:PORT=38123; npm start
```

### Testing
1. Open two browser tabs to `http://localhost:3000`
2. Enter the same room name in both tabs
3. Send messages and observe encryption/decryption in the debug panel

## Architecture

### Server (`server/index.js`)
- **Role**: Untrusted WebSocket relay server
- **Functionality**: Forwards encrypted messages between clients without decryption
- **Room Management**: Maintains `Map<roomId, Set<WebSocket>>` for message routing
- **Message Types**: `join`, `key_exchange`, `message` (encrypted)

### Client Components

#### `client/crypto.js` - Cryptographic Primitives
Web Crypto API wrapper implementing:
- ECDH key pair generation and shared secret derivation
- HKDF-based AES key derivation
- AES-256-GCM encryption/decryption
- ECDSA signing and verification
- SHA-256 fingerprint generation
- JSON canonicalization for consistent signatures

#### `client/websocket.js` - WebSocket Client
Thin abstraction over WebSocket API with JSON message handling and automatic reconnection.

#### `client/app.js` - React UI & E2EE Protocol
Main application implementing the complete E2EE protocol flow:
1. Generate ECDH and ECDSA key pairs on room join
2. Exchange public keys with peers
3. Derive shared AES-256-GCM session key
4. Encrypt messages with AES-GCM and sign with ECDSA
5. Verify signatures and decrypt received messages
6. Validate message IDs and timestamps for replay protection

#### `client/index.html`
Single-page application with inline CSS. Uses React via CDN (esm.sh).

## Protocol Flow

```
Client A                          Server                          Client B
   |                                |                                |
   |--- join room ----------------->|<--------------- join room -----|
   |                                |                                |
   |--- key_exchange (pubkeys) ---->|---> key_exchange (pubkeys) --->|
   |<--- key_exchange (pubkeys) ----|<--- key_exchange (pubkeys) ----|
   |                                |                                |
   [derive shared AES key]          |          [derive shared AES key]
   |                                |                                |
   |--- message (encrypted) ------->|---> message (encrypted) ------>|
   |    {ciphertext, iv, sig}       |    {ciphertext, iv, sig}       |
```

## Security Considerations

### Threat Model
- **Trusted**: Client-side code execution environment
- **Untrusted**: Network, server, and all intermediaries
- **Protected Against**: Eavesdropping, message tampering, replay attacks, server compromise
- **Not Protected Against**: Client-side malware, physical device compromise, MITM during key exchange (mitigated by fingerprint verification)

### Limitations
- **Two-party only**: Protocol designed for 1:1 chat (room with 2 clients)
- **No persistence**: Messages and keys are ephemeral (lost on page refresh)
- **No identity verification**: Relies on out-of-band fingerprint comparison
- **Browser-only**: Uses Web Crypto API (not compatible with Node.js crypto)

## Technology Stack

- **Backend**: Node.js, WebSocket (`ws` library)
- **Frontend**: React (via CDN), HTM (JSX alternative), Web Crypto API
- **Build**: No build step - native ES modules
- **Deployment**: Single server process, static file serving

## Project Structure

```
crypto-chat/
├── server/
│   └── index.js          # WebSocket relay server
├── client/
│   ├── index.html        # Single-page app entry
│   ├── app.js            # React UI & E2EE protocol
│   ├── crypto.js         # Web Crypto API wrapper
│   └── websocket.js      # WebSocket client wrapper
├── package.json          # Dependencies
├── CLAUDE.md             # Development guide for Claude Code
└── README.md             # This file
```

## Development

This project uses native ES modules and CDN imports (React, HTM) with no build step required. All cryptography is implemented using the Web Crypto API.

### Key Design Decisions
- **No build tooling**: Simplifies development and deployment
- **Browser-native crypto**: Leverages audited Web Crypto API implementations
- **Stateless server**: Server never stores keys or messages
- **Ephemeral keys**: Forward secrecy through per-session key generation

## License

Educational project for cryptography coursework.

## Acknowledgments

Built as a demonstration of modern web cryptography best practices using standard browser APIs.
