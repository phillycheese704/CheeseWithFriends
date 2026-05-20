const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./users.db");

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);
});

const rooms = {
    cheeseLounge: {
        id: "cheeseLounge",
        name: "Cheese Lounge",
        icon: "🧀",
        filtered: true
    },
    blueCheese: {
        id: "blueCheese",
        name: "Blue Cheese",
        icon: "🧀",
        filtered: false
    }
};

const onlineUsers = {};

function getOnlineUsers() {
    return Object.values(onlineUsers).map(user => ({
        username: user.username,
        room: user.room
    }));
}

function cleanUsername(username) {
    return String(username || "")
        .trim()
        .replace(/\s+/g, " ");
}

function isBadUsername(username) {
    const lower = username.toLowerCase();

    const blocked = [
        "admin",
        "owner",
        "moderator",
        "mod",
        "system",
        "server",
        "null",
        "undefined"
    ];

    if (username.length < 3) return "Username must be at least 3 characters.";
    if (username.length > 20) return "Username must be 20 characters or less.";
    if (!/^[a-zA-Z0-9_ -]+$/.test(username)) return "Username can only use letters, numbers, spaces, hyphens, and underscores.";

    for (const word of blocked) {
        if (lower.includes(word)) {
            return "That username is reserved.";
        }
    }

    return null;
}

function filterMessage(text, roomId) {
    let message = String(text || "").trim();

    if (!message) {
        return {
            ok: false,
            message: "Message is empty."
        };
    }

    if (message.length > 100) {
        return {
            ok: false,
            message: "Messages can only be 100 characters."
        };
    }

    if (roomId === "blueCheese") {
        return {
            ok: true,
            text: message
        };
    }

    const lower = message.toLowerCase();

    const blockedPatterns = [
        /https?:\/\//i,
        /discord\.gg/i,
        /(?:.)\1{12,}/i
    ];

    for (const pattern of blockedPatterns) {
        if (pattern.test(message)) {
            return {
                ok: false,
                message: "Cheese Lounge filter blocked that message."
            };
        }
    }

    const blockedWords = [
        "hack",
        "scam",
        "spam"
    ];

    for (const word of blockedWords) {
        if (lower.includes(word)) {
            return {
                ok: false,
                message: "Cheese Lounge filter blocked that message."
            };
        }
    }

    return {
        ok: true,
        text: message
    };
}

app.post("/signup", async (req, res) => {
    let { username, password } = req.body;

    username = cleanUsername(username);
    password = String(password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    const usernameIssue = isBadUsername(username);

    if (usernameIssue) {
        return res.json({
            success: false,
            message: usernameIssue
        });
    }

    if (password.length < 4) {
        return res.json({
            success: false,
            message: "Password must be at least 4 characters."
        });
    }

    db.get(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?)",
        [username],
        async (err, row) => {
            if (err) {
                return res.json({
                    success: false,
                    message: "Database error."
                });
            }

            if (row) {
                return res.json({
                    success: false,
                    message: "That username is already taken."
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            db.run(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                [username, hashedPassword],
                err => {
                    if (err) {
                        return res.json({
                            success: false,
                            message: "Could not create account."
                        });
                    }

                    return res.json({
                        success: true,
                        message: "Account created."
                    });
                }
            );
        }
    );
});

app.post("/login", (req, res) => {
    let { username, password } = req.body;

    username = cleanUsername(username);
    password = String(password || "");

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Enter a username and password."
        });
    }

    db.get(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(?)",
        [username],
        async (err, user) => {
            if (err || !user) {
                return res.json({
                    success: false,
                    message: "Invalid username or password."
                });
            }

            let validPassword = false;

            if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
                validPassword = await bcrypt.compare(password, user.password);
            } else {
                validPassword = password === user.password;
            }

            if (!validPassword) {
                return res.json({
                    success: false,
                    message: "Invalid username or password."
                });
            }

            return res.json({
                success: true,
                username: user.username
            });
        }
    );
});

io.on("connection", socket => {
    socket.on("user joined", data => {
        const username = cleanUsername(data.username);
        const room = rooms[data.room] ? data.room : "cheeseLounge";

        socket.username = username;
        socket.room = room;

        onlineUsers[socket.id] = {
            username,
            room
        };

        socket.join(room);

        io.emit("online users", getOnlineUsers());

        io.to(room).emit("system message", {
            room,
            text: `${username} joined ${rooms[room].name}.`
        });
    });

    socket.on("switch room", roomId => {
        if (!socket.username) return;
        if (!rooms[roomId]) return;

        const oldRoom = socket.room || "cheeseLounge";

        socket.leave(oldRoom);

        socket.room = roomId;

        if (onlineUsers[socket.id]) {
            onlineUsers[socket.id].room = roomId;
        }

        socket.join(roomId);

        io.emit("online users", getOnlineUsers());

        socket.emit("room switched", {
            room: roomId,
            roomName: rooms[roomId].name,
            filtered: rooms[roomId].filtered
        });

        io.to(roomId).emit("system message", {
            room: roomId,
            text: `${socket.username} entered ${rooms[roomId].name}.`
        });
    });

    socket.on("chat message", data => {
        if (!socket.username) return;

        const room = rooms[data.room] ? data.room : socket.room || "cheeseLounge";

        const result = filterMessage(data.text, room);

        if (!result.ok) {
            socket.emit("message rejected", result.message);
            return;
        }

        io.to(room).emit("chat message", {
            username: socket.username,
            text: result.text,
            room,
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        });
    });

    socket.on("typing", data => {
        if (!socket.username) return;

        const room = rooms[data.room] ? data.room : socket.room || "cheeseLounge";

        socket.to(room).emit("typing", {
            username: socket.username,
            room
        });
    });

    socket.on("stop typing", data => {
        if (!socket.username) return;

        const room = rooms[data.room] ? data.room : socket.room || "cheeseLounge";

        socket.to(room).emit("stop typing", {
            username: socket.username,
            room
        });
    });

    socket.on("disconnect", () => {
        const user = onlineUsers[socket.id];

        delete onlineUsers[socket.id];

        io.emit("online users", getOnlineUsers());

        if (user) {
            io.to(user.room).emit("system message", {
                room: user.room,
                text: `${user.username} left.`
            });
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});