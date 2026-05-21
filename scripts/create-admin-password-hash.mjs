import crypto from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(crypto.scrypt);
const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/create-admin-password-hash.mjs \"password-admin\"");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const derivedKey = await scryptAsync(password, salt, 64, {
  N: 16384,
  r: 8,
  p: 1
});

console.log(`scrypt$16384$8$1$${salt.toString("base64")}$${derivedKey.toString("base64")}`);
