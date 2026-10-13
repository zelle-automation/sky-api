// Defaults shared by the API and the dashboard for documents, branding and emails.
// Plain data only (no React), so the server and the demo seed can import it too.

export type Branding = {
  name: string;
  slogan: string;
  phone: string;
  email: string;
  web: string;
  cover_url: string;
  logo_url: string;
  logo_white_url: string;
  /** Contact pills in the voucher footer band; empty ones are hidden. */
  pills: { phone: boolean; email: boolean; web: boolean };
  lh_header_url: string;
  lh_footer_url: string;
  stamp_url: string;
  /** Which letterhead documents print the header/footer images. */
  letterhead_on: { invoice: boolean; quotation: boolean; "visa-letter": boolean; receipt: boolean };
  lh_space_mm: number;
  lh_side_mm: number;
};

export const DEFAULT_BRANDING: Branding = {
  name: "SKY HOLIDAYS",
  slogan: "EXPERIENCE THE EXCEPTIONAL",
  phone: "+92 311 11 33 020",
  email: "info@skyholidays.pk",
  web: "www.skyholidays.pk",
  cover_url: "/brand/docs/voucher-cover.jpg",
  logo_url: "/brand/docs/logo.png",
  logo_white_url: "/brand/docs/logo-white.png",
  pills: { phone: true, email: true, web: true },
  lh_header_url: "/brand/docs/letterhead-header.jpg",
  lh_footer_url: "/brand/docs/letterhead-footer.jpg",
  stamp_url: "",
  letterhead_on: { invoice: true, quotation: true, "visa-letter": true, receipt: true },
  lh_space_mm: 12,
  lh_side_mm: 18,
};

/** Editable texts printed on documents (Documents → each tab). */
export type DocTexts = {
  hotelInfo: string;
  transferInfo: string;
  invoiceTerms: string;
  quoteTerms: string;
  quoteIncluded: string;
  visaBody: string;
  receiptNote: string;
  showHotelContact: boolean;
  attachVoucher: boolean;
  signatory: string;
};

export const DEFAULT_TEXTS: DocTexts = {
  hotelInfo: "Please present this voucher at the hotel reception upon check-in.\nA valid government-issued ID or passport may be required.\nHotel policies, check-in / check-out times and applicable charges are subject to the property’s terms and conditions.\nAny additional charges (e.g. laundry, room service, mini bar, etc.) are payable by the guest directly to the hotel.\nThis voucher is non-transferable and valid only for the dates and details mentioned above.",
  transferInfo: "Your driver will wait at the arrivals exit holding a name board.\nFree waiting time is 60 minutes after your flight lands.\nIf you cannot find your driver, call or WhatsApp our 24/7 desk.\nPlease share any change in flight or passenger count at least 12 hours before pickup.",
  invoiceTerms: "Prices are in Pakistani rupees and include applicable taxes. Cancellation charges follow the policy shown at booking. This is a computer-generated invoice.",
  quoteTerms: "Prices are in Pakistani rupees and are subject to availability at the time of booking. Rates are confirmed only after a deposit. Flights are quoted at today’s fare.",
  quoteIncluded: "Visa · Return flights · Private transfers · Hotel stay as described · 24/7 support",
  visaBody: "We confirm that the travellers named below have booked a tourist trip to {{destination}} with Sky Holidays (Pvt) Ltd from {{start_date}} to {{end_date}}.\nTheir return flights and hotel accommodation at {{hotel}} are confirmed. Copies of the bookings are attached.\nWe kindly request you to grant them tourist visas for the above dates. Sky Holidays will be responsible for their travel arrangements during their stay.",
  receiptNote: "Thank you for your payment. Please keep this receipt for your records.",
  showHotelContact: true,
  attachVoucher: true,
  signatory: "Syed Osama Raheel",
};

/** Variables staff can insert into email templates. */
export const EMAIL_VARS = [
  "guest_name", "booking_ref", "product_name", "start_date", "end_date", "total", "paid", "balance",
  "link", "payment_link", "amount", "reason", "quote_no", "valid_until", "message", "company_name", "company_phone", "company_email",
] as const;

export type TemplateDefault = { key: string; name: string; trigger_label: string; attachments: string; subject: string; body: string };

