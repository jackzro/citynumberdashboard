const express = require("express");
const mysql = require("mysql2/promise");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* MySQL pool (LOW RAM) */
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "callee",
  connectionLimit: 5,
});

/* Upload config */
const upload = multer({ dest: "uploads/" });

/* ========== UPLOAD EXCEL ========== */
app.post("/api/upload-excel", upload.single("file"), async (req, res) => {
  const city = req.body.city;
  const filePath = req.file?.path;

  if (!city || !filePath) {
    return res.status(400).json({ error: "city and file required" });
  }

  try {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const values = [];

    for (let i = 1; i < rows.length; i++) {
      const number = rows[i][0];
      const price = rows[i][1];

      if (number != null && price != null) {
        values.push([city, number, price]);
      }
    }

    if (!values.length) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "No valid data" });
    }

    await pool.query(
      "INSERT IGNORE INTO city_numbers (city, number_value, price) VALUES ?",
      [values],
    );

    fs.unlinkSync(filePath);
    res.json({ success: true, inserted: values.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Excel insert failed" });
  }
});

/* ========== ADD SINGLE ========== */
app.post("/api/add-number", async (req, res) => {
  const { city, number, price } = req.body;

  if (!city || !number || price == null) {
    return res.status(400).json({ error: "Invalid input" });
  }

  try {
    await pool.query(
      "INSERT INTO city_numbers (city, number_value, price) VALUES (?, ?, ?)",
      [city, number, price],
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "Number already exists for this city",
      });
    }

    console.error(err);
    res.status(500).json({ error: "Insert failed" });
  }
});

/* ========== GET BY CITY ========== */
app.get("/api/numbers", async (req, res) => {
  const city = req.query.city;
  const page = parseInt(req.query.page || "1");
  const limit = 10;
  const offset = (page - 1) * limit;

  // price sorting
  const sort = req.query.sort === "desc" ? "DESC" : "ASC";

  if (!city) {
    return res.json({ data: [], total: 0 });
  }

  try {
    // get total count
    const [[countRow]] = await pool.query(
      "SELECT COUNT(*) as total FROM city_numbers WHERE city = ?",
      [city],
    );

    // get paginated data
    const [rows] = await pool.query(
      `
      SELECT number_value, price
      FROM city_numbers
      WHERE city = ?
      ORDER BY price ${sort}
      LIMIT ? OFFSET ?
      `,
      [city, limit, offset],
    );

    res.json({
      data: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load data" });
  }
});

app.listen(3000, () => {
  console.log("✅ Server running on port 3000");
});
