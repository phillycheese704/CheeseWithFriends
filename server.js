const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
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

const onlineUsers = {};

app.post("/signup", (req, res) => {
    const { username, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE username = ?",
        [username],
        (err, row) => {
            if (row) {
                return res.json({
                    success: false,
                    message: "Username already taken"
                });
            }

            db.run(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                [username, password],
                err => {
                    if (err) {
                        return res.json({
                            success: false,
                            message: "Signup failed"
                        });
                    }

                    res.json({
                        success: true
                    });
                }
            );
        }
    );
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE username = ? AND password = ?",
        [username, password],
        (err, row) => {
            if (!row) {
                return res.json({
                    success: false,
                    message: "Invalid username or password"
                });
            }

            res.json({
                success: true
            });
        }
    );
});

io.on("connection", socket => {

    socket.on("user joined", username => {
        onlineUsers[socket.id] = username;

        io.emit("online users", Object.values(onlineUsers));

        io.emit("system message", `${username} joined`);
    });

    socket.on("chat message", data => {
        io.emit("chat message", data);
    });

    socket.on("disconnect", () => {

        const username = onlineUsers[socket.id];

        delete onlineUsers[socket.id];

        io.emit("online users", Object.values(onlineUsers));

        if (username) {
            io.emit("system message", `${username} left`);
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});