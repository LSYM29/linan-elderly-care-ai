const mysql = require("mysql2/promise");

const database = require("./src/database-config").databaseName();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "+08:00",
  dateStrings: true,
});

// 统一会话时区，确保 SQL 时间、草稿有效期和时间展示均使用北京时间。
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'");
});
module.exports = pool;
