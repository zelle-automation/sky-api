// Every /api/admin route requires a signed-in staff member; each router checks the
// sub-tab permission ("bookings.cancelled", "payments.methods", ...) for what it serves.
import { Router } from "express";
import { requireAuth } from "../../lib/auth.js";
import bookings from "./bookings.js";
import cars from "./cars.js";
import destinations from "./destinations.js";
import documents from "./documents.js";
import enquiries from "./enquiries.js";
import excursions from "./excursions.js";
import homepage from "./homepage.js";
import hotels from "./hotels.js";
import media from "./media.js";
import overview from "./overview.js";
import packages from "./packages.js";
import payments from "./payments.js";
import settings from "./settings.js";
import subscribers from "./subscribers.js";
import transfers from "./transfers.js";
import umrah from "./umrah.js";
import users from "./users.js";
import visa from "./visa.js";

const r = Router();
r.use(requireAuth);
r.use("/overview", overview);
r.use("/bookings", bookings);
r.use("/enquiries", enquiries);
r.use("/payments", payments);
r.use("/documents", documents);
r.use("/hotels", hotels);
r.use("/excursions", excursions);
r.use("/packages", packages);
r.use("/umrah", umrah);
r.use("/transfers", transfers);
r.use("/cars", cars);
r.use("/destinations", destinations);
r.use("/visa", visa);
r.use("/homepage", homepage);
r.use("/media", media);
r.use("/subscribers", subscribers);
r.use("/users", users);
r.use("/settings", settings);

export default r;
