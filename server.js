require("dotenv").config();

const express = require("express");
const path = require("path");
const sql = require("mssql/msnodesqlv8");

const app = express();
const port = Number(process.env.PORT || 3000);
const services = {
  "Corte y peinado": 125157,
  Coloración: 268193,
  Manicura: 89398
};

const requiredConfig = ["DB_SERVER", "DB_NAME"];
const missingConfig = requiredConfig.filter(name => !process.env[name]);
if (missingConfig.length) {
  console.error(`Faltan variables de entorno: ${missingConfig.join(", ")}. Copia .env.example a .env y complétalo.`);
  process.exit(1);
}

const useSqlAuth = Boolean(process.env.DB_USER && process.env.DB_PASSWORD);
const dbConfig = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  driver: process.env.DB_ODBC_DRIVER || "ODBC Driver 18 for SQL Server",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    instanceName: process.env.DB_INSTANCE,
    trustedConnection: process.env.DB_TRUSTED_CONNECTION !== "false" && !useSqlAuth,
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
    encrypt: process.env.DB_ENCRYPT === "true",
    useUTC: false
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

if (useSqlAuth) {
  console.log("Usando autenticación SQL para SQL Server");
} else {
  console.log("Usando autenticación integrada de Windows para SQL Server");
}

let poolPromise;
function getPool() {
  if (!poolPromise) {
    if (process.env.SQLSERVER_ADAPTER_MODULE) {
      poolPromise = Promise.resolve(require(process.env.SQLSERVER_ADAPTER_MODULE).createPool(dbConfig));
    } else {
      poolPromise = new sql.ConnectionPool(dbConfig).connect();
    }
  }
  return poolPromise;
}

async function runQuery(statement, parameters = {}) {
  const pool = await getPool();
  if (process.env.SQLSERVER_ADAPTER_MODULE) {
    return pool.query(statement, parameters);
  }
  const request = pool.request();
  for (const [name, value] of Object.entries(parameters)) request.input(name, value);
  return request.query(statement);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin", (request, response) => {
  response.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/health", async (request, response) => {
  try {
    await runQuery("SELECT 1 AS ok");
    response.json({ ok: true });
  } catch (error) {
    console.error("SQL Server health check failed:", error.code || error.message);
    response.status(503).json({ ok: false, message: "No hay conexión con SQL Server. Comprueba la instancia SQLEXPRESS y la base KarinaPolo." });
  }
});

app.get("/api/appointments", async (request, response) => {
  try {
    const result = await runQuery(
      `SELECT id, customer_name, customer_phone, customer_email, service, appointment_date, appointment_time, price_cop, status, created_at
       FROM dbo.appointments
       ORDER BY appointment_date DESC, appointment_time DESC`
    );
    response.json(result.recordset);
  } catch (error) {
    console.error("SQL Server appointments fetch failed:", error.code || error.message);
    response.status(503).json({ message: "No pudimos consultar las citas." });
  }
});

app.patch("/api/appointments/:id/status", async (request, response) => {
  const { id } = request.params;
  const { status } = request.body || {};
  const validStatuses = ["pending", "confirmed", "cancelled"];

  if (!validStatuses.includes(status)) {
    return response.status(400).json({ message: "El estado no es válido." });
  }

  try {
    const result = await runQuery(
      `UPDATE dbo.appointments
       SET status = @status
       WHERE id = @id;

       SELECT id, customer_name, customer_phone, customer_email, service, appointment_date, appointment_time, price_cop, status, created_at
       FROM dbo.appointments
       WHERE id = @id;`,
      { status, id: Number(id) }
    );

    if (!result.recordset || result.recordset.length === 0) {
      return response.status(404).json({ message: "No se encontró la cita." });
    }

    return response.json(result.recordset[0]);
  } catch (error) {
    console.error("SQL Server status update failed:", error.code || error.message);
    return response.status(503).json({ message: "No pudimos actualizar la cita." });
  }
});

app.get("/api/appointments/availability", async (request, response) => {
  const appointmentDate = request.query.date;
  if (typeof appointmentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    return response.status(400).json({ message: "La fecha seleccionada no es válida." });
  }
  const parsedDate = new Date(`${appointmentDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== appointmentDate) {
    return response.status(400).json({ message: "La fecha seleccionada no es válida." });
  }
  if (parsedDate.getUTCDay() === 1) return response.json({ booked_times: [] });

  try {
    const result = await runQuery(
      `SELECT CONVERT(varchar(5), appointment_time, 108) AS booked_time
       FROM dbo.appointments
       WHERE appointment_date = CONVERT(date, @appointmentDate)
         AND status <> N'cancelled'`,
      { appointmentDate }
    );
    return response.json({ booked_times: result.recordset.map(row => row.booked_time) });
  } catch (error) {
    console.error("SQL Server availability query failed:", error.code || error.message);
    return response.status(503).json({ message: "No pudimos consultar los horarios disponibles." });
  }
});

app.post("/api/appointments", async (request, response) => {
  const {
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    service,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime
  } = request.body || {};

  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim() : "";
  const price = services[service];

  if (!cleanName || cleanName.length > 120 || !cleanPhone || cleanPhone.length > 30) {
    return response.status(400).json({ message: "Revisa el nombre y el teléfono." });
  }
  if (cleanEmail && (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))) {
    return response.status(400).json({ message: "El correo electrónico no es válido." });
  }
  if (!price) return response.status(400).json({ message: "El servicio seleccionado no es válido." });
  if (typeof appointmentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    return response.status(400).json({ message: "La fecha seleccionada no es válida." });
  }
  const parsedDate = new Date(`${appointmentDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== appointmentDate) {
    return response.status(400).json({ message: "La fecha seleccionada no es válida." });
  }
  if (parsedDate.getUTCDay() === 1) return response.status(400).json({ message: "La peluquería no atiende los lunes." });
  if (typeof appointmentTime !== "string" || !/^([01]\d|19):00$/.test(appointmentTime) || Number(appointmentTime.slice(0, 2)) < 7) {
    return response.status(400).json({ message: "La hora debe estar entre 7:00 a. m. y 7:00 p. m." });
  }

  try {
    const result = await runQuery(
      `INSERT INTO dbo.appointments
        (customer_name, customer_phone, customer_email, service, appointment_date, appointment_time, price_cop, status)
       OUTPUT INSERTED.id
       VALUES
        (@customerName, @customerPhone, @customerEmail, @service,
         CONVERT(date, @appointmentDate), CONVERT(time(0), @appointmentTime), @priceCop, N'pending')`,
      {
        customerName: cleanName,
        customerPhone: cleanPhone,
        customerEmail: cleanEmail || null,
        service,
        appointmentDate,
        appointmentTime,
        priceCop: price
      }
    );
    return response.status(201).json({ id: result.recordset[0].id, message: "Cita guardada." });
  } catch (error) {
    if (error.number === 2601 || error.number === 2627) {
      return response.status(409).json({ message: "Ese horario acaba de ocuparse. Elige otra hora." });
    }
    console.error("SQL Server appointment insert failed:", error.code || error.number || error.message);
    return response.status(503).json({ message: "No pudimos guardar la cita. Verifica SQL Server Express y la base KarinaPolo." });
  }
});

async function start() {
  try {
    await getPool();
    app.listen(port, () => console.log(`Karina Polo está disponible en http://localhost:${port}`));
  } catch (error) {
    console.error("No se pudo conectar a SQL Server Express:", error.code || error.message);
    console.error("Confirma que SQLEXPRESS esté iniciado y que la base KarinaPolo exista.");
    process.exit(1);
  }
}

start();
