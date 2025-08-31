const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000; // Puerto dinámico para Render

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // carpeta pública
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -------------------- PostgreSQL --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://admin:uJGqPEmGBKlZ1eXXQl8GNCMIPLHHjYJs@dpg-d2pss9er433s73dl9qgg-a/mensajes12313411",
  ssl: { rejectUnauthorized: false }
});

// Crear tablas si no existen
async function crearTablas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre TEXT,
      email TEXT UNIQUE NOT NULL,
      contraseña TEXT NOT NULL,
      codigo_verificacion TEXT,
      verificado BOOLEAN DEFAULT false
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes (
      id SERIAL PRIMARY KEY,
      de_usuario_id INTEGER REFERENCES usuarios(id),
      a_usuario_id INTEGER REFERENCES usuarios(id),
      estado TEXT DEFAULT 'pendiente',
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      id SERIAL PRIMARY KEY,
      usuario1_id INTEGER REFERENCES usuarios(id),
      usuario2_id INTEGER REFERENCES usuarios(id),
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id SERIAL PRIMARY KEY,
      chat_id INTEGER REFERENCES chats(id),
      de_usuario_id INTEGER REFERENCES usuarios(id),
      mensaje TEXT,
      archivo TEXT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      visto BOOLEAN DEFAULT false
    )
  `);
}
crearTablas().catch(console.error);

// -------------------- Nodemailer --------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "alanlajones24@gmail.com",
    pass: process.env.EMAIL_PASS || "zmbrgtugxnwxtcma"
  }
});

// -------------------- Funciones --------------------
function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// -------------------- Multer --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// -------------------- Rutas HTML --------------------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/registrar", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "panel.html")));

// -------------------- Registro --------------------
app.post("/registrar", async (req, res) => {
  const { nombre, email, contraseña } = req.body;
  if (!nombre || !email || !contraseña) return res.status(400).send("Todos los campos son obligatorios");

  const codigo = generarCodigo();
  const hash = bcrypt.hashSync(contraseña, 10);

  try {
    await pool.query(
      `INSERT INTO usuarios (nombre, email, contraseña, codigo_verificacion) VALUES ($1,$2,$3,$4)`,
      [nombre, email, hash, codigo]
    );

    const mailOptions = {
      from: process.env.EMAIL_USER || "alanlajones24@gmail.com",
      to: email,
      subject: "Verifica tu cuenta",
      text: `Hola ${nombre}, tu código de verificación es: ${codigo}`,
      html: `<p>Hola <b>${nombre}</b>, tu código de verificación es: <b>${codigo}</b></p>`
    };
    await transporter.sendMail(mailOptions);
    res.json({ message: "Usuario registrado. Verifica tu correo." });

  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Correo ya registrado" });
  }
});

// -------------------- Verificación --------------------
app.post("/verificar", async (req, res) => {
  const { email, codigo } = req.body;
  try {
    const { rows } = await pool.query(`SELECT * FROM usuarios WHERE email=$1 AND codigo_verificacion=$2`, [email, codigo]);
    if (rows.length === 0) return res.status(400).json({ error: "Código incorrecto" });

    await pool.query(`UPDATE usuarios SET verificado=true WHERE email=$1`, [email]);
    res.json({ message: "Usuario verificado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Login --------------------
app.post("/login", async (req, res) => {
  const { email, contraseña } = req.body;
  try {
    const { rows } = await pool.query(`SELECT * FROM usuarios WHERE email=$1`, [email]);
    if (rows.length === 0) return res.status(400).json({ error: "Usuario no registrado" });

    const valid = bcrypt.compareSync(contraseña, rows[0].contraseña);
    if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });

    res.json({ message: "Login exitoso", verificado: rows[0].verificado, nombre: rows[0].nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Datos del usuario --------------------
app.get("/usuario", async (req, res) => {
  const email = req.query.email;
  try {
    const { rows } = await pool.query(`SELECT nombre,email,verificado FROM usuarios WHERE email=$1`, [email]);
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Solicitudes --------------------
app.post("/solicitud", async (req, res) => {
  const { deEmail, aEmail } = req.body;
  try {
    const { rows: deRows } = await pool.query(`SELECT id FROM usuarios WHERE email=$1`, [deEmail]);
    if (deRows.length === 0) return res.status(400).json({ error: "Usuario remitente no encontrado" });
    const { rows: aRows } = await pool.query(`SELECT id FROM usuarios WHERE email=$1`, [aEmail]);
    if (aRows.length === 0) return res.status(400).json({ error: "Usuario destinatario no encontrado" });

    const deId = deRows[0].id, aId = aRows[0].id;

    const { rows: existe } = await pool.query(
      `SELECT * FROM solicitudes WHERE de_usuario_id=$1 AND a_usuario_id=$2 AND estado='pendiente'`,
      [deId, aId]
    );
    if (existe.length > 0) return res.status(400).json({ error: "Ya existe una solicitud pendiente" });

    const { rows: chatExist } = await pool.query(
      `SELECT * FROM chats WHERE (usuario1_id=$1 AND usuario2_id=$2) OR (usuario1_id=$2 AND usuario2_id=$1)`,
      [deId, aId]
    );
    if (chatExist.length > 0) return res.status(400).json({ error: "Ya existe un chat con este usuario" });

    await pool.query(`INSERT INTO solicitudes (de_usuario_id,a_usuario_id) VALUES($1,$2)`, [deId, aId]);
    res.json({ message: "Solicitud enviada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Aceptar solicitud --------------------
app.post("/solicitud/aceptar", async (req, res) => {
  const { solicitudId } = req.body;
  try {
    const { rows: solRows } = await pool.query(`SELECT * FROM solicitudes WHERE id=$1`, [solicitudId]);
    if (solRows.length === 0) return res.status(400).json({ error: "Solicitud no encontrada" });
    const sol = solRows[0];

    await pool.query(`UPDATE solicitudes SET estado='aceptada' WHERE id=$1`, [solicitudId]);

    const { rows: chatExist } = await pool.query(
      `SELECT * FROM chats WHERE (usuario1_id=$1 AND usuario2_id=$2) OR (usuario1_id=$2 AND usuario2_id=$1)`,
      [sol.de_usuario_id, sol.a_usuario_id]
    );
    if (chatExist.length > 0) return res.json({ message: "Solicitud aceptada (chat ya existía)" });

    await pool.query(`INSERT INTO chats (usuario1_id, usuario2_id) VALUES ($1,$2)`, [sol.de_usuario_id, sol.a_usuario_id]);
    res.json({ message: "Solicitud aceptada y chat creado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Chats y mensajes --------------------
app.post("/mensaje", async (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  try {
    const { rows } = await pool.query(`SELECT id FROM usuarios WHERE email=$1`, [deEmail]);
    if (rows.length === 0) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query(`INSERT INTO mensajes (chat_id,de_usuario_id,mensaje) VALUES ($1,$2,$3)`, [chatId, rows[0].id, mensaje]);
    res.json({ message: "Mensaje enviado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

app.post("/mensajeArchivo", upload.single("archivo"), async (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  const archivo = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const { rows } = await pool.query(`SELECT id FROM usuarios WHERE email=$1`, [deEmail]);
    if (rows.length === 0) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query(`INSERT INTO mensajes (chat_id,de_usuario_id,mensaje,archivo) VALUES ($1,$2,$3,$4)`, [chatId, rows[0].id, mensaje, archivo]);
    res.json({ message: "Mensaje enviado", archivo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

app.get("/mensajes", async (req, res) => {
  const { chatId } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT m.mensaje,m.archivo,m.fecha,m.visto,u.nombre,u.email
      FROM mensajes m
      JOIN usuarios u ON m.de_usuario_id=u.id
      WHERE chat_id=$1
      ORDER BY fecha ASC
    `, [chatId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

app.post("/mensaje/visto", async (req, res) => {
  const { chatId, deEmail } = req.body;
  try {
    const { rows } = await pool.query(`SELECT id FROM usuarios WHERE email=$1`, [deEmail]);
    if (rows.length === 0) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query(`UPDATE mensajes SET visto=true WHERE chat_id=$1 AND de_usuario_id=$2`, [chatId, rows[0].id]);
    res.json({ message: "Mensajes marcados como vistos" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

app.get("/limpiarChatsDuplicados", async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM chats
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM chats
        GROUP BY LEAST(usuario1_id,usuario2_id), GREATEST(usuario1_id,usuario2_id)
      )
    `);
    res.json({ message: "Chats duplicados eliminados" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error limpiando chats" });
  }
});

// -------------------- Servidor --------------------
app.listen(PORT, () => {
  console.log(`Servidor corriendo en Render en el puerto ${PORT}`);
});
