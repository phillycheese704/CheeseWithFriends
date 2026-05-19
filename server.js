const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

/* PUBLIC FOLDER */

app.use(express.static("public"));

/* ONLINE USERS */

let onlineUsers = [];

/* SOCKET CONNECTION */

io.on("connection", (socket) => {

  console.log("A user connected");

/* USER JOINS */

  socket.on("join", (username) => {

    socket.username = username;

    onlineUsers.push(username);

    io.emit(
      "system message",
      `${username} joined Cheese Lounge 🧀`
    );

    io.emit(
      "online users",
      onlineUsers
    );

  });

/* CHAT MESSAGE */

  socket.on("chat message", (data) => {

    io.emit(
      "chat message",
      data
    );

  });

/* DISCONNECT */

  socket.on("disconnect", () => {

    console.log("User disconnected");

    if(socket.username){

      onlineUsers =
        onlineUsers.filter(
          user => user !== socket.username
        );

      io.emit(
        "system message",
        `${socket.username} left`
      );

      io.emit(
        "online users",
        onlineUsers
      );

    }

  });

});

/* START SERVER */

server.listen(5000, "0.0.0.0", () => {

  console.log(
    "Server running on http://localhost:5000"
  );

});