// Shapes the API returns for the public catalogue; shared by the Express API and the Next.js pages.

/** One listing in any collection (hotel, excursion or package), shaped for the card, list and spotlight views. */

const CATEGORY_LABEL = { international: "International", domestic: "Domestic", umrah: "Umrah", honeymoon: "Honeymoon" };
export const categoryLabel = (c) => CATEGORY_LABEL[c] ?? c;
