# Resend API notes

Source: https://resend.com/docs/api-reference/emails/send-email

The Send Email API uses POST https://api.resend.com/emails with an Authorization: Bearer <API key> header and Content-Type: application/json. Required payload fields are `from`, `to`, and `subject`; this implementation uses `html` and `text`. Resend supports an `Idempotency-Key` header to prevent duplicate requests for up to 24 hours. The sender address must be a verified sender/domain in Resend. Attachments are supported by the API but are not included in the first email implementation; the email currently contains invoice details and payment options in HTML and plain text.
