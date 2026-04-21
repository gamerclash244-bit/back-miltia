const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
let players = {};
let leaderboards = {}; // Now an object to hold separate leaderboards per room

io.on('connection', (socket) => {
    
    // LOGIN & ROOM ASSIGNMENT
    socket.on('login', (data, callback) => {
        let roomName = data.room || "GLOBAL_PUBLIC"; // Default to public if left blank
        let nameTaken = false;
        let existingId = null;

        // Check if name is taken IN THIS SPECIFIC ROOM
        for (let id in players) {
            if (players[id].room === roomName && players[id].name.toLowerCase() === data.name.toLowerCase()) {
                nameTaken = true; existingId = id;
            }
        }

        if (nameTaken) {
            io.to(existingId).emit('kicked', { reason: "Logged in from another location in this room." });
            socket.leave(roomName);
            delete players[existingId];
            socket.broadcast.to(roomName).emit('playerDisconnected', existingId);
        }

        // Connect the socket to the isolated room
        socket.join(roomName);

        players[socket.id] = {
            id: socket.id,
            room: roomName,
            name: data.name,
            x: Math.random() * 8000 + 1000, 
            y: Math.random() * 500 + 200,
            aimAngle: 0, color: "#e74c3c", health: 100, weapon: 'rifle'
        };

        // Create an empty leaderboard for this room if it doesn't exist yet
        if (!leaderboards[roomName]) leaderboards[roomName] = [];

        // Filter players to ONLY send the ones in the same room to the new user
        let playersInRoom = {};
        for (let id in players) {
            if (players[id].room === roomName) playersInRoom[id] = players[id];
        }

        socket.broadcast.to(roomName).emit('newPlayer', { id: socket.id, player: players[socket.id] });
        callback({ success: true, currentPlayers: playersInRoom });
        
        io.to(roomName).emit('leaderboardUpdate', leaderboards[roomName]);
    });

    // MOVEMENT (Isolated)
    socket.on('playerMovement', (data) => {
        let p = players[socket.id]; if (!p) return;
        p.x = data.x; p.y = data.y; p.aimAngle = data.aimAngle; p.color = data.color; p.health = data.health; p.weapon = data.weapon;
        socket.broadcast.to(p.room).emit('playerMoved', { id: socket.id, player: p });
    });

    // BULLETS (Isolated)
    socket.on('shoot', (data) => {
        let p = players[socket.id]; if (!p) return;
        socket.broadcast.to(p.room).emit('networkBullet', {
            x: data.x, y: data.y, vx: data.vx, vy: data.vy, radius: data.radius, ownerId: data.ownerId
        });
    });

    // SCORE & LEADERBOARD (Isolated)
    socket.on('updateScore', (data) => {
        let p = players[socket.id]; if (!p) return;
        let roomLB = leaderboards[p.room];
        let found = roomLB.find(lb => lb.name === data.name);
        
        if (found) {
            if (data.kills > found.bestStreak) found.bestStreak = data.kills;
            found.totalKills += data.kills;
        } else {
            roomLB.push({ name: data.name, bestStreak: data.kills, totalKills: data.kills });
        }
        
        roomLB.sort((a, b) => b.totalKills - a.totalKills);
        io.to(p.room).emit('leaderboardUpdate', roomLB);
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        let p = players[socket.id];
        if (p) {
            socket.broadcast.to(p.room).emit('playerDisconnected', socket.id);
            delete players[socket.id];
        }
    });
});

// Using 0.0.0.0 allows LAN connections
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
