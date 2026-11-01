import { redirect } from "next/navigation";

// Flowko: the upstream referral programme is not part of this product. The route file stays, because the
// framing lock and the reserved usernames are derived from the route scan, and anyone who opens an old
// link lands on the event types. No metadata: the upstream title and offer must not appear.
export default function ReferralsPage() {
  redirect("/event-types");
}
