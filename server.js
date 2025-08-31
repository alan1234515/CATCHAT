const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000; // Puerto dinámico para Render

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname))); // index.html, login.html, panel.html
app.use(express.static(path.join(__dirname, "public"))); // css/js/img
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // archivos subidos

// Base de datos SQLite (advertencia: en Render no persiste)
let db;
try {
  db = new sqlite3.Database("./db.sqlite", (err) => {
    if (err) console.error("Error al abrir DB:", err);
    else console.log("Base de datos conectada correctamente.");
  });
} catch (err) {
  console.error("Excepción al crear DB:", err);
}

// Crear tablas
db.run(
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    email TEXT UNIQUE,
    contraseña TEXT,
    codigo_verificacion TEXT,
    verificado INTEGER DEFAULT 0
  )`
);
db.run(
  `CREATE TABLE IF NOT EXISTS solicitudes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    de_usuario_id INTEGER,
    a_usuario_id INTEGER,
    estado TEXT DEFAULT 'pendiente',
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(de_usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(a_usuario_id) REFERENCES usuarios(id)
  )`
);
db.run(
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario1_id INTEGER,
    usuario2_id INTEGER,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario1_id) REFERENCES usuarios(id),
    FOREIGN KEY(usuario2_id) REFERENCES usuarios(id)
  )`
);
db.run(
  `CREATE TABLE IF NOT EXISTS mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    de_usuario_id INTEGER,
    mensaje TEXT,
    archivo TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    visto INTEGER DEFAULT 0,
    FOREIGN KEY(de_usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(chat_id) REFERENCES chats(id)
  )`
);

// Nodemailer con Gmail SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "alanlajones24@gmail.com",
    pass: "zmbrgtugxnwxtcma" // contraseña de aplicación
  }
});

// Función para generar código de verificación
function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Multer para subir archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// -------------------- Rutas HTML --------------------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/registrar", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "panel.html")));

// -------------------- Registro --------------------
app.post("/registrar", (req, res) => {
  if (!db) return res.status(500).send("Base de datos no disponible");

  const { nombre, email, contraseña } = req.body;
  if (!nombre || !email || !contraseña) return res.status(400).send("Todos los campos son obligatorios");

  const codigo = generarCodigo();
  const hash = bcrypt.hashSync(contraseña, 10);

  db.run(
    `INSERT INTO usuarios (nombre, email, contraseña, codigo_verificacion) VALUES (?, ?, ?, ?)`,
    [nombre, email, hash, codigo],
    async function (err) {
      if (err) return res.status(400).send("Correo ya registrado");

      const mailOptions = {
        from: "alanlajones24@gmail.com",
        to: email,
        subject: "Verifica tu cuenta",
        text: `Hola ${nombre}, tu código de verificación es: ${codigo}`,
        html: `<p>Hola <b>${nombre}</b>, tu código de verificación es: <b>${codigo}</b></p>`
      };

      try { await transporter.sendMail(mailOptions); } catch (e) { console.error(e); }

      res.json({ message: "Usuario registrado. Verifica tu correo." });
    }
  );
});

// -------------------- Verificación --------------------
app.post("/verificar", (req, res) => {
  const { email, codigo } = req.body;
  db.get(`SELECT * FROM usuarios WHERE email=? AND codigo_verificacion=?`, [email, codigo], (err, row) => {
    if (!row) return res.status(400).json({ error: "Código incorrecto" });
    db.run(`UPDATE usuarios SET verificado=1 WHERE email=?`, [email], (err2) => {
      if (err2) return res.status(500).json({ error: "Error al actualizar usuario" });
      res.json({ message: "Usuario verificado correctamente" });
    });
  });
});

// -------------------- Login --------------------
app.post("/login", (req, res) => {
  const { email, contraseña } = req.body;
  db.get(`SELECT * FROM usuarios WHERE email=?`, [email], (err, row) => {
    if (!row) return res.status(400).json({ error: "Usuario no registrado" });
    const valid = bcrypt.compareSync(contraseña, row.contraseña);
    if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });
    res.json({ message: "Login exitoso", verificado: row.verificado, nombre: row.nombre });
  });
});

// -------------------- Datos del usuario --------------------
app.get("/usuario", (req, res) => {
  const email = req.query.email;
  db.get(`SELECT * FROM usuarios WHERE email=?`, [email], (err, row) => {
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ nombre: row.nombre, email: row.email, verificado: row.verificado });
  });
});

// -------------------- Solicitudes --------------------
app.post("/solicitud", (req, res) => {
  const { deEmail, aEmail } = req.body;
  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, de) => {
    if (!de) return res.status(400).json({ error: "Usuario remitente no encontrado" });
    db.get("SELECT id FROM usuarios WHERE email=?", [aEmail], (err, a) => {
      if (!a) return res.status(400).json({ error: "Usuario destinatario no encontrado" });
      db.get(
        "SELECT * FROM solicitudes WHERE de_usuario_id=? AND a_usuario_id=? AND estado='pendiente'",
        [de.id, a.id],
        (err, row) => {
          if (row) return res.status(400).json({ error: "Ya existe una solicitud pendiente" });
          db.get(
            "SELECT * FROM chats WHERE (usuario1_id=? AND usuario2_id=?) OR (usuario1_id=? AND usuario2_id=?)",
            [de.id, a.id, a.id, de.id],
            (err, chat) => {
              if (chat) return res.status(400).json({ error: "Ya existe un chat con este usuario" });
              db.run("INSERT INTO solicitudes (de_usuario_id, a_usuario_id) VALUES (?,?)", [de.id, a.id], (err) => {
                if (err) return res.status(500).json({ error: "No se pudo enviar solicitud" });
                res.json({ message: "Solicitud enviada" });
              });
            }
          );
        }
      );
    });
  });
});

