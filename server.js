const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos (index, login, panel)
app.use(express.static(path.join(__dirname)));

// Base de datos SQLite
let db;
try {
  db = new sqlite3.Database("./db.sqlite", (err) => {
    if (err) console.error("Error al abrir DB:", err);
    else console.log("Base de datos conectada correctamente.");
  });
} catch (err) {
  console.error("Excepción al crear DB:", err);
}

// Crear tabla usuarios
db.run(
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    email TEXT UNIQUE,
    contraseña TEXT,
    codigo_verificacion TEXT,
    verificado INTEGER DEFAULT 0
  )`,
  (err) => {
    if (err) console.error("Error creando tabla usuarios:", err);
    else console.log("Tabla usuarios lista.");
  }
);
// Tabla de solicitudes
db.run(
  `CREATE TABLE IF NOT EXISTS solicitudes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    de_usuario_id INTEGER,
    a_usuario_id INTEGER,
    estado TEXT DEFAULT 'pendiente',
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(de_usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(a_usuario_id) REFERENCES usuarios(id)
  )`,
  (err) => {
    if (err) console.error("Error creando tabla solicitudes:", err);
    else console.log("Tabla solicitudes lista.");
  }
);

// Tabla de chats
db.run(
  `CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario1_id INTEGER,
    usuario2_id INTEGER,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario1_id) REFERENCES usuarios(id),
    FOREIGN KEY(usuario2_id) REFERENCES usuarios(id)
  )`,
  (err) => {
    if (err) console.error("Error creando tabla chats:", err);
    else console.log("Tabla chats lista.");
  }
);

// Tabla de mensajes
db.run(
  `CREATE TABLE IF NOT EXISTS mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    de_usuario_id INTEGER,
    mensaje TEXT,
    archivo TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(de_usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(chat_id) REFERENCES chats(id)
  )`
);

// Nodemailer con Gmail SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "alanlajones24@gmail.com",
    pass: "zmbrgtugxnwxtcma" // tu contraseña de aplicación
  }
});

// Generar código aleatorio de 6 dígitos
function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const multer = require("multer");

// Configuración de almacenamiento
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // carpeta donde se guardan archivos
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Rutas principales primero
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html"))); // Login como principal
app.get("/registrar", (req, res) => res.sendFile(path.join(__dirname, "index.html"))); // Registro
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "panel.html"))); // Panel

// Servir archivos estáticos (css, js, imágenes) desde una carpeta específica
app.use(express.static(path.join(__dirname, "public"))); // Mueve css/js/img aquí
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // Archivos subidos


// -------------------- Registro --------------------
// -------------------- Registro --------------------
app.post("/registrar", (req, res) => {
  if (!db) return res.status(500).send("Base de datos no disponible");

  const { nombre, email, contraseña } = req.body;

  if (!nombre || !email || !contraseña) {
    return res.status(400).send("Todos los campos son obligatorios");
  }

  const codigo = generarCodigo();
  const hash = bcrypt.hashSync(contraseña, 10);

  db.run(
    `INSERT INTO usuarios (nombre, email, contraseña, codigo_verificacion) VALUES (?, ?, ?, ?)`,
    [nombre, email, hash, codigo],
    async function (err) {
      if (err) {
        console.error("Error insertando usuario:", err);
        return res.status(400).send("Correo ya registrado");
      }

      const mailOptions = {
        from: "alanlajones24@gmail.com",
        to: email,
        subject: "Verifica tu cuenta",
        text: `Hola ${nombre},\n\nTu código de verificación es: ${codigo}\n\nGracias por registrarte.`,
        html: `<p>Hola <b>${nombre}</b>,</p>
               <p>Tu código de verificación es: <b>${codigo}</b></p>
               <p>Gracias por registrarte en nuestro sitio.</p>`
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`Correo enviado a ${email}`);
      } catch (error) {
        console.error("Error al enviar correo:", error);
      }

      // Redirigir a login.html después del registro
      res.redirect("/"); // "/" apunta a tu login.html según tu ruta principal
    }
  );
});

// -------------------- Verificación --------------------
app.post("/verificar", (req, res) => {
  if (!db) return res.status(500).json({ error: "Base de datos no disponible" });

  const { email, codigo } = req.body;

  db.get(
    `SELECT * FROM usuarios WHERE email = ? AND codigo_verificacion = ?`,
    [email, codigo],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Error en la base de datos" });
      if (!row) return res.status(400).json({ error: "Código incorrecto" });

      db.run(
        `UPDATE usuarios SET verificado = 1 WHERE email = ?`,
        [email],
        (err2) => {
          if (err2) return res.status(500).json({ error: "Error al actualizar usuario" });
          res.json({ message: "✅ Usuario verificado correctamente" });
        }
      );
    }
  );
});
// Enviar solicitud a otro usuario
app.post("/solicitud", (req, res) => {
  const { deEmail, aEmail } = req.body;

  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, de) => {
    if(err || !de) return res.status(400).json({ error: "Usuario remitente no encontrado" });

    db.get("SELECT id FROM usuarios WHERE email=?", [aEmail], (err, a) => {
      if(err || !a) return res.status(400).json({ error: "Usuario destinatario no encontrado" });

      // Verificar si ya existe solicitud pendiente
      db.get(
        "SELECT * FROM solicitudes WHERE de_usuario_id=? AND a_usuario_id=? AND estado='pendiente'",
        [de.id, a.id],
        (err, row) => {
          if (row) return res.status(400).json({ error: "Ya existe una solicitud pendiente a este usuario" });

          // Verificar si ya existe chat entre ambos usuarios
          db.get(
            "SELECT * FROM chats WHERE (usuario1_id=? AND usuario2_id=?) OR (usuario1_id=? AND usuario2_id=?)",
            [de.id, a.id, a.id, de.id],
            (err, chat) => {
              if(chat) return res.status(400).json({ error: "Ya existe un chat con este usuario" });

              db.run("INSERT INTO solicitudes (de_usuario_id, a_usuario_id) VALUES (?,?)", [de.id, a.id], (err) => {
                if(err) return res.status(500).json({ error: "No se pudo enviar solicitud" });
                res.json({ message: "✅ Solicitud enviada" });
              });
            }
          );
        }
      );
    });
  });
});

// Listar solicitudes pendientes de un usuario
app.get("/solicitudes", (req, res) => {
  const email = req.query.email;
  db.get("SELECT id FROM usuarios WHERE email=?", [email], (err, user) => {
    if(err || !user) return res.status(400).json({ error: "Usuario no encontrado" });
    db.all(
      "SELECT s.id, u.nombre, u.email FROM solicitudes s JOIN usuarios u ON s.de_usuario_id=u.id WHERE s.a_usuario_id=? AND s.estado='pendiente'",
      [user.id],
      (err, rows) => {
        if(err) return res.status(500).json({ error: "Error DB" });
        res.json(rows);
      }
    );
  });
});

// Aceptar solicitud y crear chat
app.post("/solicitud/aceptar", (req, res) => {
  const { solicitudId } = req.body;
  db.get("SELECT * FROM solicitudes WHERE id=?", [solicitudId], (err, sol) => {
    if(err || !sol) return res.status(400).json({ error: "Solicitud no encontrada" });

    db.run("UPDATE solicitudes SET estado='aceptada' WHERE id=?", [solicitudId], (err) => {
      if(err) return res.status(500).json({ error: "No se pudo aceptar" });

      // Verificar si ya existe chat
      db.get(
        "SELECT * FROM chats WHERE (usuario1_id=? AND usuario2_id=?) OR (usuario1_id=? AND usuario2_id=?)",
        [sol.de_usuario_id, sol.a_usuario_id, sol.a_usuario_id, sol.de_usuario_id],
        (err, chat) => {
          if(chat) return res.json({ message: "✅ Solicitud aceptada (chat ya existía)" });

          db.run("INSERT INTO chats (usuario1_id, usuario2_id) VALUES (?,?)", [sol.de_usuario_id, sol.a_usuario_id], (err) => {
            if(err) return res.status(500).json({ error: "No se pudo crear chat" });
            res.json({ message: "✅ Solicitud aceptada y chat creado" });
          });
        }
      );
    });
  });
});

// Enviar mensaje
app.post("/mensaje", (req, res) => {
  const { chatId, deEmail, mensaje } = req.body;
  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, user) => {
    if(err || !user) return res.status(400).json({ error: "Usuario no encontrado" });
    db.run("INSERT INTO mensajes (chat_id, de_usuario_id, mensaje) VALUES (?,?,?)", [chatId, user.id, mensaje], (err) => {
      if(err) return res.status(500).json({ error: "No se pudo enviar mensaje" });
      res.json({ message: "✅ Mensaje enviado" });
    });
  });
});

// Obtener mensajes de un chat
app.get("/mensajes", (req, res) => {
  const { chatId } = req.query;
  db.all(
    "SELECT m.mensaje, m.archivo, m.fecha, u.nombre, u.email, m.visto FROM mensajes m JOIN usuarios u ON m.de_usuario_id = u.id WHERE chat_id=? ORDER BY fecha ASC",
    [chatId],
    (err, rows) => {
      if(err) return res.status(500).json({ error: "Error DB" });
      res.json(rows);
    }
  );
});


// Obtener todos los chats de un usuario
// Obtener todos los chats de un usuario con cantidad de mensajes no leídos y último mensaje
app.get("/chats", (req, res) => {
  const email = req.query.email;

  db.get("SELECT id FROM usuarios WHERE email=?", [email], (err, user) => {
    if (err || !user) return res.status(400).json({ error: "Usuario no encontrado" });

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
        if (err) return res.status(500).json({ error: "Error al traer chats" });
        res.json(rows);
      }
    );
  });
});


app.post("/mensajeArchivo", upload.single("archivo"), (req, res) => {
  const { chatId, deEmail, mensaje } = req.body; // Ahora Multer procesa los campos
  const archivo = req.file ? `/uploads/${req.file.filename}` : null;

  if (!mensaje && !archivo) return res.status(400).json({ error: "Mensaje o archivo requerido" });

  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, user) => {
    if(err || !user) return res.status(400).json({ error: "Usuario no encontrado" });

    db.run(
      "INSERT INTO mensajes (chat_id, de_usuario_id, mensaje, archivo) VALUES (?,?,?,?)",
      [chatId, user.id, mensaje, archivo],
      (err) => {
        if(err) return res.status(500).json({ error: "No se pudo enviar mensaje" });
        res.json({ message: "✅ Mensaje enviado", archivo });
      }
    );
  });
});
app.post("/mensaje/visto", (req, res) => {
  const { chatId, deEmail } = req.body;

  db.get("SELECT id FROM usuarios WHERE email=?", [deEmail], (err, user) => {
    if(err || !user) return res.status(400).json({ error: "Usuario no encontrado" });

    db.run(
      "UPDATE mensajes SET visto = 1 WHERE chat_id = ? AND de_usuario_id = ?",
      [chatId, user.id],
      (err) => {
        if(err) return res.status(500).json({ error: "No se pudo actualizar visto" });
        res.json({ message: "Mensajes marcados como vistos" });
      }
    );
  });
});

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
    if(err) return res.status(500).json({error:"Error limpiando chats"});
    res.json({message:"Chats duplicados eliminados"});
  });
});

// -------------------- Login --------------------
app.post("/login", (req, res) => {
  if (!db) return res.status(500).json({ error: "Base de datos no disponible" });

  const { email, contraseña } = req.body;

  db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], (err, row) => {
    if (err) return res.status(500).json({ error: "Error en la base de datos" });
    if (!row) return res.status(400).json({ error: "Usuario no registrado" });

    const valid = bcrypt.compareSync(contraseña, row.contraseña);
    if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });

    res.json({ message: "✅ Login exitoso", verificado: row.verificado, nombre: row.nombre });
  });
});

// -------------------- Datos del usuario --------------------
app.get("/usuario", (req, res) => {
  if (!db) return res.status(500).json({ error: "Base de datos no disponible" });
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Email es requerido" });

  db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], (err, row) => {
    if (err) return res.status(500).json({ error: "Error en la base de datos" });
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({ nombre: row.nombre, email: row.email, verificado: row.verificado });
  });
});

// -------------------- Iniciar servidor --------------------
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
