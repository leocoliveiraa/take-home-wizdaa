const path = require("path");

function ensureDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
  }

  return process.env.DATABASE_URL;
}

module.exports = {
  ensureDatabaseUrl,
};