app.get("/solicitudes", (req, res) => {
  const email = req.query.email;
  db.get("SELECT id FROM usuarios WHERE email=?", [email], (err, user) => {
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });
    db.all(
      "SELECT s.id, u.nombre, u.email FROM solicitudes s JOIN usuarios u ON s.de_usuario_id=u.id WHERE s.a_usuario_id=? AND s.estado='pendiente'",
      [user.id],
      (err, rows) => {
        res.json(rows);
      }
    );
  });
});

app.post("/solicitud/aceptar", (req, res) => {
  const { solicitudId } = req.body;
  db.get("SELECT * FROM solicitudes WHERE id=?", [solicitudId], (err, sol) => {
    if (!sol) return res.status(400).json({ error: "Solicitud no encontrada" });
    db.run("UPDATE solicitudes SET estado='aceptada' WHERE id=?", [solicitudId], (err) => {
      db.get(
        "SELECT * FROM chats WHERE (usuario1_id=? AND usuario2_id=?) OR (usuario1_id=? AND usuario2_id=?)",
        [sol.de_usuario_id, sol.a_usuario_id, sol.a_usuario_id, sol.de_usuario_id],
        (err, chat) => {
          if (chat) return res.json({ message: "Solicitud aceptada (chat ya existía)" });
          db.run("INSERT INTO chats (usuario1_id, usuario2_id) VALUES (?,?)", [sol.de_usuario_id, sol.a_usuario_id], (err) => {
            res.json({ message: "Solicitud aceptada y chat creado" });
          });
        }
      );
    });
  });
});

// -------------------- Chats --------------------
app.get("/chats", (req, res) => {
  const email = req.query.email;
  db.get("SELECT id FROM usuarios WHERE email=?", [email], (err, user) => {
    db.all(
      `SELECT c.id,
              CASE WHEN c.usuario1_id = ? THEN u2.nombre ELSE u1.nombre END AS nombre,
              CASE WHEN c.usuario1_id = ? THEN u2.email ELSE u1.email END AS otroEmail,
              m.mensaje AS ultimoMensaje,
              m.fecha AS fechaUltimoMensaje,
              u.email AS ultimoMensajeDe,
              m.visto AS ultimoVisto,
              (SELECT COUNT(*) FROM mensajes m2 
               WHERE m2.chat_id = c.id 
                 AND m2.de_usuario_id != ? 
                 AND m2.visto = 0) AS cantidadNoLeidos
       FROM chats c
       LEFT JOIN usuarios u1 ON c.usuario1_id = u1.id
       LEFT JOIN usuarios u2 ON c.usuario2_id = u2.id
       LEFT JOIN mensajes m ON m.id = (
           SELECT id FROM mensajes 
           WHERE chat_id = c.id 
           ORDER BY fecha DESC 
           LIMIT 1
       )
       LEFT JOIN usuarios u ON m.de_usuario_id = u.id
       WHERE c.usuario1_id = ? OR c.usuario2_id = ?`,
      [user.id, user.id, user.id, user.id, user.id],
      (err, rows) => {
        res.json(rows);
      }
    );
  });
});

// -------------------- Mensajes --------------------
app.post("/mensaje", (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, user) => {
    db.run("INSERT INTO mensajes (chat_id, de_usuario_id, mensaje) VALUES (?,?,?)", [chatId, user.id, mensaje], (err) => {
      res.json({ message: "Mensaje enviado" });
    });
  });
});

app.post("/mensajeArchivo", upload.single("archivo"), (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  const archivo = req.file ? `/uploads/${req.file.filename}` : null;
  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, user) => {
    db.run(
      "INSERT INTO mensajes (chat_id, de_usuario_id, mensaje, archivo) VALUES (?,?,?,?)",
      [chatId, user.id, mensaje, archivo],
      (err) => {
        res.json({ message: "Mensaje enviado", archivo });
      }
    );
  });
});

app.post("/mensaje/visto", (req, res) => {
  const { chatId, deEmail } = req.body;
  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, user) => {
    db.run("UPDATE mensajes SET visto=1 WHERE chat_id=? AND de_usuario_id=?", [chatId, user.id], (err) => {
      res.json({ message: "Mensajes marcados como vistos" });
    });
  });
});

// -------------------- Limpiar chats duplicados --------------------
app.get("/limpiarChatsDuplicados", (req, res) => {
  db.run(`
    DELETE FROM chats
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM chats
      GROUP BY
        CASE WHEN usuario1_id < usuario2_id THEN usuario1_id ELSE usuario2_id END,
        CASE WHEN usuario1_id < usuario2_id THEN usuario2_id ELSE usuario1_id END
    )
  `, (err) => {
    res.json({ message: "Chats duplicados eliminados" });
  });
});

// -------------------- Iniciar servidor --------------------
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
