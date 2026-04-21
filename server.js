const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
let players = {};
let leaderboards = [];

io.on('connection', (socket) => {
    
    // LOGIN SYSTEM (Prevents duplicate callsighs)
    socket.on('login', (data, callback) => {
        let nameTaken = false;
        let existingId = null;

        for (let id in players) {
            if (players[id].name.toLowerCase() === data.name.toLowerCase()) {
                nameTaken = true;
                existingId = id;
            }
        }

        if (nameTaken) {
            // Kick old player so new device can take the name
            io.to(existingId).emit('kicked', { reason: "Logged in from another location." });
            delete players[existingId];
            socket.broadcast.emit('playerDisconnected', existingId);
        }

        players[socket.id] = {
            id: socket.id,
            name: data.name,
            x: 100, y: 1500,
            aimAngle: 0,
            color: "#e74c3c",
            health: 100,
            weapon: 'rifle'
        };

        socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });
        callback({ success: true, currentPlayers: players });
        io.emit('leaderboardUpdate', leaderboards);
    });

    // MOVEMENT & SYNC
    socket.on('playerMovement', (data) => {
        if (!players[socket.id]) return;
        players[socket.id].x = data.x;
        players[socket.id].y = data.y;
        players[socket.id].aimAngle = data.aimAngle;
        players[socket.id].color = data.color;
        players[socket.id].health = data.health;
        players[socket.id].weapon = data.weapon;

        socket.broadcast.emit('playerMoved', { id: socket.id, player: players[socket.id] });
    });

    // SHOOTING SYNC
    socket.on('shoot', (data) => {
        socket.broadcast.emit('networkBullet', {
            x: data.x,
            y: data.y,
            vx: data.vx,
            vy: data.vy,
            radius: data.radius,
            ownerId: data.ownerId
        });
    });

    // SCORE & LEADERBOARD
    socket.on('updateScore', (data) => {
        let found = leaderboards.find(p => p.name === data.name);
        if (found) {
            if (data.kills > found.bestStreak) found.bestStreak = data.kills;
            found.totalKills += data.kills;
        } else {
            leaderboards.push({ name: data.name, bestStreak: data.kills, totalKills: data.kills });
        }
        
        // Sort highest total kills first
        leaderboards.sort((a, b) => b.totalKills - a.totalKills);
        io.emit('leaderboardUpdate', leaderboards);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

http.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
