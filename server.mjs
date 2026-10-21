import { createServer } from 'node:http';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = path.resolve(process.env.PATAHAO_DATA_DIR || path.join(root, 'data'));
const uploadDir = path.resolve(process.env.PATAHAO_UPLOAD_DIR || path.join(publicDir, 'uploads'));
const adminEmail = normalizeEmail(process.env.PATAHAO_ADMIN_EMAIL);
const adminName = (process.env.PATAHAO_ADMIN_NAME || 'Site Administrator').trim();
const adminPassword = process.env.PATAHAO_ADMIN_PASSWORD || '';
const port = Number(process.env.PORT || 3000);
const seedDemoListings = process.env.PATAHAO_SEED_DEMO_LISTINGS !== 'false';
const maxBodyBytes = 46 * 1024 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const initialListings = [
  {
    id: 'demo-kilimani', title: 'Bright bedsitter near Ngong Road', area: 'Kilimani', rent: 18000,
    bedrooms: 1, type: 'Bedsitter', furnished: true, utilities: ['Water', 'Wi-Fi ready'],
    latitude: -1.2921, longitude: 36.7824, landlordName: 'Sample landlord',
    landlordVerified: false,
    description: 'A compact, furnished space with reliable water and quick access to matatus.', demo: true,
  },
  {
    id: 'demo-kasarani', title: 'Student-friendly shared apartment', area: 'Kasarani', rent: 9500,
    bedrooms: 2, type: 'Shared room', furnished: true, utilities: ['Water', 'Security'],
    latitude: -1.2218, longitude: 36.8978, landlordName: 'Sample landlord',
    landlordVerified: false,
    description: 'A tidy shared option close to shops and public transport. Ask about room availability.', demo: true,
  },
  {
    id: 'demo-ruaraka', title: 'Quiet one-bedroom with balcony', area: 'Ruaraka', rent: 22000,
    bedrooms: 1, type: 'Apartment', furnished: false, utilities: ['Water', 'Parking'],
    latitude: -1.2489, longitude: 36.8783, landlordName: 'Sample landlord',
    landlordVerified: false,
    description: 'One-bedroom apartment in a small compound, with a balcony and nearby bus routes.', demo: true,
  },
  {
    id: 'demo-embakasi', title: 'Affordable room near public transport', area: 'Embakasi', rent: 7500,
    bedrooms: 1, type: 'Single room', furnished: false, utilities: ['Water'],
    latitude: -1.3197, longitude: 36.9002, landlordName: 'Sample landlord',
    landlordVerified: false,
    description: 'A simple room option with nearby shops and an easy walk to public transport.', demo: true,
  },
];

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}

const usersFile = path.join(dataDir, 'users.json');
const listingsFile = path.join(dataDir, 'listings.json');
const reviewsFile = path.join(dataDir, 'reviews.json');

async function initialize() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  if (process.env.NODE_ENV === 'production') {
    if (!validEmail(adminEmail)) throw new Error('Set PATAHAO_ADMIN_EMAIL to a valid email address in production.');
    if (!adminPassword) throw new Error('Set PATAHAO_ADMIN_PASSWORD in production.');
  }
  if (adminName.length < 2 || adminName.length > 80) {
    throw new Error('PATAHAO_ADMIN_NAME must be between 2 and 80 characters.');
  }
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(uploadDir, { recursive: true })]);
  if (!(await readJson(listingsFile, null))) await writeJson(listingsFile, seedDemoListings ? initialListings : []);
  if (!(await readJson(usersFile, null))) await writeJson(usersFile, []);
  if (!(await readJson(reviewsFile, null))) await writeJson(reviewsFile, []);

  if (adminPassword) {
    if (adminPassword.length < 12 || adminPassword.length > 128) {
      throw new Error('PATAHAO_ADMIN_PASSWORD must be between 12 and 128 characters.');
    }
    if (!validEmail(adminEmail)) throw new Error('PATAHAO_ADMIN_EMAIL must be a valid email address.');
    const users = await readJson(usersFile, []);
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(adminPassword, salt, 64)).toString('hex');
    const existing = users.findIndex((user) => user.email === adminEmail);
    const admin = {
      id: existing >= 0 ? users[existing].id : randomBytes(16).toString('hex'),
      name: adminName, email: adminEmail, role: 'admin', verified: true, salt, hash,
    };
    if (existing >= 0) users[existing] = admin;
    else users.push(admin);
    await writeJson(usersFile, users);
  } else {
    console.warn('Admin login is disabled. Set PATAHAO_ADMIN_PASSWORD before starting the server.');
  }
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; media-src 'self'; connect-src 'self' https://overpass-api.de; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
}

