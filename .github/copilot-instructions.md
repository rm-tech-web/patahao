# PATAHAO Workspace Notes

- Use Node.js 20.6 or newer. The server uses Node built-ins and has no npm dependencies.
- Keep renter, landlord and admin capabilities behind the existing authenticated API routes.
- Admin identity comes from `PATAHAO_ADMIN_EMAIL`; never add hidden access paths or hardcoded passwords.
- Escape user and map data by rendering it as text, not HTML.
- Keep uploaded media type-checked and size-limited; never commit `.env`, account data or uploads.
- Listings shown as samples are illustrative; do not present them as verified real homes.
- Run `npm start` after copying `.env.example` to `.env` and setting a unique admin password.
