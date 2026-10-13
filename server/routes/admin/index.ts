// Every /api/admin route requires a signed-in staff member; each router checks the
// sub-tab permission ("bookings.cancelled", "payments.methods", ...) for what it serves.
import { Router } from "express";
import { requireAuth } from "../../lib/auth";
import bookings from "./bookings";
import cars from "./cars";
import destinations from "./destinations";
import documents from "./documents";
import enquiries from "./enquiries";
import excursions from "./excursions";
import homepage from "./homepage";
import hotels from "./hotels";
import media from "./media";
import overview from "./overview";
import packages from "./packages";
import payments from "./payments";
import settings from "./settings";
import subscribers from "./subscribers";
import transfers from "./transfers";
import umrah from "./umrah";
import users from "./users";
import visa from "./visa";

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
