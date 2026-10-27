# Karina Polo Peluquería

La agenda usa un servidor Node.js y SQL Server Express. No abras `index.html` directamente con `file://`; las reservas se envían a la API local.

## Preparar SQL Server Express

1. En SSMS, abre `schema.sql` y ejecútalo. El script crea una base nueva llamada `KarinaPolo` y `dbo.appointments`; no usa `master` ni modifica las otras tablas.
2. La aplicación usa autenticación integrada de Windows con la cuenta que ejecuta Node. Esa cuenta debe tener permisos para conectar a `KarinaPolo` y escribir en `dbo.appointments`.
3. El equipo necesita SQL Server Express `SQLEXPRESS` iniciado y el controlador ODBC de SQL Server de 64 bits. La configuración usa `ODBC Driver 18 for SQL Server`.

## Configurar la conexión

Si aún no existe `.env`, desde PowerShell en la carpeta del proyecto ejecuta:

```powershell
Copy-Item .env.example .env
```

La configuración predeterminada es `localhost`, instancia `SQLEXPRESS`, base `KarinaPolo` y autenticación Windows. Si tu instancia o base tienen otro nombre, cambia `DB_INSTANCE` o `DB_NAME` en `.env`. No hay que guardar una contraseña SQL cuando `DB_TRUSTED_CONNECTION=true`.

## Ejecutar localmente

```powershell
npm install
npm start
```

Abre `http://localhost:3000` o ejecuta **Abrir peluquería en Chrome** desde VS Code. La conexión se valida al iniciar. El endpoint `GET /api/health` devuelve `{"ok":true}` cuando llega a SQL Server.

Las citas se guardan en `KarinaPolo.dbo.appointments`. La disponibilidad se consulta en la base y el índice único de fecha/hora impide reservas simultáneas duplicadas.

## Publicar

Netlify, al publicar archivos estáticos, no ejecuta este backend ni puede alcanzar una instancia SQL Server que corre en tu PC. Para producción, aloja la API Node en un servidor con acceso de red a SQL Server; no pongas contraseñas en JavaScript del navegador. No expongas SQL Server Express directamente a Internet.