function readBody(request, limit = maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON request.'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function cookieValue(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

async function currentUser(request) {
  const token = cookieValue(request, 'patahao_session');
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const users = await readJson(usersFile, []);
  return users.find((user) => user.id === session.userId) || null;
}

function csrfFor(request) {
  const token = cookieValue(request, 'patahao_session');
  return sessions.get(token)?.csrf || '';
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `patahao_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `patahao_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function requireUser(request, response, role) {
  const user = await currentUser(request);
  if (!user) {
    sendJson(response, 401, { error: 'Sign in to continue.' });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(response, 403, { error: 'You do not have permission to do that.' });
    return null;
  }
  if (request.headers['x-csrf-token'] !== csrfFor(request)) {
    sendJson(response, 403, { error: 'Security token expired. Refresh and try again.' });
    return null;
  }
  return user;
}

function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, verified: Boolean(user.verified) };
}

async function issueSession(response, user) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, csrf, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  setSessionCookie(response, token);
  return csrf;
}

function isAllowedMedia(bytes, kind) {
  if (kind === 'photo') {
    return (bytes.subarray(0, 3).toString('hex') === 'ffd8ff')
      || bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
  }
  return (bytes.length > 12 && bytes.subarray(4, 8).toString() === 'ftyp')
    || bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
}