export const DEFAULT_TEMPLATES: TemplateDefault[] = [
  {
    key: "booking_received", name: "Booking received", trigger_label: "When a guest books on the website", attachments: "None",
    subject: "We have your booking {{booking_ref}}",
    body: "Assalam o Alaikum {{guest_name}},\n\nThank you for choosing Sky Holidays. We have received your booking {{booking_ref}} for {{product_name}} on {{start_date}}.\n\nTotal: {{total}}\nPlease complete your payment here: {{payment_link}}\n\nOur team will confirm with the supplier and get back to you shortly.\n\nRegards,\n{{company_name}}\n{{company_phone}}",
  },
  {
    key: "booking_confirmed", name: "Booking confirmation", trigger_label: "When a booking is confirmed", attachments: "Voucher + invoice",
    subject: "Your booking {{booking_ref}} is confirmed",
    body: "Assalam o Alaikum {{guest_name}},\n\nThank you for booking {{product_name}} with Sky Holidays. Your booking {{booking_ref}} is confirmed for {{start_date}}.\n\nTotal: {{total}}\nBalance due: {{balance}}\n\nYour voucher and invoice are attached.\n\nRegards,\n{{company_name}}",
  },
  {
    key: "payment_received", name: "Payment received", trigger_label: "When a payment succeeds", attachments: "Receipt",
    subject: "Payment received for {{booking_ref}}",
    body: "Dear {{guest_name}},\n\nWe have received {{amount}} for your booking {{booking_ref}} ({{product_name}}).\n\nPaid so far: {{paid}}\nBalance: {{balance}}\n\nThank you,\n{{company_name}}",
  },
  {
    key: "slip_verified", name: "Bank slip verified", trigger_label: "When a guest’s bank slip is verified", attachments: "Receipt",
    subject: "Your payment slip for {{booking_ref}} is verified",
    body: "Dear {{guest_name}},\n\nYour bank transfer of {{amount}} for booking {{booking_ref}} has been verified.\n\nBalance: {{balance}}\n\nThank you,\n{{company_name}}",
  },
  {
    key: "booking_cancelled", name: "Booking cancelled", trigger_label: "When a booking is cancelled", attachments: "None",
    subject: "Booking {{booking_ref}} has been cancelled",
    body: "Dear {{guest_name}},\n\nYour booking {{booking_ref}} for {{product_name}} on {{start_date}} has been cancelled.\n\nReason: {{reason}}\n\nIf a refund is due, we will email you as soon as it is processed. Call us on {{company_phone}} with any questions.\n\nRegards,\n{{company_name}}",
  },
  {
    key: "refund_processed", name: "Refund processed", trigger_label: "When a refund is paid out", attachments: "None",
    subject: "Your refund for {{booking_ref}} is on its way",
    body: "Dear {{guest_name}},\n\nWe have processed a refund of {{amount}} for booking {{booking_ref}}. Depending on your bank it can take 3 to 10 working days to show in your account.\n\nRegards,\n{{company_name}}",
  },
  {
    key: "enquiry_reply", name: "Enquiry reply", trigger_label: "When you reply to an enquiry", attachments: "None",
    subject: "Re: your enquiry with Sky Holidays",
    body: "Assalam o Alaikum {{guest_name}},\n\n{{message}}\n\nRegards,\n{{company_name}}\n{{company_phone}}",
  },
  {
    key: "voucher", name: "Voucher", trigger_label: "When you press Email to guest on a voucher", attachments: "Voucher",
    subject: "Your voucher for {{product_name}} ({{booking_ref}})",
    body: "Dear {{guest_name}},\n\nPlease find your voucher for {{product_name}} on {{start_date}} attached. You can also open it here: {{link}}\n\nPlease show it at check-in or pickup.\n\nHave a wonderful trip,\n{{company_name}}",
  },
  {
    key: "invoice", name: "Invoice", trigger_label: "When you press Email to guest on an invoice", attachments: "Invoice",
    subject: "Invoice for your booking {{booking_ref}}",
    body: "Dear {{guest_name}},\n\nPlease find the invoice for {{product_name}} attached. You can also open it here: {{link}}\n\nTotal: {{total}}\nBalance due: {{balance}}\n\nRegards,\n{{company_name}}",
  },
  {
    key: "quotation", name: "Quotation", trigger_label: "When you send a quote", attachments: "Quotation",
    subject: "Your quotation {{quote_no}} from Sky Holidays",
    body: "Assalam o Alaikum {{guest_name}},\n\nThank you for your enquiry. Your quotation {{quote_no}} is attached and is valid until {{valid_until}}. You can also open it here: {{link}}\n\nReply to this email or call {{company_phone}} to confirm.\n\nRegards,\n{{company_name}}",
  },
  {
    key: "receipt", name: "Receipt", trigger_label: "When you press Email to guest on a receipt", attachments: "Receipt",
    subject: "Receipt for your payment on {{booking_ref}}",
    body: "Dear {{guest_name}},\n\nThank you for your payment of {{amount}}. Your receipt is attached and you can also open it here: {{link}}\n\nRegards,\n{{company_name}}",
  },
  {
    key: "visa_letter", name: "Visa letter", trigger_label: "When you press Email to guest on a visa letter", attachments: "Visa letter",
    subject: "Your visa support letter for {{booking_ref}}",
    body: "Dear {{guest_name}},\n\nYour visa support letter is attached. You can also open it here: {{link}}\n\nPlease print it and submit it with your visa application.\n\nRegards,\n{{company_name}}",
  },
  {
    key: "staff_alert", name: "Team alert", trigger_label: "Notifications to staff (Settings → Notifications)", attachments: "None",
    subject: "{{message}}",
    body: "{{message}}\n\n{{link}}",
  },
];

/** Replaces {{name}} with vars[name]; unknown names become empty. */
export function fillVars(text: string, vars: Record<string, string | number | null | undefined>) {
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}
