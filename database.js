const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database(
  "./users.db",
  (err)=>{

    if(err){

      console.log(err);

    }else{

      console.log(
        "Connected to SQLite database"
      );

    }

  }
);

db.run(`
  CREATE TABLE IF NOT EXISTS users(

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    username TEXT UNIQUE,

    email TEXT UNIQUE,

    password TEXT

  )
`);

module.exports = db;