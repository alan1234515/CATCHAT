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

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "public"))); // css/js/img
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -------------------- Conexión PostgreSQL --------------------
const pool = new Pool({
  connectionString: "postgresql://admin:uJGqPEmGBKlZ1eXXQl8GNCMIPLHHjYJs@dpg-d2pss9er433s73dl9qgg-a/mensajes12313411",
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("Conectado a PostgreSQL"))
  .catch((err) => console.error("Error al conectar PostgreSQL:", err));

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
        verificado INTEGER DEFAULT 0
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
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});
const upload = multer({ storage: storage });

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
    const result = await pool.query(
      "INSERT INTO usuarios (nombre, email, contraseña, codigo_verificacion) VALUES ($1,$2,$3,$4) RETURNING id",
      [nombre, email, hash, codigo]
    );

    const mailOptions = {
      from: "alanlajones24@gmail.com",
      to: email,
      subject: "Verifica tu cuenta",
      text: `Hola ${nombre}, tu código de verificación es: ${codigo}`,
      html: `<p>Hola <b>${nombre}</b>,</p><p>Tu código de verificación es: <b>${codigo}</b></p>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`Correo enviado a ${email}`);
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
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE email=$1 AND codigo_verificacion=$2",
      [email, codigo]
    );
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: "Código incorrecto" });

    await pool.query("UPDATE usuarios SET verificado=1 WHERE email=$1", [email]);
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
    if (chat) return res.json({ message: "✅ Solicitud aceptada (chat ya existía)" });

    await pool.query("INSERT INTO chats (usuario1_id, usuario2_id) VALUES ($1,$2)", [sol.de_usuario_id, sol.a_usuario_id]);
    res.json({ message: "✅ Solicitud aceptada y chat creado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error DB" });
  }
});

// -------------------- Mensajes --------------------
app.post("/mensaje", async (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [deEmail])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query(
      "INSERT INTO mensajes (chat_id, de_usuario_id, mensaje) VALUES ($1,$2,$3)",
      [chatId, user.id, mensaje]
    );
    res.json({ message: "✅ Mensaje enviado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error DB" });
  }
});

app.post("/mensajeArchivo", upload.single("archivo"), async (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  const archivo = req.file ? `/uploads/${req.file.filename}` : null;
  if (!mensaje && !archivo) return res.status(400).json({ error: "Mensaje o archivo requerido" });

  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [deEmail])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    await pool.query(
      "INSERT INTO mensajes (chat_id, de_usuario_id, mensaje, archivo) VALUES ($1,$2,$3,$4)",
      [chatId, user.id, mensaje, archivo]
    );
    res.json({ message: "✅ Mensaje enviado", archivo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error DB" });
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
    res.status(500).json({ error: "Error DB" });
  }
});

// -------------------- Obtener chats --------------------
app.get("/chats", async (req, res) => {
  const email = req.query.email;
  try {
    const user = (await pool.query("SELECT id FROM usuarios WHERE email=$1", [email])).rows[0];
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    const result = await pool.query(`
      SELECT c.id,
             CASE WHEN c.usuario1_id=$1 THEN u2.nombre ELSE u1.nombre END AS nombre,
             CASE WHEN c.usuario1_id=$1 THEN u2.email ELSE u1.email END AS otroEmail,
             m.mensaje AS ultimoMensaje,
             m.fecha AS fechaUltimoMensaje,
             u.email AS ultimoMensajeDe,
             m.visto AS ultimoVisto,
             (SELECT COUNT(*) FROM mensajes m2 WHERE m2.chat_id=c.id AND m2.de_usuario_id!=$1 AND m2.visto=FALSE) AS cantidadNoLeidos
      FROM chats c
      LEFT JOIN usuarios u1 ON c.usuario1_id=u1.id
      LEFT JOIN usuarios u2 ON c.usuario2_id=u2.id
      LEFT JOIN mensajes m ON m.id = (
        SELECT id FROM mensajes WHERE chat_id=c.id ORDER BY fecha DESC LIMIT 1
      )
      LEFT JOIN usuarios u ON m.de_usuario_id=u.id
      WHERE c.usuario1_id=$1 OR c.usuario2_id=$1
    `, [user.id]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error DB" });
  }
});

// -------------------- Login --------------------
app.post("/login", async (req, res) => {
  const { email, contraseña } = req.body;
  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE email=$1", [email]);
    const row = result.rows[0];
    if (!row) return res.status(400).json({ error: "Usuario no registrado" });

    const valid = bcrypt.compareSync(contraseña, row.contraseña);
    if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });

    res.json({ message: "✅ Login exitoso", verificado: row.verificado, nombre: row.nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error DB" });
  }
});

// -------------------- Datos del usuario --------------------
app.get("/usuario", async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Email requerido" });

  try {
    const row = (await pool.query("SELECT * FROM usuarios WHERE email=$1", [email])).rows[0];
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({ nombre: row.nombre, email: row.email, verificado: row.verificado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error DB" });
  }
});

// -------------------- Limpiar chats duplicados --------------------
app.get("/limpiarChatsDuplicados", async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM chats
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM chats
        GROUP BY LEAST(usuario1_id, usuario2_id), GREATEST(usuario1_id, usuario2_id)
      )
    `);
    res.json({ message: "Chats duplicados eliminados" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error limpiando chats" });
  }
});

// -------------------- Iniciar servidor --------------------
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
