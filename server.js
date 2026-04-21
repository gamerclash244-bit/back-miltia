const express = require('express');
const app = express();
const http = require('http').createServer(app);
const mongoose = require('mongoose');
const io = require('socket.io')(http, { cors: { origin: "*" } });

const mongoURI = process.env.MONGO_URI; 
if (mongoURI) {
  mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB Connected successfully!'))
    .catch(err => console.log('MongoDB Connection Error:', err));
}

const PlayerSchema = new mongoose.Schema({
  name: { type: String, unique: true }, 
  pin: { type: String }, 
  totalKills: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 } 
});
const PlayerDB = mongoose.model('Player', PlayerSchema);

const players = {};
const SYNC_RADIUS = 2500; // Maximum pixel distance to send network updates

io.on('connection', async (socket) => {
  console.log('Connection attempt:', socket.id);
  
  try {
    const topPlayers = await PlayerDB.find().sort({ bestStreak: -1 }).limit(10);
    socket.emit('leaderboardUpdate', topPlayers);
  } catch (err) {}

  socket.on('login', async (data, callback) => {
    if (!data.name || !data.pin) return callback({ success: false, message: "Callsign and PIN required." });
    try {
      let p = await PlayerDB.findOne({ name: data.name });
      if (p) {
        if (p.pin === data.pin) {
          callback({ success: true, currentPlayers: players });
        } else {
          callback({ success: false, message: "Callsign taken. Incorrect PIN." });
        }
      } else {
        p = new PlayerDB({ name: data.name, pin: data.pin });
        await p.save();
        callback({ success: true, currentPlayers: players });
      }
    } catch (err) {
      callback({ success: false, message: "Database Error. Check Render Logs." });
    }
  });

  socket.on('playerMovement', (data) => {
    const isNewPlayer = !players[socket.id];
    players[socket.id] = data;

    if (isNewPlayer) {
      // Only broadcast once to let everyone know they spawned
      socket.broadcast.emit('newPlayer', { id: socket.id, player: data });
    } else {
      // PROXIMITY FILTER: Only send movement to players within 2500 pixels
      for (let id in players) {
        if (id !== socket.id) {
          let otherPlayer = players[id];
          let dist = Math.hypot(otherPlayer.x - data.x, otherPlayer.y - data.y);
          if (dist <= SYNC_RADIUS) {
            io.to(id).emit('playerMoved', { id: socket.id, player: data });
          }
        }
      }
    }
  });

  socket.on('shoot', (bulletData) => {
    let shooter = players[socket.id];
    if (!shooter) return;

    // PROXIMITY FILTER: Only send bullets to nearby players
    for (let id in players) {
      if (id !== socket.id) {
        let otherPlayer = players[id];
        let dist = Math.hypot(otherPlayer.x - shooter.x, otherPlayer.y - shooter.y);
        if (dist <= SYNC_RADIUS) {
          io.to(id).emit('networkBullet', bulletData);
        }
      }
    }
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
