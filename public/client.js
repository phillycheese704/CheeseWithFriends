const socket = io();

let username = "";

/* SCREENS */

const homeScreen =
  document.getElementById("homeScreen");

const signupScreen =
  document.getElementById("signupScreen");

const loginScreen =
  document.getElementById("loginScreen");

const chatScreen =
  document.getElementById("chatScreen");

/* BUTTONS */

const openSignup =
  document.getElementById("openSignup");

const openLogin =
  document.getElementById("openLogin");

const backSignup =
  document.getElementById("backSignup");

const backLogin =
  document.getElementById("backLogin");

const joinBtn =
  document.getElementById("joinBtn");

/* CHAT */

const usernameInput =
  document.getElementById("usernameInput");

const messages =
  document.getElementById("messages");

const messageInput =
  document.getElementById("messageInput");

const sendBtn =
  document.getElementById("sendBtn");

const usersList =
  document.getElementById("usersList");

const onlineCount =
  document.getElementById("onlineCount");

/* OPEN SIGNUP */

openSignup.addEventListener("click",()=>{

  homeScreen.classList.add("hidden");

  signupScreen.classList.remove("hidden");

});

/* OPEN LOGIN */

openLogin.addEventListener("click",()=>{

  homeScreen.classList.add("hidden");

  loginScreen.classList.remove("hidden");

});

/* BACK BUTTONS */

backSignup.addEventListener("click",()=>{

  signupScreen.classList.add("hidden");

  homeScreen.classList.remove("hidden");

});

backLogin.addEventListener("click",()=>{

  loginScreen.classList.add("hidden");

  homeScreen.classList.remove("hidden");

});

/* ENTER CHAT */

joinBtn.addEventListener("click",()=>{

  username =
    usernameInput.value.trim();

  if(!username) return;

  loginScreen.classList.add("hidden");

  chatScreen.classList.remove("hidden");

  socket.emit("join",username);

});

/* SEND MESSAGE */

function sendMessage(){

  const message =
    messageInput.value.trim();

  if(!message) return;

  socket.emit("chat message",{

    username,
    message

  });

  messageInput.value = "";

}

sendBtn.addEventListener(
  "click",
  sendMessage
);

messageInput.addEventListener(
  "keydown",
  (e)=>{

    if(e.key === "Enter"){

      sendMessage();

    }

  }
);

/* RECEIVE CHAT */

socket.on(
  "chat message",
  (data)=>{

    const div =
      document.createElement("div");

    div.className = "message";

    div.innerHTML = `
      <strong>${data.username}</strong><br>
      ${data.message}
    `;

    messages.appendChild(div);

    messages.scrollTop =
      messages.scrollHeight;

  }
);

/* SYSTEM MESSAGE */

socket.on(
  "system message",
  (msg)=>{

    const div =
      document.createElement("div");

    div.className =
      "message system";

    div.textContent = msg;

    messages.appendChild(div);

    messages.scrollTop =
      messages.scrollHeight;

  }
);

/* ONLINE USERS */

socket.on(
  "online users",
  (users)=>{

    usersList.innerHTML = "";

    onlineCount.textContent =
      `${users.length} online`;

    users.forEach(user=>{

      const div =
        document.createElement("div");

      div.className = "user-tag";

      div.textContent =
        `🧀 ${user}`;

      usersList.appendChild(div);

    });

  }
);