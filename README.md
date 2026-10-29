# KG Mail Portal

Sends each selected user their own PDF (`<userCode>.pdf`) by email. One application: a **React** page and a **Node.js** (Express) API, with a **Turso** (libSQL) database. It runs in two places that share the same database:

| | Vercel (cloud) | Windows server (office) |
| --- | --- | --- |
| Sign in, choose users, preview and send PDFs | ✓ | ✓ |
| PDF folder | chosen on your own computer in the browser | same |
| Daily schedules (several times a day) | – | ✓ reads PDFs from a server folder |
| User list | read from Turso | copies the office employee API into Turso every hour |
| History | shared | shared |

## Using the portal

Sign in (default **admin / admin**; change it with `ADMIN_PASSWORD`).

**Send mail**

| Field | |
| --- | --- |
| Company | From `comCode` |
| User | Multi-select, shown as `FP10001-RAVI KUMAR SHAH` |
| Subject | `{}` becomes the user code: `{}-Attachment` → `FP10001-Attachment` |
| Message | `{}` becomes the user name: `Dear {},` → `Dear RAVI KUMAR SHAH,` |
| CC | Type an address, press **Add** or Enter |
| Path | **Choose folder…** opens your computer's folder picker; files must be named `<userCode>.pdf` |

**Check Mail Format** previews every mail (subject, attachment, message) and lists users with no PDF. **Send Mail** sends one email per user found, with a progress bar. Only each user's own PDF is uploaded, at send time (max 4 MB per PDF on Vercel). `{employeeCode}`, `{employeeName}` and `{date}` also work.

Other pages: **Shared email** (same message and files to several users), **Users** (paste or upload the employee API JSON; the Windows server also syncs it), **Daily schedules** (Windows server) and **History**.

A mail the server accepted is never sent twice by a retry; a mail with an uncertain result is never resent automatically.

## Deploy on Vercel

1. Import this GitHub repository in Vercel (**Add New → Project**). The settings come from `vercel.json` (build `npm run build`, output `dist`, API in `api/index.js`).
2. Add these **Environment Variables** (Production):

| Name | Value |
| --- | --- |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | your sign-in password |
| `SESSION_SECRET` | a long random string |
| `TURSO_DATABASE_URL` | `libsql://…turso.io` |
| `TURSO_AUTH_TOKEN` | Turso token |
| `SMTP_USER` | sender Gmail / Google Workspace address |
| `SMTP_PASSWORD` | its Gmail app password |
| `DEFAULT_CC` | CC prefilled on the page (optional) |
| `SMTP_HOST`, `SMTP_PORT` | optional, default `smtp.gmail.com`, `587` |

3. Deploy. Fill the user list once: on the **Users** page paste the employee API JSON, or let the Windows server sync it.

Never commit secrets; `.env` is git-ignored.

## Windows server (schedules and user sync)

In an Administrator PowerShell window in the project folder:

```powershell
copy .env.example .env                     # then edit
.\scripts\Set-Secret.ps1 SMTP_PASSWORD
.\scripts\Set-Secret.ps1 TURSO_AUTH_TOKEN
.\scripts\Set-Secret.ps1 ADMIN_PASSWORD    # optional, default admin
.\scripts\Portal-Service.ps1 install       # http://127.0.0.1:6001/ on that server
```

`Portal-Service.ps1 status | restart | update | stop | start | uninstall`. Secrets are stored encrypted for the machine (DPAPI) in `C:\ProgramData\KGMailPortal\secrets`; logs are in `logs\`. With `LOCAL_ONLY=true` the service answers only on that server.

`npm run sync-users` copies the employee API into Turso once (from any PC in the office network).

## Development

```bash
npm install
npm run dev        # API + React with live reload on http://127.0.0.1:6001/
npm run typecheck
npm run build      # dist/
```

| Folder | |
| --- | --- |
| `src/` | React page |
| `server/app.js` | API routes (shared) |
| `server/index.js` | Windows server: static files, schedules, hourly user sync |
| `api/index.js` | Vercel function |
| `server/` | `auth.js` sign-in, `employees.js` users, `mail.js` sending, `pdfs.js`, `scheduler.js`, `db.js` Turso |
| `scripts/` | Windows service and secret scripts, `sync-users.js` |
