const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
let players = {};
let leaderboards = {}; 

io.on('connection', (socket) => {
    
    // STEP 1: Basic Authentication
    socket.on('login', (data, callback) => {
        socket.playerName = data.name;
        callback({ success: true });
    });

    // STEP 2: Join Specific Game Mode
    socket.on('joinGame', (data, callback) => {
        let roomName = data.room || "GLOBAL_PUBLIC"; 
        let nameTaken = false;
        let existingId = null;

        // Ensure no duplicate names in the chosen room
        for (let id in players) {
            if (players[id].room === roomName && players[id].name.toLowerCase() === socket.playerName.toLowerCase()) {
                nameTaken = true; existingId = id;
            }
        }

        if (nameTaken) {
            io.to(existingId).emit('kicked', { reason: "Logged in from another location in this room." });
            io.sockets.sockets.get(existingId)?.leave(roomName);
            delete players[existingId];
            socket.broadcast.to(roomName).emit('playerDisconnected', existingId);
        }

        // Leave previous room if returning from death
        if (players[socket.id]) {
            socket.leave(players[socket.id].room);
            socket.broadcast.to(players[socket.id].room).emit('playerDisconnected', socket.id);
        }

        // Connect the socket to the isolated room
        socket.join(roomName);

        players[socket.id] = {
            id: socket.id,
            room: roomName,
            name: socket.playerName,
            x: Math.random() * 8000 + 1000, 
            y: Math.random() * 500 + 200,
            aimAngle: 0, 
            color: data.color || "#e74c3c", 
            health: 100, 
            weapon: 'rifle'
        };

        if (!leaderboards[roomName]) leaderboards[roomName] = [];

        let playersInRoom = {};
        for (let id in players) {
            if (players[id].room === roomName) playersInRoom[id] = players[id];
        }

        socket.broadcast.to(roomName).emit('newPlayer', { id: socket.id, player: players[socket.id] });
        callback({ success: true, currentPlayers: playersInRoom });
        
        io.to(roomName).emit('leaderboardUpdate', leaderboards[roomName]);
    });

    // MOVEMENT (Isolated to Room)
    socket.on('playerMovement', (data) => {
        let p = players[socket.id]; if (!p) return;
        p.x = data.x; p.y = data.y; p.aimAngle = data.aimAngle; p.color = data.color; p.health = data.health; p.weapon = data.weapon;
        socket.broadcast.to(p.room).emit('playerMoved', { id: socket.id, player: p });
    });

    // BULLETS (Isolated to Room)
    socket.on('shoot', (data) => {
        let p = players[socket.id]; if (!p) return;
        socket.broadcast.to(p.room).emit('networkBullet', {
            x: data.x, y: data.y, vx: data.vx, vy: data.vy, radius: data.radius, ownerId: data.ownerId
        });
    });

    // SCORE & LEADERBOARD (Isolated to Room)
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

http.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
