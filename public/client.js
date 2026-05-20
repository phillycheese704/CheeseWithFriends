const socket = io();

let currentUser = null;
let currentRoom = "cheeseLounge";
let typingTimer = null;

const authScreen = document.getElementById("authScreen");
const app = document.getElementById("app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const inviteCodeInput = document.getElementById("inviteCode");
const authMessage = document.getElementById("authMessage");

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const charCounter = document.getElementById("charCounter");
const typingIndicator = document.getElementById("typingIndicator");

const onlineUsers = document.getElementById("onlineUsers");
const onlineCount = document.getElementById("onlineCount");

const chatPage = document.getElementById("chatPage");
const arcadePage = document.getElementById("arcadePage");

const roomTitle = document.getElementById("roomTitle");
const roomSubtitle = document.getElementById("roomSubtitle");

function setAuthMessage(text, type = "error") {
    authMessage.textContent = text;
    authMessage.className = type;
}

async function signUp() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const inviteCode = inviteCodeInput.value;

    if (!username || !password || !inviteCode) {
        setAuthMessage("Enter username, password, and invite code.");
        return;
    }

    const response = await fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password,
            inviteCode
        })
    });

    const data = await response.json();

    if (!data.success) {
        setAuthMessage(data.message);
        return;
    }

    setAuthMessage("Account created. You can login now.", "success");
}

async function login() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        setAuthMessage("Enter a username and password.");
        return;
    }

    const response = await fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const data = await response.json();

    if (!data.success) {
        setAuthMessage(data.message);
        return;
    }

    currentUser = data.username;

    authScreen.classList.add("hidden");
    app.classList.remove("hidden");

    socket.emit("user joined", {
        username: currentUser,
        room: currentRoom
    });
}

function sendMessage() {
    const text = messageInput.value.trim();

    if (!text) return;

    if (text.length > 100) {
        alert("Messages can only be 100 characters.");
        return;
    }

    socket.emit("chat message", {
        room: currentRoom,
        text
    });

    socket.emit("stop typing", {
        room: currentRoom
    });

    messageInput.value = "";
    updateCounter();
}

function switchRoom(roomId) {
    if (roomId === currentRoom) return;

    currentRoom = roomId;

    messages.innerHTML = `
        <div class="empty-state">
            You entered a new room. The cheese is different here.
        </div>
    `;

    updateRoomUI(roomId);

    socket.emit("switch room", roomId);
}

function updateRoomUI(roomId) {
    document
        .querySelectorAll(".room-button")
        .forEach(button => button.classList.remove("active"));

    const activeButton = document.getElementById(`room-${roomId}`);

    if (activeButton) {
        activeButton.classList.add("active");
    }

    if (roomId === "cheeseLounge") {
        roomTitle.textContent = "🧀 Cheese Lounge";
        roomSubtitle.textContent = "Filtered main room • 100 character messages";
        messageInput.placeholder = "Say something cheesy...";
    }

    if (roomId === "blueCheese") {
        roomTitle.textContent = "🧀 Blue Cheese";
        roomSubtitle.textContent = "No filters • still capped at 100 chars for layout safety";
        messageInput.placeholder = "Enter the blue zone...";
    }
}

function openArcade() {
    chatPage.classList.add("hidden");
    arcadePage.classList.remove("hidden");
}

function closeArcade() {
    arcadePage.classList.add("hidden");
    chatPage.classList.remove("hidden");
}

function changeTabName() {
    const input = document.getElementById("tabNameInput");
    const value = input.value.trim();

    if (!value) return;

    document.title = value;
}

function updateCounter() {
    const length = messageInput.value.length;
    charCounter.textContent = `${length}/100`;

    if (length >= 90) {
        charCounter.classList.add("danger");
    } else {
        charCounter.classList.remove("danger");
    }
}

function addMessage(data) {
    removeEmptyState();

    const div = document.createElement("div");
    div.className = "message";

    div.innerHTML = `
        <div class="message-meta">
            <strong title="${escapeHtml(data.username)}">${escapeHtml(data.username)}</strong>
            <span>${escapeHtml(data.time || "")}</span>
        </div>
        <p>${escapeHtml(data.text)}</p>
    `;

    messages.appendChild(div);
    scrollToBottom();
}

function addSystemMessage(text) {
    removeEmptyState();

    const div = document.createElement("div");
    div.className = "system-message";
    div.textContent = text;

    messages.appendChild(div);
    scrollToBottom();
}

function removeEmptyState() {
    const empty = messages.querySelector(".empty-state");

    if (empty) {
        empty.remove();
    }
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text || "");
    return div.innerHTML;
}

messageInput.addEventListener("input", () => {
    updateCounter();

    socket.emit("typing", {
        room: currentRoom
    });

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
        socket.emit("stop typing", {
            room: currentRoom
        });
    }, 900);
});

messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        sendMessage();
    }
});

socket.on("chat message", data => {
    if (data.room !== currentRoom) return;
    addMessage(data);
});

socket.on("system message", data => {
    if (data.room !== currentRoom) return;
    addSystemMessage(data.text);
});

socket.on("online users", users => {
    onlineUsers.innerHTML = "";

    onlineCount.textContent = `${users.length} online`;

    users.forEach(user => {
        const div = document.createElement("div");

        div.className = "online-user";
        div.innerHTML = `
            <span class="status-dot"></span>
            <span title="${escapeHtml(user.username)}">${escapeHtml(user.username)}</span>
            <small>${user.room === "blueCheese" ? "Blue Cheese" : "Cheese Lounge"}</small>
        `;

        onlineUsers.appendChild(div);
    });
});

socket.on("room switched", data => {
    updateRoomUI(data.room);
});

socket.on("message rejected", message => {
    alert(message);
});

socket.on("typing", data => {
    if (data.room !== currentRoom) return;

    typingIndicator.textContent = `${data.username} is typing...`;
});

socket.on("stop typing", data => {
    if (data.room !== currentRoom) return;

    typingIndicator.textContent = "";
});

updateCounter();