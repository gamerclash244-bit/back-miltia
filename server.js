const express = require('express');
const app = express();
const http = require('http').createServer(app);

// CORS is required so your Vercel frontend is allowed to talk to your Render backend
const io = require('socket.io')(http, {
  cors: { origin: "*" } 
});

const players = {};

io.on('connection', (socket) => {
  console.log('Fighter connected:', socket.id);

  players[socket.id] = { x: 100, y: 100, aimAngle: 0, color: '#e74c3c', name: 'Unknown', health: 100 };

  socket.emit('currentPlayers', players);
  socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

  socket.on('playerMovement', (data) => {
    if(players[socket.id]) {
      players[socket.id] = data;
      socket.broadcast.emit('playerMoved', { id: socket.id, player: players[socket.id] });
    }
  });

  socket.on('shoot', (bulletData) => {
    socket.broadcast.emit('networkBullet', bulletData);
  });

  socket.on('disconnect', () => {
    console.log('Fighter disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Render dynamically assigns a PORT, so we must use process.env.PORT
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
