const express = require('express');
const app = express();
const http = require('http').createServer(app);
const mongoose = require('mongoose');
const io = require('socket.io')(http, {
  cors: { origin: "*" } 
});

// CONNECT TO DATABASE
const mongoURI = process.env.MONGO_URI; 
if (mongoURI) {
  mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB Connected successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));
} else {
  console.log("WARNING: No MONGO_URI found. Leaderboard will not save.");
}

// DEFINE THE SCOREBOARD RULES (1 Name = 1 Record)
const PlayerSchema = new mongoose.Schema({
  name: { type: String, unique: true }, // Ensures unique names
  totalKills: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 } // This is "One Life Kills"
});
const PlayerDB = mongoose.model('Player', PlayerSchema);

const players = {};

io.on('connection', async (socket) => {
  console.log('Fighter connected:', socket.id);
  
  // Instantly send the current leaderboard to the new player
  try {
    const topPlayers = await PlayerDB.find().sort({ bestStreak: -1 }).limit(10);
    socket.emit('leaderboardUpdate', topPlayers);
  } catch (err) {}

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

  // WHEN A PLAYER DIES, UPDATE THE DATABASE
  socket.on('updateScore', async (data) => {
    if (!data.name || data.kills === undefined || data.kills === 0) return; 
    
    try {
      let p = await PlayerDB.findOne({ name: data.name });
      if (!p) {
        // First time this name got a kill
        p = new PlayerDB({ name: data.name, totalKills: data.kills, bestStreak: data.kills });
      } else {
        // Returning player, update their stats
        p.totalKills += data.kills;
        if (data.kills > p.bestStreak) {
          p.bestStreak = data.kills; // Update highest "One Life Kills"
        }
      }
      await p.save();
      
      // Broadcast the newly sorted leaderboard to everyone
      const topPlayers = await PlayerDB.find().sort({ bestStreak: -1 }).limit(10);
      io.emit('leaderboardUpdate', topPlayers);
    } catch (err) {
      console.log("Database update failed:", err);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
