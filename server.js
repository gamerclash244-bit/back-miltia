const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;

// ── MONGODB SECURE UPLINK ──
const uri = process.env.MONGODB_URI || "mongodb+srv://gamerclash244_db_user:YJGhqcHaRmOMoF9P@cluster0.5o0s4pv.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri);
let usersCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("✅ Connected to MongoDB Secure Uplink!");
        const database = client.db('baylerbayOps'); 
        usersCollection = database.collection('users'); 
        await usersCollection.createIndex({ callsignLower: 1 }, { unique: true });
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
    }
}
connectDB();
// ───────────────────────────

// ── SERVER-SIDE MAP & PHYSICS FOR BOTS ──
const worldWidth = 10000; const worldHeight = 2500;
let serverMap = [];

function mulberry32(a) { return function() { var t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function checkOverlap(nx, ny, nw, nh) { const PAD = 40; for (let obj of serverMap) { if (obj.type === 'wall' || obj.type === 'floor') continue; if (nx < obj.x + obj.w + PAD && nx + nw + PAD > obj.x && ny < obj.y + obj.h + PAD && ny + nh + PAD > obj.y) return true; } return false; }

function buildServerMap() {
    serverMap = [ { x: -50, y: 0, w: 50, h: worldHeight, type: "wall" }, { x: worldWidth,y: 0, w: 50, h: worldHeight, type: "wall" }, { x: 0, y: -50, w: worldWidth, h: 50, type: "wall" }, { x: 0, y: worldHeight-50, w: worldWidth, h: 50, type: "floor" } ];
    let rand = mulberry32(12345);
    let cx = 200; while (cx < worldWidth - 400) { let pw = 130 + rand() * 270, py = worldHeight - 130 - rand() * 520; if (!checkOverlap(cx, py, pw, 28)) { serverMap.push({ x: cx, y: py, w: pw, h: 28, type: "plat" }); } cx += pw + 40 + rand() * 140; }
    cx = 350; while (cx < worldWidth - 600) { let pw = 110 + rand() * 200, py = worldHeight - 650 - rand() * 380; if (!checkOverlap(cx, py, pw, 24)) { serverMap.push({ x: cx, y: py, w: pw, h: 24, type: "plat" }); } cx += pw + 80 + rand() * 240; }
    cx = 500; while (cx < worldWidth - 800) { let pw = 90 + rand() * 170, py = worldHeight - 1100 - rand() * 480; if (!checkOverlap(cx, py, pw, 22)) { serverMap.push({ x: cx, y: py, w: pw, h: 22, type: "plat" }); } cx += pw + 120 + rand() * 320; }
    cx = 700; while (cx < worldWidth - 1000) { let pw = 120 + rand() * 280, py = 120 + rand() * 420; if (!checkOverlap(cx, py, pw, 20)) { serverMap.push({ x: cx, y: py, w: pw, h: 20, type: "plat" }); } cx += pw + 220 + rand() * 500; }
}
buildServerMap();

// ── SERVER-SIDE BOTS (SYNCHRONIZED) ──
class ServerNPC {
    constructor(id, name, color) {
        this.id = id; this.name = name; this.color = color;
        this.x = Math.random() * 8000 + 1000; this.y = Math.random() * 500 + 200; 
        this.width = 40; this.height = 40; this.dx = 0; this.dy = 0;
        this.health = 100; this.maxHealth = 100; this.aimAngle = 0;
        this.target = null; this.decisionTimer = 0; this.moveDir = Math.random() > 0.5 ? 1 : -1; this.lastShotTime = 0;
    }

    update(dt, publicPlayers) {
        if (this.health <= 0) return;
        const now = Date.now();
        this.decisionTimer -= dt; 

        // Target closest online player or other bot
        let closest = null; let minDist = 1200; 
        for (let id in publicPlayers) {
            let p = publicPlayers[id]; if (p.health <= 0) continue;
            let d = Math.hypot(p.x - this.x, p.y - this.y);
            if (d < minDist) { minDist = d; closest = p; }
        }
        
        for (let i=0; i<globalNPCs.length; i++) {
            let ob = globalNPCs[i]; if (ob.id === this.id || ob.health <= 0) continue;
            let d = Math.hypot(ob.x - this.x, ob.y - this.y);
            if (d < minDist) { minDist = d; closest = ob; }
        }

        this.target = closest;

        if (this.decisionTimer <= 0) {
            this.decisionTimer = 1000 + Math.random() * 2000;
            if (this.target) this.moveDir = this.target.x > this.x ? 1 : -1;
            else if (Math.random() > 0.7) this.moveDir *= -1;
        }

        this.x += this.moveDir * 4; 
        this.dy += 0.35; 
        if ((this.target && this.target.y < this.y - 100) || this.y > 2300) this.dy -= 0.8; 
        this.y += this.dy;

        serverMap.forEach(obj => {
            if (this.x < obj.x + obj.w && this.x + this.width > obj.x && this.y < obj.y + obj.h && this.y + this.height > obj.y) {
                if (this.dy > 0) { this.y = obj.y - this.height; this.dy = 0; } 
                else if (this.dy < 0) { this.y = obj.y + obj.h; this.dy = 0; }
            }
        });

        // 💥 FASTER SHOOTING LOGIC 💥
        if (this.target && this.health > 0) {
            let targetX = this.target.x + 20; let targetY = this.target.y + 20;
            let desiredAngle = Math.atan2(targetY - (this.y + 20), targetX - (this.x + 20));
            this.aimAngle += (desiredAngle - this.aimAngle) * 0.2; 

            // Much faster trigger finger (down from 500ms delay)
            if (now - this.lastShotTime > 300 + Math.random() * 200) {
                this.lastShotTime = now;
                io.to('GLOBAL_PUBLIC').emit('networkBullet', {
                    x: this.x + 20, y: this.y + 20,
                    vx: Math.cos(this.aimAngle) * 14, vy: Math.sin(this.aimAngle) * 14,
                    radius: 4, color: '#ffffff', ownerId: this.id 
                });
            }
        }
    }
}

const botNames = ["Alpha_Unit", "Ghost_Z", "Rogue_01", "Shadow_Byte", "Viper", "Keralite_Pro", "Bot_Nizal", "Cyber_Rex"];
const botColors = ["#ff4757", "#2ecc71", "#3498db", "#f1c40f", "#a29bfe", "#fd79a8"];
let globalNPCs = [];
for (let i = 0; i < 6; i++) {
    globalNPCs.push(new ServerNPC("npc_"+i, botNames[i], botColors[i % botColors.length]));
}

// ── SERVER GAME LOOP (30 FPS) ──
setInterval(() => {
    let publicPlayers = {};
    for (let id in players) { if (players[id].room === 'GLOBAL_PUBLIC') publicPlayers[id] = players[id]; }
    
    globalNPCs.forEach(npc => npc.update(33, publicPlayers));
    io.to('GLOBAL_PUBLIC').emit('npcSync', globalNPCs);
}, 33);
// ───────────────────────────────

let players = {};
let leaderboards = {}; 

function cleanupRoom(roomName) {
    let hasPlayers = false;
    for (let id in players) { if (players[id].room === roomName) { hasPlayers = true; break; } }
    if (!hasPlayers) delete leaderboards[roomName];
}

io.on('connection', (socket) => {
    
    socket.on('login', async (data, callback) => {
        const { name, pin } = data;
        if (!name || !pin) return callback({ success: false, message: "Callsign and PIN required." });
        const callsignLower = name.toLowerCase();

        try {
            if (!usersCollection) return callback({ success: false, message: "Database booting up..." });
            const user = await usersCollection.findOne({ callsignLower: callsignLower });

            if (user) {
                if (user.pin === pin) { socket.playerName = user.callsign; callback({ success: true }); } 
                else { callback({ success: false, message: "ACCESS DENIED: Incorrect PIN." }); }
            } else {
                await usersCollection.insertOne({ callsign: name, callsignLower: callsignLower, pin: pin });
                socket.playerName = name; callback({ success: true });
            }
        } catch (err) { callback({ success: false, message: "Database error." }); }
    });

    socket.on('joinGame', (data, callback) => {
        let roomName = data.room || "GLOBAL_PUBLIC"; 
        let nameTaken = false; let existingId = null;

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
            id: socket.id, room: roomName, name: socket.playerName,
            x: Math.random() * 8000 + 1000, y: Math.random() * 500 + 200,
            aimAngle: 0, color: data.color || "#e74c3c", health: 100, weapon: 'rifle'
        };

        if (!leaderboards[roomName]) leaderboards[roomName] = [];

        let foundLB = leaderboards[roomName].find(lb => lb.name === socket.playerName);
        if (!foundLB) leaderboards[roomName].push({ name: socket.playerName, bestStreak: 0, totalKills: 0 });

        let playersInRoom = {};
        for (let id in players) { if (players[id].room === roomName) playersInRoom[id] = players[id]; }

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

    // SERVER-AUTHORITATIVE BOT DAMAGE
    socket.on('damageBot', (data) => {
        let p = players[socket.id];
        if (!p || p.room !== 'GLOBAL_PUBLIC') return;

        let bot = globalNPCs.find(b => b.id === data.botId);
        if (bot && bot.health > 0) {
            bot.health -= data.damage;
            if (bot.health <= 0) {
                io.to('GLOBAL_PUBLIC').emit('botDied', { botId: bot.id, botName: bot.name, killerId: socket.id, killerName: p.name });
                
                setTimeout(() => {
                    bot.health = 100;
                    bot.x = Math.random() * 8000 + 1000;
                    bot.y = Math.random() * 500 + 200;
                }, 3000);
            }
        }
    });

    socket.on('updateScore', (data) => {
        let p = players[socket.id]; if (!p) return;
        let roomLB = leaderboards[p.room]; if (!roomLB) return; 
        
        let found = roomLB.find(lb => lb.name === data.name);
        if (found) {
            if (data.kills > found.bestStreak) found.bestStreak = data.kills;
            found.totalKills += data.kills;
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

http.listen(PORT, '0.0.0.0', () => { console.log(`Server listening on port ${PORT}`); });
