require("dotenv").config();
const express = require("express");
const mysql = require("mysql");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());

// 🔹 เชื่อมต่อฐานข้อมูล
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000
});

db.connect((err) => {
    if (err) {
        console.error("❌ Database connection failed:", err);
    } else {
        console.log("✅ Connected to MySQL database");
    }
});

// 🔹 Route แสดงหน้าหลัก
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

// 🔹 API รับข้อมูลจาก Sensor และบันทึกลงฐานข้อมูล
app.post("/api/data", (req, res) => {
    const { decoded_payload } = req.body.uplink_message || {};
    
    if (!decoded_payload || !decoded_payload.bytes || decoded_payload.bytes.length < 4) {
        return res.status(400).json({ message: "Invalid data format" });
    }

    const [temperature, humidity, light, greenhouse_id] = decoded_payload.bytes;
    
    const sql = "INSERT INTO sensor_data (temperature, humidity, light, greenhouse_id) VALUES (?, ?, ?, ?)";
    db.query(sql, [temperature, humidity, light, greenhouse_id], (err, result) => {
        if (err) {
            console.error("❌ Error inserting data:", err);
            return res.status(500).json({ message: "Database error", error: err });
        }

        console.log(`✅ New data for Greenhouse ${greenhouse_id}:`, { temperature, humidity, light });

        // ✅ ดึงข้อมูลล่าสุดของโรงเรือนนั้น
        db.query("SELECT * FROM sensor_data WHERE greenhouse_id = ? ORDER BY id DESC LIMIT 1", [greenhouse_id], (err, latestData) => {
            if (!err && latestData.length > 0) {
                io.emit("newData", {
                    temperature: latestData[0].temperature,
                    humidity: latestData[0].humidity,
                    light: latestData[0].light,
                    greenhouse_id: parseInt(latestData[0].greenhouse_id) // ✅ ส่งเป็นตัวเลขแน่ๆ
                });
                console.log("📡 Emitting real-time data:", latestData[0]);
            }
        });

        res.status(200).json({ message: "Data received and stored", data: { temperature, humidity, light, greenhouse_id } });
    });
});

// 🔹 WebSocket: เมื่อ Client เชื่อมต่อ
io.on("connection", (socket) => {
    console.log("🟢 Client connected:", socket.id);

    // ส่งรายการโรงเรือนทั้งหมดให้ Client
    db.query("SELECT DISTINCT greenhouse_id FROM sensor_data", (err, greenhouses) => {
        if (!err) {
            const greenhouseList = greenhouses.map(g => g.greenhouse_id);
            socket.emit("greenhouseList", greenhouseList);
        }
    });

    // 📌 รับคำขอข้อมูลย้อนหลังจากไคลเอนต์
    socket.on("requestHistoricalData", (greenhouse_id) => {
        console.log(`🔄 Fetching historical data for Greenhouse ${greenhouse_id}`);

        const sql = "SELECT * FROM sensor_data WHERE greenhouse_id = ? ORDER BY id DESC LIMIT 10";
        db.query(sql, [greenhouse_id], (err, results) => {
            if (!err) {
                socket.emit("historicalData", results.reverse()); // เรียงจากเก่าไปใหม่
                console.log("📜 Sent historical data:", results);
            }
        });
    });

    socket.on("disconnect", () => {
        console.log("🔴 Client disconnected:", socket.id);
    });
});

// 🔹 Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
