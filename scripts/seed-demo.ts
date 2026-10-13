// Optional sample data for trying the dashboard: bookings, payments, enquiries, room types,
// transfers, cars and Umrah packages. Not needed in production. Usage: npm run db:seed-demo
import { Client } from "pg";
import * as bookings from "./demo/bookings";
import * as catalog from "./demo/catalog";
import * as services from "./demo/services";
import * as admin from "./demo/admin";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  for (const [name, mod] of Object.entries({ catalog, services, admin, bookings })) {
    await mod.run(c);
    console.log(`demo: ${name}`);
  }
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
