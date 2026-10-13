// Optional sample data for trying the dashboard: bookings, payments, enquiries, room types,
// transfers, cars and Umrah packages. Not needed in production. Usage: npm run db:seed-demo
import { Client } from "pg";
import * as bookings from "./demo/bookings.js";
import * as catalog from "./demo/catalog.js";
import * as services from "./demo/services.js";
import * as admin from "./demo/admin.js";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  for (const [name, mod] of Object.entries({ catalog, services, admin, bookings })) {
    await mod.run(c);
    console.log(`demo: ${name}`);
  }
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
