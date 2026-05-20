const express = require("express");
const http = require("http");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Server } = require("socket.io");

const db = require("./database");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

/* MIDDLEWARE */

app.use(express.json());

app.use(express.urlencoded({
  extended:true
}));

app.use(express.static("public"));

app.use(session({

  secret:"cheese-secret",

  resave:false,

  saveUninitialized:false

}));

/* ONLINE USERS */

let onlineUsers = [];

/* SIGNUP */

app.post("/signup", async (req,res)=>{

  const {
    username,
    email,
    password
  } = req.body;

  if(
    !username ||
    !email ||
    !password
  ){

    return res.json({
      success:false,
      message:"Please fill all fields"
    });

  }

  try{

    const hashedPassword =
      await bcrypt.hash(password,10);

    db.run(

      `
      INSERT INTO users(
        username,
        email,
        password
      )
      VALUES(?,?,?)
      `,

      [
        username,
        email,
        hashedPassword
      ],

      function(err){

        if(err){

          return res.json({
            success:false,
            message:"Username or email already exists"
          });

        }

        res.json({
          success:true
        });

      }

    );

  }catch(err){

    console.log(err);

    res.json({
      success:false,
      message:"Server error"
    });

  }

});

/* LOGIN */

app.post("/login",(req,res)=>{

  const {
    email,
    password
  } = req.body;

  db.get(

    `
    SELECT * FROM users
    WHERE email = ?
    `,

    [email],

    async (err,user)=>{

      if(err || !user){

        return res.json({
          success:false,
          message:"User not found"
        });

      }

      const validPassword =
        await bcrypt.compare(
          password,
          user.password
        );

      if(!validPassword){

        return res.json({
          success:false,
          message:"Wrong password"
        });

      }

      req.session.user = {
        id:user.id,
        username:user.username
      };

      res.json({
        success:true,
        username:user.username
      });

    }

  );

});

/* SOCKETS */

io.on("connection",(socket)=>{

  socket.on("join",(username)=>{

    socket.username = username;

    onlineUsers.push(username);

    io.emit(
      "online users",
      onlineUsers
    );

    io.emit(
      "system message",
      `${username} joined Cheese Lounge 🧀`
    );

  });

  socket.on(
    "chat message",
    (data)=>{

      io.emit(
        "chat message",
        data
      );

    }
  );

  socket.on("disconnect",()=>{

    if(socket.username){

      onlineUsers =
        onlineUsers.filter(
          user =>
            user !== socket.username
        );

      io.emit(
        "online users",
        onlineUsers
      );

      io.emit(
        "system message",
        `${socket.username} left`
      );

    }

  });

});

/* START SERVER */

const PORT =
  process.env.PORT || 3000;

server.listen(PORT,()=>{

  console.log(
    `Server running on port ${PORT}`
  );

});