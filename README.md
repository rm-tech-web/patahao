# PATAHAO

PATAHAO is a free-to-list Nairobi rental discovery prototype for students, renters and local landlords. It includes area and rent filters, sample listings, OpenStreetMap pins, opt-in nearby hospital search, landlord accounts, photo/video uploads, community ratings and an admin verification queue.

## Run on Windows

1. Install Node.js 20.6 or newer. This project has no npm dependencies.
2. In this folder, copy `.env.example` to `.env` and set the administrator email and name plus a unique password of at least 12 characters.
3. Start the app with `npm start` (or use `npm run dev` while editing).
4. Open `http://localhost:3000` in a browser.

The administrator signs in with the configured `PATAHAO_ADMIN_EMAIL` and `PATAHAO_ADMIN_PASSWORD`. Keep `.env` private. Run `npm run check` to check the JavaScript syntax.

## Local data and free services

Accounts, listings and ratings are stored in `data/*.json`; uploaded files are stored in `public/uploads/`. Generated data and uploads are ignored by git. Local development seeds four clearly labelled sample listings. Do not represent them as real homes or verified landlords. Landlords must provide a public contact email for each new listing; renters are sent to that address using their own email app.

The app charges no listing fee and needs no paid API key. Map tiles and nearby hospital results use OpenStreetMap services. They require an internet connection and are subject to those services' attribution and fair-use policies. Location is only requested after a user chooses “Find near me”; approximate coordinates are sent to the public Overpass service for the search.

## Deploy a small public beta on Render

1. Create a **public GitHub repository** for this project and push the source. Confirm `.env`, account data and uploads are not included.
2. In Render, create a Blueprint deployment from that GitHub repository; Render reads `render.yaml`.
3. Enter `PATAHAO_ADMIN_EMAIL` and a new, unique `PATAHAO_ADMIN_PASSWORD` in Render's environment settings. Use a password manager to generate the password. Do not reuse a local development password. Admin email and password are deliberately not committed to the public repository; production fails to start until both are set.
4. Deploy and check that `/api/health` returns `{"status":"ok"}`. Sign in with the configured admin email and password.
5. Add only genuine listings with permission from the landlord. The Render configuration disables demo listing seeding.

The Blueprint uses a **paid Render web service and persistent disk**. The disk stores JSON data and uploads across restarts; without it, those files would be lost on redeploy. Keep this service to one instance: the JSON-file storage and in-memory sessions/rate limits are not safe for multiple instances or horizontal scaling. Arrange and test backups of the persistent disk before accepting important user data.

## Security and launch limits

Passwords are stored as salted scrypt hashes. The server uses HttpOnly/SameSite cookies, production Secure cookies, CSRF and same-origin checks, basic per-process login throttling, security headers and upload type/size checks. Production startup fails unless an admin email and password are configured. Never put secrets in source control or GitHub Actions logs.

This setup is a **small public beta**, not production-ready housing infrastructure. Before relying on it for real users, add a maintained database and persistent session store, distributed abuse controls, monitored backups and recovery tests, privacy/retention and user-reporting procedures, and an independent property/identity verification process. Listing contact emails are public. The admin approval is a manual status change, not proof of legal ownership. Ratings are community feedback, not proof of tenancy or endorsement. Publish clear privacy and service terms before collecting real account data. Never send deposits before independently viewing and verifying a property.

## Useful files

- `server.mjs` - Node HTTP server and API routes
- `public/index.html` - page structure and forms
- `public/styles.css` - responsive visual design
- `public/app.js` - filters, map, accounts and listing interactions
- `.env.example` - local admin configuration template
- `render.yaml` - Render Blueprint for the public beta
