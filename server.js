const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;

// ── MONGODB SETUP ──
// Replace the string below with your actual MongoDB connection URI!
// Example: "mongodb+srv://<username>:<password>@cluster0.mongodb.net/?retryWrites=true&w=majority"
const uri = process.env.MONGODB_URI || "mongodb+srv://gamerclash244_db_user:YJGhqcHaRmOMoF9P@cluster0.5o0s4pv.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri);
let usersCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Secure Uplink!");
        const database = client.db('baylerbayOps'); // Name of your database
        usersCollection = database.collection('users'); // Name of your collection
        
        // Creates an index so we can search callsigns quickly (case-insensitive)
        await usersCollection.createIndex({ callsignLower: 1 }, { unique: true });
    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}
connectDB();
// ───────────────────

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
    
    // ── DATABASE AUTHENTICATION LOGIC (MONGODB) ──
    socket.on('login', async (data, callback) => {
        const { name, pin } = data;

        if (!name || !pin) {
            return callback({ success: false, message: "Callsign and PIN required." });
        }

        const callsignLower = name.toLowerCase();

        try {
            // Wait for the collection to load just in case the server just woke up
            if (!usersCollection) {
                return callback({ success: false, message: "Database booting up, try again in 5 seconds." });
            }

            // 1. Look for the user in MongoDB
            const user = await usersCollection.findOne({ callsignLower: callsignLower });

            if (user) {
                // 2. User exists: Verify the PIN
                if (user.pin === pin) {
                    socket.playerName = user.callsign; // Use their properly capitalized saved name
                    callback({ success: true });
                } else {
                    callback({ success: false, message: "ACCESS DENIED: Incorrect PIN." });
                }
            } else {
                // 3. New User: Register them in MongoDB
                await usersCollection.insertOne({
                    callsign: name,
                    callsignLower: callsignLower,
                    pin: pin
                });
                
                socket.playerName = name;
                callback({ success: true });
            }
        } catch (err) {
            console.error("DB Login Error:", err);
            callback({ success: false, message: "Database uplink error." });
        }
    });
    // ─────────────────────────────────────────────

    socket.on('joinGame', (data, callback) => {
        let roomName = data.room || "GLOBAL_PUBLIC"; 
        let nameTaken = false;
        let existingId = null;

        // Ensure no duplicate active connections
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
