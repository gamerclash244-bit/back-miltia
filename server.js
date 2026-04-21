const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
let players = {};
let leaderboards = {}; 

function cleanupRoom(roomName) {
    let hasPlayers = false;
    for (let id in players) {
        if (players[id].room === roomName) {
            hasPlayers = true;
            break;
        }
    }
    if (!hasPlayers) {
        delete leaderboards[roomName];
    }
}

io.on('connection', (socket) => {
    
    socket.on('login', (data, callback) => {
        socket.playerName = data.name;
        callback({ success: true });
    });

    socket.on('joinGame', (data, callback) => {
        let roomName = data.room || "GLOBAL_PUBLIC"; 
        let nameTaken = false;
        let existingId = null;

        // THE FIX: "id !== socket.id" ensures you don't kick yourself when respawning!
        for (let id in players) {
            if (id !== socket.id && players[id].room === roomName && players[id].name.toLowerCase() === socket.playerName.toLowerCase()) {
                nameTaken = true; existingId = id;
            }
        }

        if (nameTaken) {
            io.to(existingId).emit('kicked', { reason: "Logged in from another location in this room." });
            io.sockets.sockets.get(existingId)?.leave(roomName);
            delete players[existingId];
            socket.broadcast.to(roomName).emit('playerDisconnected', existingId);
            cleanupRoom(roomName);
        }

        if (players[socket.id]) {
            let oldRoom = players[socket.id].room;
            socket.leave(oldRoom);
            socket.broadcast.to(oldRoom).emit('playerDisconnected', socket.id);
            delete players[socket.id];
            cleanupRoom(oldRoom);
        }

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

    socket.on('playerMovement', (data) => {
        let p = players[socket.id]; if (!p) return;
        p.x = data.x; p.y = data.y; p.aimAngle = data.aimAngle; p.color = data.color; p.health = data.health; p.weapon = data.weapon;
        socket.broadcast.to(p.room).emit('playerMoved', { id: socket.id, player: p });
    });

    socket.on('shoot', (data) => {
        let p = players[socket.id]; if (!p) return;
        socket.broadcast.to(p.room).emit('networkBullet', {
            x: data.x, y: data.y, vx: data.vx, vy: data.vy, radius: data.radius, ownerId: data.ownerId
        });
    });

    socket.on('updateScore', (data) => {
        let p = players[socket.id]; if (!p) return;
        let roomLB = leaderboards[p.room];
        if (!roomLB) return; 
        
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

    socket.on('disconnect', () => {
        let p = players[socket.id];
        if (p) {
            let oldRoom = p.room;
            socket.broadcast.to(oldRoom).emit('playerDisconnected', socket.id);
            delete players[socket.id];
            cleanupRoom(oldRoom); 
        }
    });
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
