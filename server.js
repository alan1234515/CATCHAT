const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 1000;

// -------------------- Middleware --------------------
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -------------------- Conexión PostgreSQL --------------------
const pool = new Pool({
  connectionString: "postgresql://admin:uJGqPEmGBKlZ1eXXQl8GNCMIPLHHjYJs@dpg-d2pss9er433s73dl9qgg-a/mensajes12313411",
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("Conectado a PostgreSQL"))
  .catch(err => console.error("Error al conectar PostgreSQL:", err));

// -------------------- Crear tablas si no existen --------------------
async function crearTablas() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre TEXT,
        email TEXT UNIQUE,
        contraseña TEXT,
        codigo_verificacion TEXT,
        verificado BOOLEAN DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS solicitudes (
        id SERIAL PRIMARY KEY,
        de_usuario_id INTEGER REFERENCES usuarios(id),
        a_usuario_id INTEGER REFERENCES usuarios(id),
        estado TEXT DEFAULT 'pendiente',
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        usuario1_id INTEGER REFERENCES usuarios(id),
        usuario2_id INTEGER REFERENCES usuarios(id),
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS mensajes (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES chats(id),
        de_usuario_id INTEGER REFERENCES usuarios(id),
        mensaje TEXT,
        archivo TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        visto BOOLEAN DEFAULT FALSE
      );
    `);
    console.log("Tablas creadas correctamente (si no existían)");
  } catch (err) {
    console.error("Error creando tablas:", err);
  }
}
crearTablas();

// -------------------- Nodemailer --------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "alanlajones24@gmail.com",
    pass: "zmbrgtugxnwxtcma"
  }
});

// Generar código aleatorio de 6 dígitos
function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// -------------------- Multer --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// -------------------- Rutas principales --------------------
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
      "INSERT INTO usuarios (nombre, email, contraseña, codigo_verificacion) VALUES ($1,$2,$3,$4)",
      [nombre, email, hash, codigo]
    );

    await transporter.sendMail({
      from: "alanlajones24@gmail.com",
      to: email,
      subject: "Verifica tu cuenta",
      text: `Hola ${nombre}, tu código de verificación es: ${codigo}`,
      html: `<p>Hola <b>${nombre}</b>,</p><p>Tu código de verificación es: <b>${codigo}</b></p>`
    });

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(400).send("Correo ya registrado o error en la DB");
  }
});

// -------------------- Verificación --------------------
app.post("/verificar", async (req, res) => {
  const { email, codigo } = req.body;
  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE email=$1 AND codigo_verificacion=$2", [email, codigo]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: "Código incorrecto" });

    await pool.query("UPDATE usuarios SET verificado=TRUE WHERE email=$1", [email]);
    res.json({ message: "✅ Usuario verificado correctamente" });
  } catch (err) {
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Solicitudes --------------------
app.post("/solicitud", async (req, res) => {
  const { deEmail, aEmail } = req.body;
  try {
    const de = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [deEmail])).rows[0];
    const a = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [aEmail])).rows[0];
    if (!de || !a) return res.status(400).json({ error: "Usuario no encontrado" });

    const existing = (await pool.query(
      "SELECT * FROM solicitudes WHERE de_usuario_id=$1 AND a_usuario_id=$2 AND estado='pendiente'",
      [de.id, a.id]
    )).rows[0];
    if (existing) return res.status(400).json({ error: "Ya existe solicitud pendiente" });

    const chatExists = (await pool.query(
      "SELECT * FROM chats WHERE (usuario1_id=$1 AND usuario2_id=$2) OR (usuario1_id=$2 AND usuario2_id=$1)",
      [de.id, a.id]
    )).rows[0];
    if (chatExists) return res.status(400).json({ error: "Ya existe un chat con este usuario" });

    await pool.query("INSERT INTO solicitudes (de_usuario_id,a_usuario_id) VALUES ($1,$2)", [de.id, a.id]);
    res.json({ message: "✅ Solicitud enviada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en la DB" });
  }
});

app.get("/solicitudes", async (req, res) => {
  const email = req.query.email;
  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [email])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    const rows = (await pool.query(
      `SELECT s.id, u.nombre, u.email 
       FROM solicitudes s 
       JOIN usuarios u ON s.de_usuario_id=u.id 
       WHERE s.a_usuario_id=$1 AND s.estado='pendiente'`,
      [user.id]
    )).rows;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error DB" });
  }
});

app.post("/solicitud/aceptar", async (req, res) => {
  const { solicitudId } = req.body;
  try {
    const sol = (await pool.query("SELECT * FROM solicitudes WHERE id=$1", [solicitudId])).rows[0];
    if (!sol) return res.status(400).json({ error: "Solicitud no encontrada" });

    await pool.query("UPDATE solicitudes SET estado='aceptada' WHERE id=$1", [solicitudId]);

    const chat = (await pool.query(
      "SELECT * FROM chats WHERE (usuario1_id=$1 AND usuario2_id=$2) OR (usuario1_id=$2 AND usuario2_id=$1)",
      [sol.de_usuario_id, sol.a_usuario_id]
    )).rows[0];

    let chatId;
    if (!chat) {
      const nuevoChat = await pool.query(
        "INSERT INTO chats (usuario1_id, usuario2_id) VALUES ($1,$2) RETURNING id",
        [sol.de_usuario_id, sol.a_usuario_id]
      );
      chatId = nuevoChat.rows[0].id;
    } else {
      chatId = chat.id;
    }

    const chatInfo = await pool.query(
      `SELECT c.id AS chat_id, u1.nombre AS usuario1, u1.email AS email1,
              u2.nombre AS usuario2, u2.email AS email2
       FROM chats c
       JOIN usuarios u1 ON c.usuario1_id=u1.id
       JOIN usuarios u2 ON c.usuario2_id=u2.id
       WHERE c.id=$1`,
      [chatId]
    );

    res.json({ message: "✅ Solicitud aceptada y chat listo", chat: chatInfo.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "No se pudo aceptar la solicitud" });
  }
});

// -------------------- Mensajes --------------------
app.post("/mensaje", async (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [deEmail])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query("INSERT INTO mensajes (chat_id,de_usuario_id,mensaje) VALUES ($1,$2,$3)", [chatId, user.id, mensaje]);
    res.json({ message: "✅ Mensaje enviado" });
  } catch (err) {
    res.status(500).json({ error: "No se pudo enviar mensaje" });
  }
});

app.post("/mensajeArchivo", upload.single("archivo"), async (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  const archivo = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [deEmail])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query("INSERT INTO mensajes (chat_id,de_usuario_id,mensaje,archivo) VALUES ($1,$2,$3,$4)", [chatId, user.id, mensaje, archivo]);
    res.json({ message: "✅ Mensaje con archivo enviado" });
  } catch (err) {
    res.status(500).json({ error: "Error al enviar archivo" });
  }
});

app.post("/mensaje/visto", async (req, res) => {
  const { chatId, deEmail } = req.body;
  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [deEmail])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query("UPDATE mensajes SET visto=TRUE WHERE chat_id=$1 AND de_usuario_id=$2", [chatId, user.id]);
    res.json({ message: "Mensajes marcados como vistos" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al marcar vistos" });
  }
});

// -------------------- Obtener chats --------------------
app.get("/chats", async (req, res) => {
  const email = req.query.email;
  try {
    const query = `
      SELECT c.id,
             CASE WHEN c.usuario1_email = $1 THEN c.usuario2_nombre ELSE c.usuario1_nombre END AS nombre,
             CASE WHEN c.usuario1_email = $1 THEN c.usuario2_email ELSE c.usuario1_email END AS email,
             m.mensaje AS "ultimoMensaje",
             m.fecha AS "fechaUltimoMensaje",
             COALESCE(unread.cantidad, 0) AS "cantidadNoLeidos"
      FROM chats c
      LEFT JOIN LATERAL (
          SELECT mensaje, fecha
          FROM mensajes
          WHERE chat_id = c.id
          ORDER BY fecha DESC
          LIMIT 1
      ) m ON true
      LEFT JOIN LATERAL (
          SELECT COUNT(*) AS cantidad
          FROM mensajes
          WHERE chat_id = c.id AND de_email != $1 AND visto = false
      ) unread ON true
      WHERE c.usuario1_email = $1 OR c.usuario2_email = $1
      ORDER BY m.fecha DESC;
    `;
    const { rows } = await pool.query(query, [email]);
    res.json(rows);
  } catch (err) {
    console.error("Error al cargar chats:", err);
    res.status(500).json({ error: "Error al cargar chats" });
  }
});

// -------------------- Obtener mensajes de un chat --------------------
app.get("/mensajes", async (req, res) => {
  const { chatId } = req.query;
  try {
    const rows = (await pool.query(
      `SELECT m.id, m.mensaje, m.archivo, m.fecha, u.nombre, u.email, m.visto
       FROM mensajes m
       JOIN usuarios u ON m.de_usuario_id=u.id
       WHERE m.chat_id=$1 ORDER BY m.fecha ASC`,
      [chatId]
    )).rows;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al cargar mensajes" });
  }
});

// -------------------- Login --------------------
app.post("/login", async (req, res) => {
  const { email, contraseña } = req.body;
  try {
    const user = (await pool.query("SELECT * FROM usuarios WHERE email=$1", [email])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    if (!bcrypt.compareSync(contraseña, user.contraseña)) return res.status(400).json({ error: "Contraseña incorrecta" });

    res.json({ message: "✅ Login correcto", email: user.email, nombre: user.nombre, verificado: user.verificado });
  } catch (err) {
    res.status(500).json({ error: "Error login" });
  }
});

// -------------------- Datos del usuario --------------------
app.get("/usuario", async (req, res) => {
  const email = req.query.email;
  try {
    const row = (await pool.query("SELECT * FROM usuarios WHERE email=$1", [email])).rows[0];
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ nombre: row.nombre, email: row.email, verificado: row.verificado });
  } catch (err) {
    res.status(500).json({ error: "Error en la base de datos" });
  }
});

// -------------------- Servidor --------------------
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