async function saveMedia(file, kind) {
  const data = typeof file === 'string' ? file : file?.data;
  if (typeof data !== 'string') return '';
  const match = data.match(/^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error(`Choose a supported ${kind} file.`), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  const limit = kind === 'photo' ? 8 * 1024 * 1024 : 24 * 1024 * 1024;
  if (!bytes.length || bytes.length > limit || !isAllowedMedia(bytes, kind)) {
    throw Object.assign(new Error(`The ${kind} file is invalid or too large.`), { status: 400 });
  }
  const extension = match[1].split('/')[1].replace('jpeg', 'jpg');
  const filename = `${randomBytes(16).toString('hex')}.${extension}`;
  await writeFile(path.join(uploadDir, filename), bytes, { flag: 'wx', mode: 0o644 });
  return `/uploads/${filename}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128;
}

async function handleApi(request, response, url) {
  const method = request.method;
  const route = url.pathname;

  if (method === 'GET' && route === '/api/listings') {
    const [listings, reviews, users] = await Promise.all([
      readJson(listingsFile, []), readJson(reviewsFile, []), readJson(usersFile, []),
    ]);
    const results = listings.map((listing) => {
      const landlord = users.find((user) => user.id === listing.ownerId);
      const landlordReviews = reviews.filter((review) => review.landlordId === (listing.ownerId || listing.id));
      const average = landlordReviews.length
        ? landlordReviews.reduce((sum, review) => sum + review.rating, 0) / landlordReviews.length : 0;
      return {
        ...listing,
        landlordName: landlord?.name || listing.landlordName || 'Local landlord',
        landlordVerified: !listing.demo && Boolean(landlord?.verified || listing.landlordVerified),
        rating: Number(average.toFixed(1)),
        reviewCount: landlordReviews.length,
      };
    });
    sendJson(response, 200, results);
    return;
  }

  if (method === 'GET' && route === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (method === 'GET' && route === '/api/me') {
    const user = await currentUser(request);
    sendJson(response, 200, { user: user ? cleanUser(user) : null, csrf: user ? csrfFor(request) : '' });
    return;
  }

  if (method === 'POST' && (route === '/api/auth/register' || route === '/api/auth/login')) {
    if (!sameOrigin(request)) return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    const body = await readBody(request, 16 * 1024);
    const ip = request.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (attempts.resetAt < Date.now()) { attempts.count = 0; attempts.resetAt = Date.now() + 15 * 60 * 1000; }
    if (attempts.count >= 10) return sendJson(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });

    const email = normalizeEmail(body.email);
    if (!validEmail(email) || typeof body.password !== 'string') {
      return sendJson(response, 400, { error: 'Enter a valid email and password.' });
    }
    const users = await readJson(usersFile, []);
    let user;
    if (route.endsWith('/register')) {
      const name = String(body.name || '').trim();
      const role = body.role === 'landlord' ? 'landlord' : 'tenant';
      if (email === adminEmail) return sendJson(response, 409, { error: 'This email is reserved for the site administrator.' });
      if (!validPassword(body.password)) return sendJson(response, 400, { error: 'Use a password between 12 and 128 characters.' });
      if (name.length < 2 || name.length > 80) return sendJson(response, 400, { error: 'Enter a name between 2 and 80 characters.' });
      if (users.some((entry) => entry.email === email)) return sendJson(response, 409, { error: 'An account with this email already exists.' });
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(body.password, salt, 64)).toString('hex');
      user = { id: randomBytes(16).toString('hex'), name, email, role, verified: false, salt, hash };
      users.push(user);
      await writeJson(usersFile, users);
    } else {
      user = users.find((entry) => entry.email === email);
      if (!user || !user.salt || !user.hash) {
        attempts.count += 1;
        loginAttempts.set(ip, attempts);
        return sendJson(response, 401, { error: 'Email or password is incorrect.' });
      }
      const candidate = await scrypt(body.password, user.salt, 64);
      const expected = Buffer.from(user.hash, 'hex');
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
        attempts.count += 1;
        loginAttempts.set(ip, attempts);
        return sendJson(response, 401, { error: 'Email or password is incorrect.' });
      }
    }
    loginAttempts.delete(ip);
    const csrf = await issueSession(response, user);
    sendJson(response, 200, { user: cleanUser(user), csrf });
    return;
  }

  if (method === 'POST' && route === '/api/auth/logout') {
    const token = cookieValue(request, 'patahao_session');
    if (request.headers['x-csrf-token'] !== csrfFor(request)) return sendJson(response, 403, { error: 'Security token expired.' });
    sessions.delete(token);
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === 'POST' && route === '/api/listings') {
    const user = await requireUser(request, response, 'landlord');
    if (!user) return;
    const body = await readBody(request);
    const title = String(body.title || '').trim();
    const area = String(body.area || '').trim();
    const contactEmail = normalizeEmail(body.contactEmail);
    const description = String(body.description || '').trim();
    const rent = Number(body.rent);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (title.length < 8 || title.length > 100 || area.length < 2 || area.length > 80 || description.length < 20 || description.length > 1200) {
      return sendJson(response, 400, { error: 'Check the title, Nairobi area and 20-1,200 character description.' });
    }
    if (!validEmail(contactEmail)) return sendJson(response, 400, { error: 'Enter a valid public contact email for this listing.' });
    if (!Number.isInteger(rent) || rent < 1000 || rent > 2000000) return sendJson(response, 400, { error: 'Enter a monthly rent between KSh 1,000 and KSh 2,000,000.' });
    if (!Number.isFinite(latitude) || latitude < -1.6 || latitude > -1.0 || !Number.isFinite(longitude) || longitude < 36.5 || longitude > 37.2) {
      return sendJson(response, 400, { error: 'Choose a location in or near Nairobi.' });
    }
    const photo = await saveMedia(body.photo, 'photo');
    const video = await saveMedia(body.video, 'video');
    if (!photo) return sendJson(response, 400, { error: 'Add at least one property photo.' });
    const listing = {
      id: randomBytes(12).toString('hex'), title, area, contactEmail, description, rent, latitude, longitude,
      bedrooms: Math.max(0, Math.min(10, Number.parseInt(body.bedrooms, 10) || 0)),
      type: ['Bedsitter', 'Single room', 'Shared room', 'Apartment', 'House'].includes(body.type) ? body.type : 'Apartment',
      furnished: Boolean(body.furnished), utilities: Array.isArray(body.utilities) ? body.utilities.slice(0, 8).map((item) => String(item).slice(0, 30)) : [],
      photo, video, ownerId: user.id, landlordName: user.name, landlordVerified: user.verified,
      createdAt: new Date().toISOString(), demo: false,
    };
    const listings = await readJson(listingsFile, []);
    listings.unshift(listing);
    await writeJson(listingsFile, listings);
    sendJson(response, 201, listing);
    return;
  }

  if (method === 'POST' && route === '/api/verification-requests') {
    const user = await requireUser(request, response, 'landlord');
    if (!user) return;
    if (user.verified) return sendJson(response, 409, { error: 'This landlord account is already verified.' });
    const users = await readJson(usersFile, []);
    const target = users.find((entry) => entry.id === user.id);
    target.verificationRequestedAt = new Date().toISOString();
    await writeJson(usersFile, users);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === 'POST' && route === '/api/reviews') {
    const user = await requireUser(request, response);
    if (!user) return;
    const body = await readBody(request, 8 * 1024);
    const rating = Number(body.rating);
    const listings = await readJson(listingsFile, []);
    const listing = listings.find((entry) => entry.id === body.listingId);
    const landlordId = listing?.ownerId || listing?.id;
    if (!listing || listing.demo) return sendJson(response, 404, { error: 'Reviews are available for live listings only.' });
    if (listing.ownerId === user.id) return sendJson(response, 403, { error: 'You cannot review your own listing.' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return sendJson(response, 400, { error: 'Choose a rating from 1 to 5.' });
    const reviews = await readJson(reviewsFile, []);
    if (reviews.some((review) => review.listingId === listing.id && review.userId === user.id)) {
      return sendJson(response, 409, { error: 'You have already reviewed this listing.' });
    }
    const comment = String(body.comment || '').trim().slice(0, 300);
    reviews.push({ id: randomBytes(12).toString('hex'), listingId: listing.id, landlordId, userId: user.id, reviewerName: user.name, rating, comment, createdAt: new Date().toISOString() });
    await writeJson(reviewsFile, reviews);
    sendJson(response, 201, { ok: true });
    return;
  }

  if (method === 'GET' && route === '/api/admin/verification-requests') {
    const user = await currentUser(request);
    if (!user || user.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required.' });
    if (request.headers['x-csrf-token'] !== csrfFor(request)) return sendJson(response, 403, { error: 'Security token expired.' });
    const users = await readJson(usersFile, []);
    sendJson(response, 200, users.filter((entry) => entry.role === 'landlord' && entry.verificationRequestedAt && !entry.verified).map(cleanUser));
    return;
  }

  const approveMatch = route.match(/^\/api\/admin\/verification-requests\/([a-f0-9]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    const user = await requireUser(request, response, 'admin');
    if (!user) return;
    const users = await readJson(usersFile, []);
    const landlord = users.find((entry) => entry.id === approveMatch[1] && entry.role === 'landlord');
    if (!landlord || !landlord.verificationRequestedAt) return sendJson(response, 404, { error: 'Verification request not found.' });
    landlord.verified = true;
    landlord.verificationRequestedAt = '';
    await writeJson(usersFile, users);
    const listings = await readJson(listingsFile, []);
    for (const listing of listings) if (listing.ownerId === landlord.id) listing.landlordVerified = true;
    await writeJson(listingsFile, listings);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

async function serveStatic(request, response, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendJson(response, 400, { error: 'Invalid path.' }); }
  const servingUpload = decoded.startsWith('/uploads/');
  const baseDir = servingUpload ? uploadDir : publicDir;
  const relative = servingUpload ? decoded.slice('/uploads/'.length) : decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.resolve(baseDir, relative);
  if (!relative || !target.startsWith(`${baseDir}${path.sep}`)) return sendJson(response, 403, { error: 'Forbidden.' });
  try {
    const body = await readFile(target);
    const extension = path.extname(target).toLowerCase();
    response.writeHead(200, { 'Content-Type': mimeTypes[extension] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Could not read file.' });
  }
}

await initialize();
const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (!sameOrigin(request) && request.method !== 'GET') return sendJson(response, 403, { error: 'Request origin is not allowed.' });
      await handleApi(request, response, url);
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      await serveStatic(request, response, url.pathname);
    } else {
      sendJson(response, 405, { error: 'Method not allowed.' });
    }
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'The request could not be completed.' });
    else response.destroy();
    if (!error.status) console.error(error);
  }
});

server.listen(port, () => console.log(`PATAHAO is running at http://localhost:${port}`));
