const socket = io();

let currentUser = null;

const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const authMessage = document.getElementById("authMessage");

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");

const onlineUsers = document.getElementById("onlineUsers");

async function signUp() {

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        authMessage.textContent =
            "Enter username and password";
        return;
    }

    const res = await fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await res.json();

    if (!data.success) {
        authMessage.textContent = data.message;
        return;
    }

    authMessage.textContent =
        "Account created. Now login.";
}

async function login() {

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    const res = await fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await res.json();

    if (!data.success) {
        authMessage.textContent = data.message;
        return;
    }

    currentUser = username;

    authScreen.style.display = "none";
    app.style.display = "flex";

    socket.emit("user joined", username);
}

function sendMessage() {

    const text = messageInput.value.trim();

    if (!text) return;

    socket.emit("chat message", {
        username: currentUser,
        text
    });

    messageInput.value = "";
}

socket.on("chat message", data => {

    const div = document.createElement("div");

    div.className = "message";

    div.innerHTML = `
        <strong>${data.username}</strong>
        <p>${data.text}</p>
    `;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;
});

socket.on("system message", text => {

    const div = document.createElement("div");

    div.className = "systemMessage";

    div.textContent = text;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;
});

socket.on("online users", users => {

    onlineUsers.innerHTML = "";

    users.forEach(user => {

        const div = document.createElement("div");

        div.className = "onlineUser";

        div.textContent = user;

        onlineUsers.appendChild(div);
    });
});

function changeTabName() {

    const value =
        document.getElementById("tabNameInput")
        .value
        .trim();

    if (!value) return;

    document.title = value;
}

messageInput?.addEventListener("keydown", e => {

    if (e.key === "Enter") {
        sendMessage();
    }
});