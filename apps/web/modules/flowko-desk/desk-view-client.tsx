// Flowko U28: client-only. The desk draws dates and hours in the business time zone, the server in its own (UTC)
// and the browser in the viewer's, so a server-rendered desk would throw React #418 (U19 precedent,
// bookings-view.tsx). The dynamic import with ssr: false lives here because Next refuses it in a Server Component.
"use client";

import dynamic from "next/dynamic";

const DeskView = dynamic(() => import("./desk-view"), { ssr: false });

export function DeskViewClient() {
  return <DeskView />;
}
