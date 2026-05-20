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
        filtered: true
    },
    blueCheese: {
        id: "blueCheese",
        name: "Blue Cheese",
        filtered: false
    }
};

const onlineUsers = {};
const userMessageMemory = {};

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

function normalizeText(text) {
    return String(text || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .toLowerCase();
}

function leetNormalize(text) {
    return normalizeText(text)
        .replace(/0/g, "o")
        .replace(/1/g, "i")
        .replace(/!/g, "i")
        .replace(/\|/g, "i")
        .replace(/3/g, "e")
        .replace(/4/g, "a")
        .replace(/@/g, "a")
        .replace(/5/g, "s")
        .replace(/\$/g, "s")
        .replace(/7/g, "t")
        .replace(/\+/g, "t")
        .replace(/8/g, "b")
        .replace(/9/g, "g");
}

function compactText(text) {
    return leetNormalize(text)
        .replace(/[^a-z0-9]/g, "")
        .replace(/(.)\1+/g, "$1");
}

/* CHEESE LOUNGE BLOCKED WORDS */
const BLOCKED_MESSAGE_TERMS = [
    "fuck",
    "fuk",
    "fck",
    "shit",
    "shite",
    "bitch",
    "btch",
    "asshole",
    "arsehole",
    "bastard",
    "dick",
    "dickhead",
    "cock",
    "piss",
    "crap",
    "damn",
    "slut",
    "whore",
    "hoe",
    "cunt",
    "twat",
    "wanker",
    "prick",
    "tosser",
    "bollocks",
    "bugger",
    "motherfucker",
    "porn",
    "sex",
    "nude",
    "nudes",
    "nsfw",
    "scam",
    "phishing",
    "hack",
    "hacker",
    "spam"
];

const BLOCKED_USERNAME_TERMS = [
    "admin",
    "owner",
    "moderator",
    "mod",
    "system",
    "server",
    "staff",
    "support",
    "official",
    "null",
    "undefined"
];

const RESERVED_EXACT_USERNAMES = [
    "admin",
    "owner",
    "moderator",
    "mod",
    "system",
    "server",
    "staff",
    "support",
    "cheesewithfriends",
    "cheese with friends",
    "cheese lounge",
    "blue cheese"
];

function checkUsername(username) {
    const cleaned = cleanUsername(username);
    const normalized = normalizeText(cleaned);
    const compact = compactText(cleaned);

    if (!cleaned) return "Enter a username.";
    if (cleaned.length < 3) return "Username must be at least 3 characters.";
    if (cleaned.length > 20) return "Username must be 20 characters or less.";

    if (/[\u200B-\u200D\uFEFF]/.test(username)) {
        return "Username cannot use invisible characters.";
    }

    if (!/^[a-zA-Z0-9_ -]+$/.test(cleaned)) {
        return "Username can only use letters, numbers, spaces, hyphens, and underscores.";
    }

    if (/(.)\1{4,}/i.test(cleaned)) {
        return "Username has too many repeated characters.";
    }

    if (/^\d+$/.test(cleaned)) {
        return "Username cannot be only numbers.";
    }

    if (RESERVED_EXACT_USERNAMES.includes(normalized)) {
        return "That username is reserved.";
    }

    for (const term of BLOCKED_USERNAME_TERMS) {
        if (
            normalized.includes(normalizeText(term)) ||
            compact.includes(compactText(term))
        ) {
            return "That username is not allowed.";
        }
    }

    return null;
}

function checkMessage(text, roomId, socketId) {
    const raw = String(text || "");
    const message = raw.trim();

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

    if (/[\u200B-\u200D\uFEFF]/.test(message)) {
        return {
            ok: false,
            message: "Message contains invisible characters."
        };
    }

    const now = Date.now();

    if (!userMessageMemory[socketId]) {
        userMessageMemory[socketId] = {
            lastMessage: "",
            lastTime: 0,
            repeatCount: 0
        };
    }

    const memory = userMessageMemory[socketId];

    if (now - memory.lastTime < 650) {
        return {
            ok: false,
            message: "Slow down a little."
        };
    }

    if (message === memory.lastMessage) {
        memory.repeatCount++;

        if (memory.repeatCount >= 2) {
            return {
                ok: false,
                message: "Stop repeating the same message."
            };
        }
    } else {
        memory.repeatCount = 0;
    }

    memory.lastMessage = message;
    memory.lastTime = now;

    const room = rooms[roomId] || rooms.cheeseLounge;

    /*
       Blue Cheese has no word/link filters.
       It still has anti-crash safety:
       - 100 char limit
       - anti-spam
       - invisible character block
    */
    if (room.filtered === false) {
        return {
            ok: true,
            text: message
        };
    }

    const normalized = normalizeText(message);
    const compact = compactText(message);

    const blockedPatterns = [
        /https?:\/\//i,
        /www\./i,
        /\.com/i,
        /\.net/i,
        /\.org/i,
        /\.gg/i,
        /discord\.gg/i,
        /discord\.com\/invite/i,
        /@everyone/i,
        /@here/i,
        /(?:.)\1{14,}/i
    ];

    for (const pattern of blockedPatterns) {
        if (pattern.test(message)) {
            return {
                ok: false,
                message: "Cheese Lounge filter blocked that message."
            };
        }
    }

    for (const term of BLOCKED_MESSAGE_TERMS) {
        const normalTerm = normalizeText(term);
        const compactTerm = compactText(term);

        if (
            normalized.includes(normalTerm) ||
            compact.includes(compactTerm)
        ) {
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

/* SIGNUP */

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

    const usernameIssue = checkUsername(username);

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

/* LOGIN */

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

            if (
                user.password.startsWith("$2a$") ||
                user.password.startsWith("$2b$")
            ) {
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

/* SOCKETS */

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

        const room =
            rooms[data.room]
                ? data.room
                : socket.room || "cheeseLounge";

        const result = checkMessage(
            data.text,
            room,
            socket.id
        );

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

        const room =
            rooms[data.room]
                ? data.room
                : socket.room || "cheeseLounge";

        socket.to(room).emit("typing", {
            username: socket.username,
            room
        });
    });

    socket.on("stop typing", data => {
        if (!socket.username) return;

        const room =
            rooms[data.room]
                ? data.room
                : socket.room || "cheeseLounge";

        socket.to(room).emit("stop typing", {
            username: socket.username,
            room
        });
    });

    socket.on("disconnect", () => {
        const user = onlineUsers[socket.id];

        delete onlineUsers[socket.id];
        delete userMessageMemory[socket.id];

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