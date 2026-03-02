// client/websocket.js

export function createSocketClient(url, handlers) {
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    handlers.onOpen?.();
  });

  socket.addEventListener('close', () => {
    handlers.onClose?.();
  });

  socket.addEventListener('error', (event) => {
    handlers.onError?.(event);
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      handlers.onMessage?.(payload);
    } catch {
      handlers.onError?.(new Error('Invalid JSON from server'));
    }
  });

  return {
    send(payload) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    },
    close() {
      socket.close();
    },
    raw: socket
  };
}
