# crypto-chat

端到端加密聊天课程项目（E2EE Chat）。

## 启动
```bash
npm install
npm start
```

打开 `http://localhost:3000`，用两个浏览器标签页进入同一房间。

如果端口占用：
```powershell
$env:PORT=38123; npm start
```

## 已实现功能
- ECDH（P-256）密钥交换 + HKDF-SHA256 派生 AES-256-GCM 会话密钥
- AES-GCM 端到端加密（服务端仅转发密文）
- ECDSA（P-256）消息签名与验签
- 基于 `messageId + timestamp` 的防重放检查
- 公钥指纹展示（支持带外比对）
- 明文/密文/IV/签名状态可视化面板

## 目录
- `server/index.js` WebSocket 转发服务器
- `client/crypto.js` Web Crypto 密码学模块
- `client/websocket.js` WebSocket 客户端封装
- `client/app.js` 前端页面逻辑
- `docs/report.md` 课程报告（答辩版）
