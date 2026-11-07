import { isFlowkoDeskEmail } from "./flowkoBusiness/deskEmail";

export default function isSmsCalEmail(email: string) {
  // Flowko U25: a desk-only worker's @flowko.invalid placeholder is a faux recipient too (never mailed, hidden in the UI)
  return email.endsWith("@sms.cal.com") || isFlowkoDeskEmail(email);
}
