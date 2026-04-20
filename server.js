const express = require('express');
const app = express();
const http = require('http').createServer(app);
const mongoose = require('mongoose');
const io = require('socket.io')(http, { cors: { origin: "*" } });

// CONNECT TO DATABASE
const mongoURI = process.env.MONGO_URI; 
if (mongoURI) {
  mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB Connected successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));
}

// SCOREBOARD & AUTHENTICATION RULES
const PlayerSchema = new mongoose.Schema({
  name: { type: String, unique: true }, 
  pin: { type: String }, // NEW: Secret PIN to lock the name
  totalKills: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 } 
});
const PlayerDB = mongoose.model('Player', PlayerSchema);

const players = {};

io.on('connection', async (socket) => {
  console.log('Connection attempt:', socket.id);
  
  // Send the leaderboard as soon as they connect
  try {
    const topPlayers = await PlayerDB.find().sort({ bestStreak: -1 }).limit(10);
    socket.emit('leaderboardUpdate', topPlayers);
  } catch (err) {}

  // NEW: LOGIN AND REGISTER SYSTEM
  socket.on('login', async (data, callback) => {
    if (!data.name || !data.pin) return callback({ success: false, message: "Name and PIN required." });
    
    try {
      let p = await PlayerDB.findOne({ name: data.name });
      if (p) {
        // Name exists, check PIN
        if (p.pin === data.pin) {
          callback({ success: true, currentPlayers: players });
        } else {
          callback({ success: false, message: "Name taken. Incorrect PIN." });
        }
      } else {
        // Name is new, register it
        p = new PlayerDB({ name: data.name, pin: data.pin });
        await p.save();
        callback({ success: true, currentPlayers: players });
      }
    } catch (err) {
      callback({ success: false, message: "Database Error." });
    }
  });

  socket.on('playerMovement', (data) => {
    if (!players[socket.id]) {
      // First time moving, tell everyone they joined
      players[socket.id] = data;
      socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });
    } else {
      // Just moving
      players[socket.id] = data;
      socket.broadcast.emit('playerMoved', { id: socket.id, player: players[socket.id] });
    }
  });

  socket.on('shoot', (bulletData) => {
    socket.broadcast.emit('networkBullet', bulletData);
  });

  socket.on('updateScore', async (data) => {
    if (!data.name || !data.kills) return; 
    try {
      let p = await PlayerDB.findOne({ name: data.name });
      if (p) {
        p.totalKills += data.kills;
        if (data.kills > p.bestStreak) p.bestStreak = data.kills; 
        await p.save();
        const topPlayers = await PlayerDB.find().sort({ bestStreak: -1 }).limit(10);
        io.emit('leaderboardUpdate', topPlayers);
      }
    } catch (err) {}
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
