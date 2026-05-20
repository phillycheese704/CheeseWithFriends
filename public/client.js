alert("CLIENT JS LOADED 🧀");
const socket = io();

let currentUser = null;

// ELEMENTS
const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const authMessage = document.getElementById("authMessage");

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");

const onlineUsers = document.getElementById("onlineUsers");

// =======================
// SIGN UP
// =======================

function signUp() {

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    authMessage.textContent =
      "Enter username and password";
    return;
  }

  socket.emit("signup", {
    username,
    password
  });

}

// =======================
// LOGIN
// =======================

function login() {

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    authMessage.textContent =
      "Enter username and password";
    return;
  }

  socket.emit("login", {
    username,
    password
  });

}

// =======================
// AUTH RESPONSES
// =======================

socket.on("signup success", () => {

  authMessage.textContent =
    "Account created! You can login now.";

});

socket.on("signup error", (msg) => {

  authMessage.textContent = msg;

});

socket.on("login success", (username) => {

  currentUser = username;

  authScreen.style.display = "none";
  app.style.display = "flex";

});

socket.on("login error", (msg) => {

  authMessage.textContent = msg;

});

// =======================
// SEND MESSAGE
// =======================

function sendMessage() {

  const message = messageInput.value.trim();

  if (!message) return;

  socket.emit("chat message", {
    username: currentUser,
    message
  });

  messageInput.value = "";

}

// ENTER KEY
messageInput.addEventListener("keydown", (e) => {

  if (e.key === "Enter") {
    sendMessage();
  }

});

// =======================
// RECEIVE MESSAGE
// =======================

socket.on("chat message", (data) => {

  const div = document.createElement("div");

  div.className = "message";

  div.innerHTML = `
    <strong>${data.username}</strong><br>
    ${data.message}
  `;

  messages.appendChild(div);

  messages.scrollTop = messages.scrollHeight;

});

// =======================
// ONLINE USERS
// =======================

socket.on("online users", (users) => {

  onlineUsers.innerHTML = "";

  users.forEach(user => {

    const div = document.createElement("div");

    div.className = "user-tag";

    div.textContent = user;

    onlineUsers.appendChild(div);

  });

});